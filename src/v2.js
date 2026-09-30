// V2 API with pagination and new status vocabulary

const { getAll, getById, insert, update, getDatabaseName } = require('./db');
const { logAction } = require('./logging');
const { getRelations } = require('./links');
const { getBlockers, isBlocked } = require('./blockers');
const { getComments, getCommentCount } = require('./comments');
const { getAssignees } = require('./assignees');
const { publishEvent, sendNotification, publishToUser } = require('./notifications');
const { getCurrentProject } = require('./auth');
const { recalculateInitiativeForTodo } = require('./initiatives');

// Helper to generate request ID
function generateRequestId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Helper to map v1 storage status to v2 response status
function statusToV2(status) {
  if (status === 'open') return 'todo';
  if (status === 'done') return 'completed';
  if (status === 'in_progress') return 'in_progress';
  return 'todo';
}

// Helper to map v2 input status to v1 storage status
function statusFromV2(status) {
  if (status === 'todo') return 'open';
  if (status === 'completed') return 'done';
  if (status === 'in_progress') return 'in_progress';
  return 'open';
}

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

// Helper to enrich a todo with v2-specific fields
async function enrichTodoV2(todo) {
  const blocked = await isBlocked(todo.id);
  const comment_count = await getCommentCount(todo.id);
  const assignees = await getAssignees(todo.id);
  const project = await getProjectInfo(todo.project_id);
  const initiative = await getInitiativeForTodo(todo.id);

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

function registerV2Routes(app, requireAuth) {
  // GET /api/v2/todos - List todos with pagination
  app.get('/api/v2/todos', requireAuth, async (req, res) => {
    const { page = 1, page_size = 20, status, priority, project_id, assigned_to, overdue, include_archived, sort, order } = req.query;

    try {
      // Parse pagination params
      let pageNum = parseInt(page) || 1;
      let pageSizeNum = parseInt(page_size) || 20;

      // Validate page_size max
      if (pageSizeNum > 100) {
        pageSizeNum = 100;
      }
      if (pageNum < 1) {
        pageNum = 1;
      }

      // Fetch all todos (we'll handle filtering in-memory)
      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        const meta = {
          page: pageNum,
          page_size: pageSizeNum,
          total: 0,
          total_pages: 0
        };
        return res.json(wrapV2Response([], meta));
      }

      // Filter by archive status
      let filtered = todos;
      if (include_archived !== 'true') {
        // Default: exclude archived
        filtered = todos.filter(todo => !todo.archived);
      }

      // Enrich all todos
      const todosWithEnrichment = [];
      for (const todo of filtered) {
        const enriched = await enrichTodoV2(todo);
        todosWithEnrichment.push(enriched);
      }

      // Filter by status if provided
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

      // Filter by assigned_to if provided
      let result = todosWithEnrichment;
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

      // Log the action
      await logAction(req.user.id, req.user.username, 'list_todos', null, {});

      // Paginate
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

  // GET /api/v2/todos/:id - Get a single todo
  app.get('/api/v2/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
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

  // POST /api/v2/todos - Create a todo
  app.post('/api/v2/todos', requireAuth, async (req, res) => {
    const { title, description, status, project_id, due_date, priority } = req.body;

    // Validate title
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json(wrapV2Response(null, { error: 'title is required' }));
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 200) {
      return res.status(400).json(wrapV2Response(null, { error: 'title too long (max 200)' }));
    }

    // Validate description
    let trimmedDescription = description;
    if (description !== undefined && description !== null) {
      trimmedDescription = String(description).trim();
      if (trimmedDescription.length > 2000) {
        return res.status(400).json(wrapV2Response(null, { error: 'description too long (max 2000)' }));
      }
    }

    // Validate priority
    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    let assignedPriority = priority || 'medium';
    if (!validPriorities.includes(assignedPriority)) {
      return res.status(400).json(wrapV2Response(null, { error: 'invalid priority' }));
    }

    // Validate due_date
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
        const project = await getById('projects', project_id);
        if (!project) {
          return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
        }
      } catch (error) {
        return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
      }
      assignedProjectId = project_id;
    } else {
      const currentProject = getCurrentProject(req.user.id);
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

      const enriched = await enrichTodoV2(todo);
      res.status(201).json(wrapV2Response(enriched));
    } catch (error) {
      console.error('Create todo error:', error);
      res.status(500).json(wrapV2Response(null, { error: 'failed to create todo' }));
    }
  });

  // PUT /api/v2/todos/:id - Update a todo
  app.put('/api/v2/todos/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, description, status, project_id, due_date, priority } = req.body;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
      }

      // Check if todo is archived
      if (todo.archived) {
        return res.status(409).json(wrapV2Response(null, { error: 'todo is archived' }));
      }

      // Validate title if provided
      if (title !== undefined) {
        if (!title || typeof title !== 'string' || !title.trim()) {
          return res.status(400).json(wrapV2Response(null, { error: 'title is required' }));
        }
        const trimmedTitle = title.trim();
        if (trimmedTitle.length > 200) {
          return res.status(400).json(wrapV2Response(null, { error: 'title too long (max 200)' }));
        }
      }

      // Validate description if provided
      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 2000) {
          return res.status(400).json(wrapV2Response(null, { error: 'description too long (max 2000)' }));
        }
      }

      // Validate priority if provided
      if (priority !== undefined) {
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
          return res.status(400).json(wrapV2Response(null, { error: 'invalid priority' }));
        }
      }

      // Validate due_date if provided
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
        const blocked = await isBlocked(id);
        if (blocked) {
          const blockers = await getBlockers(id);
          const blockerIds = blockers.map(b => b.id);
          return res.status(409).json(wrapV2Response(null, { error: 'todo is blocked', blocked_by: blockerIds }));
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
      if (status !== undefined) {
        const newStorageStatus = statusFromV2(status);
        if (newStorageStatus !== todo.status) {
          changes.status = { from: todo.status, to: newStorageStatus };
          todo.status = newStorageStatus;

          // Update completed_at based on status
          if (newStorageStatus === 'done') {
            todo.completed_at = new Date().toISOString();
          } else if (newStorageStatus === 'open' || newStorageStatus === 'in_progress') {
            todo.completed_at = null;
          }
        }
      }

      // Handle project_id change
      if (project_id !== undefined && project_id !== todo.project_id) {
        if (project_id !== null) {
          const project = await getById('projects', project_id);
          if (!project) {
            return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
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

      const enriched = await enrichTodoV2(todo);
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
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
      }

      // Check if todo is archived
      if (todo.archived) {
        return res.status(409).json(wrapV2Response(null, { error: 'todo is archived' }));
      }

      const newStorageStatus = statusFromV2(status);

      // Check if trying to mark as completed while blocked
      if (newStorageStatus === 'done') {
        const blocked = await isBlocked(id);
        if (blocked) {
          const blockers = await getBlockers(id);
          const blockerIds = blockers.map(b => b.id);
          return res.status(409).json(wrapV2Response(null, { error: 'todo is blocked', blocked_by: blockerIds }));
        }
      }

      todo.status = newStorageStatus;

      // Update completed_at based on status
      if (newStorageStatus === 'done') {
        todo.completed_at = new Date().toISOString();
      } else if (newStorageStatus === 'open' || newStorageStatus === 'in_progress') {
        todo.completed_at = null;
      }

      todo.updated_at = new Date().toISOString();

      await update('todos', id, todo);

      // Recalculate initiative
      await recalculateInitiativeForTodo(parseInt(id));

      // Log the action
      await logAction(req.user.id, req.user.username, 'update_todo', id, { status: newStorageStatus });

      // Send completion notifications to assignees
      if (newStorageStatus === 'done') {
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

      const enriched = await enrichTodoV2(todo);
      res.json(wrapV2Response(enriched));
    } catch (error) {
      console.error('Update status error:', error);
      res.status(404).json(wrapV2Response(null, { error: 'todo not found' }));
    }
  });

  // GET /api/v2/projects/:project_id/todos - List todos for a project with pagination
  app.get('/api/v2/projects/:project_id/todos', requireAuth, async (req, res) => {
    const { project_id } = req.params;
    const { page = 1, page_size = 20, status, priority, assigned_to, overdue, include_archived, sort, order } = req.query;

    try {
      // Verify project exists
      const project = await getById('projects', project_id);
      if (!project) {
        return res.status(404).json(wrapV2Response(null, { error: 'project not found' }));
      }

      // Parse pagination params
      let pageNum = parseInt(page) || 1;
      let pageSizeNum = parseInt(page_size) || 20;

      if (pageSizeNum > 100) {
        pageSizeNum = 100;
      }
      if (pageNum < 1) {
        pageNum = 1;
      }

      // Fetch all todos
      const todos = await getAll('todos');

      if (!Array.isArray(todos)) {
        const meta = {
          page: pageNum,
          page_size: pageSizeNum,
          total: 0,
          total_pages: 0
        };
        return res.json(wrapV2Response([], meta));
      }

      // Filter by project_id
      let filtered = todos.filter(todo => todo.project_id === parseInt(project_id));

      // Filter by archive status
      if (include_archived !== 'true') {
        filtered = filtered.filter(todo => !todo.archived);
      }

      // Enrich all todos
      const todosWithEnrichment = [];
      for (const todo of filtered) {
        const enriched = await enrichTodoV2(todo);
        todosWithEnrichment.push(enriched);
      }

      // Filter by status if provided
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

      // Filter by assigned_to if provided
      let result = todosWithEnrichment;
      if (assigned_to) {
        const userId = parseInt(assigned_to);
        result = result.filter(todo =>
          todo.assignees.some(a => a.id === userId)
        );
      }

      // Filter by priority if provided
      if (priority) {
        result = result.filter(todo => todo.priority === priority);
      }

      // Filter by overdue if provided
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

      // Log the action
      await logAction(req.user.id, req.user.username, 'list_project_todos', null, { project_id });

      // Paginate
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
