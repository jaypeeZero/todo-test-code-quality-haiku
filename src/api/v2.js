// V2 API with pagination and new status vocabulary

const { logAction } = require('./logging');
const { getRelations } = require('./links');
const { getBlockers, isBlocked } = require('./blockers');
const { getComments, getCommentCount } = require('./comments');
const { getAssignees } = require('./assignees');
const { publishEvent, sendNotification, publishToUser } = require('./notifications');
const { recalculateInitiativeForTodo } = require('./initiatives');

const STATUS_OPEN = 'open';
const STATUS_DONE = 'done';
const STATUS_IN_PROGRESS = 'in_progress';
const STATUS_TODO = 'todo';
const STATUS_COMPLETED = 'completed';

function generateRequestId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Helper to map v1 storage status to v2 response status
function statusToV2(status) {
  if (status === STATUS_OPEN) return STATUS_TODO;
  if (status === STATUS_DONE) return STATUS_COMPLETED;
  if (status === STATUS_IN_PROGRESS) return STATUS_IN_PROGRESS;
  return STATUS_TODO;
}

// Helper to map v2 input status to v1 storage status
function statusFromV2(status) {
  if (status === STATUS_TODO) return STATUS_OPEN;
  if (status === STATUS_COMPLETED) return STATUS_DONE;
  if (status === STATUS_IN_PROGRESS) return STATUS_IN_PROGRESS;
  return STATUS_OPEN;
}

async function getProjectInfo(db, projectId) {
  if (!projectId) {
    return null;
  }
  try {
    const project = await db.getById('projects', projectId);
    if (project) {
      return { id: project.id, name: project.name };
    }
  } catch (error) {
    console.error('Error fetching project:', error);
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
    const allInitiativeTodos = await db.getAll('initiative_todos');
    if (!Array.isArray(allInitiativeTodos)) {
      return null;
    }
    const initiativeTodo = allInitiativeTodos.find(l => l.todo_id === parseInt(todoId));
    if (!initiativeTodo) {
      return null;
    }
    const initiative = await db.getById('initiatives', initiativeTodo.initiative_id);
    if (initiative) {
      return { id: initiative.id, name: initiative.name };
    }
  } catch (error) {
    console.error('Error fetching initiative for todo:', error);
    throw error;
  }
  return null;
}

// Helper to enrich a todo with v2-specific fields
async function enrichTodoV2(db, auth, todo) {
  const blocked = await isBlocked(db, todo.id);
  const comment_count = await getCommentCount(db, todo.id);
  const assignees = await getAssignees(db, auth, todo.id);
  const project = await getProjectInfo(db, todo.project_id);
  const initiative = await getInitiativeForTodo(db, todo.id);

  return {
    id: todo.id,
    title: todo.title,
    description: todo.description,
    status: statusToV2(todo.status),
    priority: todo.priority,
    due_date: todo.due_date,
    project_id: todo.project_id,
    created_by: todo.created_by,
    created_at: todo.created_at,
    updated_at: todo.updated_at,
    completed_at: todo.completed_at,
    archived: todo.archived,
    archived_at: todo.archived_at,
    is_blocked: blocked,
    comment_count,
    assignees: assignees.map(a => ({ id: a.id, username: a.username })),
    project,
    is_overdue: isOverdue(todo),
    initiative
  };
}

// Response wrapper for v2 endpoints
function wrapV2Response(data, meta = {}) {
  const requestId = meta.request_id || generateRequestId();
  return {
    data,
    meta: {
      api_version: 2,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

function registerV2Routes(app, requireAuth, db, auth) {
  app.get('/api/v2/todos', requireAuth, async (req, res) => {
    const { page = 1, page_size = 20, status, priority, project_id, assigned_to, overdue, include_archived, sort, order } = req.query;

    try {
      let pageNum = parseInt(page) || 1;
      let pageSizeNum = parseInt(page_size) || 20;

      if (pageSizeNum > 100) {
        pageSizeNum = 100;
      }
      if (pageNum < 1) {
        pageNum = 1;
      }

      // Fetch all todos (we'll handle filtering in-memory)
      const todos = await db.getAll('todos');

      if (!Array.isArray(todos)) {
        const meta = {
          page: pageNum,
          page_size: pageSizeNum,
          total: 0,
          total_pages: 0
        };
        return res.json(wrapV2Response([], meta));
      }

      let filtered = todos;
      if (include_archived !== 'true') {
        // Default: exclude archived
        filtered = todos.filter(todo => !todo.archived);
      }

      const todosWithEnrichment = [];
      for (const todo of filtered) {
        const enriched = await enrichTodoV2(db, auth, todo);
        todosWithEnrichment.push(enriched);
      }

      if (status) {
        // Convert v2 status to v1 storage status for filtering
        const v1Status = statusFromV2(status);
        todosWithEnrichment = todosWithEnrichment.filter(todo => {
          // If filtering for todo, include both open and in_progress
          if (v1Status === 'open') {
            const storageStatus = todo.status === 'todo' ? 'open' :
                                 todo.status === 'in_progress' ? 'in_progress' :
                                 todo.status === 'completed' ? 'done' : 'open';
            return storageStatus === 'open' || storageStatus === 'in_progress';
          }
          return todo.status === status;
        });
      }

      let result = todosWithEnrichment;
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

      await logAction(db, req.user.id, req.user.username, 'list_todos', null, {});

      const total = result.length;
      const total_pages = Math.ceil(total / pageSizeNum);
      const start = (pageNum - 1) * pageSizeNum;
      const end = start + pageSizeNum;
      const items = result.slice(start, end);

      const meta = {
        page: pageNum,
        page_size: pageSizeNum,
        total,
        total_pages
      };

      res.json(wrapV2Response(items, meta));
    } catch (error) {
      console.error('List todos error:', error);
      res.status(500).json(wrapV2Response(null, { error: 'failed to list todos' }));
    }
  });

  app.get('/api/v2/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
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
        id: todo.id,
        title: todo.title,
        description: todo.description,
        status: statusToV2(todo.status),
        priority: todo.priority,
        due_date: todo.due_date,
        project_id: todo.project_id,
        created_by: todo.created_by,
        created_at: todo.created_at,
        updated_at: todo.updated_at,
        completed_at: todo.completed_at,
        archived: todo.archived,
        archived_at: todo.archived_at,
        relations,
        blocked_by,
        is_blocked: blocked,
        comments,
        assignees: assignees.map(a => ({ id: a.id, username: a.username })),
        project,
        initiative,
        is_overdue: isOverdue(todo)
      };

      res.json(wrapV2Response(response));
    } catch (error) {
      res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
    }
  });

  app.post('/api/v2/todos', requireAuth, async (req, res) => {
    const { title, description, status, project_id, due_date, priority } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json(wrapV2Response(null, { error: 'title is required' }));
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 200) {
      return res.status(400).json(wrapV2Response(null, { error: 'title too long (max 200)' }));
    }

    let trimmedDescription = description;
    if (description !== undefined && description !== null) {
      trimmedDescription = String(description).trim();
      if (trimmedDescription.length > 2000) {
        return res.status(400).json(wrapV2Response(null, { error: 'description too long (max 2000)' }));
      }
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    let assignedPriority = priority || 'medium';
    if (!validPriorities.includes(assignedPriority)) {
      return res.status(400).json(wrapV2Response(null, { error: 'invalid priority' }));
    }

    let assignedDueDate = due_date || null;
    if (due_date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
        return res.status(400).json(wrapV2Response(null, { error: 'invalid due_date format' }));
      }
      const dateObj = new Date(due_date + 'T00:00:00Z');
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json(wrapV2Response(null, { error: 'invalid due_date' }));
      }
      assignedDueDate = due_date;
    }

    // Determine project_id: explicit > current project > null
    let assignedProjectId = null;
    if (project_id !== undefined && project_id !== null) {
      try {
        const project = await db.getById('projects', project_id);
        if (!project) {
          return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
        }
      } catch (error) {
        return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
      }
      assignedProjectId = project_id;
    } else {
      const currentProject = auth.getCurrentProject(req.user.id);
      if (currentProject) {
        assignedProjectId = currentProject;
      }
    }

    // Convert v2 status to v1 storage status
    const storageStatus = statusFromV2(status || 'todo');

    const now = new Date().toISOString();
    const todoRecord = {
      title: trimmedTitle,
      description: trimmedDescription || null,
      status: storageStatus,
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

      await publishEvent('todos', {
        type: 'todo.created',
        todo,
        by: req.user.username
      });

      const enriched = await enrichTodoV2(db, auth, todo);
      res.status(201).json(wrapV2Response(enriched));
    } catch (error) {
      console.error('Create todo error:', error);
      res.status(500).json(wrapV2Response(null, { error: 'failed to create todo' }));
    }
  });

  app.put('/api/v2/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, status, project_id, due_date, priority } = req.body;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
      }

      if (todo.archived) {
        return res.status(409).json(wrapV2Response(null, { error: 'todo is archived' }));
      }

      if (title !== undefined) {
        if (!title || typeof title !== 'string' || !title.trim()) {
          return res.status(400).json(wrapV2Response(null, { error: 'title is required' }));
        }
        const trimmedTitle = title.trim();
        if (trimmedTitle.length > 200) {
          return res.status(400).json(wrapV2Response(null, { error: 'title too long (max 200)' }));
        }
      }

      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 2000) {
          return res.status(400).json(wrapV2Response(null, { error: 'description too long (max 2000)' }));
        }
      }

      if (priority !== undefined) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return res.status(400).json(wrapV2Response(null, { error: 'invalid priority' }));
        }
      }

      if (due_date !== undefined) {
        if (due_date !== null) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
            return res.status(400).json(wrapV2Response(null, { error: 'invalid due_date format' }));
          }
          const dateObj = new Date(due_date + 'T00:00:00Z');
          if (isNaN(dateObj.getTime())) {
            return res.status(400).json(wrapV2Response(null, { error: 'invalid due_date' }));
          }
        }
      }

      // Check if trying to mark as completed while blocked
      if (status && statusFromV2(status) === 'done' && statusFromV2(status) !== todo.status) {
        const blocked = await isBlocked(db, id);
        if (blocked) {
          const blockers = await getBlockers(db, id);
          const blockerIds = blockers.map(b => b.id);
          return res.status(409).json(wrapV2Response(null, { error: 'todo is blocked', blocked_by: blockerIds }));
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
      if (status !== undefined) {
        const newStorageStatus = statusFromV2(status);
        if (newStorageStatus !== todo.status) {
          changes.status = { from: todo.status, to: newStorageStatus };
          todo.status = newStorageStatus;

          if (newStorageStatus === 'done') {
            todo.completed_at = new Date().toISOString();
          } else if (newStorageStatus === 'open' || newStorageStatus === 'in_progress') {
            todo.completed_at = null;
          }
        }
      }

      if (project_id !== undefined && project_id !== todo.project_id) {
        if (project_id !== null) {
          const project = await db.getById('projects', project_id);
          if (!project) {
            return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
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
        await recalculateInitiativeForTodo(db, parseInt(id));
      }

      await logAction(db, req.user.id, req.user.username, 'update_todo', id, changes);

      await publishEvent('todos', {
        type: 'todo.updated',
        todo,
        by: req.user.username
      });

      if (changes.status && changes.status.to === 'done') {
        const assignees = await getAssignees(db, auth, id);
        const databaseName = db.getDatabaseName();
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

      const enriched = await enrichTodoV2(db, auth, todo);
      res.json(wrapV2Response(enriched));
    } catch (error) {
      res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
    }
  });

  // PATCH /api/v2/todos/:id/status - Update status only
  app.patch('/api/v2/todos/:id/status', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json(wrapV2Response(null, { error: 'status is required' }));
    }

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
      }

      if (todo.archived) {
        return res.status(409).json(wrapV2Response(null, { error: 'todo is archived' }));
      }

      const newStorageStatus = statusFromV2(status);

      // Check if trying to mark as completed while blocked
      if (newStorageStatus === 'done') {
        const blocked = await isBlocked(db, id);
        if (blocked) {
          const blockers = await getBlockers(db, id);
          const blockerIds = blockers.map(b => b.id);
          return res.status(409).json(wrapV2Response(null, { error: 'todo is blocked', blocked_by: blockerIds }));
        }
      }

      todo.status = newStorageStatus;

      if (newStorageStatus === 'done') {
        todo.completed_at = new Date().toISOString();
      } else if (newStorageStatus === 'open' || newStorageStatus === 'in_progress') {
        todo.completed_at = null;
      }

      todo.updated_at = new Date().toISOString();

      await db.update('todos', id, todo);

      await recalculateInitiativeForTodo(db, parseInt(id));

      await logAction(db, req.user.id, req.user.username, 'update_todo', id, { status: newStorageStatus });

      if (newStorageStatus === 'done') {
        const assignees = await getAssignees(db, auth, id);
        const databaseName = db.getDatabaseName();
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

      const enriched = await enrichTodoV2(db, auth, todo);
      res.json(wrapV2Response(enriched));
    } catch (error) {
      console.error('Update status error:', error);
      res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
    }
  });

  app.get('/api/v2/projects/:project_id/todos', requireAuth, async (req, res) => {
    const { project_id } = req.params;
    const { page = 1, page_size = 20, status, priority, assigned_to, overdue, include_archived, sort, order } = req.query;

    try {
      const project = await db.getById('projects', project_id);
      if (!project) {
        return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
      }

      let pageNum = parseInt(page) || 1;
      let pageSizeNum = parseInt(page_size) || 20;

      if (pageSizeNum > 100) {
        pageSizeNum = 100;
      }
      if (pageNum < 1) {
        pageNum = 1;
      }

      const todos = await db.getAll('todos');

      if (!Array.isArray(todos)) {
        const meta = {
          page: pageNum,
          page_size: pageSizeNum,
          total: 0,
          total_pages: 0
        };
        return res.json(wrapV2Response([], meta));
      }

      let filtered = todos.filter(todo => todo.project_id === parseInt(project_id));

      if (include_archived !== 'true') {
        filtered = filtered.filter(todo => !todo.archived);
      }

      const todosWithEnrichment = [];
      for (const todo of filtered) {
        const enriched = await enrichTodoV2(db, auth, todo);
        todosWithEnrichment.push(enriched);
      }

      if (status) {
        const v1Status = statusFromV2(status);
        todosWithEnrichment = todosWithEnrichment.filter(todo => {
          if (v1Status === 'open') {
            const storageStatus = todo.status === 'todo' ? 'open' :
                                 todo.status === 'in_progress' ? 'in_progress' :
                                 todo.status === 'completed' ? 'done' : 'open';
            return storageStatus === 'open' || storageStatus === 'in_progress';
          }
          return todo.status === status;
        });
      }

      let result = todosWithEnrichment;
      if (assigned_to) {
        const userId = parseInt(assigned_to);
        result = result.filter(todo =>
          todo.assignees.some(a => a.id === userId)
        );
      }

      if (priority) {
        result = result.filter(todo => todo.priority === priority);
      }

      if (overdue === 'true') {
        result = result.filter(todo => todo.is_overdue);
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

      await logAction(db, req.user.id, req.user.username, 'list_project_todos', null, { project_id });

      const total = result.length;
      const total_pages = Math.ceil(total / pageSizeNum);
      const start = (pageNum - 1) * pageSizeNum;
      const end = start + pageSizeNum;
      const items = result.slice(start, end);

      const meta = {
        page: pageNum,
        page_size: pageSizeNum,
        total,
        total_pages
      };

      res.json(wrapV2Response(items, meta));
    } catch (error) {
      console.error('List project todos error:', error);
      res.status(500).json(wrapV2Response(null, { error: 'failed to list project todos' }));
    }
  });
}

module.exports = {
  registerV2Routes
};
