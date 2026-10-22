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

  function formatTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  async function loadContacts() {
    var tbody = document.getElementById("contactsTableBody");
    try {
      var res = await Auth.apiFetch("/contacts");
      if (!res.ok) return;
      var contacts = await res.json();
      if (contacts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="footer-note">Справочник пока пуст.</td></tr>';
        return;
      }
      tbody.innerHTML = contacts
        .map(function (c) {
          return (
            "<tr><td><strong>" + esc(c.fullName) + "</strong></td><td>" + esc(c.position || "—") + "</td><td>" + esc(c.email) +
            '</td><td><button type="button" class="btn btn-secondary" data-delete-contact="' + c.id + '" style="min-height:32px;padding:0 12px">Удалить</button></td></tr>'
          );
        })
        .join("");
      Array.prototype.forEach.call(tbody.querySelectorAll("[data-delete-contact]"), function (btn) {
        btn.addEventListener("click", async function () {
          if (!confirm("Удалить контакт из справочника?")) return;
          await Auth.apiFetch("/contacts/" + btn.getAttribute("data-delete-contact"), { method: "DELETE" });
          loadContacts();
        });
      });
    } catch (e) {}
  }

  var addContactForm = document.getElementById("addContactForm");
  if (addContactForm) {
    addContactForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var errorBox = document.getElementById("contactFormError");
      errorBox.style.display = "none";
      var payload = {
        fullName: document.getElementById("contactFullName").value.trim(),
        position: document.getElementById("contactPosition").value.trim() || undefined,
        email: document.getElementById("contactEmail").value.trim(),
      };
      try {
        var res = await Auth.apiFetch("/contacts", { method: "POST", body: payload });
        var data = await res.json();
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось добавить контакт");
        addContactForm.reset();
        loadContacts();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = "block";
      }
    });
  }

  var MEETING_LABEL = { QUEUED: "в очереди", TRANSCRIBING: "распознавание речи", SUMMARIZING: "анализ Claude", DONE: "готово", FAILED: "ошибка" };

  async function loadTranscripts() {
    var container = document.getElementById("transcriptsList");
    if (!container) return;
    try {
      var res = await Auth.apiFetch("/transcriber/jobs");
      if (!res.ok) return;
      var jobs = await res.json();
      if (jobs.length === 0) {
        container.innerHTML = '<div class="footer-note">Пока нет ни одной обработанной записи.</div>';
        return;
      }
      container.innerHTML = jobs
        .map(function (j) {
          var len = (j.transcriptText || "").length;
          var lenNote = len > 0 ? "(" + len.toLocaleString("ru-RU") + " символов)" : "";
          var body = j.transcriptText
            ? '<span style="white-space:pre-wrap;overflow-wrap:anywhere;display:block;margin-top:12px">' + esc(j.transcriptText) + "</span>"
            : '<div class="footer-note" style="margin-top:12px">' + (j.status === "FAILED" ? "Обработка завершилась ошибкой." : "Расшифровка ещё не готова — статус: " + (MEETING_LABEL[j.status] || j.status) + ".") + "</div>";
          return (
            '<div class="transcript-card"><details>' +
            "<summary><strong>" + esc(j.audioFileName) + "</strong> <span class=\"footer-note\">" +
            esc(j.meetingType || "Аудио") + " · " + formatTime(j.createdAt) + " " + lenNote + "</span></summary>" +
            body +
            "</details></div>"
          );
        })
        .join("");
    } catch (e) {}
  }

  renderProfile();
  loadUsers();
  renderNavToggles();
  renderWidgetToggles();
  loadContacts();
  loadTranscripts();
})();
