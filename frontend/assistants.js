(function () {
  var PAGE_MAP = {
    TRANSCRIBER: "transcriber.html",
    FINANCE_ANALYST: "finance.html",
    KSG_CONTROL: "ksg.html",
    LAND_SEARCH: "land.html",
    SUPPORT_MONITOR: "support.html",
    FINANCE_MONITOR: "finance-monitor.html",
    MAIL_PARSER: "mail.html",
  };
  var ICON_MAP = {
    TRANSCRIBER: { letter: "Т", color: "#003DA5" },
    PLANNER: { letter: "П", color: "#00ACA0" },
    FINANCE_ANALYST: { letter: "Ф", color: "#005151" },
    KSG_CONTROL: { letter: "К", color: "#003DA5" },
    LAND_SEARCH: { letter: "З", color: "#002D72" },
    SUPPORT_MONITOR: { letter: "Л", color: "#00ACA0" },
    FINANCE_MONITOR: { letter: "D", color: "#003DA5" },
    SMM_TELEGRAM: { letter: "С", color: "#005151" },
    SMM_INSTAGRAM: { letter: "А", color: "#F2CA00" },
    MAIL_PARSER: { letter: "П", color: "#002D72" },
  };
  var STATUS_LABEL = { ACTIVE: "активен", SETUP: "настройка", NEW: "новый" };
  var STATUS_CLASS = { ACTIVE: "status-ok", SETUP: "status-wait", NEW: "status-new" };

  var state = { assistants: [], tagFilter: "", statusFilter: "" };

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }
  function showApiWarning(show) {
    var box = document.getElementById("apiWarning");
    document.getElementById("apiWarningUrl").textContent = window.API_BASE;
    box.style.display = show ? "block" : "none";
  }

  async function loadAssistants() {
    try {
      var res = await Auth.apiFetch("/assistants");
      if (!res.ok) throw new Error("bad status");
      state.assistants = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }
    renderStats();
    renderFilters();
    renderGrid();
    renderSetupList();
  }

  function renderStats() {
    document.getElementById("statTotal").textContent = state.assistants.length;
    document.getElementById("statActive").textContent = state.assistants.filter(function (a) { return a.status === "ACTIVE"; }).length;
    document.getElementById("statSetup").textContent = state.assistants.filter(function (a) { return a.status === "SETUP"; }).length;
  }

  function renderFilters() {
    var tags = Array.from(new Set(state.assistants.reduce(function (acc, a) { return acc.concat(a.tags); }, [])));
    var tagEl = document.getElementById("tagFilters");
    tagEl.innerHTML = ['<button class="chip' + (state.tagFilter === "" ? " active" : "") + '" data-tag="">Все</button>']
      .concat(tags.map(function (t) { return '<button class="chip' + (state.tagFilter === t ? " active" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>"; }))
      .join("");
    Array.prototype.forEach.call(tagEl.querySelectorAll("[data-tag]"), function (btn) {
      btn.addEventListener("click", function () { state.tagFilter = btn.getAttribute("data-tag"); renderFilters(); renderGrid(); });
    });

    var statusEl = document.getElementById("statusFilters");
    var statuses = [["", "Все статусы"], ["ACTIVE", "Активные"], ["SETUP", "Требуют настройки"], ["NEW", "Новые"]];
    statusEl.innerHTML = statuses
      .map(function (s) { return '<button class="chip' + (state.statusFilter === s[0] ? " active" : "") + '" data-status="' + s[0] + '">' + s[1] + "</button>"; })
      .join("");
    Array.prototype.forEach.call(statusEl.querySelectorAll("[data-status]"), function (btn) {
      btn.addEventListener("click", function () { state.statusFilter = btn.getAttribute("data-status"); renderFilters(); renderGrid(); });
    });
  }

  function renderGrid() {
    var filtered = state.assistants.filter(function (a) {
      if (state.tagFilter && a.tags.indexOf(state.tagFilter) === -1) return false;
      if (state.statusFilter && a.status !== state.statusFilter) return false;
      return true;
    });

    var el = document.getElementById("assistantGrid");
    if (filtered.length === 0) {
      el.innerHTML = '<div class="footer-note">Ничего не найдено по текущим фильтрам.</div>';
      return;
    }
    el.innerHTML = filtered
      .map(function (a) {
        var icon = ICON_MAP[a.key] || { letter: a.name[0], color: "#005151" };
        var href = PAGE_MAP[a.key];
        var tag = href ? "a" : "article";
        var hrefAttr = href ? ' href="' + href + '" style="color:inherit"' : "";
        return (
          "<" + tag + ' class="assistant-tile"' + hrefAttr + ">" +
          '<div class="assistant-top"><div class="assistant-icon" style="background:' + icon.color + '">' + icon.letter + '</div>' +
          '<div class="status-chip ' + STATUS_CLASS[a.status] + '">' + STATUS_LABEL[a.status] + "</div></div>" +
          "<div><h3>" + esc(a.name) + "</h3><p>" + esc(a.description) + "</p></div>" +
          '<div class="tags">' + a.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>" +
          '<div class="assistant-meta"><div class="meta-box"><span>Вход</span><strong>' + esc(a.inputHint) + '</strong></div>' +
          '<div class="meta-box"><span>Результат</span><strong>' + esc(a.outputHint) + "</strong></div></div>" +
          "</" + tag + ">"
        );
      })
      .join("");
  }

  function renderSetupList() {
    var needsSetup = state.assistants.filter(function (a) { return a.status !== "ACTIVE"; });
    var el = document.getElementById("setupList");
    el.innerHTML = needsSetup.length
      ? needsSetup
          .map(function (a) {
            return (
              '<div class="list-item"><div><strong>' + esc(a.name) + "</strong><span>" + esc(a.description) +
              '</span></div><span class="status-chip ' + STATUS_CLASS[a.status] + '">' + STATUS_LABEL[a.status] + "</span></div>"
            );
          })
          .join("")
      : '<div class="footer-note">Все ассистенты в каталоге активны.</div>';
  }

  document.getElementById("toggleAddAssistantBtn").addEventListener("click", function () {
    var panel = document.getElementById("addAssistantPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    if (panel.style.display === "block") panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("addAssistantForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("addAssistantError");
    errorBox.style.display = "none";
    var payload = {
      name: document.getElementById("newAssistantName").value,
      description: document.getElementById("newAssistantDescription").value,
      inputHint: document.getElementById("newAssistantInput").value,
      outputHint: document.getElementById("newAssistantOutput").value,
      tags: document.getElementById("newAssistantTags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
    };
    try {
      var res = await Auth.apiFetch("/assistants", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error) || "Не удалось добавить ассистента");
      e.target.reset();
      document.getElementById("addAssistantPanel").style.display = "none";
      await loadAssistants();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  var ROLE_LABEL = { EXECUTIVE: "Руководитель", ANALYST: "Аналитик", PROJECT_OFFICE: "Офис проекта", OPERATOR: "Оператор", ADMIN: "Администратор" };
  var ROLES = Object.keys(ROLE_LABEL);

  document.getElementById("toggleRolesBtn").addEventListener("click", function () {
    var panel = document.getElementById("rolesPanel");
    var willShow = panel.style.display === "none";
    panel.style.display = willShow ? "block" : "none";
    if (willShow) {
      loadUsers();
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  async function loadUsers() {
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
  }

  loadAssistants();
})();
