
const { getAll, getById, insert, remove } = require('./db');
const { logAction } = require('./logging');
const { getAllUsers } = require('./auth');
const { sendNotification, publishToUser } = require('./notifications');

const TODO_USERS_TABLE = 'todo_users';

async function getAssignees(todoId) {
  try {
    const assignments = await getAll(TODO_USERS_TABLE, { todo_id: todoId });
    if (!Array.isArray(assignments)) {
      return [];
    }

    const users = getAllUsers();
    const assignees = assignments.map(assignment => {
      const user = users.find(u => u.id === String(assignment.user_id));
      return {
        id: assignment.user_id,
        username: user ? user.username : 'unknown',
        assigned_by: assignment.assigned_by,
        assigned_at: assignment.assigned_at
      };
    });

    return assignees;
  } catch (error) {
    console.error('Error fetching assignees:', error);
    throw error;
  }
}

function registerAssigneeRoutes(app, requireAuth) {
  app.post('/todos/:id/users', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const users = getAllUsers();
      const user = users.find(u => u.id === String(user_id));
      if (!user) {
        return res.status(404).json({ error: 'user not found' });
      }

      const assignments = await getAll(TODO_USERS_TABLE, { todo_id: parseInt(id), user_id: parseInt(user_id) });
      if (Array.isArray(assignments) && assignments.length > 0) {
        return res.status(400).json({ error: 'user is already assigned to this todo' });
      }

      const now = new Date().toISOString();
      const assignmentRecord = {
        todo_id: parseInt(id),
        user_id: parseInt(user_id),
        assigned_by: req.user.id,
        assigned_at: now
      };

      const assignment = await insert(TODO_USERS_TABLE, assignmentRecord);

      await logAction(req.user.id, req.user.username, 'assign_user', parseInt(id), {
        assigned_user_id: parseInt(user_id)
      });

      await sendNotification(
        user.username,
        'You were assigned a todo',
        `You were assigned to todo: ${todo.title}`
      );
      await publishToUser(user.id, {
        type: 'todo.assigned',
        todo,
        assigned_by: req.user.username
      });

      res.status(201).json(assignment);
    } catch (error) {
      console.error('Assign user error:', error);
      res.status(500).json({ error: 'failed to assign user' });
    }
  });

  // DELETE /todos/:id/users/:userId - Unassign a user from a todo
  app.delete('/todos/:id/users/:userId', requireAuth, async (req, res) => {
    const { id, userId } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const assignments = await getAll(TODO_USERS_TABLE, { todo_id: parseInt(id), user_id: parseInt(userId) });
      if (!Array.isArray(assignments) || assignments.length === 0) {
        return res.status(404).json({ error: 'assignment not found' });
      }

      const assignment = assignments[0];
      await remove(TODO_USERS_TABLE, assignment.id);

      await logAction(req.user.id, req.user.username, 'unassign_user', parseInt(id), {
        unassigned_user_id: parseInt(userId)
      });

      res.status(204).send();
    } catch (error) {
      console.error('Unassign user error:', error);
      res.status(500).json({ error: 'failed to unassign user' });
    }
  });

  app.get('/todos/:id/users', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const assignees = await getAssignees(id);
      res.json(assignees);
    } catch (error) {
      console.error('Get assignees error:', error);
      res.status(500).json({ error: 'failed to fetch assignees' });
    }
  });

  // GET /users/:id/todos - Get all todos assigned to a user
  app.get('/users/:id/todos', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const users = getAllUsers();
      const user = users.find(u => u.id === String(id));
      if (!user) {
        return res.status(404).json({ error: 'user not found' });
      }

      const assignments = await getAll(TODO_USERS_TABLE, { user_id: parseInt(id) });
      if (!Array.isArray(assignments)) {
        return res.json([]);
      }

      const allTodos = await getAll('todos');
      const todoList = Array.isArray(allTodos) ? allTodos : [];

      const assignedTodoIds = new Set(assignments.map(a => a.todo_id));
      const todos = todoList.filter(t => assignedTodoIds.has(t.id) && !t.archived);

      res.json(todos);
    } catch (error) {
      console.error('Get user todos error:', error);
      res.status(500).json({ error: 'failed to fetch todos' });
    }
  });
}

module.exports = {
  registerAssigneeRoutes,
  getAssignees
};
