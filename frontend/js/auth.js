const API_BASE_URL = (window.__APP_CONFIG__ && window.__APP_CONFIG__.API_BASE_URL)
  || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://your-render-backend-url');
const AUTH_TOKEN_KEY = 'student_result_auth_token';

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders(includeContentType = true) {
  const headers = {};
  const token = getAuthToken();
  if (includeContentType) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function redirectIfNotAuthenticated() {
  if (!getAuthToken()) {
    window.location.href = 'index.html';
  }
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
