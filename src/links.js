// Todo relationships (parent/child and siblings) module

const { getAll, getById, insert, update, remove } = require('./db');
const { logAction } = require('./logging');

// Helper to get parent of a todo
async function getParent(todoId) {
  try {
    const links = await getAll('todo_links', { to_todo_id: todoId, type: 'parent' });
    if (Array.isArray(links) && links.length > 0) {
      const parentLink = links[0];
      const parent = await getById('todos', parentLink.from_todo_id);
      if (parent && !parent.archived) {
        return parent;
      }
    }
    return null;
  } catch (error) {
    console.error('Error fetching parent:', error);
    return null;
  }
}

// Helper to get children of a todo
async function getChildren(todoId) {
  try {
    const links = await getAll('todo_links', { from_todo_id: todoId, type: 'parent' });
    if (!Array.isArray(links)) {
      return [];
    }
    const children = [];
    for (const link of links) {
      const child = await getById('todos', link.to_todo_id);
      if (child && !child.archived) {
        children.push(child);
      }
    }
    return children;
  } catch (error) {
    console.error('Error fetching children:', error);
    return [];
  }
}

// Helper to get siblings of a todo
async function getSiblings(todoId) {
  try {
    const links = await getAll('todo_links', { type: 'sibling' });
    if (!Array.isArray(links)) {
      return [];
    }
    const siblings = [];
    for (const link of links) {
      let siblingId = null;
      if (link.from_todo_id === parseInt(todoId)) {
        siblingId = link.to_todo_id;
      } else if (link.to_todo_id === parseInt(todoId)) {
        siblingId = link.from_todo_id;
      }
      if (siblingId !== null) {
        const sibling = await getById('todos', siblingId);
        if (sibling && !sibling.archived) {
          siblings.push(sibling);
        }
      }
    }
    return siblings;
  } catch (error) {
    console.error('Error fetching siblings:', error);
    return [];
  }
}

// Helper to get relations for a todo
async function getRelations(todoId) {
  const parent = await getParent(todoId);
  const children = await getChildren(todoId);
  const siblings = await getSiblings(todoId);
  return {
    parent,
    children,
    siblings
  };
}

// Register relationship routes
function registerLinkRoutes(app, requireAuth) {
  // POST /todos/:id/children - Make :id the parent of child_id
  app.post('/todos/:id/children', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { child_id } = req.body;

    try {
      // Validate both todos exist
      const parentTodo = await getById('todos', id);
      if (!parentTodo) {
        return res.status(404).json({ error: 'parent todo not found' });
      }

      const childTodo = await getById('todos', child_id);
      if (!childTodo) {
        return res.status(404).json({ error: 'child todo not found' });
      }

      // Validate not same todo
      if (parseInt(id) === parseInt(child_id)) {
        return res.status(400).json({ error: 'cannot set todo as its own parent' });
      }

      // Check if link already exists
      const existingLinks = await getAll('todo_links', {
        from_todo_id: id,
        to_todo_id: child_id,
        type: 'parent'
      });
      if (Array.isArray(existingLinks) && existingLinks.length > 0) {
        return res.status(400).json({ error: 'parent-child relationship already exists' });
      }

      // Check if child already has a parent
      const childLinks = await getAll('todo_links', { to_todo_id: child_id, type: 'parent' });
      if (Array.isArray(childLinks) && childLinks.length > 0) {
        return res.status(400).json({ error: 'child todo already has a parent' });
      }

      // Create the link
      const linkRecord = {
        from_todo_id: parseInt(id),
        to_todo_id: parseInt(child_id),
        type: 'parent',
        created_by: req.user.id,
        created_at: new Date().toISOString()
      };

      const link = await insert('todo_links', linkRecord);

      // Log the action
      await logAction(req.user.id, req.user.username, 'create_parent_child_link', parseInt(id), {
        child_id: parseInt(child_id)
      });

      res.status(201).json(link);
    } catch (error) {
      console.error('Create parent-child link error:', error);
      res.status(500).json({ error: 'failed to create parent-child relationship' });
    }
  });

  // DELETE /todos/:id/children/:childId - Remove parent-child relationship
  app.delete('/todos/:id/children/:childId', requireAuth, async (req, res) => {
    const { id, childId } = req.params;

    try {
      // Find and delete the link
      const links = await getAll('todo_links', {
        from_todo_id: id,
        to_todo_id: childId,
        type: 'parent'
      });

      if (!Array.isArray(links) || links.length === 0) {
        return res.status(404).json({ error: 'parent-child relationship not found' });
      }

      const link = links[0];
      await remove('todo_links', link.id);

      // Log the action
      await logAction(req.user.id, req.user.username, 'delete_parent_child_link', parseInt(id), {
        child_id: parseInt(childId)
      });

      res.status(204).send();
    } catch (error) {
      console.error('Delete parent-child link error:', error);
      res.status(500).json({ error: 'failed to delete parent-child relationship' });
    }
  });

  // POST /todos/:id/siblings - Create a sibling relationship
  app.post('/todos/:id/siblings', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { sibling_id } = req.body;

    try {
      // Validate both todos exist
      const todo1 = await getById('todos', id);
      if (!todo1) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const todo2 = await getById('todos', sibling_id);
      if (!todo2) {
        return res.status(404).json({ error: 'sibling todo not found' });
      }

      // Validate not same todo
      if (parseInt(id) === parseInt(sibling_id)) {
        return res.status(400).json({ error: 'cannot set todo as its own sibling' });
      }

      // Check if link already exists in either direction
      const existingLinks = await getAll('todo_links', { type: 'sibling' });
      if (Array.isArray(existingLinks)) {
        for (const link of existingLinks) {
          if ((link.from_todo_id === parseInt(id) && link.to_todo_id === parseInt(sibling_id)) ||
              (link.from_todo_id === parseInt(sibling_id) && link.to_todo_id === parseInt(id))) {
            return res.status(400).json({ error: 'sibling relationship already exists' });
          }
        }
      }

      // Create the link (store with smaller id first for consistency)
      const id1 = Math.min(parseInt(id), parseInt(sibling_id));
      const id2 = Math.max(parseInt(id), parseInt(sibling_id));

      const linkRecord = {
        from_todo_id: id1,
        to_todo_id: id2,
        type: 'sibling',
        created_by: req.user.id,
        created_at: new Date().toISOString()
      };

      const link = await insert('todo_links', linkRecord);

      // Log the action
      await logAction(req.user.id, req.user.username, 'create_sibling_link', parseInt(id), {
        sibling_id: parseInt(sibling_id)
      });

      res.status(201).json(link);
    } catch (error) {
      console.error('Create sibling link error:', error);
      res.status(500).json({ error: 'failed to create sibling relationship' });
    }
  });

  // DELETE /todos/:id/siblings/:siblingId - Remove sibling relationship
  app.delete('/todos/:id/siblings/:siblingId', requireAuth, async (req, res) => {
    const { id, siblingId } = req.params;

    try {
      // Find the link in either direction
      const id1 = Math.min(parseInt(id), parseInt(siblingId));
      const id2 = Math.max(parseInt(id), parseInt(siblingId));

      const links = await getAll('todo_links', {
        from_todo_id: id1,
        to_todo_id: id2,
        type: 'sibling'
      });

      if (!Array.isArray(links) || links.length === 0) {
        return res.status(404).json({ error: 'sibling relationship not found' });
      }

      const link = links[0];
      await remove('todo_links', link.id);

      // Log the action
      await logAction(req.user.id, req.user.username, 'delete_sibling_link', parseInt(id), {
        sibling_id: parseInt(siblingId)
      });

      res.status(204).send();
    } catch (error) {
      console.error('Delete sibling link error:', error);
      res.status(500).json({ error: 'failed to delete sibling relationship' });
    }
  });

  // GET /todos/:id/relations - Get all relations for a todo
  app.get('/todos/:id/relations', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const relations = await getRelations(id);

      // Log the action
      await logAction(req.user.id, req.user.username, 'view_todo_relations', id, {});

      res.json(relations);
    } catch (error) {
      console.error('Get relations error:', error);
      res.status(500).json({ error: 'failed to fetch relations' });
    }
  });
}

module.exports = {
  registerLinkRoutes,
  getRelations
};
