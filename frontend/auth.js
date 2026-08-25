// Общий модуль авторизации для всех защищённых страниц. Подключается после config.js.
(function () {
  var TOKEN_KEY = "vmeste-token";
  var USER_KEY = "vmeste-user";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.location.href = "login.html";
  }

  // Вызывать в начале каждой защищённой страницы: без токена — редирект на логин.
  function requireAuth() {
    if (!getToken()) {
      window.location.href = "login.html";
      return false;
    }
    return true;
  }

  // Обёртка над fetch: подставляет базовый адрес API и Bearer-токен,
  // при 401 разлогинивает и уводит на экран входа.
  async function apiFetch(path, options) {
    options = options || {};
    var headers = options.headers || {};
    var token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    if (!(options.body instanceof FormData) && options.body && typeof options.body !== "string") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    var res = await fetch(window.API_BASE + path, Object.assign({}, options, { headers: headers }));
    if (res.status === 401) {
      logout();
      throw new Error("Не авторизован");
    }
    return res;
  }

  function renderUserBadge() {
    var el = document.querySelector(".avatar");
    var user = getUser();
    if (el && user) {
      el.textContent = user.name;
      el.style.cursor = "pointer";
      el.title = "Выйти (" + user.email + ")";
      el.addEventListener("click", function () {
        if (confirm("Выйти из системы?")) logout();
      });
    }
  }

  window.Auth = {
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    logout: logout,
    requireAuth: requireAuth,
    apiFetch: apiFetch,
  };

  document.addEventListener("DOMContentLoaded", renderUserBadge);
})();
