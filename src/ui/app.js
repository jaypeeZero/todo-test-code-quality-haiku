// Constants (global for reference)
const CURRENT_PROJECT_ID_KEY = 'currentProjectId';

(function() {
  // State
  let token = localStorage.getItem('token');
  let currentUser = null;
  let currentProjectId = localStorage.getItem(CURRENT_PROJECT_ID_KEY);
  if (currentProjectId === 'null') currentProjectId = null;
  let allTodos = [];
  let allProjects = [];
  let allInitiatives = [];
  let allUsers = [];
  let selectedTodo = null;
  let notificationCount = 0;
  const maxNotifications = 20;
  let notifications = [];

  let todosEventSource = null;
  let initiativesEventSource = null;
  let userEventSource = null;

  const JSON_HEADER = { 'Content-Type': 'application/json' };
  const NOTIFICATIONS_LIST_ID = 'notifications-list';
  const HTTP_METHOD_POST = 'POST';
  const HTTP_METHOD_PUT = 'PUT';
  const HTTP_METHOD_DELETE = 'DELETE';
  const AUTH_HEADER_KEY = 'Authorization';
  const CONTENT_TYPE_HEADER = 'Content-Type';
  const CONTENT_TYPE_JSON = 'application/json';
  const DISPLAY_NONE = 'none';
  const DISPLAY_BLOCK = 'block';
  const DISPLAY_FLEX = 'flex';
  const CLASS_ACTIVE = 'active';
  const LOGIN_SCREEN_ID = 'login-screen';
  const APP_SCREEN_ID = 'app-screen';
  const DETAIL_PANEL_ID = 'detail-panel';
  const LOGIN_ERROR_ID = 'login-error';
  const REOPEN_BTN_ID = 'reopen-btn';
  const COMPLETE_BTN_ID = 'complete-btn';
  const DETAIL_TITLE_ID = 'detail-title';
  const DETAIL_DESCRIPTION_ID = 'detail-description';
  const DETAIL_STATUS_ID = 'detail-status';
  const DETAIL_PRIORITY_ID = 'detail-priority';
  const DETAIL_DUE_DATE_ID = 'detail-due-date';
  const INITIATIVE_SECTION_ID = 'initiative-section';
  const DETAIL_INITIATIVE_ID = 'detail-initiative';
  const DETAIL_ASSIGNEES_ID = 'detail-assignees';
  const DETAIL_COMMENTS_ID = 'detail-comments';
  const DETAIL_RELATIONS_ID = 'detail-relations';
  const DETAIL_BLOCKERS_ID = 'detail-blockers';
  const ASSIGNEE_SELECT_ID = 'assignee-select';
  const NEW_TODO_FORM_ID = 'new-todo-form';
  const NEW_PROJECT_FORM_ID = 'new-project-form';
  const NEW_INITIATIVE_FORM_ID = 'new-initiative-form';
  const PROJECT_SWITCHER_ID = 'project-switcher';
  const NO_PROJECT_QUERY = '?project_id=none';
  const NO_PROJECT_VALUE = 'none';
  const API_ENDPOINT_PROJECTS = '/projects';
  const API_ENDPOINT_INITIATIVES = '/initiatives';
  const API_ENDPOINT_TODOS = '/todos';
  const API_ENDPOINT_USERS = '/users';
  const API_ENDPOINT_ME = '/me';
  const STATUS_OPEN = 'open';
  const STATUS_DONE = 'done';
  const CSS_CLASS_RELATION_ITEM = 'relation-item';
  const CSS_CLASS_ASSIGNEE_BADGE = 'assignee-badge';
  const CSS_CLASS_COMMENT = 'comment';
  const CSS_CLASS_BLOCKER_ITEM = 'blocker-item';
  const CSS_CLASS_TAB_BTN = CSS_CLASS_TAB_BTN;

function getAuthHeader() {
  return { [AUTH_HEADER_KEY]: `Bearer ${token}` };
}

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
      method: HTTP_METHOD_POST,
      headers: JSON_HEADER,
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      document.getElementById(LOGIN_ERROR_ID).textContent = 'Invalid credentials';
      return;
    }

    const data = await response.json();
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById(LOGIN_ERROR_ID).textContent = '';
    showApp();
  } catch (error) {
    document.getElementById(LOGIN_ERROR_ID).textContent = 'Login failed';
    console.error('Login error:', error);
  }
});

function showLogin() {
  document.getElementById(LOGIN_SCREEN_ID).style.display = DISPLAY_BLOCK;
  document.getElementById(APP_SCREEN_ID).style.display = DISPLAY_NONE;
}

function showApp() {
  document.getElementById(LOGIN_SCREEN_ID).style.display = DISPLAY_NONE;
  document.getElementById(APP_SCREEN_ID).style.display = DISPLAY_FLEX;
  document.getElementById(APP_SCREEN_ID).style.flexDirection = 'column';
  loadAppData();
  setupEventListeners();
  setupRealTimeUpdates();
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await fetch('/logout', {
      method: HTTP_METHOD_POST,
      headers: getAuthHeader()
    });
  } catch (error) {
    console.error('Logout error:', error);
    throw error;
  }
  localStorage.removeItem('token');
  localStorage.removeItem(CURRENT_PROJECT_ID_KEY);
  token = null;
  currentUser = null;
  closeDetailPanel();
  closeNotificationsPanel();
  if (todosEventSource) todosEventSource.close();
  if (initiativesEventSource) initiativesEventSource.close();
  if (userEventSource) userEventSource.close();
  showLogin();
});

async function loadAppData() {
  try {
    const meResponse = await fetch(API_ENDPOINT_ME, {
      headers: getAuthHeader()
    });
    const meData = await meResponse.json();
    currentUser = meData;
    currentProjectId = meData.current_project_id;
    document.getElementById('username-display').textContent = meData.username;

    const projectsResponse = await fetch(API_ENDPOINT_PROJECTS, {
      headers: getAuthHeader()
    });
    allProjects = await projectsResponse.json();
    populateProjectSwitcher();
    populateProjectMultiSelect();
    populateProjectSelect();

    const usersResponse = await fetch(API_ENDPOINT_USERS, {
      headers: getAuthHeader()
    });
    allUsers = await usersResponse.json();
    populateAssigneeSelect();

    const todosParams = currentProjectId ? `?project_id=${currentProjectId}` : NO_PROJECT_QUERY;
    const todosResponse = await fetch(`${API_ENDPOINT_TODOS}${todosParams}`, {
      headers: getAuthHeader()
    });
    allTodos = await todosResponse.json();
    renderTodosList();

    const initiativesResponse = await fetch(API_ENDPOINT_INITIATIVES, {
      headers: getAuthHeader()
    });
    allInitiatives = await initiativesResponse.json();
    renderInitiativesList();

    renderProjectsList();
  } catch (error) {
    console.error('Failed to load app data:', error);
    throw error;
  }
}

function setupEventListeners() {
  document.querySelectorAll(CSS_CLASS_TAB_BTN).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(CSS_CLASS_TAB_BTN).forEach(b => b.classList.remove(CLASS_ACTIVE));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove(CLASS_ACTIVE));
      btn.classList.add(CLASS_ACTIVE);
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add(CLASS_ACTIVE);
    });
  });

  document.getElementById(PROJECT_SWITCHER_ID).addEventListener('change', async (e) => {
    currentProjectId = e.target.value === NO_PROJECT_VALUE ? null : parseInt(e.target.value);
    localStorage.setItem(CURRENT_PROJECT_ID_KEY, currentProjectId);
    try {
      await fetch('/me/current-project', {
        method: HTTP_METHOD_PUT,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
        },
        body: JSON.stringify({ project_id: currentProjectId })
      });
      const todosParams = currentProjectId ? `?project_id=${currentProjectId}` : NO_PROJECT_QUERY;
      const response = await fetch(`${API_ENDPOINT_TODOS}${todosParams}`, {
        headers: getAuthHeader()
      });
      allTodos = await response.json();
      renderTodosList();
    } catch (error) {
      console.error('Failed to switch project:', error);
      throw error;
    }
  });

  document.getElementById(NEW_TODO_FORM_ID).addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('todo-title').value;
    const description = document.getElementById('todo-description').value;
    const priority = document.getElementById('todo-priority').value;
    const dueDate = document.getElementById('todo-due-date').value;

    try {
      const response = await fetch(API_ENDPOINT_TODOS, {
        method: HTTP_METHOD_POST,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
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
        document.getElementById(NEW_TODO_FORM_ID).reset();
      }
    } catch (error) {
      console.error('Failed to create todo:', error);
      throw error;
    }
  });

  document.getElementById(NEW_PROJECT_FORM_ID).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('project-name').value;
    const description = document.getElementById('project-description').value;

    try {
      const response = await fetch(API_ENDPOINT_PROJECTS, {
        method: HTTP_METHOD_POST,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
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
        document.getElementById(NEW_PROJECT_FORM_ID).reset();
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      throw error;
    }
  });

  document.getElementById(NEW_INITIATIVE_FORM_ID).addEventListener('submit', async (e) => {
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
      const response = await fetch(API_ENDPOINT_INITIATIVES, {
        method: HTTP_METHOD_POST,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
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
        document.getElementById(NEW_INITIATIVE_FORM_ID).reset();
        document.querySelectorAll('#project-multi-select .multi-select-item').forEach(item => {
          item.classList.remove('selected');
        });
      }
    } catch (error) {
      console.error('Failed to create initiative:', error);
      throw error;
    }
  });

  document.getElementById('close-detail-btn').addEventListener('click', closeDetailPanel);

  document.getElementById('notifications-btn').addEventListener('click', toggleNotificationsPanel);
}

function toggleNotificationsPanel() {
  const list = document.getElementById(NOTIFICATIONS_LIST_ID);
  list.style.display = list.style.display === DISPLAY_NONE ? 'block' : 'none';
}

function closeNotificationsPanel() {
  document.getElementById(NOTIFICATIONS_LIST_ID).style.display = DISPLAY_NONE;
}

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
  const select = document.getElementById(ASSIGNEE_SELECT_ID);
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
      method: HTTP_METHOD_PUT,
      headers: {
        [AUTH_HEADER_KEY]: `Bearer ${token}`,
        [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
      },
      body: JSON.stringify({ status: STATUS_DONE })
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
      method: HTTP_METHOD_PUT,
      headers: {
        [AUTH_HEADER_KEY]: `Bearer ${token}`,
        [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
      },
      body: JSON.stringify({ status: STATUS_OPEN })
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
    throw error;
  }
}

async function archiveTodo(todoId) {
  try {
    const response = await fetch(`/todos/${todoId}`, {
      method: HTTP_METHOD_DELETE,
      headers: getAuthHeader()
    });

    if (response.ok) {
      allTodos = allTodos.filter(t => t.id !== todoId);
      renderTodosList();
      closeDetailPanel();
    }
  } catch (error) {
    console.error('Failed to archive todo:', error);
    throw error;
  }
}

async function deleteProject(projectId) {
  if (!confirm('Delete this project?')) return;

  try {
    const response = await fetch(`/projects/${projectId}`, {
      method: HTTP_METHOD_DELETE,
      headers: getAuthHeader()
    });

    if (response.ok) {
      allProjects = allProjects.filter(p => p.id !== projectId);
      populateProjectSwitcher();
      populateProjectMultiSelect();
      renderProjectsList();
    }
  } catch (error) {
    console.error('Failed to delete project:', error);
    throw error;
  }
}

async function deleteInitiative(initiativeId) {
  if (!confirm('Delete this initiative?')) return;

  try {
    const response = await fetch(`/initiatives/${initiativeId}`, {
      method: HTTP_METHOD_DELETE,
      headers: getAuthHeader()
    });

    if (response.ok) {
      allInitiatives = allInitiatives.filter(i => i.id !== initiativeId);
      renderInitiativesList();
    }
  } catch (error) {
    console.error('Failed to delete initiative:', error);
    throw error;
  }
}

async function openTodoDetail(todoId) {
  try {
    const response = await fetch(`/todos/${todoId}`, {
      headers: getAuthHeader()
    });

    if (response.ok) {
      selectedTodo = await response.json();
      renderDetailPanel();
      document.getElementById(DETAIL_PANEL_ID).style.display = DISPLAY_BLOCK;
      document.getElementById(DETAIL_PANEL_ID).classList.add('open');
    }
  } catch (error) {
    console.error('Failed to load todo detail:', error);
  }
}

function closeDetailPanel() {
  document.getElementById(DETAIL_PANEL_ID).style.display = DISPLAY_NONE;
  selectedTodo = null;
}

function renderDetailPanel() {
  if (!selectedTodo) return;

  document.getElementById(DETAIL_TITLE_ID).textContent = escapeHtml(selectedTodo.title);
  document.getElementById(DETAIL_DESCRIPTION_ID).textContent = selectedTodo.description || '(no description)';
  document.getElementById(DETAIL_STATUS_ID).value = selectedTodo.status === STATUS_OPEN ? STATUS_OPEN : STATUS_DONE;
  document.getElementById(DETAIL_PRIORITY_ID).value = selectedTodo.priority;
  document.getElementById(DETAIL_DUE_DATE_ID).value = selectedTodo.due_date || '';

  if (selectedTodo.initiative) {
    document.getElementById(INITIATIVE_SECTION_ID).style.display = DISPLAY_BLOCK;
    document.getElementById(DETAIL_INITIATIVE_ID).textContent = escapeHtml(selectedTodo.initiative.name);
  } else {
    document.getElementById(INITIATIVE_SECTION_ID).style.display = DISPLAY_NONE;
  }

  if (selectedTodo.status === STATUS_DONE) {
    document.getElementById(COMPLETE_BTN_ID).style.display = DISPLAY_NONE;
    document.getElementById(REOPEN_BTN_ID).style.display = DISPLAY_BLOCK;
  } else {
    document.getElementById(COMPLETE_BTN_ID).style.display = DISPLAY_BLOCK;
    document.getElementById(REOPEN_BTN_ID).style.display = DISPLAY_NONE;
  }

  const assigneesContainer = document.getElementById(DETAIL_ASSIGNEES_ID);
  assigneesContainer.innerHTML = '';
  if (selectedTodo.assignees && selectedTodo.assignees.length > 0) {
    selectedTodo.assignees.forEach(assignee => {
      const badge = document.createElement('div');
      badge.className = CSS_CLASS_ASSIGNEE_BADGE;
      badge.innerHTML = `
        ${escapeHtml(assignee.username)}
        <button class="remove-assignee" onclick="removeAssignee(${assignee.id})">×</button>
      `;
      assigneesContainer.appendChild(badge);
    });
  }

  const commentsContainer = document.getElementById(DETAIL_COMMENTS_ID);
  commentsContainer.innerHTML = '';
  if (selectedTodo.comments && selectedTodo.comments.length > 0) {
    selectedTodo.comments.forEach(comment => {
      const commentDiv = document.createElement('div');
      commentDiv.className = CSS_CLASS_COMMENT;
      commentDiv.innerHTML = `
        <div class="comment-author">${escapeHtml(comment.username)}</div>
        <div class="comment-body">${escapeHtml(comment.body)}</div>
      `;
      commentsContainer.appendChild(commentDiv);
    });
  }

  const relationsContainer = document.getElementById(DETAIL_RELATIONS_ID);
  relationsContainer.innerHTML = '';
  if (selectedTodo.relations) {
    const { parent, children, siblings } = selectedTodo.relations;
    if (parent) {
      const item = document.createElement('div');
      item.className = CSS_CLASS_RELATION_ITEM;
      item.innerHTML = `<span class="relation-label">Parent:</span> ${escapeHtml(parent.title)} (#${parent.id})`;
      relationsContainer.appendChild(item);
    }
    if (children && children.length > 0) {
      const item = document.createElement('div');
      item.className = CSS_CLASS_RELATION_ITEM;
      item.innerHTML = `<span class="relation-label">Children:</span> ${children.map(c => `${escapeHtml(c.title)} (#${c.id})`).join(', ')}`;
      relationsContainer.appendChild(item);
    }
    if (siblings && siblings.length > 0) {
      const item = document.createElement('div');
      item.className = CSS_CLASS_RELATION_ITEM;
      item.innerHTML = `<span class="relation-label">Siblings:</span> ${siblings.map(s => `${escapeHtml(s.title)} (#${s.id})`).join(', ')}`;
      relationsContainer.appendChild(item);
    }
  }

  const blockersContainer = document.getElementById(DETAIL_BLOCKERS_ID);
  blockersContainer.innerHTML = '';
  if (selectedTodo.blocked_by && selectedTodo.blocked_by.length > 0) {
    selectedTodo.blocked_by.forEach(blocker => {
      const item = document.createElement('div');
      item.className = CSS_CLASS_BLOCKER_ITEM;
      item.innerHTML = `
        <span>${escapeHtml(blocker.title)} (#${blocker.id})</span>
        <button class="remove-blocker" onclick="removeBlocker(${blocker.id})">×</button>
      `;
      blockersContainer.appendChild(item);
    });
  }

  setupDetailPanelListeners();
}

function setupDetailPanelListeners() {
  document.getElementById(DETAIL_STATUS_ID).addEventListener('change', async (e) => {
    try {
      const response = await fetch(`/todos/${selectedTodo.id}`, {
        method: HTTP_METHOD_PUT,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
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
      throw error;
    }
  });

  document.getElementById('detail-priority').addEventListener('change', async (e) => {
    try {
      const response = await fetch(`/todos/${selectedTodo.id}`, {
        method: HTTP_METHOD_PUT,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
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
      throw error;
    }
  });

  document.getElementById('detail-due-date').addEventListener('change', async (e) => {
    try {
      const response = await fetch(`/todos/${selectedTodo.id}`, {
        method: HTTP_METHOD_PUT,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
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
      throw error;
    }
  });

  document.getElementById('add-assignee-btn').addEventListener('click', async () => {
    const userId = document.getElementById(ASSIGNEE_SELECT_ID).value;
    if (!userId) return;

    try {
      const response = await fetch(`/todos/${selectedTodo.id}/users`, {
        method: HTTP_METHOD_POST,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
        },
        body: JSON.stringify({ user_id: parseInt(userId) })
      });

      if (response.ok) {
        document.getElementById(ASSIGNEE_SELECT_ID).value = '';
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: getAuthHeader()
        });
        selectedTodo = await detailResponse.json();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to add assignee:', error);
      throw error;
    }
  });

  document.getElementById('add-comment-btn').addEventListener('click', async () => {
    const body = document.getElementById('comment-body').value;
    if (!body) return;

    try {
      const response = await fetch(`/todos/${selectedTodo.id}/comments`, {
        method: HTTP_METHOD_POST,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
        },
        body: JSON.stringify({ body })
      });

      if (response.ok) {
        document.getElementById('comment-body').value = '';
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: getAuthHeader()
        });
        selectedTodo = await detailResponse.json();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
      throw error;
    }
  });

  document.getElementById('add-blocker-btn').addEventListener('click', async () => {
    const blockerTodoId = parseInt(document.getElementById('blocker-todo-id').value);
    if (!blockerTodoId) return;

    try {
      const response = await fetch(`/todos/${selectedTodo.id}/blockers`, {
        method: HTTP_METHOD_POST,
        headers: {
          [AUTH_HEADER_KEY]: `Bearer ${token}`,
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON
        },
        body: JSON.stringify({ blocker_id: blockerTodoId })
      });

      if (response.ok) {
        document.getElementById('blocker-todo-id').value = '';
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: getAuthHeader()
        });
        selectedTodo = await detailResponse.json();
        renderDetailPanel();
      }
    } catch (error) {
      console.error('Failed to add blocker:', error);
      throw error;
    }
  });

  document.getElementById(COMPLETE_BTN_ID).addEventListener('click', async () => {
    await completeTodo(selectedTodo.id);
  });

  document.getElementById(REOPEN_BTN_ID).addEventListener('click', async () => {
    await reopenTodo(selectedTodo.id);
  });

  document.getElementById('archive-btn').addEventListener('click', async () => {
    await archiveTodo(selectedTodo.id);
  });
}

async function removeAssignee(userId) {
  try {
    const response = await fetch(`/todos/${selectedTodo.id}/users/${userId}`, {
      method: HTTP_METHOD_DELETE,
      headers: getAuthHeader()
    });

    if (response.ok) {
      const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
        headers: getAuthHeader()
      });
      selectedTodo = await detailResponse.json();
      renderDetailPanel();
    }
  } catch (error) {
    console.error('Failed to remove assignee:', error);
    throw error;
  }
}

async function removeBlocker(blockerTodoId) {
  try {
    const response = await fetch(`/todos/${selectedTodo.id}/blockers/${blockerTodoId}`, {
      method: HTTP_METHOD_DELETE,
      headers: getAuthHeader()
    });

    if (response.ok) {
      const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
        headers: getAuthHeader()
      });
      selectedTodo = await detailResponse.json();
      renderDetailPanel();
    }
  } catch (error) {
    console.error('Failed to remove blocker:', error);
    throw error;
  }
}

function setupRealTimeUpdates() {
  todosEventSource = new EventSource('http://localhost:4002/topics/todos/stream');
  todosEventSource.addEventListener('message', async (e) => {
    try {
      const data = JSON.parse(e.data);
      const todosParams = currentProjectId ? `?project_id=${currentProjectId}` : NO_PROJECT_QUERY;
      const response = await fetch(`/todos${todosParams}`, {
        headers: getAuthHeader()
      });
      allTodos = await response.json();
      renderTodosList();
      if (selectedTodo) {
        const detailResponse = await fetch(`/todos/${selectedTodo.id}`, {
          headers: getAuthHeader()
        });
        if (detailResponse.ok) {
          selectedTodo = await detailResponse.json();
          renderDetailPanel();
        }
      }
    } catch (error) {
      console.error('Error processing todos event:', error);
      throw error;
    }
  });

  initiativesEventSource = new EventSource('http://localhost:4002/topics/initiatives/stream');
  initiativesEventSource.addEventListener('message', async (e) => {
    try {
      const data = JSON.parse(e.data);
      // Reload initiatives on progress/completed events
      const response = await fetch(API_ENDPOINT_INITIATIVES, {
        headers: getAuthHeader()
      });
      allInitiatives = await response.json();
      renderInitiativesList();
    } catch (error) {
      console.error('Error processing initiatives event:', error);
      throw error;
    }
  });

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

})();
