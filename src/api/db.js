// Database module for communicating with the fake database service over HTTP

class Db {
  #baseURL;
  #databaseName;

  constructor() {
    if (process.env.DATABASE_URL) {
      this.#baseURL = process.env.DATABASE_URL;
      this.#databaseName = 'custom';
    } else {
      const databaseKind = process.env.DATABASE_KIND || 'memory';
      if (databaseKind === 'file') {
        this.#baseURL = 'http://localhost:4003';
        this.#databaseName = 'file';
      } else {
        this.#baseURL = 'http://localhost:4001';
        this.#databaseName = 'memory';
      }
    }
  }

  async makeRequest(method, path, body = null) {
    const url = `${this.#baseURL}${path}`;
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

  async getAll(table, filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      params.append(key, value);
    });
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.makeRequest('GET', `/tables/${table}${query}`);
  }

  async getById(table, id) {
    return this.makeRequest('GET', `/tables/${table}/${id}`);
  }

  async insert(table, record) {
    return this.makeRequest('POST', `/tables/${table}`, record);
  }

  async update(table, id, record) {
    return this.makeRequest('PUT', `/tables/${table}/${id}`, record);
  }

  async remove(table, id) {
    return this.makeRequest('DELETE', `/tables/${table}/${id}`);
  }

  getDatabaseName() {
    return this.#databaseName;
  }

  getBaseURL() {
    return this.#baseURL;
  }
}

module.exports = { Db };
