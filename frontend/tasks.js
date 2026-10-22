(function () {
  var state = { kind: "TASK", period: "", query: "", tasks: [], expandAll: false };

  var STATUS_LABEL = { OPEN: "открыта", IN_PROGRESS: "в работе", DONE: "выполнена", CANCELLED: "отменена" };
  var STATUS_CLASS = { OPEN: "status-wait", IN_PROGRESS: "status-wait", DONE: "status-ok", CANCELLED: "status-risk" };
  var PRIORITY_LABEL = { LOW: "низкий", MEDIUM: "обычный", HIGH: "критичный" };

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

  // Дата-строка в UTC (как хранится dueDate — см. комментарий в task-modal.js про
  // T00:00:00Z), чтобы "сегодня/неделя" совпадали с тем, что реально записано в БД.
  function todayUtcStr() {
    return new Date().toISOString().slice(0, 10);
  }
  function addDaysUtcStr(days) {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function matchesPeriod(task) {
    if (state.period === "critical") return task.priority === "HIGH";
    if (!task.dueDate) return state.period === "";
    var due = task.dueDate.slice(0, 10);
    if (state.period === "today") return due === todayUtcStr();
    if (state.period === "week") return due >= todayUtcStr() && due <= addDaysUtcStr(7);
    return true;
  }

  function matchesQuery(task) {
    if (!state.query) return true;
    return (task.title + " " + (task.description || "")).toLowerCase().indexOf(state.query) !== -1;
  }

  function formatDue(iso) {
    if (!iso) return "без срока";
    var d = new Date(iso);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  }

  async function fetchTasks() {
    try {
      var params = "?kind=" + state.kind + (state.kind === "REMINDER" ? "&mine=true" : "");
      var res = await Auth.apiFetch("/tasks" + params);
      if (!res.ok) throw new Error("bad status " + res.status);
      state.tasks = await res.json();
      showApiWarning(false);
    } catch (err) {
      showApiWarning(true);
      return;
    }
    renderStats();
    renderList();
  }

  function renderStats() {
    document.getElementById("statTotal").textContent = state.tasks.length;
    document.getElementById("statToday").textContent = state.tasks.filter(function (t) { return t.dueDate && t.dueDate.slice(0, 10) === todayUtcStr(); }).length;
    document.getElementById("statCritical").textContent = state.tasks.filter(function (t) { return t.priority === "HIGH"; }).length;
  }

  function taskCardHtml(t) {
    var statusClass = STATUS_CLASS[t.status] || "status-wait";
    var priorityChip = t.priority === "HIGH" ? '<span class="status-chip status-risk">критично</span>' : "";
    var meta = [];
    if (t.project && t.project.name) meta.push("проект: " + esc(t.project.name));
    if (t.owner && t.owner.name) meta.push("исполнитель: " + esc(t.owner.name));
    meta.push("срок: " + formatDue(t.dueDate));
    var commentsCount = t._count ? t._count.comments : 0;

    return (
      '<details class="transcript-card task-details" data-task-id="' + t.id + '">' +
        '<summary>' +
          '<strong>' + esc(t.title) + "</strong> " +
          '<span class="status-chip ' + statusClass + '">' + STATUS_LABEL[t.status] + "</span> " +
          priorityChip +
          '<span class="footer-note" style="display:inline">' + meta.join(" · ") + "</span>" +
        "</summary>" +
        '<div style="margin-top:12px">' +
          (t.description ? '<p style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(t.description) + "</p>" : '<p class="footer-note">Без описания.</p>') +
          '<div class="footer-note">Комментариев: ' + commentsCount + (t.createdBy && t.createdBy.name ? " · поставил: " + esc(t.createdBy.name) : "") + "</div>" +
          '<div class="hero-actions" style="margin-top:10px"><button type="button" class="btn btn-secondary open-task-btn" data-task-id="' + t.id + '">Открыть карточку</button></div>' +
        "</div>" +
      "</details>"
    );
  }

  function renderList() {
    var el = document.getElementById("tasksList");
    var visible = state.tasks.filter(matchesPeriod).filter(matchesQuery);
    document.getElementById("listSubtitle").textContent =
      state.kind === "REMINDER" ? "Ваши личные напоминания" : "Поручения команды";

    if (visible.length === 0) {
      el.innerHTML = '<div class="footer-note">Ничего не найдено по текущим фильтрам.</div>';
      return;
    }
    el.innerHTML = visible.map(taskCardHtml).join("");

    Array.prototype.forEach.call(el.querySelectorAll("details"), function (d) { d.open = state.expandAll; });
    Array.prototype.forEach.call(el.querySelectorAll(".open-task-btn"), function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        TaskModal.open(btn.getAttribute("data-task-id"), fetchTasks);
      });
    });
  }

  document.getElementById("toggleExpandAllBtn").addEventListener("click", function (e) {
    state.expandAll = !state.expandAll;
    e.target.textContent = state.expandAll ? "Свернуть все" : "Развернуть все";
    Array.prototype.forEach.call(document.querySelectorAll("#tasksList details"), function (d) { d.open = state.expandAll; });
  });

  Array.prototype.forEach.call(document.querySelectorAll("#kindFilters .filter"), function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#kindFilters .filter").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      state.kind = btn.getAttribute("data-kind");
      fetchTasks();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("#periodFilters .filter"), function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#periodFilters .filter").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      state.period = btn.getAttribute("data-period");
      renderList();
    });
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    renderList();
  });

  // --- Формы добавления ---

  async function loadOwnerOptions() {
    var select = document.getElementById("newTaskOwner");
    try {
      var res = await Auth.apiFetch("/users");
      if (!res.ok) return;
      var users = await res.json();
      select.innerHTML = '<option value="">Не назначен</option>' +
        users.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + "</option>"; }).join("");
    } catch (e) {}
  }

  document.getElementById("toggleAddTaskBtn").addEventListener("click", function () {
    var panel = document.getElementById("addTaskPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    document.getElementById("addReminderPanel").style.display = "none";
  });

  document.getElementById("toggleAddReminderBtn").addEventListener("click", function () {
    var panel = document.getElementById("addReminderPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
    document.getElementById("addTaskPanel").style.display = "none";
  });

  document.getElementById("addTaskForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("addTaskError");
    errorBox.style.display = "none";
    var dueDateVal = document.getElementById("newTaskDueDate").value;
    var payload = {
      title: document.getElementById("newTaskTitle").value.trim(),
      description: document.getElementById("newTaskDescription").value.trim() || undefined,
      dueDate: dueDateVal ? new Date(dueDateVal + "T00:00:00Z").toISOString() : undefined,
      priority: document.getElementById("newTaskPriority").value,
      ownerId: document.getElementById("newTaskOwner").value || undefined,
      source: "manual",
      kind: "TASK",
    };
    try {
      var res = await Auth.apiFetch("/tasks", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось добавить задачу");
      e.target.reset();
      document.getElementById("addTaskPanel").style.display = "none";
      if (state.kind === "TASK") fetchTasks();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  document.getElementById("addReminderForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("addReminderError");
    errorBox.style.display = "none";
    var dueDateVal = document.getElementById("newReminderDueDate").value;
    var payload = {
      title: document.getElementById("newReminderTitle").value.trim(),
      dueDate: dueDateVal ? new Date(dueDateVal + "T00:00:00Z").toISOString() : undefined,
      kind: "REMINDER",
      source: "manual",
    };
    try {
      var res = await Auth.apiFetch("/tasks", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось добавить напоминание");
      e.target.reset();
      document.getElementById("addReminderPanel").style.display = "none";
      if (state.kind === "REMINDER") fetchTasks();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  loadOwnerOptions();
  fetchTasks();
})();
