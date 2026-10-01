// Todo blockers (blocked-by relationships) module

const { logAction } = require('./logging');

const TODO_LINKS_TABLE = 'todo_links';
const BLOCKS_TYPE = 'blocks';
const TODOS_TABLE = 'todos';

// Helper to get all blockers of a todo (todos that block it)
async function getBlockers(db, todoId) {
  try {
    const links = await db.getAll(TODO_LINKS_TABLE, { to_todo_id: todoId, type: BLOCKS_TYPE });
    if (!Array.isArray(links)) {
      return [];
    }
    const blockers = [];
    for (const link of links) {
      const blocker = await db.getById(TODOS_TABLE, link.from_todo_id);
      if (blocker && !blocker.archived) {
        blockers.push(blocker);
      }
    }
    return blockers;
  } catch (error) {
    console.error('Error fetching blockers:', error);
    throw error;
  }
}

// Helper to get all todos blocked by this todo (todos it blocks)
async function getBlocked(db, todoId) {
  try {
    const links = await db.getAll(TODO_LINKS_TABLE, { from_todo_id: todoId, type: BLOCKS_TYPE });
    if (!Array.isArray(links)) {
      return [];
    }
    const blocked = [];
    for (const link of links) {
      const blockedTodo = await db.getById(TODOS_TABLE, link.to_todo_id);
      if (blockedTodo && !blockedTodo.archived) {
        blocked.push(blockedTodo);
      }
    }
    return blocked;
  } catch (error) {
    console.error('Error fetching blocked todos:', error);
    throw error;
  }
}

// Helper to check if todo is blocked (has any blocker that is not done)
async function isBlocked(db, todoId) {
  const blockers = await getBlockers(db, todoId);
  for (const blocker of blockers) {
    if (blocker.status !== 'done') {
      return true;
    }
  }
  return false;
}

// Helper to check if we can reach targetId by following blocks from fromId
async function canReachViaBlocks(db, fromId, targetId, visited = new Set()) {
  if (parseInt(fromId) === parseInt(targetId)) {
    return true;
  }
  if (visited.has(parseInt(fromId))) {
    return false;
  }
  visited.add(parseInt(fromId));

  try {
    const blocked = await getBlocked(db, fromId);
    for (const todo of blocked) {
      if (parseInt(todo.id) === parseInt(targetId)) {
        return true;
      }
      if (await canReachViaBlocks(db, todo.id, targetId, visited)) {
        return true;
      }
    }
  } catch (error) {
    console.error('Error checking blocking chain:', error);
    throw error;
  }

  return false;
}

function registerBlockerRoutes(app, requireAuth, db) {
  // POST /todos/:id/blockers - Add a blocker to a todo
  app.post('/todos/:id/blockers', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { blocker_id } = req.body;

    try {
      const todo = await db.getById(TODOS_TABLE, id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const blocker = await db.getById(TODOS_TABLE, blocker_id);
      if (!blocker) {
        return res.status(404).json({ error: 'blocker todo not found' });
      }

      if (parseInt(id) === parseInt(blocker_id)) {
        return res.status(400).json({ error: 'cannot set todo as its own blocker' });
      }

      const existingLinks = await db.getAll(TODO_LINKS_TABLE, {
        from_todo_id: blocker_id,
        to_todo_id: id,
        type: BLOCKS_TYPE
      });
      if (Array.isArray(existingLinks) && existingLinks.length > 0) {
        return res.status(400).json({ error: 'blocker relationship already exists' });
      }

      // Check for cycles: if id can reach blocker_id via existing blocks, adding blocker_id->id creates a cycle
      const canReach = await canReachViaBlocks(db, parseInt(id), parseInt(blocker_id));
      if (canReach) {
        return res.status(400).json({ error: 'would create a cycle' });
      }

      const linkRecord = {
        from_todo_id: parseInt(blocker_id),
        to_todo_id: parseInt(id),
        type: BLOCKS_TYPE,
        created_by: req.user.id,
        created_at: new Date().toISOString()
      };

      const link = await db.insert(TODO_LINKS_TABLE, linkRecord);

      await logAction(db, req.user.id, req.user.username, 'create_blocker_link', parseInt(id), {
        blocker_id: parseInt(blocker_id)
      });

      res.status(201).json(link);
    } catch (error) {
      console.error('Create blocker link error:', error);
      res.status(500).json({ error: 'failed to create blocker relationship' });
    }
  });

  app.delete('/todos/:id/blockers/:blockerId', requireAuth, async (req, res) => {
    const { id, blockerId } = req.params;

    try {
      const links = await db.getAll(TODO_LINKS_TABLE, {
        from_todo_id: blockerId,
        to_todo_id: id,
        type: BLOCKS_TYPE
      });

      if (!Array.isArray(links) || links.length === 0) {
        return res.status(404).json({ error: 'blocker relationship not found' });
      }

      const link = links[0];
      await db.remove(TODO_LINKS_TABLE, link.id);

      await logAction(db, req.user.id, req.user.username, 'delete_blocker_link', parseInt(id), {
        blocker_id: parseInt(blockerId)
      });

      res.status(204).send();
    } catch (error) {
      console.error('Delete blocker link error:', error);
      res.status(500).json({ error: 'failed to delete blocker relationship' });
    }
  });

  app.get('/todos/:id/blockers', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById(TODOS_TABLE, id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const blocked_by = await getBlockers(db, id);
      const blocking = await getBlocked(db, id);
      const is_blocked = await isBlocked(db, id);

      await logAction(db, req.user.id, req.user.username, 'view_todo_blockers', id, {});

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
