const express = require('express');

// In-memory storage: { table_name: [records] }
const storage = {};
// Track next ID per table: { table_name: nextId }
const nextIds = {};

function start() {
  const app = express();
  const port = process.env.FAKE_DB_PORT || 4001;

  app.use(express.json());

  // Middleware to log requests
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // GET /health
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // GET /tables/:table - returns all records with optional filtering
  app.get('/tables/:table', (req, res) => {
    const table = req.params.table;
    let records = storage[table] || [];

    // Apply query filters
    const filters = req.query;
    Object.keys(filters).forEach(key => {
      records = records.filter(record => {
        return String(record[key]) === String(filters[key]);
      });
    });

    res.json(records);
  });

  // GET /tables/:table/:id - returns one record or 404
  app.get('/tables/:table/:id', (req, res) => {
    const table = req.params.table;
    const id = parseInt(req.params.id, 10);
    const records = storage[table] || [];
    const record = records.find(r => r.id === id);

    if (!record) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(record);
  });

  // POST /tables/:table - inserts a new record
  app.post('/tables/:table', (req, res) => {
    const table = req.params.table;
    if (!storage[table]) {
      storage[table] = [];
      nextIds[table] = 1;
    }

    const id = nextIds[table]++;
    const record = { id, ...req.body };
    storage[table].push(record);

    res.status(201).json(record);
  });

  // PUT /tables/:table/:id - updates a record
  app.put('/tables/:table/:id', (req, res) => {
    const table = req.params.table;
    const id = parseInt(req.params.id, 10);
    const records = storage[table] || [];
    const recordIndex = records.findIndex(r => r.id === id);

    if (recordIndex === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Merge the updated fields while keeping the id
    records[recordIndex] = { id, ...req.body };
    res.json(records[recordIndex]);
  });

  // DELETE /tables/:table/:id - deletes a record
  app.delete('/tables/:table/:id', (req, res) => {
    const table = req.params.table;
    const id = parseInt(req.params.id, 10);
    const records = storage[table] || [];
    const recordIndex = records.findIndex(r => r.id === id);

    if (recordIndex === -1) {
      return res.status(404).json({ error: 'Not found' });
    }

    records.splice(recordIndex, 1);
    res.status(204).send();
  });

  const server = app.listen(port, () => {
    console.log(`Fake database server running on port ${port}`);
  });

  return server;
}

module.exports = { start };

// Auto-start if run directly
if (require.main === module) {
  start();
}
