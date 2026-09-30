// Bulk operations and export module

const { getAll, getById, update } = require('./db');
const { logAction } = require('./logging');

// Helper to escape CSV values
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const strValue = String(value);
  if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
    return '"' + strValue.replace(/"/g, '""') + '"';
  }
  return strValue;
}

// Helper to generate CSV row
function toCSVRow(fields) {
  return fields.map(escapeCSV).join(',');
}

// Helper to format date for CSV (YYYY-MM-DD format)
function formatDate(dateStr) {
  if (!dateStr) return '';
  if (typeof dateStr === 'string') {
    return dateStr.split('T')[0];
  }
  return '';
}

// Register bulk operation routes
function registerBulkRoutes(app, requireAuth) {
  // POST /todos/bulk-complete - Mark multiple todos as done
  app.post('/todos/bulk-complete', requireAuth, async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const completed = [];
    const failed = [];

    try {
      for (const id of ids) {
        try {
          const todo = await getById('todos', id);

          if (!todo) {
            failed.push({ id, reason: 'not found' });
            continue;
          }

          if (todo.status === 'done') {
            failed.push({ id, reason: 'already done' });
            continue;
          }

          // Update todo
          const now = new Date().toISOString();
          todo.status = 'done';
          todo.completed_at = now;
          todo.updated_at = now;

          await update('todos', id, todo);

          // Log the action
          await logAction(req.user.id, req.user.username, 'bulk_complete_todo', id, {});

          completed.push(id);
        } catch (error) {
          failed.push({ id, reason: 'update failed' });
        }
      }

      res.json({ completed, failed });
    } catch (error) {
      res.status(500).json({ error: 'bulk complete failed' });
    }
  });

  // POST /todos/bulk-update - Update multiple todos
  app.post('/todos/bulk-update', requireAuth, async (req, res) => {
    const { ids, changes } = req.body;

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    if (!changes || typeof changes !== 'object') {
      return res.status(400).json({ error: 'changes must be an object' });
    }

    const updated = [];
    const failed = [];

    try {
      for (const id of ids) {
        try {
          const todo = await getById('todos', id);

          if (!todo) {
            failed.push({ id, reason: 'not found' });
            continue;
          }

          // Apply changes
          let hasChanges = false;
          const changeLog = {};

          if (changes.priority !== undefined && changes.priority !== todo.priority) {
            const validPriorities = ['low', 'medium', 'high', 'urgent'];
            if (!validPriorities.includes(changes.priority)) {
              failed.push({ id, reason: 'invalid priority' });
              continue;
            }
            changeLog.priority = { from: todo.priority, to: changes.priority };
            todo.priority = changes.priority;
            hasChanges = true;
          }

          if (changes.project_id !== undefined && changes.project_id !== todo.project_id) {
            // If project_id is not null, verify project exists
            if (changes.project_id !== null) {
              const project = await getById('projects', changes.project_id);
              if (!project) {
                failed.push({ id, reason: 'project not found' });
                continue;
              }
            }
            changeLog.project_id = { from: todo.project_id, to: changes.project_id };
            todo.project_id = changes.project_id;
            hasChanges = true;
          }

          if (changes.due_date !== undefined && changes.due_date !== todo.due_date) {
            if (changes.due_date !== null) {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.due_date)) {
                failed.push({ id, reason: 'invalid due_date format' });
                continue;
              }
              const dateObj = new Date(changes.due_date + 'T00:00:00Z');
              if (isNaN(dateObj.getTime())) {
                failed.push({ id, reason: 'invalid due_date' });
                continue;
              }
            }
            changeLog.due_date = { from: todo.due_date, to: changes.due_date };
            todo.due_date = changes.due_date;
            hasChanges = true;
          }

          if (changes.title !== undefined && changes.title !== todo.title) {
            const trimmedTitle = String(changes.title).trim();
            if (!trimmedTitle || trimmedTitle.length > 200) {
              failed.push({ id, reason: 'invalid title' });
              continue;
            }
            changeLog.title = { from: todo.title, to: trimmedTitle };
            todo.title = trimmedTitle;
            hasChanges = true;
          }

          if (changes.description !== undefined && changes.description !== todo.description) {
            const trimmedDesc = changes.description !== null ? String(changes.description).trim() : null;
            if (trimmedDesc !== null && trimmedDesc.length > 2000) {
              failed.push({ id, reason: 'description too long' });
              continue;
            }
            changeLog.description = { from: todo.description, to: trimmedDesc };
            todo.description = trimmedDesc;
            hasChanges = true;
          }

          if (changes.status !== undefined && changes.status !== todo.status) {
            changeLog.status = { from: todo.status, to: changes.status };
            todo.status = changes.status;
            if (changes.status === 'done') {
              todo.completed_at = new Date().toISOString();
            } else if (changes.status === 'open') {
              todo.completed_at = null;
            }
            hasChanges = true;
          }

          if (hasChanges) {
            todo.updated_at = new Date().toISOString();
            await update('todos', id, todo);
            await logAction(req.user.id, req.user.username, 'bulk_update_todo', id, changeLog);
            updated.push(id);
          } else {
            failed.push({ id, reason: 'no changes applied' });
          }
        } catch (error) {
          failed.push({ id, reason: 'update failed' });
        }
      }

      res.json({ updated, failed });
    } catch (error) {
      res.status(500).json({ error: 'bulk update failed' });
    }
  });

  // POST /todos/bulk-archive - Archive multiple todos
  app.post('/todos/bulk-archive', requireAuth, async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const archived = [];
    const failed = [];

    try {
      for (const id of ids) {
        try {
          const todo = await getById('todos', id);

          if (!todo) {
            failed.push({ id, reason: 'not found' });
            continue;
          }

          // Archive todo
          const now = new Date().toISOString();
          todo.archived = true;
          todo.archived_at = now;

          await update('todos', id, todo);

          // Log the action
          await logAction(req.user.id, req.user.username, 'bulk_archive_todo', id, {});

          archived.push(id);
        } catch (error) {
          failed.push({ id, reason: 'archive failed' });
        }
      }

      res.json({ archived, failed });
    } catch (error) {
      res.status(500).json({ error: 'bulk archive failed' });
    }
  });

  // GET /todos/export.csv - Export all non-archived todos as CSV
  app.get('/todos/export.csv', requireAuth, async (req, res) => {
    const { include_archived } = req.query;

    try {
      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        return res.status(200).set('Content-Type', 'text/csv').send('id,title,status,priority,due_date,project_id,created_by,created_at,completed_at\n');
      }

      // Filter based on include_archived
      let filtered = todos;
      if (include_archived !== 'true') {
        filtered = todos.filter(todo => !todo.archived);
      }

      // Build CSV
      const headers = ['id', 'title', 'status', 'priority', 'due_date', 'project_id', 'created_by', 'created_at', 'completed_at'];
      let csv = toCSVRow(headers) + '\n';

      for (const todo of filtered) {
        const row = [
          todo.id,
          todo.title,
          todo.status,
          todo.priority || 'medium',
          formatDate(todo.due_date),
          todo.project_id || '',
          todo.created_by || '',
          formatDate(todo.created_at),
          formatDate(todo.completed_at)
        ];
        csv += toCSVRow(row) + '\n';
      }

      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', 'attachment; filename="todos.csv"');
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: 'export failed' });
    }
  });

  // GET /projects/:id/export.csv - Export project's todos as CSV
  app.get('/projects/:id/export.csv', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      // Verify project exists
      const project = await getById('projects', id);
      if (!project) {
        return res.status(404).json({ error: 'project not found' });
      }

      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        return res.status(200).set('Content-Type', 'text/csv').send('id,title,status,priority,due_date,project_id,created_by,created_at,completed_at\n');
      }

      // Filter for this project and non-archived todos
      const filtered = todos.filter(todo =>
        todo.project_id === parseInt(id) && !todo.archived
      );

      // Build CSV
      const headers = ['id', 'title', 'status', 'priority', 'due_date', 'project_id', 'created_by', 'created_at', 'completed_at'];
      let csv = toCSVRow(headers) + '\n';

      for (const todo of filtered) {
        const row = [
          todo.id,
          todo.title,
          todo.status,
          todo.priority || 'medium',
          formatDate(todo.due_date),
          todo.project_id || '',
          todo.created_by || '',
          formatDate(todo.created_at),
          formatDate(todo.completed_at)
        ];
        csv += toCSVRow(row) + '\n';
      }

      res.set('Content-Type', 'text/csv');
      res.set('Content-Disposition', `attachment; filename="project-${id}-todos.csv"`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: 'export failed' });
    }
  });
}

module.exports = {
  registerBulkRoutes
};
