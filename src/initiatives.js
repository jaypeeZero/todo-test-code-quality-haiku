// Initiatives module for cross-project goals

const { getAll, getById, insert, update, remove } = require('./db');
const { logAction } = require('./logging');
const { publishEvent } = require('./notifications');

// Register initiative routes
function registerInitiativeRoutes(app, requireAuth) {
  // POST /initiatives - Create an initiative
  app.post('/initiatives', requireAuth, async (req, res) => {
    const { name, description, project_ids } = req.body;

    // Validate name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 200) {
      return res.status(400).json({ error: 'name too long (max 200)' });
    }

    // Validate project_ids
    if (!Array.isArray(project_ids) || project_ids.length === 0) {
      return res.status(400).json({ error: 'project_ids must be a non-empty array' });
    }

    try {
      // Verify all projects exist
      const allProjects = await getAll('projects');
      const projectMap = {};
      if (Array.isArray(allProjects)) {
        allProjects.forEach(p => {
          projectMap[p.id] = p;
        });
      }

      for (const projectId of project_ids) {
        if (!projectMap[projectId]) {
          return res.status(400).json({ error: `project ${projectId} not found` });
        }
      }

      // Validate description
      let trimmedDescription = description;
      if (description !== undefined && description !== null) {
        trimmedDescription = String(description).trim();
        if (trimmedDescription.length > 2000) {
          return res.status(400).json({ error: 'description too long (max 2000)' });
        }
      }

      const now = new Date().toISOString();
      const initiativeRecord = {
        name: trimmedName,
        description: trimmedDescription || null,
        status: 'active',
        created_by: req.user.id,
        created_at: now,
        updated_at: now,
        completed_at: null
      };

      const initiative = await insert('initiatives', initiativeRecord);

      // Create initiative_projects links
      for (const projectId of project_ids) {
        await insert('initiative_projects', {
          initiative_id: initiative.id,
          project_id: projectId
        });
      }

      // Log the action
      await logAction(req.user.id, req.user.username, 'create_initiative', initiative.id, {
        name: trimmedName,
        project_ids
      });

      // Return initiative with projects and counts
      const response = await enrichInitiative(initiative);
      res.status(201).json(response);
    } catch (error) {
      console.error('Create initiative error:', error);
      res.status(500).json({ error: 'failed to create initiative' });
    }
  });

  // GET /initiatives - List all initiatives
  app.get('/initiatives', requireAuth, async (req, res) => {
    try {
      const initiatives = await getAll('initiatives');
      const result = Array.isArray(initiatives) ? initiatives : [];

      const enriched = await Promise.all(result.map(init => enrichInitiative(init)));

      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: 'failed to list initiatives' });
    }
  });

  // GET /initiatives/:id - Get a single initiative
  app.get('/initiatives/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      const response = await enrichInitiative(initiative);
      res.json(response);
    } catch (error) {
      res.status(404).json({ error: 'initiative not found' });
    }
  });

  // GET /initiatives/:id/progress - Get initiative progress
  app.get('/initiatives/:id/progress', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      const progress = await calculateProgress(parseInt(id));
      res.json(progress);
    } catch (error) {
      res.status(404).json({ error: 'initiative not found' });
    }
  });

  // PUT /initiatives/:id - Update an initiative
  app.put('/initiatives/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      const changes = {};

      // Validate name if provided
      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ error: 'name is required' });
        }
        const trimmedName = name.trim();
        if (trimmedName.length > 200) {
          return res.status(400).json({ error: 'name too long (max 200)' });
        }
        if (trimmedName !== initiative.name) {
          changes.name = { from: initiative.name, to: trimmedName };
          initiative.name = trimmedName;
        }
      }

      // Validate description if provided
      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 2000) {
          return res.status(400).json({ error: 'description too long (max 2000)' });
        }
        if (trimmedDesc !== initiative.description) {
          changes.description = { from: initiative.description, to: trimmedDesc || null };
          initiative.description = trimmedDesc || null;
        }
      }

      initiative.updated_at = new Date().toISOString();

      await update('initiatives', id, initiative);

      // Log the action
      await logAction(req.user.id, req.user.username, 'update_initiative', parseInt(id), changes);

      // Publish event
      await publishEvent('initiatives', {
        type: 'initiative.updated',
        initiative,
        by: req.user.username
      });

      const response = await enrichInitiative(initiative);
      res.json(response);
    } catch (error) {
      res.status(404).json({ error: 'initiative not found' });
    }
  });

  // DELETE /initiatives/:id - Delete an initiative (removes initiative and link rows, not todos or projects)
  app.delete('/initiatives/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      // Delete initiative_projects links
      try {
        const allLinks = await getAll('initiative_projects');
        if (Array.isArray(allLinks)) {
          for (const link of allLinks) {
            if (link.initiative_id === parseInt(id)) {
              await remove('initiative_projects', link.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting initiative_projects:', error);
      }

      // Delete initiative_todos links
      try {
        const allTodos = await getAll('initiative_todos');
        if (Array.isArray(allTodos)) {
          for (const link of allTodos) {
            if (link.initiative_id === parseInt(id)) {
              await remove('initiative_todos', link.id);
            }
          }
        }
      } catch (error) {
        console.error('Error deleting initiative_todos:', error);
      }

      await remove('initiatives', id);

      // Log the action
      await logAction(req.user.id, req.user.username, 'delete_initiative', parseInt(id), {});

      // Publish event
      await publishEvent('initiatives', {
        type: 'initiative.deleted',
        initiative,
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(404).json({ error: 'initiative not found' });
    }
  });

  // POST /initiatives/:id/projects - Add a project to an initiative
  app.post('/initiatives/:id/projects', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { project_id } = req.body;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      // Verify project exists
      const project = await getById('projects', project_id);
      if (!project) {
        return res.status(404).json({ error: 'project not found' });
      }

      // Check if already linked
      const allLinks = await getAll('initiative_projects');
      if (Array.isArray(allLinks)) {
        const exists = allLinks.some(
          l => l.initiative_id === parseInt(id) && l.project_id === parseInt(project_id)
        );
        if (exists) {
          return res.status(400).json({ error: 'project already linked to this initiative' });
        }
      }

      await insert('initiative_projects', {
        initiative_id: parseInt(id),
        project_id: parseInt(project_id)
      });

      // Log the action
      await logAction(req.user.id, req.user.username, 'add_initiative_project', parseInt(id), {
        project_id: parseInt(project_id)
      });

      // Publish event
      await publishEvent('initiatives', {
        type: 'initiative.project_added',
        initiative_id: parseInt(id),
        project_id: parseInt(project_id),
        by: req.user.username
      });

      const response = await enrichInitiative(initiative);
      res.status(201).json(response);
    } catch (error) {
      console.error('Add project error:', error);
      res.status(500).json({ error: 'failed to add project' });
    }
  });

  // DELETE /initiatives/:id/projects/:projectId - Remove a project from an initiative
  app.delete('/initiatives/:id/projects/:projectId', requireAuth, async (req, res) => {
    const { id, projectId } = req.params;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      // Check that initiative has at least one other project
      const allLinks = await getAll('initiative_projects');
      const initiativeProjects = Array.isArray(allLinks)
        ? allLinks.filter(l => l.initiative_id === parseInt(id))
        : [];

      if (initiativeProjects.length <= 1) {
        return res.status(400).json({ error: 'initiative must have at least one project' });
      }

      // Find and delete the link
      let found = false;
      for (const link of initiativeProjects) {
        if (link.project_id === parseInt(projectId)) {
          await remove('initiative_projects', link.id);
          found = true;
          break;
        }
      }

      if (!found) {
        return res.status(404).json({ error: 'project not linked to this initiative' });
      }

      // Log the action
      await logAction(req.user.id, req.user.username, 'remove_initiative_project', parseInt(id), {
        project_id: parseInt(projectId)
      });

      // Publish event
      await publishEvent('initiatives', {
        type: 'initiative.project_removed',
        initiative_id: parseInt(id),
        project_id: parseInt(projectId),
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'failed to remove project' });
    }
  });

  // POST /initiatives/:id/todos - Add a todo to an initiative
  app.post('/initiatives/:id/todos', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { todo_id } = req.body;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      const todo = await getById('todos', todo_id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      // Get initiative's projects
      const allInitiativeProjects = await getAll('initiative_projects');
      const initiativeProjectIds = Array.isArray(allInitiativeProjects)
        ? allInitiativeProjects
            .filter(l => l.initiative_id === parseInt(id))
            .map(l => l.project_id)
        : [];

      // Verify todo's project is one of the initiative's projects
      if (!initiativeProjectIds.includes(todo.project_id)) {
        return res.status(400).json({
          error: "todo's project is not in this initiative's projects"
        });
      }

      // Check if todo is already in any initiative
      const allInitiativeTodos = await getAll('initiative_todos');
      if (Array.isArray(allInitiativeTodos)) {
        const alreadyLinked = allInitiativeTodos.some(
          l => l.todo_id === parseInt(todo_id)
        );
        if (alreadyLinked) {
          return res.status(400).json({ error: 'todo already belongs to an initiative' });
        }
      }

      await insert('initiative_todos', {
        initiative_id: parseInt(id),
        todo_id: parseInt(todo_id)
      });

      // Log the action
      await logAction(req.user.id, req.user.username, 'add_initiative_todo', parseInt(id), {
        todo_id: parseInt(todo_id)
      });

      // Recalculate progress and potentially auto-complete
      await recalculateInitiativeForTodo(parseInt(todo_id));

      const response = await enrichInitiative(initiative);
      res.status(201).json(response);
    } catch (error) {
      console.error('Add todo error:', error);
      res.status(500).json({ error: 'failed to add todo' });
    }
  });

  // DELETE /initiatives/:id/todos/:todoId - Remove a todo from an initiative
  app.delete('/initiatives/:id/todos/:todoId', requireAuth, async (req, res) => {
    const { id, todoId } = req.params;

    try {
      const initiative = await getById('initiatives', id);
      if (!initiative) {
        return res.status(404).json({ error: 'initiative not found' });
      }

      const allInitiativeTodos = await getAll('initiative_todos');
      let found = false;
      if (Array.isArray(allInitiativeTodos)) {
        for (const link of allInitiativeTodos) {
          if (link.initiative_id === parseInt(id) && link.todo_id === parseInt(todoId)) {
            await remove('initiative_todos', link.id);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        return res.status(404).json({ error: 'todo not linked to this initiative' });
      }

      // Log the action
      await logAction(req.user.id, req.user.username, 'remove_initiative_todo', parseInt(id), {
        todo_id: parseInt(todoId)
      });

      // Publish event
      await publishEvent('initiatives', {
        type: 'initiative.todo_removed',
        initiative_id: parseInt(id),
        todo_id: parseInt(todoId),
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'failed to remove todo' });
    }
  });
}

// Helper function to enrich an initiative with projects and counts
async function enrichInitiative(initiative) {
  const projects = await getInitiativeProjects(initiative.id);
  const progress = await calculateProgress(initiative.id);

  return {
    ...initiative,
    projects,
    todo_count: progress.total,
    done_count: progress.done,
    percent: progress.percent
  };
}

// Helper function to get projects for an initiative
async function getInitiativeProjects(initiativeId) {
  try {
    const allProjects = await getAll('projects');
    const allLinks = await getAll('initiative_projects');

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
    return [];
  }
}

// Helper function to calculate progress for an initiative
async function calculateProgress(initiativeId) {
  try {
    const allInitiativeTodos = await getAll('initiative_todos');
    const allTodos = await getAll('todos');

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
        status: 'active'
      };
    }

    const initiativeTodos = Array.isArray(allTodos)
      ? allTodos.filter(t => todoIds.includes(t.id) && !t.archived)
      : [];

    const total = initiativeTodos.length;
    const done = initiativeTodos.filter(t => t.status === 'done').length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    // Determine status based on progress
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
    return {
      total: 0,
      done: 0,
      percent: 0,
      status: 'active'
    };
  }
}

// Main function to recalculate initiative status when a todo changes
async function recalculateInitiativeForTodo(todoId) {
  try {
    // Find the initiative this todo belongs to
    const allInitiativeTodos = await getAll('initiative_todos');
    if (!Array.isArray(allInitiativeTodos)) {
      return;
    }

    const initiativeTodoLink = allInitiativeTodos.find(l => l.todo_id === parseInt(todoId));
    if (!initiativeTodoLink) {
      return;
    }

    const initiativeId = initiativeTodoLink.initiative_id;
    const initiative = await getById('initiatives', initiativeId);
    if (!initiative) {
      return;
    }

    // Calculate new progress
    const progress = await calculateProgress(initiativeId);

    // Determine new status
    let newStatus = 'active';
    let completedAt = null;
    if (progress.total > 0 && progress.done === progress.total) {
      newStatus = 'completed';
      completedAt = new Date().toISOString();
    }

    // Update initiative if status changed
    if (initiative.status !== newStatus) {
      initiative.status = newStatus;
      initiative.completed_at = completedAt;
      initiative.updated_at = new Date().toISOString();
      await update('initiatives', initiativeId, initiative);

      // Publish completion event if just completed
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
  }
}

module.exports = {
  registerInitiativeRoutes,
  recalculateInitiativeForTodo
};
