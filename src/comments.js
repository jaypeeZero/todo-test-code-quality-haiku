// Comments module for todos

const { getAll, getById, insert, update, remove } = require('./db');
const { logAction } = require('./logging');
const { publishToUser } = require('./notifications');
const { getAssignees } = require('./assignees');

// Helper to get all comments for a todo (oldest first)
async function getComments(todoId) {
  try {
    const comments = await getAll('comments', { todo_id: todoId });
    if (!Array.isArray(comments)) {
      return [];
    }
    // Sort oldest first
    comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return comments;
  } catch (error) {
    console.error('Error fetching comments:', error);
    return [];
  }
}

// Helper to get comment count for a todo
async function getCommentCount(todoId) {
  try {
    const comments = await getComments(todoId);
    return comments.length;
  } catch (error) {
    console.error('Error getting comment count:', error);
    return 0;
  }
}

// Register comment routes
function registerCommentRoutes(app, requireAuth) {
  // POST /todos/:id/comments - Create a comment
  app.post('/todos/:id/comments', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { body } = req.body;

    // Validate body
    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const trimmedBody = body.trim();
    if (trimmedBody.length > 1000) {
      return res.status(400).json({ error: 'body too long (max 1000)' });
    }

    try {
      // Validate todo exists
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }
      const now = new Date().toISOString();
      const commentRecord = {
        todo_id: parseInt(id),
        user_id: req.user.id,
        username: req.user.username,
        body: trimmedBody,
        created_at: now,
        updated_at: now,
        edited: false
      };

      const comment = await insert('comments', commentRecord);

      // Log the action
      await logAction(req.user.id, req.user.username, 'create_comment', parseInt(id), {
        comment_id: comment.id,
        body: trimmedBody
      });

      // Publish comment event to assignees and creator
      const assignees = await getAssignees(parseInt(id));
      const assigneeIds = new Set(assignees.map(a => a.id));

      // Publish to all assignees
      for (const assignee of assignees) {
        await publishToUser(assignee.id, {
          type: 'comment.created',
          todo_id: parseInt(id),
          comment,
          by: req.user.username
        });
      }

      // Publish to todo creator if not already an assignee
      if (!assigneeIds.has(todo.created_by)) {
        await publishToUser(todo.created_by, {
          type: 'comment.created',
          todo_id: parseInt(id),
          comment,
          by: req.user.username
        });
      }

      res.status(201).json(comment);
    } catch (error) {
      console.error('Create comment error:', error);
      res.status(500).json({ error: 'failed to create comment' });
    }
  });

  // GET /todos/:id/comments - List comments for a todo
  app.get('/todos/:id/comments', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const comments = await getComments(id);

      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch comments' });
    }
  });

  // PUT /todos/:id/comments/:commentId - Edit a comment
  app.put('/todos/:id/comments/:commentId', requireAuth, async (req, res) => {
    const { id, commentId } = req.params;
    const { body } = req.body;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const comment = await getById('comments', commentId);
      if (!comment) {
        return res.status(404).json({ error: 'comment not found' });
      }

      // Check if user is the author
      if (comment.user_id !== req.user.id) {
        return res.status(403).json({ error: 'only the comment author may edit this comment' });
      }

      // Validate body
      if (!body || typeof body !== 'string' || !body.trim()) {
        return res.status(400).json({ error: 'body is required' });
      }
      const trimmedBody = body.trim();
      if (trimmedBody.length > 1000) {
        return res.status(400).json({ error: 'body too long (max 1000)' });
      }

      // Update comment
      const updatedComment = {
        ...comment,
        body: trimmedBody,
        updated_at: new Date().toISOString(),
        edited: true
      };

      await update('comments', commentId, updatedComment);

      // Log the action
      await logAction(req.user.id, req.user.username, 'edit_comment', parseInt(id), {
        comment_id: parseInt(commentId)
      });

      res.json(updatedComment);
    } catch (error) {
      console.error('Edit comment error:', error);
      res.status(500).json({ error: 'failed to edit comment' });
    }
  });

  // DELETE /todos/:id/comments/:commentId - Delete a comment
  app.delete('/todos/:id/comments/:commentId', requireAuth, async (req, res) => {
    const { id, commentId } = req.params;

    try {
      const todo = await getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const comment = await getById('comments', commentId);
      if (!comment) {
        return res.status(404).json({ error: 'comment not found' });
      }

      // Check if user is the author
      if (comment.user_id !== req.user.id) {
        return res.status(403).json({ error: 'only the comment author may delete this comment' });
      }

      await remove('comments', commentId);

      // Log the action
      await logAction(req.user.id, req.user.username, 'delete_comment', parseInt(id), {
        comment_id: parseInt(commentId)
      });

      res.status(204).send();
    } catch (error) {
      console.error('Delete comment error:', error);
      res.status(500).json({ error: 'failed to delete comment' });
    }
  });
}

module.exports = {
  registerCommentRoutes,
  getComments,
  getCommentCount
};
