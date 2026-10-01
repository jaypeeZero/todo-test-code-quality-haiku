const express = require('express');
const { start: startFakeDatabase } = require('../../fake_external_services/fake_database/server');
const { start: startFakeFileDatabase } = require('../../fake_external_services/fake_file_database/server');
const { NotificationServer } = require('../../fake_external_services/fake_notifications/server');
const { Auth, parseUsers } = require('./auth');
const { registerTodoRoutes } = require('./todos');
const { registerLinkRoutes } = require('./links');
const { registerBlockerRoutes } = require('./blockers');
const { registerCommentRoutes } = require('./comments');
const { registerAssigneeRoutes } = require('./assignees');
const { registerProjectRoutes } = require('./projects');
const { registerBulkRoutes } = require('./bulk');
const { registerInitiativeRoutes } = require('./initiatives');
const { registerV2Routes } = require('./v2');
const { Db } = require('./db');
const { NOTIFICATIONS_ENABLED, APP_ENV, getNotifyApiKey } = require('./notifications');

const DEFAULT_NOTIFICATIONS_URL = 'http://localhost:4002';
const API_KEY_HEADER = 'x-api-key';
const PROJECTS_TABLE = 'projects';
const CURRENT_PROJECT_ENDPOINT = '/me/current-project';

const app = express();
const port = process.env.PORT || 3000;

const db = new Db();
const auth = new Auth(parseUsers(process.env.APP_USERS || 'alice:password1,bob:password2,carol:password3'));
const requireAuth = (req, res, next) => auth.requireAuth(req, res, next);

app.use(express.json());
app.use(express.static('/Users/wrigjame/code/todo_test/src/ui'));

console.log(`Notifications ${NOTIFICATIONS_ENABLED ? 'enabled' : 'disabled'}, environment: ${APP_ENV}`);

console.log('Starting fake services...');
startFakeDatabase();
startFakeFileDatabase();
new NotificationServer(process.env.FAKE_NOTIFY_PORT || 4002, process.env.FAKE_NOTIFY_API_KEY || 'test-key-123').start();

function registerRoutes(app, port, db, auth, requireAuth, NOTIFICATIONS_ENABLED, APP_ENV, getNotifyApiKey, registerProjectRoutes, registerBulkRoutes, registerTodoRoutes, registerLinkRoutes, registerBlockerRoutes, registerCommentRoutes, registerAssigneeRoutes, registerInitiativeRoutes, registerV2Routes) {
  app.get('/health', async (req, res) => {
    try {
      const dbResponse = await fetch(`${db.getBaseURL()}/health`);
      const dbStatus = await dbResponse.json();

      res.json({
        status: 'ok',
        database: dbStatus.status,
        databaseKind: db.getDatabaseName(),
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
        databaseKind: db.getDatabaseName(),
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
    const result = auth.login(username, password);
    if (!result) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    res.json(result);
  });

  app.post('/logout', requireAuth, (req, res) => {
    const authHeader = req.get('Authorization');
    const token = authHeader.match(/^Bearer (.+)$/)[1];
    auth.logout(token);
    res.status(204).send();
  });

  app.get('/me', requireAuth, (req, res) => {
    res.json({
      id: req.user.id,
      username: req.user.username,
      current_project_id: auth.getCurrentProject(req.user.id)
    });
  });

  app.get('/users', requireAuth, (req, res) => {
    res.json(auth.getAllUsers());
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

  registerProjectRoutes(app, requireAuth, db);

  app.put(CURRENT_PROJECT_ENDPOINT, requireAuth, async (req, res) => {
    const { project_id } = req.body;

    try {
      if (project_id !== null && project_id !== undefined) {
        const project = await db.getById(PROJECTS_TABLE, project_id);
        if (!project) {
          return res.status(404).json({ error: 'project not found' });
        }
      }

      auth.setCurrentProject(req.user.id, project_id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting current project:', error);
      res.status(500).json({ error: 'failed to set current project' });
    }
  });

  app.get(CURRENT_PROJECT_ENDPOINT, requireAuth, async (req, res) => {
    try {
      const projectId = auth.getCurrentProject(req.user.id);
      if (projectId === null || projectId === undefined) {
        return res.json({ project: null });
      }

      const project = await db.getById(PROJECTS_TABLE, projectId);
      res.json({ project: project || null });
    } catch (error) {
      console.error('Error fetching current project:', error);
      res.status(500).json({ error: 'failed to fetch current project' });
    }
  });

  // Register bulk routes (before todo routes so specific paths match first)
  registerBulkRoutes(app, requireAuth, db);

  registerTodoRoutes(app, requireAuth, db, auth);

  registerLinkRoutes(app, requireAuth, db);

  registerBlockerRoutes(app, requireAuth, db);

  registerCommentRoutes(app, requireAuth, db, auth);

  registerAssigneeRoutes(app, requireAuth, db, auth);

  registerInitiativeRoutes(app, requireAuth, db);

  registerV2Routes(app, requireAuth, db, auth);

  app.listen(port, () => {
    console.log(`Todo app running on port ${port}`);
  });
}

// Give services a moment to start
setTimeout(() => registerRoutes(app, port, db, auth, requireAuth, NOTIFICATIONS_ENABLED, APP_ENV, getNotifyApiKey, registerProjectRoutes, registerBulkRoutes, registerTodoRoutes, registerLinkRoutes, registerBlockerRoutes, registerCommentRoutes, registerAssigneeRoutes, registerInitiativeRoutes, registerV2Routes), 500);
