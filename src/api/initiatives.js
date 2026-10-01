
const { logAction } = require('./logging');
const { publishEvent } = require('./notifications');

const INITIATIVES_TABLE = 'initiatives';
const INITIATIVE_PROJECTS_TABLE = 'initiative_projects';
const INITIATIVE_TODOS_TABLE = 'initiative_todos';
const PROJECTS_TABLE = 'projects';
const TODOS_TABLE = 'todos';

const STATUS_BAD_REQUEST = 400;
const STATUS_NOT_FOUND = 404;
const STATUS_CREATED = 201;
const STATUS_SERVER_ERROR = 500;

const ERROR_NAME_REQUIRED = 'name is required';
const ERROR_NAME_TOO_LONG_200 = 'name too long (max 200)';
const ERROR_DESCRIPTION_TOO_LONG_2000 = 'description too long (max 2000)';
const ERROR_INITIATIVE_NOT_FOUND = 'initiative not found';

const STATUS_DONE = 'done';
const STATUS_ACTIVE = 'active';
const STATUS_COMPLETED = 'completed';

function registerInitiativeRoutes(app, requireAuth, db) {
  app.post('/initiatives', requireAuth, async (req, res) => {
    const { name, description, project_ids } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(STATUS_BAD_REQUEST).json({ error: ERROR_NAME_REQUIRED });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return res.status(STATUS_BAD_REQUEST).json({ error: ERROR_NAME_TOO_LONG_200 });
    }

    if (!Array.isArray(project_ids) || project_ids.length === 0) {
      return res.status(STATUS_BAD_REQUEST).json({ error: 'project_ids must be a non-empty array' });
    }

    try {
      const allProjects = await db.getAll(PROJECTS_TABLE);
      const projectMap = {};
      if (Array.isArray(allProjects)) {
        allProjects.forEach(p => {
          projectMap[p.id] = p;
        });
      }

      for (const projectId of project_ids) {
        if (!projectMap[projectId]) {
          return res.status(STATUS_BAD_REQUEST).json({ error: `project ${projectId} not found` });
        }
      }

      let trimmedDescription = description;
      if (description !== undefined && description !== null) {
        trimmedDescription = String(description).trim();
        if (trimmedDescription.length > 2000) {
          return res.status(STATUS_BAD_REQUEST).json({ error: ERROR_DESCRIPTION_TOO_LONG_2000 });
        }
      }

      const now = new Date().toISOString();
      const initiativeRecord = {
        name: trimmedName,
        description: trimmedDescription || null,
        status: STATUS_ACTIVE,
        created_by: req.user.id,
        created_at: now,
        updated_at: now,
        completed_at: null
      };

      const initiative = await db.insert(INITIATIVES_TABLE, initiativeRecord);

      for (const projectId of project_ids) {
        await db.insert('initiative_projects', {
          initiative_id: initiative.id,
          project_id: projectId
        });
      }

      await logAction(db, req.user.id, req.user.username, 'create_initiative', initiative.id, {
        name: trimmedName,
        project_ids
      });

      const response = await enrichInitiative(db, initiative);
      res.status(STATUS_CREATED).json(response);
    } catch (error) {
      console.error('Create initiative error:', error);
      res.status(STATUS_SERVER_ERROR).json({ error: 'failed to create initiative' });
    }
  });

  app.get('/initiatives', requireAuth, async (req, res) => {
    try {
      const initiatives = await db.getAll(INITIATIVES_TABLE);
      const result = Array.isArray(initiatives) ? initiatives : [];

      const enriched = await Promise.all(result.map(init => enrichInitiative(db, init)));

      res.json(enriched);
    } catch (error) {
      res.status(STATUS_SERVER_ERROR).json({ error: 'failed to list initiatives' });
    }
  });

  app.get('/initiatives/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      const response = await enrichInitiative(db, initiative);
      res.json(response);
    } catch (error) {
      res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
    }
  });

  app.get('/initiatives/:id/progress', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      const progress = await calculateProgress(db, parseInt(id));
      res.json(progress);
    } catch (error) {
      res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
    }
  });

  app.put('/initiatives/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      const changes = {};

      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(STATUS_BAD_REQUEST).json({ error: ERROR_NAME_REQUIRED });
        }
        const trimmedName = name.trim();
        if (trimmedName.length > 200) {
          return res.status(STATUS_BAD_REQUEST).json({ error: ERROR_NAME_TOO_LONG_200 });
        }
        if (trimmedName !== initiative.name) {
          changes.name = { from: initiative.name, to: trimmedName };
          initiative.name = trimmedName;
        }
      }

      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 2000) {
          return res.status(STATUS_BAD_REQUEST).json({ error: ERROR_DESCRIPTION_TOO_LONG_2000 });
        }
        if (trimmedDesc !== initiative.description) {
          changes.description = { from: initiative.description, to: trimmedDesc || null };
          initiative.description = trimmedDesc || null;
        }
      }

      initiative.updated_at = new Date().toISOString();

      await db.update('initiatives', id, initiative);

      await logAction(db, req.user.id, req.user.username, 'update_initiative', parseInt(id), changes);

      await publishEvent('initiatives', {
        type: 'initiative.updated',
        initiative,
        by: req.user.username
      });

      const response = await enrichInitiative(db, initiative);
      res.json(response);
    } catch (error) {
      res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
    }
  });

  // DELETE /initiatives/:id - Delete an initiative (removes initiative and link rows, not todos or projects)
  app.delete('/initiatives/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      try {
        const allLinks = await db.getAll(INITIATIVE_PROJECTS_TABLE);
        if (Array.isArray(allLinks)) {
          for (const link of allLinks) {
            if (link.initiative_id === parseInt(id)) {
              await db.remove('initiative_projects', link.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting initiative_projects:', error);
      }

      try {
        const allTodos = await db.getAll('initiative_todos');
        if (Array.isArray(allTodos)) {
          for (const link of allTodos) {
            if (link.initiative_id === parseInt(id)) {
              await db.remove('initiative_todos', link.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting initiative_todos:', error);
      }

      await db.remove('initiatives', id);

      // Log the action
      await logAction(db, req.user.id, req.user.username, 'delete_initiative', parseInt(id), {});

      await publishEvent('initiatives', {
        type: 'initiative.deleted',
        initiative,
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
    }
  });

  app.post('/initiatives/:id/projects', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { project_id } = req.body;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      const project = await db.getById(PROJECTS_TABLE, project_id);
      if (!project) {
        return res.status(STATUS_NOT_FOUND).json({ error: 'project not found' });
      }

      const allLinks = await db.getAll(INITIATIVE_PROJECTS_TABLE);
      if (Array.isArray(allLinks)) {
        const exists = allLinks.some(
          l => l.initiative_id === parseInt(id) && l.project_id === parseInt(project_id)
        );
        if (exists) {
          return res.status(STATUS_BAD_REQUEST).json({ error: 'project already linked to this initiative' });
        }
      }

      await db.insert('initiative_projects', {
        initiative_id: parseInt(id),
        project_id: parseInt(project_id)
      });

      await logAction(db, req.user.id, req.user.username, 'add_initiative_project', parseInt(id), {
        project_id: parseInt(project_id)
      });

      await publishEvent('initiatives', {
        type: 'initiative.project_added',
        initiative_id: parseInt(id),
        project_id: parseInt(project_id),
        by: req.user.username
      });

      const response = await enrichInitiative(db, initiative);
      res.status(STATUS_CREATED).json(response);
    } catch (error) {
      console.error('Add project error:', error);
      res.status(STATUS_SERVER_ERROR).json({ error: 'failed to add project' });
    }
  });

  app.delete('/initiatives/:id/projects/:projectId', requireAuth, async (req, res) => {
    const { id, projectId } = req.params;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      // Check that initiative has at least one other project
      const allLinks = await db.getAll(INITIATIVE_PROJECTS_TABLE);
      const initiativeProjects = Array.isArray(allLinks)
        ? allLinks.filter(l => l.initiative_id === parseInt(id))
        : [];

      if (initiativeProjects.length <= 1) {
        return res.status(STATUS_BAD_REQUEST).json({ error: 'initiative must have at least one project' });
      }

      let found = false;
      for (const link of initiativeProjects) {
        if (link.project_id === parseInt(projectId)) {
          await db.remove('initiative_projects', link.id);
          found = true;
          break;
        }
      }

      if (!found) {
        return res.status(STATUS_NOT_FOUND).json({ error: 'project not linked to this initiative' });
      }

      await logAction(db, req.user.id, req.user.username, 'remove_initiative_project', parseInt(id), {
        project_id: parseInt(projectId)
      });

      await publishEvent('initiatives', {
        type: 'initiative.project_removed',
        initiative_id: parseInt(id),
        project_id: parseInt(projectId),
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(STATUS_SERVER_ERROR).json({ error: 'failed to remove project' });
    }
  });

  app.post('/initiatives/:id/todos', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { todo_id } = req.body;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      const todo = await db.getById(TODOS_TABLE, todo_id);
      if (!todo) {
        return res.status(STATUS_NOT_FOUND).json({ error: 'todo not found' });
      }

      const allInitiativeProjects = await db.getAll('initiative_projects');
      const initiativeProjectIds = Array.isArray(allInitiativeProjects)
        ? allInitiativeProjects
            .filter(l => l.initiative_id === parseInt(id))
            .map(l => l.project_id)
        : [];

      // Verify todo's project is one of the initiative's projects
      if (!initiativeProjectIds.includes(todo.project_id)) {
        return res.status(STATUS_BAD_REQUEST).json({
          error: "todo's project is not in this initiative's projects"
        });
      }

      const allInitiativeTodos = await db.getAll(INITIATIVE_TODOS_TABLE);
      if (Array.isArray(allInitiativeTodos)) {
        const alreadyLinked = allInitiativeTodos.some(
          l => l.todo_id === parseInt(todo_id)
        );
        if (alreadyLinked) {
          return res.status(STATUS_BAD_REQUEST).json({ error: 'todo already belongs to an initiative' });
        }
      }

      await db.insert('initiative_todos', {
        initiative_id: parseInt(id),
        todo_id: parseInt(todo_id)
      });

      await logAction(db, req.user.id, req.user.username, 'add_initiative_todo', parseInt(id), {
        todo_id: parseInt(todo_id)
      });

      await recalculateInitiativeForTodo(db, parseInt(todo_id));

      const response = await enrichInitiative(db, initiative);
      res.status(STATUS_CREATED).json(response);
    } catch (error) {
      console.error('Add todo error:', error);
      res.status(STATUS_SERVER_ERROR).json({ error: 'failed to add todo' });
    }
  });

  app.delete('/initiatives/:id/todos/:todoId', requireAuth, async (req, res) => {
    const { id, todoId } = req.params;

    try {
      const initiative = await db.getById(INITIATIVES_TABLE, id);
      if (!initiative) {
        return res.status(STATUS_NOT_FOUND).json({ error: ERROR_INITIATIVE_NOT_FOUND });
      }

      const allInitiativeTodos = await db.getAll(INITIATIVE_TODOS_TABLE);
      let found = false;
      if (Array.isArray(allInitiativeTodos)) {
        for (const link of allInitiativeTodos) {
          if (link.initiative_id === parseInt(id) && link.todo_id === parseInt(todoId)) {
            await db.remove('initiative_todos', link.id);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        return res.status(STATUS_NOT_FOUND).json({ error: 'todo not linked to this initiative' });
      }

      await logAction(db, req.user.id, req.user.username, 'remove_initiative_todo', parseInt(id), {
        todo_id: parseInt(todoId)
      });

      await publishEvent('initiatives', {
        type: 'initiative.todo_removed',
        initiative_id: parseInt(id),
        todo_id: parseInt(todoId),
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(STATUS_SERVER_ERROR).json({ error: 'failed to remove todo' });
    }
  });
}

async function enrichInitiative(db, initiative) {
  const projects = await getInitiativeProjects(db, initiative.id);
  const progress = await calculateProgress(db, initiative.id);

  return {
    ...initiative,
    projects,
    todo_count: progress.total,
    done_count: progress.done,
    percent: progress.percent
  };
}

async function getInitiativeProjects(db, initiativeId) {
  try {
    const allProjects = await db.getAll('projects');
    const allLinks = await db.getAll(INITIATIVE_PROJECTS_TABLE);

    if (!Array.isArray(allLinks)) {
      return [];
    }

    const projectIds = allLinks
      .filter(l => l.initiative_id === parseInt(initiativeId))
      .map(l => l.project_id);

    if (!Array.isArray(allProjects)) {
      return [];
    }

    return allProjects
      .filter(p => projectIds.includes(p.id))
      .map(p => ({ id: p.id, name: p.name }));
  } catch (error) {
    console.error('Error getting initiative projects:', error);
    throw error;
  }
}

async function calculateProgress(db, initiativeId) {
  try {
    const allInitiativeTodos = await db.getAll(INITIATIVE_TODOS_TABLE);
    const allTodos = await db.getAll(TODOS_TABLE);

    const todoIds = Array.isArray(allInitiativeTodos)
      ? allInitiativeTodos
          .filter(l => l.initiative_id === parseInt(initiativeId))
          .map(l => l.todo_id)
      : [];

    if (todoIds.length === 0) {
      return {
        total: 0,
        done: 0,
        percent: 0,
        status: STATUS_ACTIVE
      };
    }

    const initiativeTodos = Array.isArray(allTodos)
      ? allTodos.filter(t => todoIds.includes(t.id) && !t.archived)
      : [];

    const total = initiativeTodos.length;
    const done = initiativeTodos.filter(t => t.status === STATUS_DONE).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    let status = 'active';
    if (total > 0 && done === total) {
      status = 'completed';
    }

    return {
      total,
      done,
      percent,
      status
    };
  } catch (error) {
    console.error('Error calculating progress:', error);
    throw error;
  }
}

async function recalculateInitiativeForTodo(db, todoId) {
  try {
    const allInitiativeTodos = await db.getAll(INITIATIVE_TODOS_TABLE);
    if (!Array.isArray(allInitiativeTodos)) {
      return;
    }

    const initiativeTodoLink = allInitiativeTodos.find(l => l.todo_id === parseInt(todoId));
    if (!initiativeTodoLink) {
      return;
    }

    const initiativeId = initiativeTodoLink.initiative_id;
    const initiative = await db.getById('initiatives', initiativeId);
    if (!initiative) {
      return;
    }

    const progress = await calculateProgress(db, initiativeId);

    let newStatus = 'active';
    let completedAt = null;
    if (progress.total > 0 && progress.done === progress.total) {
      newStatus = 'completed';
      completedAt = new Date().toISOString();
    }

    if (initiative.status !== newStatus) {
      initiative.status = newStatus;
      initiative.completed_at = completedAt;
      initiative.updated_at = new Date().toISOString();
      await db.update(INITIATIVES_TABLE, initiativeId, initiative);

      if (newStatus === 'completed') {
        await publishEvent('initiatives', {
          type: 'initiative.completed',
          initiative_id: initiativeId,
          total: progress.total,
          done: progress.done,
          percent: progress.percent,
          status: newStatus
        });
      }
    }

    // Always publish progress event
    await publishEvent('initiatives', {
      type: 'initiative.progress',
      initiative_id: initiativeId,
      total: progress.total,
      done: progress.done,
      percent: progress.percent,
      status: initiative.status
    });
  } catch (error) {
    console.error('Error recalculating initiative for todo:', error);
    throw error;
  }
}

module.exports = {
  registerInitiativeRoutes,
  recalculateInitiativeForTodo
};
