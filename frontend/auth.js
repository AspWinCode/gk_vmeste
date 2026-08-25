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

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // Колокольчик уведомлений — общий для всех защищённых страниц, монтируется здесь
  // одним местом вместо дублирования разметки/логики в каждом *.html.
  function mountNotifications() {
    var actions = document.querySelector(".top-actions");
    if (!actions || !getToken()) return;

    var wrap = document.createElement("div");
    wrap.style.position = "relative";
    wrap.innerHTML =
      '<button class="icon-btn" id="notifBellBtn" aria-label="Уведомления" style="position:relative">🔔' +
      '<span id="notifBadge" style="display:none;position:absolute;top:4px;right:4px;min-width:16px;height:16px;padding:0 3px;border-radius:999px;background:var(--color-red);color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:700"></span>' +
      "</button>" +
      '<div id="notifPanel" style="display:none;position:absolute;top:52px;right:0;width:340px;max-height:420px;overflow:auto;background:var(--color-surface);border:1px solid var(--color-border);border-radius:16px;box-shadow:var(--shadow-md);z-index:20;padding:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px 10px"><strong style="font-size:var(--text-sm)">Уведомления</strong><button id="notifMarkAllBtn" class="btn btn-secondary" style="min-height:32px;padding:0 10px;font-size:var(--text-xs)">Прочитать все</button></div>' +
      '<div id="notifList"></div>' +
      "</div>";
    actions.insertBefore(wrap, actions.firstChild);

    var bellBtn = document.getElementById("notifBellBtn");
    var panel = document.getElementById("notifPanel");
    var badge = document.getElementById("notifBadge");
    var list = document.getElementById("notifList");

    function renderList(items) {
      if (items.length === 0) {
        list.innerHTML = '<div class="footer-note" style="padding:8px">Уведомлений нет.</div>';
        return;
      }
      list.innerHTML = items
        .map(function (n) {
          return (
            '<div data-id="' + n.id + '" data-link="' + esc(n.link || "") + '" style="cursor:pointer;padding:10px 8px;border-radius:12px;margin-bottom:4px;background:' +
            (n.read ? "transparent" : "var(--color-surface-2)") + '">' +
            '<strong style="display:block;font-size:var(--text-sm)">' + esc(n.title) + "</strong>" +
            '<span style="display:block;font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px">' + esc(n.body) + "</span>" +
            '<span style="display:block;font-size:var(--text-xs);color:var(--color-text-faint);margin-top:4px">' + new Date(n.createdAt).toLocaleString("ru-RU") + "</span>" +
            "</div>"
          );
        })
        .join("");
      Array.prototype.forEach.call(list.querySelectorAll("[data-id]"), function (row) {
        row.addEventListener("click", async function () {
          await apiFetch("/notifications/" + row.getAttribute("data-id") + "/read", { method: "PATCH" });
          var link = row.getAttribute("data-link");
          if (link) window.location.href = link;
          refreshUnreadCount();
        });
      });
    }

    async function loadPanel() {
      var res = await apiFetch("/notifications");
      if (res.ok) renderList(await res.json());
    }

    async function refreshUnreadCount() {
      try {
        var res = await apiFetch("/notifications/unread-count");
        if (!res.ok) return;
        var data = await res.json();
        if (data.count > 0) {
          badge.textContent = data.count > 9 ? "9+" : String(data.count);
          badge.style.display = "block";
        } else {
          badge.style.display = "none";
        }
      } catch (e) {}
    }

    bellBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willShow = panel.style.display === "none";
      panel.style.display = willShow ? "block" : "none";
      if (willShow) loadPanel();
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) panel.style.display = "none";
    });
    document.getElementById("notifMarkAllBtn").addEventListener("click", async function (e) {
      e.stopPropagation();
      await apiFetch("/notifications/read-all", { method: "POST" });
      loadPanel();
      refreshUnreadCount();
    });

    refreshUnreadCount();
    setInterval(refreshUnreadCount, 30000);
  }

  window.Auth = {
    getToken: getToken,
    getUser: getUser,
    setSession: setSession,
    logout: logout,
    requireAuth: requireAuth,
    apiFetch: apiFetch,
  };

  // Общий ⌘K/Ctrl+K — просто ставит фокус в поле поиска на текущей странице.
  // Саму фильтрацию по вводу каждая страница делает своим скриптом (данные разные).
  function mountSearchShortcut() {
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        var input = document.getElementById("globalSearchInput");
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderUserBadge();
    mountNotifications();
    mountSearchShortcut();
  });
})();
