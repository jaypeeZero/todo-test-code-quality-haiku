
const { getAll, getById, insert, update, remove } = require('./db');
const { logAction } = require('./logging');
const { publishEvent } = require('./notifications');

const PROJECTS_TABLE = 'projects';

function registerProjectRoutes(app, requireAuth) {
  app.post('/projects', requireAuth, async (req, res) => {
    const { name, description } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({ error: 'name too long (max 100)' });
    }

    let trimmedDescription = description;
    if (description !== undefined && description !== null) {
      trimmedDescription = String(description).trim();
      if (trimmedDescription.length > 1000) {
        return res.status(400).json({ error: 'description too long (max 1000)' });
      }
    }

    try {
      const allProjects = await getAll(PROJECTS_TABLE);
      if (Array.isArray(allProjects)) {
        const exists = allProjects.some(p => p.name.toLowerCase() === trimmedName.toLowerCase());
        if (exists) {
          return res.status(400).json({ error: 'project name must be unique' });
        }
      }

      const now = new Date().toISOString();
      const projectRecord = {
        name: trimmedName,
        description: trimmedDescription || null,
        created_by: req.user.id,
        created_at: now,
        updated_at: now
      };

      const project = await insert(PROJECTS_TABLE, projectRecord);

      await logAction(req.user.id, req.user.username, 'create_project', project.id, {
        name: trimmedName,
        description: trimmedDescription || null
      });

      await publishEvent(PROJECTS_TABLE, {
        type: 'project.created',
        project,
        by: req.user.username
      });

      res.status(201).json(project);
    } catch (error) {
      console.error('Create project error:', error);
      res.status(500).json({ error: 'failed to create project' });
    }
  });

  app.get('/projects', requireAuth, async (req, res) => {
    try {
      const projects = await getAll('projects');
      const result = Array.isArray(projects) ? projects : [];
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'failed to list projects' });
    }
  });

  app.get('/projects/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const project = await getById(PROJECTS_TABLE, id);
      if (!project) {
        return res.status(404).json({ error: 'project not found' });
      }

      const allTodos = await getAll('todos');
      const todos = Array.isArray(allTodos)
        ? allTodos.filter(t => t.project_id === parseInt(id) && !t.archived)
        : [];

      const response = {
        ...project,
        todo_count: todos.length,
        todos
      };

      res.json(response);
    } catch (error) {
      res.status(404).json({ error: 'project not found' });
    }
  });

  app.get('/projects/:id/todos', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const project = await getById(PROJECTS_TABLE, id);
      if (!project) {
        return res.status(404).json({ error: 'project not found' });
      }

      const allTodos = await getAll('todos');
      const todos = Array.isArray(allTodos)
        ? allTodos.filter(t => t.project_id === parseInt(id) && !t.archived)
        : [];

      res.json(todos);
    } catch (error) {
      res.status(404).json({ error: 'project not found' });
    }
  });

  app.put('/projects/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;

    try {
      const project = await getById(PROJECTS_TABLE, id);
      if (!project) {
        return res.status(404).json({ error: 'project not found' });
      }

      if (name !== undefined) {
        if (!name || typeof name !== 'string' || !name.trim()) {
          return res.status(400).json({ error: 'name is required' });
        }
        const trimmedName = name.trim();
        if (trimmedName.length > 100) {
          return res.status(400).json({ error: 'name too long (max 100)' });
        }
      }

      if (description !== undefined && description !== null) {
        const trimmedDesc = String(description).trim();
        if (trimmedDesc.length > 1000) {
          return res.status(400).json({ error: 'description too long (max 1000)' });
        }
      }

      const changes = {};

      if (name !== undefined && name !== project.name) {
        const trimmedName = name.trim();
        const allProjects = await getAll(PROJECTS_TABLE);
        if (Array.isArray(allProjects)) {
          const exists = allProjects.some(p => p.id !== parseInt(id) && p.name.toLowerCase() === trimmedName.toLowerCase());
          if (exists) {
            return res.status(400).json({ error: 'project name must be unique' });
          }
        }
        changes.name = { from: project.name, to: trimmedName };
        project.name = trimmedName;
      }

      if (description !== undefined && description !== project.description) {
        const trimmedDesc = description !== null ? String(description).trim() : '';
        changes.description = { from: project.description, to: trimmedDesc || null };
        project.description = trimmedDesc || null;
      }

      project.updated_at = new Date().toISOString();

      await update(PROJECTS_TABLE, id, project);

      await logAction(req.user.id, req.user.username, 'update_project', parseInt(id), changes);

      await publishEvent(PROJECTS_TABLE, {
        type: 'project.updated',
        project,
        by: req.user.username
      });

      res.json(project);
    } catch (error) {
      res.status(404).json({ error: 'project not found' });
    }
  });

  // DELETE /projects/:id - Delete a project (sets todos project_id to null)
  app.delete('/projects/:id', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const project = await getById(PROJECTS_TABLE, id);
      if (!project) {
        return res.status(404).json({ error: 'project not found' });
      }

      try {
        const allTodos = await getAll('todos');
        if (Array.isArray(allTodos)) {
          for (const todo of allTodos) {
            if (todo.project_id === parseInt(id)) {
              todo.project_id = null;
              await update('todos', todo.id, todo);
            }
          }
        }
      } catch (error) {
        console.error('Error updating todos after project deletion:', error);
      }

      await remove(PROJECTS_TABLE, id);

      await logAction(req.user.id, req.user.username, 'delete_project', parseInt(id), {});

      await publishEvent(PROJECTS_TABLE, {
        type: 'project.deleted',
        project,
        by: req.user.username
      });

      res.status(204).send();
    } catch (error) {
      res.status(404).json({ error: 'project not found' });
    }
  });
}

module.exports = {
  registerProjectRoutes
};
