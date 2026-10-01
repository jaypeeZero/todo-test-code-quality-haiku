
const crypto = require('crypto');

function parseUsers(userString) {
  const users = [];
  const pairs = userString.split(',');
  pairs.forEach((pair, index) => {
    const [username, password] = pair.split(':');
    users.push({
      id: String(index + 1),
      username: username.trim(),
      password: password.trim()
    });
  });
  return users;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

class Auth {
  #tokenMap;
  #currentProjects;
  #users;

  constructor(users) {
    this.#tokenMap = new Map();
    this.#currentProjects = new Map();
    this.#users = users;
  }

  login(username, password) {
    const user = this.#users.find(u => u.username === username && u.password === password);
    if (!user) {
      return null;
    }
    const token = generateToken();
    this.#tokenMap.set(token, { id: user.id, username: user.username });
    return {
      token,
      user: {
        id: user.id,
        username: user.username
      }
    };
  }

  logout(token) {
    this.#tokenMap.delete(token);
  }

  getUserByToken(token) {
    return this.#tokenMap.get(token);
  }

  getAllUsers() {
    return this.#users.map(u => ({
      id: u.id,
      username: u.username
    }));
  }

  requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'missing token' });
    }
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({ error: 'invalid token format' });
    }
    const token = match[1];
    const user = this.getUserByToken(token);
    if (!user) {
      return res.status(401).json({ error: 'unknown token' });
    }
    req.user = { ...user, token };
    next();
  }

  getCurrentProject(userId) {
    return this.#currentProjects.get(userId) || null;
  }

  setCurrentProject(userId, projectId) {
    if (projectId === null || projectId === undefined) {
      this.#currentProjects.delete(userId);
    } else {
      this.#currentProjects.set(userId, projectId);
    }
  }
}

module.exports = { Auth, parseUsers };
