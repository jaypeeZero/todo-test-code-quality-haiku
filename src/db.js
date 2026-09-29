// Database module for communicating with the fake database service over HTTP

const baseURL = process.env.DATABASE_URL || 'http://localhost:4001';

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
  const params = new URLSearchParams(filters);
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

module.exports = {
  getAll,
  getById,
  insert,
  update,
  remove
};
