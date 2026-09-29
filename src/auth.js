// Authentication module for user login, token management, and auth middleware

const crypto = require('crypto');

// In-memory storage for tokens
const tokenMap = new Map(); // token -> user

// Parse users from environment variable
function parseUsers() {
  const userString = process.env.APP_USERS || 'alice:password1,bob:password2,carol:password3';
  const users = [];

  const pairs = userString.split(',');
  pairs.forEach((pair, index) => {
    const [username, password] = pair.split(':');
    users.push({
      id: index + 1,
      username: username.trim(),
      password: password.trim()
    });
  });

  return users;
}

// Generate a random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Initialize users at startup
const users = parseUsers();

// Login: authenticate user and create token
function login(username, password) {
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return null;
  }

  const token = generateToken();
  tokenMap.set(token, user);

  return {
    token,
    user: {
      id: user.id,
      username: user.username
    }
  };
}

// Logout: forget token
function logout(token) {
  tokenMap.delete(token);
}

// Get user by token
function getUserByToken(token) {
  return tokenMap.get(token);
}

// Get all users (without passwords)
function getAllUsers() {
  return users.map(u => ({
    id: u.id,
    username: u.username
  }));
}

// Middleware to require authentication
function requireAuth(req, res, next) {
  const authHeader = req.get('Authorization');
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

  req.user = user;
  next();
}

module.exports = {
  login,
  logout,
  getUserByToken,
  getAllUsers,
  requireAuth
};
