const express = require('express');

const PORT = process.env.FAKE_NOTIFY_PORT || 4002;
const API_KEY = process.env.FAKE_NOTIFY_API_KEY || 'test-key-123';

const notifications = [];
let nextId = 1;

const app = express();

app.use(express.json());

// Middleware for API key validation (except /health)
app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

// POST /send endpoint
app.post('/send', (req, res) => {
  // 1 in 10 chance of simulating a failure
  if (Math.random() < 0.1) {
    return res.status(500).json({ error: 'provider temporarily unavailable' });
  }

  const { to, subject, message } = req.body;

  const notification = {
    id: nextId++,
    to,
    subject,
    message,
    timestamp: new Date().toISOString()
  };

  notifications.push(notification);

  console.log('Notification queued:', JSON.stringify(notification));

  res.status(202).json({
    id: notification.id,
    status: 'queued'
  });
});

// GET /sent endpoint
app.get('/sent', (req, res) => {
  res.json(notifications);
});

// DELETE /sent endpoint
app.delete('/sent', (req, res) => {
  notifications.length = 0;
  res.status(204).send();
});

// GET /health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

function start() {
  const server = app.listen(PORT, () => {
    console.log(`Fake notification service listening on port ${PORT}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { start };
