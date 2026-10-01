

async function logAction(db, userId, username, action, todoId = null, details = null) {
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
    await db.insert('user_logs', logRecord);
  } catch (error) {
    console.error('Failed to log action:', error);
    throw error;
  }
}

module.exports = {
  logAction
};
