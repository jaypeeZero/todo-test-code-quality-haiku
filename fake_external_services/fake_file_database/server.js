const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const port = process.env.FAKE_FILE_DB_PORT || 4003;
const dataDir = process.env.FAKE_FILE_DB_DIR || path.join(__dirname, 'data');

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Ensure table directory exists
function ensureTableDir(table) {
  const tableDir = path.join(dataDir, table);
  if (!fs.existsSync(tableDir)) {
    fs.mkdirSync(tableDir, { recursive: true });
  }
}

// Get the next ID for a table by finding the highest existing ID
function getNextId(table) {
  const tableDir = path.join(dataDir, table);
  if (!fs.existsSync(tableDir)) {
    return 1;
  }

  const files = fs.readdirSync(tableDir);
  if (files.length === 0) {
    return 1;
  }

  const ids = files
    .map(f => parseInt(f.replace('.txt', ''), 10))
    .filter(id => !isNaN(id))
    .sort((a, b) => a - b);

  return ids.length > 0 ? ids[ids.length - 1] + 1 : 1;
}

// Get a record by ID
function getRecord(table, id) {
  const recordPath = path.join(dataDir, table, `${id}.txt`);
  if (!fs.existsSync(recordPath)) {
    return null;
  }

  const content = fs.readFileSync(recordPath, 'utf8');
  return JSON.parse(content);
}

// Get all records in a table
function getAllRecords(table) {
  const tableDir = path.join(dataDir, table);
  if (!fs.existsSync(tableDir)) {
    return [];
  }

  const files = fs.readdirSync(tableDir);
  return files
    .map(f => {
      const recordPath = path.join(tableDir, f);
      const content = fs.readFileSync(recordPath, 'utf8');
      return JSON.parse(content);
    })
    .sort((a, b) => a.id - b.id);
}

// Save a record to disk
function saveRecord(table, record) {
  ensureTableDir(table);
  const recordPath = path.join(dataDir, table, `${record.id}.txt`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
}

// Delete a record from disk
function deleteRecord(table, id) {
  const recordPath = path.join(dataDir, table, `${id}.txt`);
  if (fs.existsSync(recordPath)) {
    fs.unlinkSync(recordPath);
  }
}

function start() {
  ensureDataDir();

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', storage: 'file' });
  });

  // GET /tables/:table - list records with optional filters
  app.get('/tables/:table', (req, res) => {
    const { table } = req.params;
    let records = getAllRecords(table);

    // Apply filters from query string
    const filters = req.query;
    Object.keys(filters).forEach(key => {
      records = records.filter(record => {
        return String(record[key]) === String(filters[key]);
      });
    });

    res.json(records);
  });

  // GET /tables/:table/:id - get single record
  app.get('/tables/:table/:id', (req, res) => {
    const { table, id } = req.params;
    const record = getRecord(table, id);

    if (!record) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(record);
  });

  // POST /tables/:table - create new record
  app.post('/tables/:table', (req, res) => {
    const { table } = req.params;
    ensureTableDir(table);

    const id = getNextId(table);
    const record = { id, ...req.body };

    saveRecord(table, record);
    res.status(201).json(record);
  });

  // PUT /tables/:table/:id - update record
  app.put('/tables/:table/:id', (req, res) => {
    const { table, id } = req.params;
    const existing = getRecord(table, parseInt(id, 10));

    if (!existing) {
      return res.status(404).json({ error: 'Not found' });
    }

    const record = { id: parseInt(id, 10), ...req.body };
    saveRecord(table, record);
    res.json(record);
  });

  // DELETE /tables/:table/:id - delete record
  app.delete('/tables/:table/:id', (req, res) => {
    const { table, id } = req.params;
    const existing = getRecord(table, parseInt(id, 10));

    if (!existing) {
      return res.status(404).json({ error: 'Not found' });
    }

    deleteRecord(table, parseInt(id, 10));
    res.status(204).send();
  });

  const server = app.listen(port, () => {
    console.log(`Fake file database server running on port ${port}`);
  });

  return server;
}

module.exports = { start };

if (require.main === module) {
  start();
}
