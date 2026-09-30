// Logging helper module

const { insert } = require('./db');

// Helper to log user actions
async function logAction(userId, username, action, todoId = null, details = null) {
  const timestamp = new Date().toISOString();
  const logRecord = {
    user_id: userId,
    username,
    action,
    todo_id: todoId,
    timestamp,
    details: details || {}
  };
  try {
    await insert('user_logs', logRecord);
  } catch (error) {
    console.error('Failed to log action:', error);
  }
}

module.exports = {
  logAction
};
