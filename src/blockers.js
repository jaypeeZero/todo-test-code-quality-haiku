// Todo blockers (blocked-by relationships) module

const { getAll, getById, insert, remove } = require('./db');
const { logAction } = require('./logging');

// Helper to get all blockers of a todo (todos that block it)
async function getBlockers(todoId) {
  try {
    const links = await getAll('todo_links', { to_todo_id: todoId, type: 'blocks' });
    if (!Array.isArray(links)) {
      return [];
    }
    const blockers = [];
    for (const link of links) {
      const blocker = await getById('todos', link.from_todo_id);
      if (blocker && !blocker.archived) {
        blockers.push(blocker);
      }
    }
    return blockers;
  } catch (error) {
    console.error('Error fetching blockers:', error);
    return [];
  }
}

// Helper to get all todos blocked by this todo (todos it blocks)
async function getBlocked(todoId) {
  try {
    const links = await getAll('todo_links', { from_todo_id: todoId, type: 'blocks' });
    if (!Array.isArray(links)) {
      return [];
    }
    const blocked = [];
    for (const link of links) {
      const blockedTodo = await getById('todos', link.to_todo_id);
      if (blockedTodo && !blockedTodo.archived) {
        blocked.push(blockedTodo);
      }
    }
    return blocked;
  } catch (error) {
    console.error('Error fetching blocked todos:', error);
    return [];
  }
}

// Helper to check if todo is blocked (has any blocker that is not done)
async function isBlocked(todoId) {
  const blockers = await getBlockers(todoId);
  for (const blocker of blockers) {
    if (blocker.status !== 'done') {
      return true;
    }
  }
  return false;
}

// Helper to check if we can reach targetId by following blocks from fromId
async function canReachViaBlocks(fromId, targetId, visited = new Set()) {
  if (parseInt(fromId) === parseInt(targetId)) {
    return true;
  }
  if (visited.has(parseInt(fromId))) {
    return false;
  }
  visited.add(parseInt(fromId));

  try {
    const blocked = await getBlocked(fromId);
    for (const todo of blocked) {
      if (parseInt(todo.id) === parseInt(targetId)) {
        return true;
      }
      if (await canReachViaBlocks(todo.id, targetId, visited)) {
        return true;
      }
    }
  } catch (error) {
    console.error('Error checking blocking chain:', error);
  }

  return false;
}

// Register blocker routes
function registerBlockerRoutes(app, requireAuth) {
  // POST /todos/:id/blockers - Add a blocker to a todo
  app.post('/todos/:id/blockers', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { blocker_id } = req.body;

    try {
      // Validate both todos exist
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const blocker = await getById('todos', blocker_id);
      if (!blocker) {
        return res.status(404).json({ error: 'blocker todo not found' });
      }

      // Validate not same todo
      if (parseInt(id) === parseInt(blocker_id)) {
        return res.status(400).json({ error: 'cannot set todo as its own blocker' });
      }

      // Check if link already exists
      const existingLinks = await getAll('todo_links', {
        from_todo_id: blocker_id,
        to_todo_id: id,
        type: 'blocks'
      });
      if (Array.isArray(existingLinks) && existingLinks.length > 0) {
        return res.status(400).json({ error: 'blocker relationship already exists' });
      }

      // Check for cycles: if id can reach blocker_id via existing blocks, adding blocker_id->id creates a cycle
      const canReach = await canReachViaBlocks(parseInt(id), parseInt(blocker_id));
      if (canReach) {
        return res.status(400).json({ error: 'would create a cycle' });
      }

      // Create the link
      const linkRecord = {
        from_todo_id: parseInt(blocker_id),
        to_todo_id: parseInt(id),
        type: 'blocks',
        created_by: req.user.id,
        created_at: new Date().toISOString()
      };

      const link = await insert('todo_links', linkRecord);

      // Log the action
      await logAction(req.user.id, req.user.username, 'create_blocker_link', parseInt(id), {
        blocker_id: parseInt(blocker_id)
      });

      res.status(201).json(link);
    } catch (error) {
      console.error('Create blocker link error:', error);
      res.status(500).json({ error: 'failed to create blocker relationship' });
    }
  });

  // DELETE /todos/:id/blockers/:blockerId - Remove a blocker
  app.delete('/todos/:id/blockers/:blockerId', requireAuth, async (req, res) => {
    const { id, blockerId } = req.params;

    try {
      // Find and delete the link
      const links = await getAll('todo_links', {
        from_todo_id: blockerId,
        to_todo_id: id,
        type: 'blocks'
      });

      if (!Array.isArray(links) || links.length === 0) {
        return res.status(404).json({ error: 'blocker relationship not found' });
      }

      const link = links[0];
      await remove('todo_links', link.id);

      // Log the action
      await logAction(req.user.id, req.user.username, 'delete_blocker_link', parseInt(id), {
        blocker_id: parseInt(blockerId)
      });

      res.status(204).send();
    } catch (error) {
      console.error('Delete blocker link error:', error);
      res.status(500).json({ error: 'failed to delete blocker relationship' });
    }
  });

  // GET /todos/:id/blockers - Get blocker info for a todo
  app.get('/todos/:id/blockers', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const blocked_by = await getBlockers(id);
      const blocking = await getBlocked(id);
      const is_blocked = await isBlocked(id);

      // Log the action
      await logAction(req.user.id, req.user.username, 'view_todo_blockers', id, {});

      res.json({
        blocked_by,
        blocking,
        is_blocked
      });
    } catch (error) {
      console.error('Get blockers error:', error);
      res.status(500).json({ error: 'failed to fetch blockers' });
    }
  });
}

module.exports = {
  registerBlockerRoutes,
  getBlockers,
  getBlocked,
  isBlocked
};
