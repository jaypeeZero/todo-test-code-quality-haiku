// Database module for communicating with the fake database service over HTTP

function createDbModule() {
  let baseURL;
  let databaseName;

  if (process.env.DATABASE_URL) {
    baseURL = process.env.DATABASE_URL;
    databaseName = 'custom';
  } else {
    const databaseKind = process.env.DATABASE_KIND || 'memory';
    if (databaseKind === 'file') {
      baseURL = 'http://localhost:4003';
      databaseName = 'file';
    } else {
      baseURL = 'http://localhost:4001';
      databaseName = 'memory';
    }
  }

  async function makeRequest(method, path, body = null) {
    const url = `${baseURL}${path}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  async function getAll(table, filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      params.append(key, value);
    });
    const query = params.toString() ? `?${params.toString()}` : '';
    return makeRequest('GET', `/tables/${table}${query}`);
  }

  async function getById(table, id) {
    return makeRequest('GET', `/tables/${table}/${id}`);
  }

  async function insert(table, record) {
    return makeRequest('POST', `/tables/${table}`, record);
  }

  async function update(table, id, record) {
    return makeRequest('PUT', `/tables/${table}/${id}`, record);
  }

  async function remove(table, id) {
    return makeRequest('DELETE', `/tables/${table}/${id}`);
  }

  function getDatabaseName() {
    return databaseName;
  }

  return {
    getAll,
    getById,
    insert,
    update,
    remove,
    getDatabaseName,
    baseURL
  };
}

const dbInstance = createDbModule();

module.exports = {
  createDbModule,
  getAll: (table, filters) => dbInstance.getAll(table, filters),
  getById: (table, id) => dbInstance.getById(table, id),
  insert: (table, record) => dbInstance.insert(table, record),
  update: (table, id, record) => dbInstance.update(table, id, record),
  remove: (table, id) => dbInstance.remove(table, id),
  getDatabaseName: () => dbInstance.getDatabaseName(),
  get baseURL() {
    return dbInstance.baseURL;
  }
};
