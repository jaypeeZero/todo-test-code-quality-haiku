const express = require('express');

function start() {
  const app = express();
  const port = process.env.FAKE_DB_PORT || 4001;

  // In-memory storage: { table_name: [records] }
  const storage = {};
  // Track next ID per table: { table_name: nextId }
  const nextIds = {};

  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/tables/:table', (req, res) => {
    const table = req.params.table;
    let records = storage[table] || [];

    const filters = req.query;
    Object.keys(filters).forEach(key => {
      records = records.filter(record => {
        return String(record[key]) === String(filters[key]);
      });
    });

    res.json(records);
  });

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
