// Todo CRUD and logging helper module

const { getAll, getById, insert, update, remove, getDatabaseName } = require('./db');
const { logAction } = require('./logging');
const { getRelations } = require('./links');
const { getBlockers, isBlocked } = require('./blockers');
const { getComments, getCommentCount } = require('./comments');
const { getAssignees } = require('./assignees');
const { publishEvent, sendNotification, publishToUser } = require('./notifications');
const { getCurrentProject } = require('./auth');
const { recalculateInitiativeForTodo } = require('./initiatives');

// Helper to get project info for a todo
async function getProjectInfo(projectId) {
  if (!projectId) {
    return null;
  }
  try {
    const project = await getById('projects', projectId);
    if (project) {
      return { id: project.id, name: project.name };
    }
  } catch (error) {
    console.error('Error fetching project:', error);
  }
  return null;
}

// Helper to compute is_overdue
function isOverdue(todo) {
  if (!todo.due_date || todo.status === 'done') {
    return false;
  }
  const today = new Date().toISOString().split('T')[0];
  return todo.due_date < today;
}

// Helper to get initiative for a todo
async function getInitiativeForTodo(todoId) {
  try {
    const allInitiativeTodos = await getAll('initiative_todos');
    if (!Array.isArray(allInitiativeTodos)) {
      return null;
    }
    const initiativeTodo = allInitiativeTodos.find(l => l.todo_id === parseInt(todoId));
    if (!initiativeTodo) {
      return null;
    }
    const initiative = await getById('initiatives', initiativeTodo.initiative_id);
    if (initiative) {
      return { id: initiative.id, name: initiative.name };
    }
  } catch (error) {
    console.error('Error fetching initiative for todo:', error);
  }
  return null;
}

// Register todo routes
function registerTodoRoutes(app, requireAuth) {
  // POST /todos - Create a todo
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

    // Validate description
    let trimmedDescription = description;
    if (description !== undefined && description !== null) {
      trimmedDescription = String(description).trim();
      if (trimmedDescription.length > 2000) {
        return res.status(400).json({ error: 'description too long (max 2000)' });
      }
    }

    // Validate priority
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    let assignedPriority = priority || 'medium';
    if (!validPriorities.includes(assignedPriority)) {
      return res.status(400).json({ error: 'invalid priority' });
    }

    // Validate due_date
    let assignedDueDate = due_date || null;
    if (due_date) {
      // Check if it's a valid ISO date string (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
        return res.status(400).json({ error: 'invalid due_date format' });
      }
      // Verify it's a valid date
      const dateObj = new Date(due_date + 'T00:00:00Z');
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ error: 'invalid due_date' });
      }
      assignedDueDate = due_date;
    }

    // Create todo record
    const now = new Date().toISOString();

    // Determine project_id: explicit > current project > null
    let assignedProjectId = null;
    if (project_id !== undefined && project_id !== null) {
      // Verify project exists
      try {
        const project = await getById('projects', project_id);
        if (!project) {
          return res.status(404).json({ error: 'project not found' });
        }
      } catch (error) {
        return res.status(404).json({ error: 'project not found' });
      }
      assignedProjectId = project_id;
    } else {
      // Try to use user's current project
      const currentProject = getCurrentProject(req.user.id);
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
      const todo = await insert('todos', todoRecord);

      // Log the action
      await logAction(req.user.id, req.user.username, 'create_todo', todo.id, {
        title: trimmedTitle,
        description: trimmedDescription || null,
        project_id: assignedProjectId
      });

      // Publish event
      await publishEvent('todos', {
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

  // GET /todos/archived - List only archived todos
  app.get('/todos/archived', requireAuth, async (req, res) => {
    try {
      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        return res.json([]);
      }

      // Filter to only archived todos
      const archivedTodos = todos.filter(todo => todo.archived === true);

      // Add is_blocked, comment_count, assignees, and project to each todo
      const todosWithBlocked = [];
      for (const todo of archivedTodos) {
        const blocked = await isBlocked(todo.id);
        const comment_count = await getCommentCount(todo.id);
        const assignees = await getAssignees(todo.id);
        const project = await getProjectInfo(todo.project_id);
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
      const todos = await getAll('todos', filters);

      if (!Array.isArray(todos)) {
        return res.json([]);
      }

      // Filter by archive status
      let filtered = todos;
      if (archived === 'true') {
        // Show only archived
        filtered = todos.filter(todo => todo.archived === true);
      } else if (include_archived !== 'true') {
        // Default: exclude archived
        filtered = todos.filter(todo => !todo.archived);
      }
      // else: include_archived=true shows all

      // Add is_blocked, comment_count, assignees, and project to each todo
      const todosWithBlocked = [];
      for (const todo of filtered) {
        const blocked = await isBlocked(todo.id);
        const comment_count = await getCommentCount(todo.id);
        const assignees = await getAssignees(todo.id);
        const project = await getProjectInfo(todo.project_id);
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

      // Filter by assigned_to if provided
      let result = todosWithBlocked;
      if (assigned_to) {
        const userId = parseInt(assigned_to);
        result = result.filter(todo =>
          todo.assignees.some(a => a.id === userId)
        );
      }

      // Filter by project_id if provided
      if (project_id !== undefined) {
        if (project_id === 'none') {
          result = result.filter(todo => !todo.project_id);
        } else {
          const projectIdNum = parseInt(project_id);
          result = result.filter(todo => todo.project_id === projectIdNum);
        }
      }

      // Filter by priority if provided
      if (priority) {
        result = result.filter(todo => todo.priority === priority);
      }

      // Filter by overdue if provided
      if (overdue === 'true') {
        result = result.filter(todo => todo.is_overdue);
      }

      // Filter by due_before if provided
      if (due_before) {
        result = result.filter(todo => todo.due_date && todo.due_date < due_before);
      }

      // Filter by due_after if provided
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
      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        return res.json([]);
      }

      // Filter to only non-archived overdue todos
      let filtered = todos.filter(todo => !todo.archived && isOverdue(todo));

      // Add is_blocked, comment_count, assignees, and project to each todo
      const todosWithBlocked = [];
      for (const todo of filtered) {
        const blocked = await isBlocked(todo.id);
        const comment_count = await getCommentCount(todo.id);
        const assignees = await getAssignees(todo.id);
        const project = await getProjectInfo(todo.project_id);
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

      // Sort by due_date ascending (soonest first)
      todosWithBlocked.sort((a, b) => {
        const aDate = a.due_date || '9999-12-31';
        const bDate = b.due_date || '9999-12-31';
        return aDate.localeCompare(bDate);
      });

      // Log the action
      await logAction(req.user.id, req.user.username, 'list_overdue', null, {});

      res.json(todosWithBlocked);
    } catch (error) {
      res.status(500).json({ error: 'failed to list overdue todos' });
    }
  });

  // GET /todos/summary - Get todo summary
  app.get('/todos/summary', requireAuth, async (req, res) => {
    try {
      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        return res.json({ total: 0, open: 0, done: 0, overdue: 0, by_priority: { low: 0, medium: 0, high: 0, urgent: 0 } });
      }

      // Filter to only non-archived todos
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

  // GET /todos/:id - Get a single todo
  app.get('/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Log the action
      await logAction(req.user.id, req.user.username, 'view_todo', id, {});

      // Get relations for this todo
      const relations = await getRelations(id);

      // Get blocking info for this todo
      const blocked_by = await getBlockers(id);
      const blocked = await isBlocked(id);

      // Get comments for this todo
      const comments = await getComments(id);

      // Get assignees for this todo
      const assignees = await getAssignees(id);

      // Get project info for this todo
      const project = await getProjectInfo(todo.project_id);

      // Get initiative for this todo
      const initiative = await getInitiativeForTodo(id);

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

  // PUT /todos/:id - Update a todo
  app.put('/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, status, project_id, due_date, priority } = req.body;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Check if todo is archived
      if (todo.archived) {
        return res.status(409).json({ error: 'todo is archived' });
      }

      // Validate title if provided
      if (title !== undefined) {
        if (!title || typeof title !== 'string' || !title.trim()) {
          return res.status(400).json({ error: 'title is required' });
        }
        const trimmedTitle = title.trim();
        if (trimmedTitle.length > 200) {
          return res.status(400).json({ error: 'title too long (max 200)' });
        }
      }

      // Validate description if provided
      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 2000) {
          return res.status(400).json({ error: 'description too long (max 2000)' });
        }
      }

      // Validate priority if provided
      if (priority !== undefined) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return res.status(400).json({ error: 'invalid priority' });
        }
      }

      // Validate due_date if provided
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

      // Check if trying to mark as done while blocked
      if (status === 'done' && status !== todo.status) {
        const blocked = await isBlocked(id);
        if (blocked) {
          const blockers = await getBlockers(id);
          const blockerIds = blockers.map(b => b.id);
          return res.status(409).json({ error: 'todo is blocked', blocked_by: blockerIds });
        }
      }

      const changes = {};

      // Track what changed
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

        // Update completed_at based on status
        if (status === 'done') {
          todo.completed_at = new Date().toISOString();
        } else if (status === 'open') {
          todo.completed_at = null;
        }
      }

      // Handle project_id change
      if (project_id !== undefined && project_id !== todo.project_id) {
        // If project_id is not null, verify project exists
        if (project_id !== null) {
          const project = await getById('projects', project_id);
          if (!project) {
            return res.status(404).json({ error: 'project not found' });
          }
        }
        changes.project_id = { from: todo.project_id, to: project_id };
        todo.project_id = project_id;
      }

      // Handle priority change
      if (priority !== undefined && priority !== todo.priority) {
        changes.priority = { from: todo.priority, to: priority };
        todo.priority = priority;
      }

      // Handle due_date change
      if (due_date !== undefined && due_date !== todo.due_date) {
        changes.due_date = { from: todo.due_date, to: due_date };
        todo.due_date = due_date;
      }

      todo.updated_at = new Date().toISOString();

      // Update in database
      await update('todos', id, todo);

      // Recalculate initiative if status changed
      if (changes.status) {
        await recalculateInitiativeForTodo(parseInt(id));
      }

      // Log the action
      await logAction(req.user.id, req.user.username, 'update_todo', id, changes);

      // Publish event
      await publishEvent('todos', {
        type: 'todo.updated',
        todo,
        by: req.user.username
      });

      // Handle completion notifications
      if (changes.status && changes.status.to === 'done') {
        const assignees = await getAssignees(id);
        const databaseName = getDatabaseName();
        for (const assignee of assignees) {
          await sendNotification(
            assignee.username,
            `Todo completed: ${todo.title}`,
            `${todo.title} was completed by ${req.user.username} against the ${databaseName} database`
          );
          await publishToUser(assignee.id, {
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
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Delete all links referencing this todo
      try {
        const allLinks = await getAll('todo_links');
        if (Array.isArray(allLinks)) {
          for (const link of allLinks) {
            if (link.from_todo_id === parseInt(id) || link.to_todo_id === parseInt(id)) {
              await remove('todo_links', link.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting related links:', error);
      }

      // Delete all comments for this todo
      try {
        const allComments = await getAll('comments');
        if (Array.isArray(allComments)) {
          for (const comment of allComments) {
            if (comment.todo_id === parseInt(id)) {
              await remove('comments', comment.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting related comments:', error);
      }

      // Delete all assignments for this todo
      try {
        const allAssignments = await getAll('todo_users');
        if (Array.isArray(allAssignments)) {
          for (const assignment of allAssignments) {
            if (assignment.todo_id === parseInt(id)) {
              await remove('todo_users', assignment.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting related assignments:', error);
      }

      // Archive the todo instead of deleting
      todo.archived = true;
      todo.archived_at = new Date().toISOString();
      await update('todos', id, todo);

      // Log the action
      await logAction(req.user.id, req.user.username, 'delete_todo', id, {});

      // Publish event
      await publishEvent('todos', {
        type: 'todo.deleted',
        todo,
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  // POST /todos/:id/complete - Mark a todo as done
  app.post('/todos/:id/complete', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Check if todo is archived
      if (todo.archived) {
        return res.status(409).json({ error: 'todo is archived' });
      }

      // Check if blocked
      const blocked = await isBlocked(id);
      if (blocked) {
        const blockers = await getBlockers(id);
        const blockerIds = blockers.map(b => b.id);
        return res.status(409).json({ error: 'todo is blocked', blocked_by: blockerIds });
      }

      todo.status = 'done';
      todo.completed_at = new Date().toISOString();
      todo.updated_at = new Date().toISOString();

      await update('todos', id, todo);

      // Recalculate initiative
      await recalculateInitiativeForTodo(parseInt(id));

      // Log the action
      await logAction(req.user.id, req.user.username, 'complete_todo', id, {});

      // Send completion notifications to assignees
      const assignees = await getAssignees(id);
      const databaseName = getDatabaseName();
      for (const assignee of assignees) {
        await sendNotification(
          assignee.username,
          `Todo completed: ${todo.title}`,
          `${todo.title} was completed by ${req.user.username} against the ${databaseName} database`
        );
        await publishToUser(assignee.id, {
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

    // Validate days parameter
    if (days === undefined || days === null) {
      return res.status(400).json({ error: 'days is required' });
    }
    const daysNum = parseInt(days);
    if (isNaN(daysNum) || daysNum < 0) {
      return res.status(400).json({ error: 'days must be a non-negative integer' });
    }

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Check if todo is archived
      if (todo.archived) {
        return res.status(409).json({ error: 'todo is archived' });
      }

      // Calculate new due date
      const today = new Date().toISOString().split('T')[0];
      const baseDateStr = todo.due_date || today;
      const baseDate = new Date(baseDateStr + 'T00:00:00Z');
      const newDate = new Date(baseDate.getTime() + daysNum * 24 * 60 * 60 * 1000);
      const newDueDateStr = newDate.toISOString().split('T')[0];

      const oldDueDate = todo.due_date;
      todo.due_date = newDueDateStr;
      todo.updated_at = new Date().toISOString();

      await update('todos', id, todo);

      // Log the action
      await logAction(req.user.id, req.user.username, 'snooze_todo', id, {
        days: daysNum,
        old_due_date: oldDueDate,
        new_due_date: newDueDateStr
      });

      res.json(todo);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  // POST /todos/:id/restore - Restore an archived todo
  app.post('/todos/:id/restore', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Check if todo is actually archived
      if (!todo.archived) {
        return res.status(400).json({ error: 'todo is not archived' });
      }

      // Restore the todo
      todo.archived = false;
      todo.archived_at = null;
      await update('todos', id, todo);

      // Log the action
      await logAction(req.user.id, req.user.username, 'restore_todo', id, {});

      // Publish event
      await publishEvent('todos', {
        type: 'todo.restored',
        todo,
        by: req.user.username
      });

      res.json(todo);
    } catch (error) {
      res.status(404).json({ error: 'todo not found' });
    }
  });

  // GET /users/:id/log - Get user's action log
  app.get('/users/:id/log', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const logs = await getAll('user_logs', { user_id: id });
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
