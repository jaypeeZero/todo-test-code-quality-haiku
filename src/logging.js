
const { insert } = require('./db');

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
    throw error;
  }
}

module.exports = {
  logAction
};
