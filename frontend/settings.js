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

  renderProfile();
  loadUsers();
})();
