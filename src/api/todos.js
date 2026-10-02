// Todo CRUD and logging helper module

const { logAction } = require('./logging');
const { getRelations } = require('./links');
const { getBlockers, isBlocked } = require('./blockers');
const { getComments, getCommentCount } = require('./comments');
const { getAssignees } = require('./assignees');
const { recalculateInitiativeForTodo } = require('./initiatives');

const PROJECTS_TABLE = 'projects';
const INITIATIVE_TODOS_TABLE = 'initiative_todos';
const INITIATIVES_TABLE = 'initiatives';

async function getProjectInfo(db, projectId) {
  if (!projectId) {
    return null;
  }
  try {
    const project = await db.getById(PROJECTS_TABLE, projectId);
    if (project) {
      return { id: project.id, name: project.name };
    }
  } catch (error) {
    console.error('Error fetching project:', error);
    throw error;
  }
  return null;
}

function isOverdue(todo) {
  if (!todo.due_date || todo.status === 'done') {
    return false;
  }
  const today = new Date().toISOString().split('T')[0];
  return todo.due_date < today;
}

async function getInitiativeForTodo(db, todoId) {
  try {
    const allInitiativeTodos = await db.getAll(INITIATIVE_TODOS_TABLE);
    if (!Array.isArray(allInitiativeTodos)) {
      return null;
    }
    const initiativeTodo = allInitiativeTodos.find(l => l.todo_id === parseInt(todoId));
    if (!initiativeTodo) {
      return null;
    }
    const initiative = await db.getById(INITIATIVES_TABLE, initiativeTodo.initiative_id);
    if (initiative) {
      return { id: initiative.id, name: initiative.name };
    }
  } catch (error) {
    console.error('Error fetching initiative for todo:', error);
    throw error;
  }
  return null;
}

function registerTodoRoutes(app, requireAuth, db, auth, notifications) {
  app.post('/todos', requireAuth, async (req, res) => {
    const { title, description, status, project_id, due_date, priority } = req.body;

    // Validate title
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 200) {
      return res.status(400).json({ error: 'title too long (max 200)' });
    }

    let trimmedDescription = description;
    if (description !== undefined && description !== null) {
      trimmedDescription = String(description).trim();
      if (trimmedDescription.length > 2000) {
        return res.status(400).json({ error: 'description too long (max 2000)' });
      }
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    let assignedPriority = priority || 'medium';
    if (!validPriorities.includes(assignedPriority)) {
      return res.status(400).json({ error: 'invalid priority' });
    }

    let assignedDueDate = due_date || null;
    if (due_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
        return res.status(400).json({ error: 'invalid due_date format' });
      }
      const dateObj = new Date(due_date + 'T00:00:00Z');
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ error: 'invalid due_date' });
      }
      assignedDueDate = due_date;
    }

    const now = new Date().toISOString();

    // Determine project_id: explicit > current project > null
    let assignedProjectId = null;
    if (project_id !== undefined && project_id !== null) {
      try {
        const project = await db.getById(PROJECTS_TABLE, project_id);
        if (!project) {
          return res.status(404).json({ error: 'project not found' });
        }
      } catch (error) {
        return res.status(404).json({ error: 'project not found' });
      }
      assignedProjectId = project_id;
    } else {
      const currentProject = auth.getCurrentProject(req.user.id);
      if (currentProject) {
        assignedProjectId = currentProject;
      }
    }

    const todoRecord = {
      title: trimmedTitle,
      description: trimmedDescription || null,
      status: status || 'open',
      project_id: assignedProjectId,
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
      completed_at: null,
      due_date: assignedDueDate,
      priority: assignedPriority
    };

    try {
      const todo = await db.insert('todos', todoRecord);

      await logAction(db, req.user.id, req.user.username, 'create_todo', todo.id, {
        title: trimmedTitle,
        description: trimmedDescription || null,
        project_id: assignedProjectId
      });

      await notifications.publishEvent('todos', {
        type: 'todo.created',
        todo,
        by: req.user.username
      });

      res.status(201).json(todo);
    } catch (error) {
      console.error('Create todo error:', error);
      res.status(500).json({ error: 'failed to create todo' });
    }
  });

  app.get('/todos/archived', requireAuth, async (req, res) => {
    try {
      const todos = await db.getAll('todos');

      if (!Array.isArray(todos)) {
        return res.json([]);
      }

      const archivedTodos = todos.filter(todo => todo.archived === true);

      const todosWithBlocked = [];
      for (const todo of archivedTodos) {
        const blocked = await isBlocked(db, todo.id);
        const comment_count = await getCommentCount(db, todo.id);
        const assignees = await getAssignees(db, auth, todo.id);
        const project = await getProjectInfo(db, todo.project_id);
        const enrichedTodo = {
          ...todo,
          is_blocked: blocked,
          comment_count,
          assignees: assignees.map(a => ({ id: a.id, username: a.username })),
          project,
          is_overdue: isOverdue(todo)
        };
        todosWithBlocked.push(enrichedTodo);
      }

      res.json(todosWithBlocked);
    } catch (error) {
      res.status(500).json({ error: 'failed to list archived todos' });
    }
  });

  // GET /todos - List todos with optional status, assigned_to, and project_id filters
  app.get('/todos', requireAuth, async (req, res) => {
    const { status, assigned_to, project_id, include_archived, archived, priority, overdue, due_before, due_after, sort, order } = req.query;

    try {
      const filters = {};
      if (status && status !== 'open') {
        filters.status = status;
      }
      const todos = await db.getAll('todos', filters);

      if (!Array.isArray(todos)) {
        return res.json([]);
      }

      let filtered = todos;
      if (archived === 'true') {
        filtered = todos.filter(todo => todo.archived === true);
      } else if (include_archived !== 'true') {
        // Default: exclude archived
        filtered = todos.filter(todo => !todo.archived);
      }
      // else: include_archived=true shows all

      const todosWithBlocked = [];
      for (const todo of filtered) {
        const blocked = await isBlocked(db, todo.id);
        const comment_count = await getCommentCount(db, todo.id);
        const assignees = await getAssignees(db, auth, todo.id);
        const project = await getProjectInfo(db, todo.project_id);
        const enrichedTodo = {
          ...todo,
          status: todo.status === 'in_progress' ? 'open' : todo.status,
          is_blocked: blocked,
          comment_count,
          assignees: assignees.map(a => ({ id: a.id, username: a.username })),
          project,
          is_overdue: isOverdue(todo)
        };
        todosWithBlocked.push(enrichedTodo);
      }

      // Filter by status if provided (handle in_progress as part of open)
      if (status === 'open') {
        todosWithBlocked = todosWithBlocked.filter(todo => todo.status === 'open');
      } else if (status) {
        todosWithBlocked = todosWithBlocked.filter(todo => todo.status === status);
      }

      let result = todosWithBlocked;
      if (assigned_to) {
        const userId = parseInt(assigned_to);
        result = result.filter(todo =>
          todo.assignees.some(a => a.id === userId)
        );
      }

      if (project_id !== undefined) {
        if (project_id === 'none') {
          result = result.filter(todo => !todo.project_id);
        } else {
          const projectIdNum = parseInt(project_id);
          result = result.filter(todo => todo.project_id === projectIdNum);
        }
      }

      if (priority) {
        result = result.filter(todo => todo.priority === priority);
      }

      if (overdue === 'true') {
        result = result.filter(todo => todo.is_overdue);
      }

      if (due_before) {
        result = result.filter(todo => todo.due_date && todo.due_date < due_before);
      }

      if (due_after) {
        result = result.filter(todo => todo.due_date && todo.due_date > due_after);
      }

      // Sorting
      const sortField = sort || 'created_at';
      const sortOrder = order || 'asc';
      const isAsc = sortOrder === 'asc';

      if (sortField === 'priority') {
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        result.sort((a, b) => {
          const aOrder = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 2;
          const bOrder = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 2;
          return isAsc ? aOrder - bOrder : bOrder - aOrder;
        });
      } else if (sortField === 'due_date') {
        result.sort((a, b) => {
          const aDate = a.due_date || '9999-12-31';
          const bDate = b.due_date || '9999-12-31';
          return isAsc ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
        });
      } else if (sortField === 'created_at') {
        result.sort((a, b) => {
          const aTime = new Date(a.created_at).getTime();
          const bTime = new Date(b.created_at).getTime();
          return isAsc ? aTime - bTime : bTime - aTime;
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'failed to list todos' });
    }
  });

  // GET /todos/overdue - List only overdue todos, sorted soonest-due first
  app.get('/todos/overdue', requireAuth, async (req, res) => {
    try {
      const todos = await db.getAll('todos');

      if (!Array.isArray(todos)) {
        return res.json([]);
      }

      let filtered = todos.filter(todo => !todo.archived && isOverdue(todo));

      const todosWithBlocked = [];
      for (const todo of filtered) {
        const blocked = await isBlocked(db, todo.id);
        const comment_count = await getCommentCount(db, todo.id);
        const assignees = await getAssignees(db, auth, todo.id);
        const project = await getProjectInfo(db, todo.project_id);
        const enrichedTodo = {
          ...todo,
          is_blocked: blocked,
          comment_count,
          assignees: assignees.map(a => ({ id: a.id, username: a.username })),
          project,
          is_overdue: true
        };
        todosWithBlocked.push(enrichedTodo);
      }

      todosWithBlocked.sort((a, b) => {
        const aDate = a.due_date || '9999-12-31';
        const bDate = b.due_date || '9999-12-31';
        return aDate.localeCompare(bDate);
      });

      await logAction(db, req.user.id, req.user.username, 'list_overdue', null, {});

      res.json(todosWithBlocked);
    } catch (error) {
      res.status(500).json({ error: 'failed to list overdue todos' });
    }
  });

  app.get('/todos/summary', requireAuth, async (req, res) => {
    try {
      const todos = await db.getAll('todos');

      if (!Array.isArray(todos)) {
        return res.json({ total: 0, open: 0, done: 0, overdue: 0, by_priority: { low: 0, medium: 0, high: 0, urgent: 0 } });
      }

      const nonArchivedTodos = todos.filter(todo => !todo.archived);

      const summary = {
        total: nonArchivedTodos.length,
        open: 0,
        done: 0,
        overdue: 0,
        by_priority: {
          low: 0,
          medium: 0,
          high: 0,
          urgent: 0
        }
      };

      for (const todo of nonArchivedTodos) {
        if (todo.status === 'done') {
          summary.done++;
        } else {
          summary.open++;
        }

        if (isOverdue(todo)) {
          summary.overdue++;
        }

        const priority = todo.priority || 'medium';
        if (summary.by_priority[priority] !== undefined) {
          summary.by_priority[priority]++;
        }
      }

      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch summary' });
    }
  });

  app.get('/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      await logAction(db, req.user.id, req.user.username, 'view_todo', id, {});

      const relations = await getRelations(db, id);

      const blocked_by = await getBlockers(db, id);
      const blocked = await isBlocked(db, id);

      const comments = await getComments(db, id);

      const assignees = await getAssignees(db, auth, id);

      const project = await getProjectInfo(db, todo.project_id);

      const initiative = await getInitiativeForTodo(db, id);

      const response = {
        ...todo,
        status: todo.status === 'in_progress' ? 'open' : todo.status,
        relations,
        blocked_by,
        is_blocked: blocked,
        comments,
        assignees: assignees.map(a => ({ id: a.id, username: a.username })),
        project,
        initiative,
        is_overdue: isOverdue(todo)
      };

      res.json(response);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  app.put('/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, status, project_id, due_date, priority } = req.body;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      if (todo.archived) {
        return res.status(409).json({ error: 'todo is archived' });
      }

      if (title !== undefined) {
        if (!title || typeof title !== 'string' || !title.trim()) {
          return res.status(400).json({ error: 'title is required' });
        }
        const trimmedTitle = title.trim();
        if (trimmedTitle.length > 200) {
          return res.status(400).json({ error: 'title too long (max 200)' });
        }
      }

      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 2000) {
          return res.status(400).json({ error: 'description too long (max 2000)' });
        }
      }

      if (priority !== undefined) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return res.status(400).json({ error: 'invalid priority' });
        }
      }

      if (due_date !== undefined) {
        if (due_date !== null) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
            return res.status(400).json({ error: 'invalid due_date format' });
          }
          const dateObj = new Date(due_date + 'T00:00:00Z');
          if (isNaN(dateObj.getTime())) {
            return res.status(400).json({ error: 'invalid due_date' });
          }
        }
      }

      if (status === 'done' && status !== todo.status) {
        const blocked = await isBlocked(db, id);
        if (blocked) {
          const blockers = await getBlockers(db, id);
          const blockerIds = blockers.map(b => b.id);
          return res.status(409).json({ error: 'todo is blocked', blocked_by: blockerIds });
        }
      }

      const changes = {};

      if (title !== undefined && title !== todo.title) {
        const trimmedTitle = title.trim();
        changes.title = { from: todo.title, to: trimmedTitle };
        todo.title = trimmedTitle;
      }
      if (description !== undefined && description !== todo.description) {
        const trimmedDesc = description !== null ? String(description).trim() : '';
        changes.description = { from: todo.description, to: trimmedDesc || null };
        todo.description = trimmedDesc || null;
      }
      if (status !== undefined && status !== todo.status) {
        changes.status = { from: todo.status, to: status };
        todo.status = status;

        if (status === 'done') {
          todo.completed_at = new Date().toISOString();
        } else if (status === 'open') {
          todo.completed_at = null;
        }
      }

      if (project_id !== undefined && project_id !== todo.project_id) {
        if (project_id !== null) {
          const project = await db.getById(PROJECTS_TABLE, project_id);
          if (!project) {
            return res.status(404).json({ error: 'project not found' });
          }
        }
        changes.project_id = { from: todo.project_id, to: project_id };
        todo.project_id = project_id;
      }

      if (priority !== undefined && priority !== todo.priority) {
        changes.priority = { from: todo.priority, to: priority };
        todo.priority = priority;
      }

      if (due_date !== undefined && due_date !== todo.due_date) {
        changes.due_date = { from: todo.due_date, to: due_date };
        todo.due_date = due_date;
      }

      todo.updated_at = new Date().toISOString();

      await db.update('todos', id, todo);

      // Recalculate initiative if status changed
      if (changes.status) {
        await recalculateInitiativeForTodo(db, notifications, parseInt(id));
      }

      await logAction(db, req.user.id, req.user.username, 'update_todo', id, changes);

      await notifications.publishEvent('todos', {
        type: 'todo.updated',
        todo,
        by: req.user.username
      });

      if (changes.status && changes.status.to === 'done') {
        const assignees = await getAssignees(db, auth, id);
        const databaseName = db.getDatabaseName();
        for (const assignee of assignees) {
          await notifications.sendNotification(
            assignee.username,
            `Todo completed: ${todo.title}`,
            `${todo.title} was completed by ${req.user.username} against the ${databaseName} database`
          );
          await notifications.publishToUser(assignee.id, {
            type: 'todo.completed',
            todo,
            database: databaseName
          });
        }
      }

      res.json(todo);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  // DELETE /todos/:id - Archive a todo (soft delete)
  app.delete('/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      try {
        const allLinks = await db.getAll('todo_links');
        if (Array.isArray(allLinks)) {
          for (const link of allLinks) {
            if (link.from_todo_id === parseInt(id) || link.to_todo_id === parseInt(id)) {
              await db.remove('todo_links', link.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting related links:', error);
      }

      try {
        const allComments = await db.getAll('comments');
        if (Array.isArray(allComments)) {
          for (const comment of allComments) {
            if (comment.todo_id === parseInt(id)) {
              await db.remove('comments', comment.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting related comments:', error);
      }

      try {
        const allAssignments = await db.getAll('todo_users');
        if (Array.isArray(allAssignments)) {
          for (const assignment of allAssignments) {
            if (assignment.todo_id === parseInt(id)) {
              await db.remove('todo_users', assignment.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting related assignments:', error);
      }

      // Archive the todo instead of deleting
      todo.archived = true;
      todo.archived_at = new Date().toISOString();
      await db.update('todos', id, todo);

      await logAction(db, req.user.id, req.user.username, 'delete_todo', id, {});

      await notifications.publishEvent('todos', {
        type: 'todo.deleted',
        todo,
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  app.post('/todos/:id/complete', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      if (todo.archived) {
        return res.status(409).json({ error: 'todo is archived' });
      }

      const blocked = await isBlocked(db, id);
      if (blocked) {
        const blockers = await getBlockers(db, id);
        const blockerIds = blockers.map(b => b.id);
        return res.status(409).json({ error: 'todo is blocked', blocked_by: blockerIds });
      }

      todo.status = 'done';
      todo.completed_at = new Date().toISOString();
      todo.updated_at = new Date().toISOString();

      await db.update('todos', id, todo);

      await recalculateInitiativeForTodo(db, notifications, parseInt(id));

      await logAction(db, req.user.id, req.user.username, 'complete_todo', id, {});

      const assignees = await getAssignees(db, auth, id);
      const databaseName = db.getDatabaseName();
      for (const assignee of assignees) {
        await notifications.sendNotification(
          assignee.username,
          `Todo completed: ${todo.title}`,
          `${todo.title} was completed by ${req.user.username} against the ${databaseName} database`
        );
        await notifications.publishToUser(assignee.id, {
          type: 'todo.completed',
          todo,
          database: databaseName
        });
      }

      res.json(todo);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  // POST /todos/:id/snooze - Snooze a todo by pushing its due_date forward
  app.post('/todos/:id/snooze', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { days } = req.body;

    if (days === undefined || days === null) {
      return res.status(400).json({ error: 'days is required' });
    }
    const daysNum = parseInt(days);
    if (isNaN(daysNum) || daysNum < 0) {
      return res.status(400).json({ error: 'days must be a non-negative integer' });
    }

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      if (todo.archived) {
        return res.status(409).json({ error: 'todo is archived' });
      }

      const today = new Date().toISOString().split('T')[0];
      const baseDateStr = todo.due_date || today;
      const baseDate = new Date(baseDateStr + 'T00:00:00Z');
      const newDate = new Date(baseDate.getTime() + daysNum * 24 * 60 * 60 * 1000);
      const newDueDateStr = newDate.toISOString().split('T')[0];

      const oldDueDate = todo.due_date;
      todo.due_date = newDueDateStr;
      todo.updated_at = new Date().toISOString();

      await db.update('todos', id, todo);

      await logAction(db, req.user.id, req.user.username, 'snooze_todo', id, {
        days: daysNum,
        old_due_date: oldDueDate,
        new_due_date: newDueDateStr
      });

      res.json(todo);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  app.post('/todos/:id/restore', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      if (!todo.archived) {
        return res.status(400).json({ error: 'todo is not archived' });
      }

      todo.archived = false;
      todo.archived_at = null;
      await db.update('todos', id, todo);

      await logAction(db, req.user.id, req.user.username, 'restore_todo', id, {});

      await notifications.publishEvent('todos', {
        type: 'todo.restored',
        todo,
        by: req.user.username
      });

      res.json(todo);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  app.get('/users/:id/log', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const logs = await db.getAll('user_logs', { user_id: id });
      const logArray = Array.isArray(logs) ? logs : [];

      // Sort by timestamp, newest first
      logArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      res.json(logArray);
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch logs' });
    }
  });
}

module.exports = {
  registerTodoRoutes,
  logAction
};
