const express = require('express');

class NotificationServer {
  #port;
  #apiKey;
  #notifications;
  #nextId;
  #topics;
  #nextEventId;
  #app;

  constructor(port, apiKey) {
    this.#port = port;
    this.#apiKey = apiKey;
    this.#notifications = [];
    this.#nextId = 1;
    this.#topics = {}; // { topicName: { events: [...], subscribers: [...] } }
    this.#nextEventId = 1;
    this.#app = express();
  }

  start() {
    const app = this.#app;

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
      if (apiKey !== this.#apiKey) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      next();
    });

    app.post('/send', (req, res) => {
      // 1 in 10 chance of simulating a failure
      if (Math.random() < 0.1) {
        return res.status(500).json({ error: 'provider temporarily unavailable' });
      }

      const { to, subject, message } = req.body;

      const notification = {
        id: this.#nextId++,
        to,
        subject,
        message,
        timestamp: new Date().toISOString()
      };

      this.#notifications.push(notification);

      console.log('Notification queued:', JSON.stringify(notification));

      res.status(202).json({
        id: notification.id,
        status: 'queued'
      });

      // Publish to user topic if 'to' looks like a user id or username
      if (to && (typeof to === 'string' || typeof to === 'number')) {
        const topicName = `user-${to}`;
        this.#publishToTopic(topicName, {
          id: notification.id,
          to,
          subject,
          message,
          timestamp: notification.timestamp
        });
      }
    });

    app.post('/topics/:topic/publish', (req, res) => {
      const { topic } = req.params;
      const payload = req.body;

      const event = {
        id: this.#nextEventId++,
        topic,
        timestamp: new Date().toISOString(),
        payload
      };

      if (!this.#topics[topic]) {
        this.#topics[topic] = { events: [], subscribers: [] };
      }
      this.#topics[topic].events.push(event);

      const delivered = this.#publishToTopic(topic, event);

      res.status(202).json({
        id: event.id,
        delivered
      });
    });

    app.get('/topics/:topic/events', (req, res) => {
      const { topic } = req.params;
      const topicData = this.#topics[topic];

      if (!topicData) {
        return res.json([]);
      }

      res.json(topicData.events);
    });

    app.get('/topics/:topic/stream', (req, res) => {
      const { topic } = req.params;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      if (!this.#topics[topic]) {
        this.#topics[topic] = { events: [], subscribers: [] };
      }

      const subscriber = res;
      this.#topics[topic].subscribers.push(subscriber);

      res.write('event: connected\n');
      res.write(`data: {"topic":"${topic}"}\n\n`);

      // Send ping every 15 seconds to keep connection alive
      const pingInterval = setInterval(() => {
        res.write(': ping\n\n');
      }, 15000);

      // Handle client disconnect
      req.on('close', () => {
        clearInterval(pingInterval);
        const index = this.#topics[topic].subscribers.indexOf(subscriber);
        if (index > -1) {
          this.#topics[topic].subscribers.splice(index, 1);
        }
      });
    });

    app.get('/topics', (req, res) => {
      const topicsList = Object.keys(this.#topics).map(name => ({
        name,
        subscribers: this.#topics[name].subscribers.length,
        events: this.#topics[name].events.length
      }));

      res.json(topicsList);
    });

    app.get('/sent', (req, res) => {
      res.json(this.#notifications);
    });

    // DELETE /sent endpoint
    app.delete('/sent', (req, res) => {
      this.#notifications.length = 0;
      res.status(204).send();
    });

    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    return app.listen(this.#port, () => {
      console.log(`Fake notification service listening on port ${this.#port}`);
    });
  }

  #publishToTopic(topicName, event) {
    if (!this.#topics[topicName]) {
      this.#topics[topicName] = { events: [], subscribers: [] };
    }

    let delivered = 0;
    this.#topics[topicName].subscribers.forEach(subscriber => {
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
}

if (require.main === module) {
  const port = process.env.FAKE_NOTIFY_PORT || 4002;
  const apiKey = process.env.FAKE_NOTIFY_API_KEY || 'test-key-123';
  new NotificationServer(port, apiKey).start();
}

module.exports = { NotificationServer };
