
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

function createAuth() {
  const tokenMap = new Map();
  const currentProjects = new Map();
  const userString = process.env.APP_USERS || 'alice:password1,bob:password2,carol:password3';
  const users = parseUsers(userString);

  function login(username, password) {
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
      return null;
    }
    const token = generateToken();
    tokenMap.set(token, { id: user.id, username: user.username });
    return {
      token,
      user: {
        id: user.id,
        username: user.username
      }
    };
  }

  function logout(token) {
    tokenMap.delete(token);
  }

  function getUserByToken(token) {
    return tokenMap.get(token);
  }

  function getAllUsers() {
    return users.map(u => ({
      id: u.id,
      username: u.username
    }));
  }

  function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'missing token' });
    }
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({ error: 'invalid token format' });
    }
    const token = match[1];
    const user = getUserByToken(token);
    if (!user) {
      return res.status(401).json({ error: 'unknown token' });
    }
    req.user = { ...user, token };
    next();
  }

  function getCurrentProject(userId) {
    return currentProjects.get(userId) || null;
  }

  function setCurrentProject(userId, projectId) {
    if (projectId === null || projectId === undefined) {
      currentProjects.delete(userId);
    } else {
      currentProjects.set(userId, projectId);
    }
  }

  return {
    login,
    logout,
    getUserByToken,
    getAllUsers,
    requireAuth,
    getCurrentProject,
    setCurrentProject
  };
}

const authInstance = createAuth();

module.exports = {
  createAuth,
  login: (username, password) => authInstance.login(username, password),
  logout: (token) => authInstance.logout(token),
  getUserByToken: (token) => authInstance.getUserByToken(token),
  getAllUsers: () => authInstance.getAllUsers(),
  requireAuth: (req, res, next) => authInstance.requireAuth(req, res, next),
  getCurrentProject: (userId) => authInstance.getCurrentProject(userId),
  setCurrentProject: (userId, projectId) => authInstance.setCurrentProject(userId, projectId)
};
