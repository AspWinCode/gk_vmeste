(function () {
  var ROLE_LABEL = { EXECUTIVE: "Руководитель", ANALYST: "Аналитик", PROJECT_OFFICE: "Офис проекта", OPERATOR: "Оператор", ADMIN: "Администратор" };
  var ROLES = Object.keys(ROLE_LABEL);

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function renderProfile() {
    var user = Auth.getUser();
    if (!user) return;
    document.getElementById("profileName").textContent = user.name || "—";
    document.getElementById("profileEmail").textContent = user.email || "—";
    document.getElementById("profileRole").textContent = ROLE_LABEL[user.role] || user.role || "—";
  }

  document.getElementById("logoutBtn").addEventListener("click", function () {
    if (confirm("Выйти из системы?")) Auth.logout();
  });

  function syncThemeButtons() {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme-option]"), function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-theme-option") === current);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-theme-option]"), function (btn) {
    btn.addEventListener("click", function () {
      var theme = btn.getAttribute("data-theme-option");
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("vmeste-theme", theme);
      syncThemeButtons();
    });
  });
  syncThemeButtons();

  async function loadUsers() {
    var apiWarning = document.getElementById("apiWarning");
    try {
      var res = await Auth.apiFetch("/users");
      if (!res.ok) return;
      var users = await res.json();
      document.getElementById("usersTableBody").innerHTML = users
        .map(function (u) {
          var options = ROLES.map(function (r) { return '<option value="' + r + '"' + (r === u.role ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>"; }).join("");
          return (
            "<tr><td><strong>" + esc(u.name) + "</strong></td><td>" + esc(u.email) + '</td><td><select class="select" data-user-id="' + u.id + '" style="max-width:220px">' + options + "</select></td></tr>"
          );
        })
        .join("");
      Array.prototype.forEach.call(document.querySelectorAll("[data-user-id]"), function (select) {
        select.addEventListener("change", async function () {
          await Auth.apiFetch("/users/" + select.getAttribute("data-user-id") + "/role", { method: "PATCH", body: { role: select.value } });
        });
      });
    } catch (e) {
      if (apiWarning) {
        document.getElementById("apiWarningUrl").textContent = window.API_BASE;
        apiWarning.style.display = "block";
      }
    }
  }

  function renderNavToggles() {
    var container = document.getElementById("navTogglesList");
    if (!container || !window.Prefs) return;
    var hidden = Prefs.getHiddenNavIds();
    container.innerHTML = Prefs.NAV_ITEMS.map(function (item) {
      return (
        '<div class="toggle-row"><label for="nav-' + item.id + '">' + esc(item.label) + "</label>" +
        '<input type="checkbox" id="nav-' + item.id + '" data-nav-toggle="' + item.id + '"' +
        (hidden.indexOf(item.id) === -1 ? " checked" : "") + " /></div>"
      );
    }).join("");
    Array.prototype.forEach.call(container.querySelectorAll("[data-nav-toggle]"), function (cb) {
      cb.addEventListener("change", function () {
        var id = cb.getAttribute("data-nav-toggle");
        var current = Prefs.getHiddenNavIds();
        var pos = current.indexOf(id);
        if (cb.checked && pos !== -1) current.splice(pos, 1);
        if (!cb.checked && pos === -1) current.push(id);
        Prefs.setHiddenNavIds(current);
      });
    });
  }

  function renderWidgetToggles() {
    var container = document.getElementById("widgetTogglesList");
    if (!container || !window.Prefs) return;
    var prefs = Prefs.getDashboardPrefs();
    container.innerHTML = Prefs.DASHBOARD_WIDGETS.map(function (w) {
      return (
        '<div class="toggle-row"><label for="widget-' + w.id + '">' + esc(w.label) + "</label>" +
        '<input type="checkbox" id="widget-' + w.id + '" data-widget-toggle="' + w.id + '"' +
        (prefs.hidden.indexOf(w.id) === -1 ? " checked" : "") + " /></div>"
      );
    }).join("");
    Array.prototype.forEach.call(container.querySelectorAll("[data-widget-toggle]"), function (cb) {
      cb.addEventListener("change", function () {
        var id = cb.getAttribute("data-widget-toggle");
        var current = Prefs.getDashboardPrefs();
        var pos = current.hidden.indexOf(id);
        if (cb.checked && pos !== -1) current.hidden.splice(pos, 1);
        if (!cb.checked && pos === -1) current.hidden.push(id);
        Prefs.setDashboardPrefs(current);
      });
    });
  }

  renderProfile();
  loadUsers();
  renderNavToggles();
  renderWidgetToggles();
})();
