
const { logAction } = require('./logging');
const { getAssignees } = require('./assignees');

// Helper to get all comments for a todo (oldest first)
async function getComments(db, todoId) {
  try {
    const comments = await db.getAll('comments', { todo_id: todoId });
    if (!Array.isArray(comments)) {
      return [];
    }
    // Sort oldest first
    comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return comments;
  } catch (error) {
    console.error('Error fetching comments:', error);
    throw error;
  }
}

async function getCommentCount(db, todoId) {
  try {
    const comments = await getComments(db, todoId);
    return comments.length;
  } catch (error) {
    console.error('Error getting comment count:', error);
    throw error;
  }
}

function registerCommentRoutes(app, requireAuth, db, auth, notifications) {
  app.post('/todos/:id/comments', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { body } = req.body;

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const trimmedBody = body.trim();
    if (trimmedBody.length > 1000) {
      return res.status(400).json({ error: 'body too long (max 1000)' });
    }

    try {
      const todo = await db.getById('todos', id);
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

      const comment = await db.insert('comments', commentRecord);

      await logAction(db, req.user.id, req.user.username, 'create_comment', parseInt(id), {
        comment_id: comment.id,
        body: trimmedBody
      });

      const assignees = await getAssignees(db, auth, parseInt(id));
      const assigneeIds = new Set(assignees.map(a => a.id));

      for (const assignee of assignees) {
        await notifications.publishToUser(assignee.id, {
          type: 'comment.created',
          todo_id: parseInt(id),
          comment,
          by: req.user.username
        });
      }

      // Publish to todo creator if not already an assignee
      if (!assigneeIds.has(todo.created_by)) {
        await notifications.publishToUser(todo.created_by, {
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

  app.get('/todos/:id/comments', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const comments = await getComments(db, id);

      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: 'failed to fetch comments' });
    }
  });

  app.put('/todos/:id/comments/:commentId', requireAuth, async (req, res) => {
    const { id, commentId } = req.params;
    const { body } = req.body;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const comment = await db.getById('comments', commentId);
      if (!comment) {
        return res.status(404).json({ error: 'comment not found' });
      }

      if (comment.user_id !== req.user.id) {
        return res.status(403).json({ error: 'only the comment author may edit this comment' });
      }

      if (!body || typeof body !== 'string' || !body.trim()) {
        return res.status(400).json({ error: 'body is required' });
      }
      const trimmedBody = body.trim();
      if (trimmedBody.length > 1000) {
        return res.status(400).json({ error: 'body too long (max 1000)' });
      }

      const updatedComment = {
        ...comment,
        body: trimmedBody,
        updated_at: new Date().toISOString(),
        edited: true
      };

      await db.update('comments', commentId, updatedComment);

      await logAction(db, req.user.id, req.user.username, 'edit_comment', parseInt(id), {
        comment_id: parseInt(commentId)
      });

      res.json(updatedComment);
    } catch (error) {
      console.error('Edit comment error:', error);
      res.status(500).json({ error: 'failed to edit comment' });
    }
  });

  app.delete('/todos/:id/comments/:commentId', requireAuth, async (req, res) => {
    const { id, commentId } = req.params;

    try {
      const todo = await db.getById('todos', id);
      if (!todo) {
        return res.status(404).json({ error: 'todo not found' });
      }

      const comment = await db.getById('comments', commentId);
      if (!comment) {
        return res.status(404).json({ error: 'comment not found' });
      }

      if (comment.user_id !== req.user.id) {
        return res.status(403).json({ error: 'only the comment author may delete this comment' });
      }

      await db.remove('comments', commentId);

      await logAction(db, req.user.id, req.user.username, 'delete_comment', parseInt(id), {
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
