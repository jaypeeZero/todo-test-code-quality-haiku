const express = require('express');
const { start: startFakeDatabase } = require('../fake_external_services/fake_database/server');
const { start: startFakeNotifications } = require('../fake_external_services/fake_notifications/server');

const app = express();
const port = process.env.PORT || 3000;
const databaseURL = process.env.DATABASE_URL || 'http://localhost:4001';

// Middleware
app.use(express.json());

// Start fake services
console.log('Starting fake services...');
startFakeDatabase();
startFakeNotifications();

// Give services a moment to start
setTimeout(() => {
  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const dbResponse = await fetch(`${databaseURL}/health`);
      const dbStatus = await dbResponse.json();

      res.json({
        status: 'ok',
        database: dbStatus.status
      });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        database: 'unavailable'
      });
    }
  });

  // Start main application
  app.listen(port, () => {
    console.log(`Todo app running on port ${port}`);
  });
}, 500);
