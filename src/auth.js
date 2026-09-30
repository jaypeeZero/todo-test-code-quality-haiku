// Authentication module for user login, token management, and auth middleware

const crypto = require('crypto');

// In-memory storage for tokens
const tokenMap = new Map(); // token -> user

// In-memory storage for current project per user
const currentProjects = new Map(); // user_id -> project_id (or null)

// Parse users from environment variable
function parseUsers() {
  const userString = process.env.APP_USERS || 'alice:password1,bob:password2,carol:password3';
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

const users = parseUsers();

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

module.exports = {
  login,
  logout,
  getUserByToken,
  getAllUsers,
  requireAuth,
  getCurrentProject,
  setCurrentProject
};
