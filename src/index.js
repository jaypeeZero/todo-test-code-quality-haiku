const express = require('express');
const { start: startFakeDatabase } = require('../fake_external_services/fake_database/server');
const { start: startFakeFileDatabase } = require('../fake_external_services/fake_file_database/server');
const { start: startFakeNotifications } = require('../fake_external_services/fake_notifications/server');
const { login, logout, getUserByToken, getAllUsers, requireAuth } = require('./auth');
const { registerTodoRoutes } = require('./todos');
const { registerLinkRoutes } = require('./links');
const { registerBlockerRoutes } = require('./blockers');
const { registerCommentRoutes } = require('./comments');
const { registerAssigneeRoutes } = require('./assignees');
const { registerProjectRoutes } = require('./projects');
const { registerBulkRoutes } = require('./bulk');
const { registerInitiativeRoutes } = require('./initiatives');
const { registerV2Routes } = require('./v2');
const { getDatabaseName, baseURL } = require('./db');
const { getCurrentProject, setCurrentProject } = require('./auth');
const { NOTIFICATIONS_ENABLED, APP_ENV, getNotifyApiKey } = require('./notifications');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('/Users/wrigjame/code/todo_test/src/ui'));

// Log notification settings at startup
console.log(`Notifications ${NOTIFICATIONS_ENABLED ? 'enabled' : 'disabled'}, environment: ${APP_ENV}`);

// Start fake services
console.log('Starting fake services...');
startFakeDatabase();
startFakeFileDatabase();
startFakeNotifications();

// Give services a moment to start
setTimeout(() => {
  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const dbResponse = await fetch(`${baseURL}/health`);
      const dbStatus = await dbResponse.json();

      res.json({
        status: 'ok',
        database: dbStatus.status,
        databaseKind: getDatabaseName(),
        notifications: {
          enabled: NOTIFICATIONS_ENABLED,
          env: APP_ENV,
          key_configured: !!getNotifyApiKey()
        }
      });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        database: 'unavailable',
        databaseKind: getDatabaseName(),
        notifications: {
          enabled: NOTIFICATIONS_ENABLED,
          env: APP_ENV,
          key_configured: !!getNotifyApiKey()
        }
      });
    }
  });

  // Login endpoint
  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const result = login(username, password);
    if (!result) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    res.json(result);
  });

  // Logout endpoint
  app.post('/logout', requireAuth, (req, res) => {
    const authHeader = req.get('Authorization');
    const token = authHeader.match(/^Bearer (.+)$/)[1];
    logout(token);
    res.status(204).send();
  });

  // Get current user
  app.get('/me', requireAuth, (req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      current_project_id: getCurrentProject(req.user.id)
    });
  });

  // Get all users
  app.get('/users', requireAuth, (req, res) => {
    res.json(getAllUsers());
  });

  // Get sent notifications (proxy to provider)
  app.get('/notifications/sent', requireAuth, async (req, res) => {
    try {
      const notificationsUrl = process.env.NOTIFICATIONS_URL || 'http://localhost:4002';
      const apiKey = getNotifyApiKey();

      const response = await fetch(`${notificationsUrl}/sent`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey
        }
      });

      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch notifications' });
    }
  });

  // Notification status endpoint
  app.get('/notifications/status', requireAuth, async (req, res) => {
    try {
      const notificationsUrl = process.env.NOTIFICATIONS_URL || 'http://localhost:4002';
      const apiKey = getNotifyApiKey();
      let providerReachable = false;

      try {
        const healthResponse = await fetch(`${notificationsUrl}/health`, {
          method: 'GET',
          headers: {
            'x-api-key': apiKey
          }
        });
        providerReachable = healthResponse.ok;
      } catch (error) {
        providerReachable = false;
      }

      res.json({
        enabled: NOTIFICATIONS_ENABLED,
        env: APP_ENV,
        key_configured: !!getNotifyApiKey(),
        provider_reachable: providerReachable
      });
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch notification status' });
    }
  });

  // Register project routes
  registerProjectRoutes(app, requireAuth);

  // PUT /me/current-project - Set current project
  app.put('/me/current-project', requireAuth, async (req, res) => {
    const { project_id } = req.body;

    try {
      // If project_id is provided (not null), verify project exists
      if (project_id !== null && project_id !== undefined) {
        const { getById } = require('./db');
        const project = await getById('projects', project_id);
        if (!project) {
          return res.status(404).json({ error: 'project not found' });
        }
      }

      setCurrentProject(req.user.id, project_id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting current project:', error);
      res.status(500).json({ error: 'failed to set current project' });
    }
  });

  // GET /me/current-project - Get current project
  app.get('/me/current-project', requireAuth, async (req, res) => {
    try {
      const projectId = getCurrentProject(req.user.id);
      if (projectId === null || projectId === undefined) {
        return res.json({ project: null });
      }

      const { getById } = require('./db');
      const project = await getById('projects', projectId);
      res.json({ project: project || null });
    } catch (error) {
      console.error('Error fetching current project:', error);
      res.status(500).json({ error: 'failed to fetch current project' });
    }
  });

  // Register bulk routes (before todo routes so specific paths match first)
  registerBulkRoutes(app, requireAuth);

  // Register todo routes
  registerTodoRoutes(app, requireAuth);

  // Register link routes
  registerLinkRoutes(app, requireAuth);

  // Register blocker routes
  registerBlockerRoutes(app, requireAuth);

  // Register comment routes
  registerCommentRoutes(app, requireAuth);

  // Register assignee routes
  registerAssigneeRoutes(app, requireAuth);

  // Register initiative routes
  registerInitiativeRoutes(app, requireAuth);

  // Register V2 API routes
  registerV2Routes(app, requireAuth);

  // Start main application
  app.listen(port, () => {
    console.log(`Todo app running on port ${port}`);
  });
}, 500);
