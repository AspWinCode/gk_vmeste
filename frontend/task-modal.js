// Общая карточка задачи/поручения — открывается по клику с любого экрана, где есть
// список задач (рабочий стол, Транскрибатор, страница "Задачи"). Один экземпляр модалки
// создаётся один раз и переиспользуется, чтобы не дублировать разметку на каждой странице.
// Подключать после auth.js (использует Auth.apiFetch) и ДО скрипта конкретной страницы.
(function () {
  var STATUS_LABEL = { OPEN: "открыта", IN_PROGRESS: "в работе", DONE: "выполнена", CANCELLED: "отменена" };
  var PRIORITY_LABEL = { LOW: "низкий", MEDIUM: "обычный", HIGH: "критичный" };

  var backdrop = null;
  var panel = null;
  var currentTaskId = null;
  var onChangeCallback = null;
  var usersCache = null;

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function toDateInputValue(iso) {
    if (!iso) return "";
    return new Date(iso).toISOString().slice(0, 10);
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function ensureDom() {
    if (backdrop) return;
    backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop task-modal-backdrop";
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });

    panel = document.createElement("div");
    panel.className = "task-modal panel";
    panel.innerHTML =
      '<div class="task-modal-head">' +
        '<input class="input task-modal-title" id="tmTitle" placeholder="Название задачи" />' +
        '<button type="button" class="icon-btn" id="tmCloseBtn" aria-label="Закрыть">✕</button>' +
      "</div>" +
      '<div class="task-modal-meta footer-note" id="tmMeta"></div>' +
      '<div class="form-grid" style="margin-top:14px">' +
        '<div class="field"><label>Исполнитель</label><select class="select" id="tmOwner"><option value="">Не назначен</option></select></div>' +
        '<div class="field"><label>Срок</label><input class="input" id="tmDueDate" type="date" /></div>' +
        '<div class="field"><label>Приоритет</label><select class="select" id="tmPriority"><option value="LOW">Низкий</option><option value="MEDIUM">Обычный</option><option value="HIGH">Критичный</option></select></div>' +
        '<div class="field"><label>Статус</label><select class="select" id="tmStatus"><option value="OPEN">Открыта</option><option value="IN_PROGRESS">В работе</option><option value="DONE">Выполнена</option><option value="CANCELLED">Отменена</option></select></div>' +
      "</div>" +
      '<div class="field" style="margin-top:14px"><label>Описание</label><textarea class="textarea" id="tmDescription" placeholder="Детали задачи..."></textarea></div>' +
      '<div class="hero-actions" style="margin-top:14px">' +
        '<button class="btn btn-primary" id="tmSaveBtn" type="button">Сохранить</button>' +
        '<button class="btn btn-secondary" id="tmDeleteBtn" type="button">Удалить</button>' +
      "</div>" +
      '<div id="tmError" class="footer-note" style="color:#9E3D3D;display:none;margin-top:8px"></div>' +
      '<div class="task-modal-comments">' +
        '<strong style="font-size:var(--text-sm)">Комментарии</strong>' +
        '<div class="stack" id="tmComments" style="margin-top:10px"></div>' +
        '<form id="tmCommentForm" style="display:flex;gap:8px;margin-top:10px">' +
          '<input class="input" id="tmCommentInput" placeholder="Добавить комментарий..." style="flex:1" />' +
          '<button class="btn btn-secondary" type="submit">Отправить</button>' +
        "</form>" +
      "</div>";

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    document.getElementById("tmCloseBtn").addEventListener("click", close);
    document.getElementById("tmSaveBtn").addEventListener("click", save);
    document.getElementById("tmDeleteBtn").addEventListener("click", remove);
    document.getElementById("tmCommentForm").addEventListener("submit", addComment);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && backdrop.classList.contains("is-visible")) close();
    });
  }

  async function loadUsersOnce() {
    if (usersCache) return usersCache;
    try {
      var res = await Auth.apiFetch("/users");
      usersCache = res.ok ? await res.json() : [];
    } catch (e) {
      usersCache = [];
    }
    return usersCache;
  }

  function renderComments(comments) {
    var el = document.getElementById("tmComments");
    el.innerHTML = (comments && comments.length > 0)
      ? comments.map(function (c) {
          return (
            '<div class="row-card" style="display:block"><strong style="font-size:var(--text-xs)">' +
            esc(c.author ? c.author.name : "Без автора") + "</strong> <span class=\"footer-note\" style=\"display:inline\">" +
            formatDateTime(c.createdAt) + "</span><div style=\"margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere\">" +
            esc(c.body) + "</div></div>"
          );
        }).join("")
      : '<div class="footer-note">Комментариев пока нет.</div>';
  }

  async function open(taskId, onChange) {
    ensureDom();
    currentTaskId = taskId;
    onChangeCallback = onChange || null;
    backdrop.classList.add("is-visible");
    document.body.style.overflow = "hidden";
    document.getElementById("tmError").style.display = "none";

    var users = await loadUsersOnce();
    var ownerSelect = document.getElementById("tmOwner");
    ownerSelect.innerHTML = '<option value="">Не назначен</option>' +
      users.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + "</option>"; }).join("");

    var res = await Auth.apiFetch("/tasks/" + taskId);
    if (!res.ok) {
      document.getElementById("tmError").textContent = "Не удалось загрузить задачу";
      document.getElementById("tmError").style.display = "block";
      return;
    }
    var task = await res.json();

    document.getElementById("tmTitle").value = task.title || "";
    document.getElementById("tmOwner").value = task.ownerId || "";
    document.getElementById("tmDueDate").value = toDateInputValue(task.dueDate);
    document.getElementById("tmPriority").value = task.priority || "MEDIUM";
    document.getElementById("tmStatus").value = task.status || "OPEN";
    document.getElementById("tmDescription").value = task.description || "";

    var metaParts = [];
    if (task.kind === "REMINDER") metaParts.push("личное напоминание");
    if (task.project && task.project.name) metaParts.push("проект: " + task.project.name);
    if (task.createdBy && task.createdBy.name) metaParts.push("поставил: " + task.createdBy.name);
    if (task.source && task.source.indexOf("transcriber:") === 0) metaParts.push("из расшифровки");
    if (task.source && task.source.indexOf("mail:") === 0) metaParts.push("из письма");
    document.getElementById("tmMeta").textContent = metaParts.join(" · ") || "Создано вручную";

    renderComments(task.comments);
  }

  function close() {
    if (!backdrop) return;
    backdrop.classList.remove("is-visible");
    document.body.style.overflow = "";
    currentTaskId = null;
  }

  async function save() {
    var errorBox = document.getElementById("tmError");
    errorBox.style.display = "none";
    var dueDateVal = document.getElementById("tmDueDate").value;
    var payload = {
      title: document.getElementById("tmTitle").value.trim(),
      description: document.getElementById("tmDescription").value.trim() || null,
      ownerId: document.getElementById("tmOwner").value || null,
      // Дата без времени — храним и парсим как UTC-полночь (T00:00:00Z), иначе в часовых
      // поясах восточнее UTC локальная полночь при сохранении сдвигается на предыдущий
      // день при обратном чтении через toISOString().slice(0,10) в toDateInputValue().
      dueDate: dueDateVal ? new Date(dueDateVal + "T00:00:00Z").toISOString() : null,
      priority: document.getElementById("tmPriority").value,
      status: document.getElementById("tmStatus").value,
    };
    try {
      var res = await Auth.apiFetch("/tasks/" + currentTaskId, { method: "PATCH", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось сохранить");
      if (onChangeCallback) onChangeCallback();
      close();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  }

  async function remove() {
    if (!confirm("Удалить эту задачу?")) return;
    await Auth.apiFetch("/tasks/" + currentTaskId, { method: "DELETE" });
    if (onChangeCallback) onChangeCallback();
    close();
  }

  async function addComment(e) {
    e.preventDefault();
    var input = document.getElementById("tmCommentInput");
    var body = input.value.trim();
    if (!body) return;
    var res = await Auth.apiFetch("/tasks/" + currentTaskId + "/comments", { method: "POST", body: { body: body } });
    if (res.ok) {
      input.value = "";
      var res2 = await Auth.apiFetch("/tasks/" + currentTaskId);
      if (res2.ok) renderComments((await res2.json()).comments);
    }
  }

  window.TaskModal = { open: open, close: close };
})();
