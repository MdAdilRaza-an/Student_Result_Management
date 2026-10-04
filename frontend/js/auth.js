const API_BASE_URL = (window.__APP_CONFIG__ && window.__APP_CONFIG__.API_BASE_URL)
  || 'https://student-result-management-27s0.onrender.com';
const AUTH_TOKEN_KEY = 'student_result_auth_token';

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem('student_result_user');
  localStorage.removeItem('student_result_admin');
}

function setAuthUser(user) {
  if (user) {
    localStorage.setItem('student_result_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('student_result_user');
  }
}

function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem('student_result_user') || '{}');
  } catch (error) {
    return {};
  }
}

function authHeaders(includeContentType = true) {
  const headers = {};
  const token = getAuthToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function redirectIfNotAuthenticated({ role = null, loginPage = 'index.html' } = {}) {
  const token = getAuthToken();
  const user = getAuthUser();

  if (!token) {
    window.location.href = loginPage;
    return false;
  }

  if (role && user.role !== role) {
    if (role === 'ADMIN') {
      clearAuthToken();
      window.location.href = 'index.html';
      return false;
    }

    if (role === 'STUDENT') {
      clearAuthToken();
      window.location.href = 'student-login.html';
      return false;
    }
  }

  return true;
}

function setMessage(el, message, type = 'error') {
  if (!el) return;
  el.textContent = message;
  el.className = `message ${type}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      ...authHeaders(Boolean(options.body)),
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Request failed.');
  return payload;
}
