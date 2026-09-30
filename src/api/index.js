const express = require('express');
const { start: startFakeDatabase } = require('../../fake_external_services/fake_database/server');
const { start: startFakeFileDatabase } = require('../../fake_external_services/fake_file_database/server');
const { start: startFakeNotifications } = require('../../fake_external_services/fake_notifications/server');
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

const DEFAULT_NOTIFICATIONS_URL = 'http://localhost:4002';
const API_KEY_HEADER = 'x-api-key';
const PROJECTS_TABLE = 'projects';
const CURRENT_PROJECT_ENDPOINT = '/me/current-project';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('/Users/wrigjame/code/todo_test/src/ui'));

console.log(`Notifications ${NOTIFICATIONS_ENABLED ? 'enabled' : 'disabled'}, environment: ${APP_ENV}`);

console.log('Starting fake services...');
startFakeDatabase();
startFakeFileDatabase();
startFakeNotifications();

function registerRoutes(app, port, baseURL, getDatabaseName, NOTIFICATIONS_ENABLED, APP_ENV, getNotifyApiKey, login, logout, requireAuth, getCurrentProject, setCurrentProject, registerProjectRoutes, registerBulkRoutes, registerTodoRoutes, registerLinkRoutes, registerBlockerRoutes, registerCommentRoutes, registerAssigneeRoutes, registerInitiativeRoutes, registerV2Routes) {
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

  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const result = login(username, password);
    if (!result) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    res.json(result);
  });

  app.post('/logout', requireAuth, (req, res) => {
    const authHeader = req.get('Authorization');
    const token = authHeader.match(/^Bearer (.+)$/)[1];
    logout(token);
    res.status(204).send();
  });

  app.get('/me', requireAuth, (req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      current_project_id: getCurrentProject(req.user.id)
    });
  });

  app.get('/users', requireAuth, (req, res) => {
    res.json(getAllUsers());
  });

  // Get sent notifications (proxy to provider)
  app.get('/notifications/sent', requireAuth, async (req, res) => {
    try {
      const notificationsUrl = process.env.NOTIFICATIONS_URL || DEFAULT_NOTIFICATIONS_URL;
      const apiKey = getNotifyApiKey();

      const response = await fetch(`${notificationsUrl}/sent`, {
        method: 'GET',
        headers: {
          [API_KEY_HEADER]: apiKey
        }
      });

      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch notifications' });
    }
  });

  app.get('/notifications/status', requireAuth, async (req, res) => {
    try {
      const notificationsUrl = process.env.NOTIFICATIONS_URL || DEFAULT_NOTIFICATIONS_URL;
      const apiKey = getNotifyApiKey();
      let providerReachable = false;

      try {
        const healthResponse = await fetch(`${notificationsUrl}/health`, {
          method: 'GET',
          headers: {
            [API_KEY_HEADER]: apiKey
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

  registerProjectRoutes(app, requireAuth);

  app.put(CURRENT_PROJECT_ENDPOINT, requireAuth, async (req, res) => {
    const { project_id } = req.body;

    try {
      if (project_id !== null && project_id !== undefined) {
        const { getById } = require('./db');
        const project = await getById(PROJECTS_TABLE, project_id);
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

  app.get(CURRENT_PROJECT_ENDPOINT, requireAuth, async (req, res) => {
    try {
      const projectId = getCurrentProject(req.user.id);
      if (projectId === null || projectId === undefined) {
        return res.json({ project: null });
      }

      const { getById } = require('./db');
      const project = await getById(PROJECTS_TABLE, projectId);
      res.json({ project: project || null });
    } catch (error) {
      console.error('Error fetching current project:', error);
      res.status(500).json({ error: 'failed to fetch current project' });
    }
  });

  // Register bulk routes (before todo routes so specific paths match first)
  registerBulkRoutes(app, requireAuth);

  registerTodoRoutes(app, requireAuth);

  registerLinkRoutes(app, requireAuth);

  registerBlockerRoutes(app, requireAuth);

  registerCommentRoutes(app, requireAuth);

  registerAssigneeRoutes(app, requireAuth);

  registerInitiativeRoutes(app, requireAuth);

  registerV2Routes(app, requireAuth);

  app.listen(port, () => {
    console.log(`Todo app running on port ${port}`);
  });
}

// Give services a moment to start
setTimeout(() => registerRoutes(app, port, baseURL, getDatabaseName, NOTIFICATIONS_ENABLED, APP_ENV, getNotifyApiKey, login, logout, requireAuth, getCurrentProject, setCurrentProject, registerProjectRoutes, registerBulkRoutes, registerTodoRoutes, registerLinkRoutes, registerBlockerRoutes, registerCommentRoutes, registerAssigneeRoutes, registerInitiativeRoutes, registerV2Routes), 500);
