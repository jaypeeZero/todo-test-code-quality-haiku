const express = require('express');

const PORT = process.env.FAKE_NOTIFY_PORT || 4002;
const API_KEY = process.env.FAKE_NOTIFY_API_KEY || 'test-key-123';

const notifications = [];
let nextId = 1;

// Topics and events storage
const topics = {}; // { topicName: { events: [...], subscribers: [...] } }
let nextEventId = 1;

const app = express();

app.use(express.json());

// CORS headers for SSE stream endpoints
app.use((req, res, next) => {
  if (req.path.match(/^\/topics\/[^\/]+\/stream$/)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  next();
});

// Middleware for API key validation (except /health and SSE streams)
app.use((req, res, next) => {
  if (req.path === '/health') {
    return next();
  }

  // Allow SSE stream endpoints without auth
  if (req.path.match(/^\/topics\/[^\/]+\/stream$/)) {
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

  // Publish to user topic if 'to' looks like a user id or username
  if (to && (typeof to === 'string' || typeof to === 'number')) {
    const topicName = `user-${to}`;
    publishToTopic(topicName, {
      id: notification.id,
      to,
      subject,
      message,
      timestamp: notification.timestamp
    });
  }
});

// POST /topics/:topic/publish endpoint
app.post('/topics/:topic/publish', (req, res) => {
  const { topic } = req.params;
  const payload = req.body;

  const event = {
    id: nextEventId++,
    topic,
    timestamp: new Date().toISOString(),
    payload
  };

  // Store event in topic
  if (!topics[topic]) {
    topics[topic] = { events: [], subscribers: [] };
  }
  topics[topic].events.push(event);

  // Send to all subscribers
  const delivered = publishToTopic(topic, event);

  res.status(202).json({
    id: event.id,
    delivered
  });
});

// GET /topics/:topic/events endpoint
app.get('/topics/:topic/events', (req, res) => {
  const { topic } = req.params;
  const topicData = topics[topic];

  if (!topicData) {
    return res.json([]);
  }

  res.json(topicData.events);
});

// GET /topics/:topic/stream endpoint (SSE)
app.get('/topics/:topic/stream', (req, res) => {
  const { topic } = req.params;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Initialize topic if it doesn't exist
  if (!topics[topic]) {
    topics[topic] = { events: [], subscribers: [] };
  }

  // Add this connection to subscribers
  const subscriber = res;
  topics[topic].subscribers.push(subscriber);

  // Send initial connected message
  res.write('event: connected\n');
  res.write(`data: {"topic":"${topic}"}\n\n`);

  // Send ping every 15 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    const index = topics[topic].subscribers.indexOf(subscriber);
    if (index > -1) {
      topics[topic].subscribers.splice(index, 1);
    }
  });
});

// GET /topics endpoint
app.get('/topics', (req, res) => {
  const topicsList = Object.keys(topics).map(name => ({
    name,
    subscribers: topics[name].subscribers.length,
    events: topics[name].events.length
  }));

  res.json(topicsList);
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

// Helper function to publish an event to a topic and send to all subscribers
function publishToTopic(topicName, event) {
  if (!topics[topicName]) {
    topics[topicName] = { events: [], subscribers: [] };
  }

  // Send to all subscribers
  let delivered = 0;
  topics[topicName].subscribers.forEach(subscriber => {
    try {
      subscriber.write(`event: message\n`);
      subscriber.write(`data: ${JSON.stringify(event)}\n\n`);
      delivered++;
    } catch (e) {
      // Subscriber connection may be closed
    }
  });

  return delivered;
}

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
