// State
let token = localStorage.getItem('token');
let currentUser = null;
let currentProjectId = localStorage.getItem('currentProjectId');
if (currentProjectId === 'null') currentProjectId = null;
let allTodos = [];
let allProjects = [];
let allInitiatives = [];
let allUsers = [];
let selectedTodo = null;
let notificationCount = 0;
const maxNotifications = 20;
let notifications = [];

// Event sources for real-time updates
let todosEventSource = null;
let initiativesEventSource = null;
let userEventSource = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showApp();
  } else {
    showLogin();
  }
});

// Login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      document.getElementById('login-error').textContent = 'Invalid credentials';
      return;
    }

    const data = await response.json();
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('login-error').textContent = '';
    showApp();
  } catch (error) {
    document.getElementById('login-error').textContent = 'Login failed';
    console.error('Login error:', error);
  }
});

function showLogin() {
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('app-screen').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  document.getElementById('app-screen').style.flexDirection = 'column';
  loadAppData();
  setupEventListeners();
  setupRealTimeUpdates();
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await fetch('/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (error) {
    console.error('Logout error:', error);
  }
  localStorage.removeItem('token');
  localStorage.removeItem('currentProjectId');
  token = null;
  currentUser = null;
  closeDetailPanel();
  closeNotificationsPanel();
  if (todosEventSource) todosEventSource.close();
  if (initiativesEventSource) initiativesEventSource.close();
  if (userEventSource) userEventSource.close();
  showLogin();
});

// Load app data
async function loadAppData() {
  try {
    // Get current user
    const meResponse = await fetch('/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const meData = await meResponse.json();
    currentUser = meData;
    currentProjectId = meData.current_project_id;
    document.getElementById('username-display').textContent = meData.username;

    // Load projects
    const projectsResponse = await fetch('/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    allProjects = await projectsResponse.json();
    populateProjectSwitcher();
    populateProjectMultiSelect();
    populateProjectSelect();

    // Load users
    const usersResponse = await fetch('/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    allUsers = await usersResponse.json();
    populateAssigneeSelect();

    // Load todos
    const todosParams = currentProjectId ? `?project_id=${currentProjectId}` : '?project_id=none';
    const todosResponse = await fetch(`/todos${todosParams}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    allTodos = await todosResponse.json();
    renderTodosList();

    // Load initiatives
    const initiativesResponse = await fetch('/initiatives', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    allInitiatives = await initiativesResponse.json();
    renderInitiativesList();

    // Render projects
    renderProjectsList();
  } catch (error) {
    console.error('Failed to load app data:', error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
  });

  // Project switcher
  document.getElementById('project-switcher').addEventListener('change', async (e) => {
    currentProjectId = e.target.value === 'none' ? null : parseInt(e.target.value);
    localStorage.setItem('currentProjectId', currentProjectId);
    try {
      await fetch('/me/current-project', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ project_id: currentProjectId })
      });
      const todosParams = currentProjectId ? `?project_id=${currentProjectId}` : '?project_id=none';
      const response = await fetch(`/todos${todosParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      allTodos = await response.json();
      renderTodosList();
    } catch (error) {
      console.error('Failed to switch project:', error);
    }
  });

  // New todo form
  document.getElementById('new-todo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('todo-title').value;
    const description = document.getElementById('todo-description').value;
    const priority = document.getElementById('todo-priority').value;
    const dueDate = document.getElementById('todo-due-date').value;

    try {
      const response = await fetch('/todos', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          description: description || null,
          priority,
          due_date: dueDate || null
        })
      });

      if (response.ok) {
        const newTodo = await response.json();
        allTodos.push(newTodo);
        renderTodosList();
        document.getElementById('new-todo-form').reset();
      }
    } catch (error) {
      console.error('Failed to create todo:', error);
    }
  });

  // New project form
  document.getElementById('new-project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('project-name').value;
    const description = document.getElementById('project-description').value;

    try {
      const response = await fetch('/projects', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          description: description || null
        })
      });

      if (response.ok) {
        const newProject = await response.json();
        allProjects.push(newProject);
        populateProjectSwitcher();
        populateProjectMultiSelect();
        renderProjectsList();
        document.getElementById('new-project-form').reset();
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  });

  // New initiative form
  document.getElementById('new-initiative-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('initiative-name').value;
    const description = document.getElementById('initiative-description').value;
    const selectedProjects = Array.from(
      document.querySelectorAll('#project-multi-select .multi-select-item.selected')
    ).map(item => parseInt(item.dataset.projectId));

    if (selectedProjects.length === 0) {
      alert('Select at least one project');
      return;
    }

    try {
      const response = await fetch('/initiatives', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          description: description || null,
          project_ids: selectedProjects
        })
      });

      if (response.ok) {
        const newInitiative = await response.json();
        allInitiatives.push(newInitiative);
        renderInitiativesList();
        document.getElementById('new-initiative-form').reset();
        document.querySelectorAll('#project-multi-select .multi-select-item').forEach(item => {
          item.classList.remove('selected');
        });
      }
    } catch (error) {
      console.error('Failed to create initiative:', error);
    }
  });

  // Detail panel close
  document.getElementById('close-detail-btn').addEventListener('click', closeDetailPanel);

  // Notifications button
  document.getElementById('notifications-btn').addEventListener('click', toggleNotificationsPanel);
}

function toggleNotificationsPanel() {
  const list = document.getElementById('notifications-list');
  list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function closeNotificationsPanel() {
  document.getElementById('notifications-list').style.display = 'none';
}

// Populate dropdowns
function populateProjectSwitcher() {
  const select = document.getElementById('project-switcher');
  const currentValue = select.value;
  select.innerHTML = '<option value="none">No project</option>';
  allProjects.forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    select.appendChild(option);
  });
  if (currentProjectId) {
    select.value = currentProjectId;
  } else {
    select.value = 'none';
  }
}

function populateProjectMultiSelect() {
  const container = document.getElementById('project-multi-select');
  container.innerHTML = '';
  allProjects.forEach(project => {
    const item = document.createElement('div');
    item.className = 'multi-select-item';
    item.dataset.projectId = project.id;
    item.textContent = project.name;
    item.addEventListener('click', () => {
      item.classList.toggle('selected');
    });
    container.appendChild(item);
  });
}

function populateAssigneeSelect() {
  const select = document.getElementById('assignee-select');
  select.innerHTML = '<option value="">Select user to assign...</option>';
  allUsers.forEach(user => {
    const option = document.createElement('option');
    option.value = user.id;
    option.textContent = user.username;
    select.appendChild(option);
  });
}

function populateProjectSelect() {
  // Not used in MVP but available for future enhancements
}

// Render todos list
function renderTodosList() {
  const container = document.getElementById('todos-container');
  container.innerHTML = '';

  const projectName = currentProjectId
    ? allProjects.find(p => p.id === currentProjectId)?.name || 'No project'
    : 'No project';
  document.getElementById('current-project-name').textContent = projectName;

  allTodos.forEach(todo => {
    const card = document.createElement('div');
    card.className = 'todo-card';

    const statusClass = todo.status === 'done' ? 'done' : '';
    const overdueClass = todo.is_overdue ? 'overdue' : '';

    let todosHtml = `
      <div class="todo-card-header">
        <div class="todo-title">${escapeHtml(todo.title)}</div>
        <span class="todo-priority priority-${todo.priority}">${todo.priority}</span>
      </div>
      <div class="todo-status ${statusClass}">${todo.status}</div>
    `;

    if (todo.due_date) {
      todosHtml += `<div class="todo-meta-item">📅 ${todo.due_date}`;
      if (todo.is_overdue) {
        todosHtml += ' <span class="todo-overdue">(OVERDUE)</span>';
      }
      todosHtml += '</div>';
    }

    if (todo.is_blocked) {
      todosHtml += '<div class="todo-meta-item"><span class="todo-blocked">🚫 BLOCKED</span></div>';
    }

    if (todo.assignees && todo.assignees.length > 0) {
      todosHtml += `<div class="todo-meta-item">👤 ${todo.assignees.map(a => a.username).join(', ')}</div>`;
    }

    if (todo.comment_count > 0) {
      todosHtml += `<div class="todo-meta-item">💬 ${todo.comment_count}</div>`;
    }

    todosHtml += `
      <div class="todo-actions">
        <button class="todo-btn open-btn" onclick="openTodoDetail(${todo.id})">Open</button>
        ${todo.status === 'done' ? `
          <button class="todo-btn complete-btn" onclick="reopenTodo(${todo.id})">Reopen</button>
        ` : `
          <button class="todo-btn complete-btn" onclick="completeTodo(${todo.id})">Complete</button>
        `}
        <button class="todo-btn archive-btn" onclick="archiveTodo(${todo.id})">Archive</button>
      </div>
    `;

    card.innerHTML = todosHtml;
    container.appendChild(card);
  });
}

// Render projects list
function renderProjectsList() {
  const container = document.getElementById('projects-container');
  container.innerHTML = '';

  allProjects.forEach(project => {
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-name">${escapeHtml(project.name)}</div>
      <div class="project-description">${escapeHtml(project.description || '')}</div>
      <button class="project-delete-btn" onclick="deleteProject(${project.id})">Delete</button>
    `;
    container.appendChild(card);
  });
}

// Render initiatives list
function renderInitiativesList() {
  const container = document.getElementById('initiatives-container');
  container.innerHTML = '';

  allInitiatives.forEach(initiative => {
    const card = document.createElement('div');
    card.className = 'initiative-card';
    const projectNames = initiative.projects.map(p => p.name).join(', ');
    card.innerHTML = `
      <div class="initiative-name">${escapeHtml(initiative.name)}</div>
      <div class="initiative-projects">Projects: ${escapeHtml(projectNames)}</div>
      <div class="initiative-progress">
        <div class="progress-label">${initiative.done_count}/${initiative.todo_count} done</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${initiative.percent}%"></div>
        </div>
      </div>
      <button class="initiative-delete-btn" onclick="deleteInitiative(${initiative.id})">Delete</button>
    `;
    container.appendChild(card);
  });
}

// Todo actions
async function completeTodo(todoId) {
  try {
    const todo = allTodos.find(t => t.id === todoId);
    if (!todo) return;

    const response = await fetch(`/todos/${todoId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'done' })
    });

    if (response.ok) {
      const updatedTodo = await response.json();
      const index = allTodos.findIndex(t => t.id === todoId);
      allTodos[index] = updatedTodo;
      renderTodosList();
      if (selectedTodo && selectedTodo.id === todoId) {
        selectedTodo = updatedTodo;
        renderDetailPanel();
      }
    }
  } catch (error) {
    console.error('Failed to complete todo:', error);
  }
}

async function reopenTodo(todoId) {
  try {
    const response = await fetch(`/todos/${todoId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'open' })
    });

    if (response.ok) {
      const updatedTodo = await response.json();
      const index = allTodos.findIndex(t => t.id === todoId);
      allTodos[index] = updatedTodo;
      renderTodosList();
      if (selectedTodo && selectedTodo.id === todoId) {
        selectedTodo = updatedTodo;
        renderDetailPanel();
      }
    }
  } catch (error) {
    console.error('Failed to reopen todo:', error);
  }
}

async function archiveTodo(todoId) {
  try {
    const response = await fetch(`/todos/${todoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      allTodos = allTodos.filter(t => t.id !== todoId);
      renderTodosList();
      closeDetailPanel();
    }
  } catch (error) {
    console.error('Failed to archive todo:', error);
  }
}

// Project actions
async function deleteProject(projectId) {
  if (!confirm('Delete this project?')) return;

  try {
    const response = await fetch(`/projects/${projectId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      allProjects = allProjects.filter(p => p.id !== projectId);
      populateProjectSwitcher();
      populateProjectMultiSelect();
      renderProjectsList();
    }
  } catch (error) {
    console.error('Failed to delete project:', error);
  }
}

// Initiative actions
async function deleteInitiative(initiativeId) {
  if (!confirm('Delete this initiative?')) return;

  try {
    const response = await fetch(`/initiatives/${initiativeId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      allInitiatives = allInitiatives.filter(i => i.id !== initiativeId);
      renderInitiativesList();
    }
  } catch (error) {
    console.error('Failed to delete initiative:', error);
  }
}

// Detail panel
async function openTodoDetail(todoId) {
  try {
    const response = await fetch(`/todos/${todoId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      selectedTodo = await response.json();
      renderDetailPanel();
      document.getElementById('detail-panel').style.display = 'block';
      document.getElementById('detail-panel').classList.add('open');
    }
  } catch (error) {
    console.error('Failed to load todo detail:', error);
  }
}

function closeDetailPanel() {
  document.getElementById('detail-panel').style.display = 'none';
  selectedTodo = null;
}

function renderDetailPanel() {
  if (!selectedTodo) return;

  document.getElementById('detail-title').textContent = escapeHtml(selectedTodo.title);
  document.getElementById('detail-description').textContent = selectedTodo.description || '(no description)';
  document.getElementById('detail-status').value = selectedTodo.status === 'open' ? 'open' : 'done';
  document.getElementById('detail-priority').value = selectedTodo.priority;
  document.getElementById('detail-due-date').value = selectedTodo.due_date || '';

  // Render initiative if present
  if (selectedTodo.initiative) {
    document.getElementById('initiative-section').style.display = 'block';
    document.getElementById('detail-initiative').textContent = escapeHtml(selectedTodo.initiative.name);
  } else {
    document.getElementById('initiative-section').style.display = 'none';
  }

  // Update button visibility
  if (selectedTodo.status === 'done') {
    document.getElementById('complete-btn').style.display = 'none';
    document.getElementById('reopen-btn').style.display = 'block';
  } else {
    document.getElementById('complete-btn').style.display = 'block';
    document.getElementById('reopen-btn').style.display = 'none';
  }

  // Render assignees
  const assigneesContainer = document.getElementById('detail-assignees');
  assigneesContainer.innerHTML = '';
  if (selectedTodo.assignees && selectedTodo.assignees.length > 0) {
    selectedTodo.assignees.forEach(assignee => {
      const badge = document.createElement('div');
      badge.className = 'assignee-badge';
      badge.innerHTML = `
        ${escapeHtml(assignee.username)}
        <button class="remove-assignee" onclick="removeAssignee(${assignee.id})">×</button>
      `;
      assigneesContainer.appendChild(badge);
    });
  }

  // Render comments
  const commentsContainer = document.getElementById('detail-comments');
  commentsContainer.innerHTML = '';
  if (selectedTodo.comments && selectedTodo.comments.length > 0) {
    selectedTodo.comments.forEach(comment => {
      const commentDiv = document.createElement('div');
      commentDiv.className = 'comment';
      commentDiv.innerHTML = `
        <div class="comment-author">${escapeHtml(comment.username)}</div>
        <div class="comment-body">${escapeHtml(comment.body)}</div>
      `;
      commentsContainer.appendChild(commentDiv);
    });
  }

  // Render relations
  const relationsContainer = document.getElementById('detail-relations');
  relationsContainer.innerHTML = '';
  if (selectedTodo.relations) {
    const { parent, children, siblings } = selectedTodo.relations;
    if (parent) {
      const item = document.createElement('div');
      item.className = 'relation-item';
      item.innerHTML = `<span class="relation-label">Parent:</span> ${escapeHtml(parent.title)} (#${parent.id})`;
      relationsContainer.appendChild(item);
    }
    if (children && children.length > 0) {
      const item = document.createElement('div');
      item.className = 'relation-item';
      item.innerHTML = `<span class="relation-label">Children:</span> ${children.map(c => `${escapeHtml(c.title)} (#${c.id})`).join(', ')}`;
      relationsContainer.appendChild(item);
    }
    if (siblings && siblings.length > 0) {
      const item = document.createElement('div');
      item.className = 'relation-item';
      item.innerHTML = `<span class="relation-label">Siblings:</span> ${siblings.map(s => `${escapeHtml(s.title)} (#${s.id})`).join(', ')}`;
      relationsContainer.appendChild(item);
    }
  }

  // Render blockers
  const blockersContainer = document.getElementById('detail-blockers');
  blockersContainer.innerHTML = '';
  if (selectedTodo.blocked_by && selectedTodo.blocked_by.length > 0) {
    selectedTodo.blocked_by.forEach(blocker => {
      const item = document.createElement('div');
      item.className = 'blocker-item';
      item.innerHTML = `
        <span>${escapeHtml(blocker.title)} (#${blocker.id})</span>
        <button class="remove-blocker" onclick="removeBlocker(${blocker.id})">×</button>
      `;
      blockersContainer.appendChild(item);
    });
  }

  // Setup event listeners for detail panel
  setupDetailPanelListeners();
}

function setupDetailPanelListeners() {
  // Status change
  document.getElementById('detail-status').addEventListener('change', async (e) => {
    try {
      const response = await fetch(`/todos/${selectedTodo.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: e.target.value })
      });

      if (response.ok) {
        const updatedTodo = await response.json();
        selectedTodo = updatedTodo;
        const index = allTodos.findIndex(t => t.id === selectedTodo.id);
        allTodos[index] = updatedTodo;
        renderTodosList();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  });

  // Priority change
  document.getElementById('detail-priority').addEventListener('change', async (e) => {
    try {
      const response = await fetch(`/todos/${selectedTodo.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ priority: e.target.value })
      });

      if (response.ok) {
        const updatedTodo = await response.json();
        selectedTodo = updatedTodo;
        const index = allTodos.findIndex(t => t.id === selectedTodo.id);
        allTodos[index] = updatedTodo;
        renderTodosList();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to update priority:', error);
    }
  });

  // Due date change
  document.getElementById('detail-due-date').addEventListener('change', async (e) => {
    try {
      const response = await fetch(`/todos/${selectedTodo.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ due_date: e.target.value || null })
      });

      if (response.ok) {
        const updatedTodo = await response.json();
        selectedTodo = updatedTodo;
        const index = allTodos.findIndex(t => t.id === selectedTodo.id);
        allTodos[index] = updatedTodo;
        renderTodosList();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to update due date:', error);
    }
  });

  // Add assignee
  document.getElementById('add-assignee-btn').addEventListener('click', async () => {
    const userId = document.getElementById('assignee-select').value;
    if (!userId) return;

    try {
      const response = await fetch(`/todos/${selectedTodo.id}/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: parseInt(userId) })
      });

      if (response.ok) {
        document.getElementById('assignee-select').value = '';
        // Reload the detail panel
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        selectedTodo = await detailResponse.json();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to add assignee:', error);
    }
  });

  // Add comment
  document.getElementById('add-comment-btn').addEventListener('click', async () => {
    const body = document.getElementById('comment-body').value;
    if (!body) return;

    try {
      const response = await fetch(`/todos/${selectedTodo.id}/comments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body })
      });

      if (response.ok) {
        document.getElementById('comment-body').value = '';
        // Reload the detail panel
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        selectedTodo = await detailResponse.json();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
    }
  });

  // Add blocker
  document.getElementById('add-blocker-btn').addEventListener('click', async () => {
    const blockerTodoId = parseInt(document.getElementById('blocker-todo-id').value);
    if (!blockerTodoId) return;

    try {
      const response = await fetch(`/todos/${selectedTodo.id}/blockers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ blocker_id: blockerTodoId })
      });

      if (response.ok) {
        document.getElementById('blocker-todo-id').value = '';
        // Reload the detail panel
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        selectedTodo = await detailResponse.json();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to add blocker:', error);
    }
  });

  // Complete button
  document.getElementById('complete-btn').addEventListener('click', async () => {
    await completeTodo(selectedTodo.id);
  });

  // Reopen button
  document.getElementById('reopen-btn').addEventListener('click', async () => {
    await reopenTodo(selectedTodo.id);
  });

  // Archive button
  document.getElementById('archive-btn').addEventListener('click', async () => {
    await archiveTodo(selectedTodo.id);
  });
}

async function removeAssignee(userId) {
  try {
    const response = await fetch(`/todos/${selectedTodo.id}/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      // Reload the detail panel
      const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      selectedTodo = await detailResponse.json();
      renderDetailPanel();
    }
  } catch (error) {
    console.error('Failed to remove assignee:', error);
  }
}

async function removeBlocker(blockerTodoId) {
  try {
    const response = await fetch(`/todos/${selectedTodo.id}/blockers/${blockerTodoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.ok) {
      // Reload the detail panel
      const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      selectedTodo = await detailResponse.json();
      renderDetailPanel();
    }
  } catch (error) {
    console.error('Failed to remove blocker:', error);
  }
}

// Real-time updates
function setupRealTimeUpdates() {
  // Todos updates
  todosEventSource = new EventSource('http://localhost:4002/topics/todos/stream');
  todosEventSource.addEventListener('message', async (e) => {
    try {
      const data = JSON.parse(e.data);
      // Reload todos list on any change
      const todosParams = currentProjectId ? `?project_id=${currentProjectId}` : '?project_id=none';
      const response = await fetch(`/todos${todosParams}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      allTodos = await response.json();
      renderTodosList();
      if (selectedTodo) {
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (detailResponse.ok) {
          selectedTodo = await detailResponse.json();
          renderDetailPanel();
        }
      }
    } catch (error) {
      console.error('Error processing todos event:', error);
    }
  });

  // Initiatives updates
  initiativesEventSource = new EventSource('http://localhost:4002/topics/initiatives/stream');
  initiativesEventSource.addEventListener('message', async (e) => {
    try {
      const data = JSON.parse(e.data);
      // Reload initiatives on progress/completed events
      const response = await fetch('/initiatives', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      allInitiatives = await response.json();
      renderInitiativesList();
    } catch (error) {
      console.error('Error processing initiatives event:', error);
    }
  });

  // User notifications
  userEventSource = new EventSource(`http://localhost:4002/topics/user-${currentUser.id}/stream`);
  userEventSource.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      addNotification(data.data || JSON.stringify(data));
    } catch (error) {
      console.error('Error processing user event:', error);
    }
  });
}

function addNotification(message) {
  notifications.unshift(message);
  if (notifications.length > maxNotifications) {
    notifications.pop();
  }
  renderNotifications();
}

function renderNotifications() {
  const list = document.getElementById('notifications-list');
  list.innerHTML = '';
  notifications.forEach(notif => {
    const item = document.createElement('div');
    item.className = 'notification-item';
    item.textContent = typeof notif === 'string' ? notif : JSON.stringify(notif);
    list.appendChild(item);
  });
}

// Utility
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
