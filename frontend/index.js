(function () {
  var esc = window.escHtml; // общий хелпер, см. util.js
  function fmtMoney(v) {
    if (v === null || v === undefined) return "—";
    var abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(".", ",") + " млрд ₽";
    if (abs >= 1e6) return Math.round(v / 1e6) + " млн ₽";
    return Math.round(v) + " ₽";
  }
  function fmtPercent(v) {
    if (v === null || v === undefined) return "—";
    return (v * 100).toFixed(1).replace(".", ",") + "%";
  }
  function fmtDue(iso) {
    if (!iso) return "без срока";
    var d = new Date(iso);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    return (sameDay ? "сегодня" : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })) +
      " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  function daysFromNow(iso) {
    return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  }

  // Группировка "Дальше по срокам" по дню — Сегодня/Завтра/дата, как в макете.
  function dueDayLabel(iso) {
    if (!iso) return "Без срока";
    var d = new Date(iso);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var due = new Date(d); due.setHours(0, 0, 0, 0);
    var diffDays = Math.round((due - today) / 86400000);
    if (diffDays === 0) return "Сегодня";
    if (diffDays === 1) return "Завтра";
    if (diffDays < 0) return "Просрочено";
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
  }

  // Относительное время для "Ленты действий" — макет показывает часы для сегодняшних
  // событий и "вчера"/дату для более старых, а не абсолютный timestamp на каждой карточке.
  function fmtFeedTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    var yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "вчера";
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }

  var PRIORITY_LABEL = { HIGH: "Важно", MEDIUM: "Обычно", LOW: "Низкий" };
  var PRIORITY_CHIP = { HIGH: "status-wait", MEDIUM: "status-ok", LOW: "status-new" };
  var PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };

  function showApiWarning(show) {
    var box = document.getElementById("apiWarning");
    document.getElementById("apiWarningUrl").textContent = window.API_BASE;
    box.style.display = show ? "block" : "none";
  }

  async function fetchJson(path) {
    var res = await Auth.apiFetch(path);
    if (!res.ok) throw new Error(path + " -> " + res.status);
    return res.json();
  }

  var state = {
    signals: [], feed: [], tasks: [], allTasks: [], reminders: null, projects: [], latestScenarioByProject: {}, ksgStages: [],
    direction: "", period: "", query: "", priorityTab: "tasks",
  };

  async function loadDashboard() {
    var tasks, ksgSummary, ksgStages, scenarios, projects, transcriptionJobs;
    try {
      [tasks, ksgSummary, ksgStages, scenarios, projects, transcriptionJobs] = await Promise.all([
        fetchJson("/tasks?kind=TASK"), // личные напоминания (kind=REMINDER) сюда не попадают — видны только на странице "Задачи" их создателю
        fetchJson("/ksg/summary"),
        fetchJson("/ksg/stages"),
        fetchJson("/finance/scenarios"),
        fetchJson("/projects"),
        fetchJson("/transcriber/jobs"),
      ]);
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }

    var openTasks = tasks.filter(function (t) { return t.status === "OPEN" || t.status === "IN_PROGRESS"; });

    var criticalKsg = ksgStages.filter(function (s) { return s.status === "критично"; });
    var riskyScenarios = scenarios.filter(function (s) { return s.margin !== null && s.margin < 0.15; });
    var overdueTasks = openTasks.filter(function (t) { return t.dueDate && daysFromNow(t.dueDate) < 0; });

    document.getElementById("kpiActiveTasks").textContent = openTasks.length;
    renderKpiBadge("kpiActiveTasksBadge", overdueTasks.length > 0 ? overdueTasks.length + " просрочено" : "В срок", overdueTasks.length > 0 ? "status-risk" : "status-ok");

    document.getElementById("kpiKsgDelays").textContent = ksgSummary.criticalStages;
    renderKpiBadge("kpiKsgDelaysBadge", ksgSummary.criticalStages > 0 ? "Есть отставания" : "В плане", ksgSummary.criticalStages > 0 ? "status-risk" : "status-ok");

    var latestScenarioByProject = {};
    scenarios.forEach(function (s) {
      if (!latestScenarioByProject[s.projectId]) latestScenarioByProject[s.projectId] = s; // уже отсортировано desc по createdAt
    });
    var totalNpv = Object.values(latestScenarioByProject).reduce(function (sum, s) { return sum + (s.npv || 0); }, 0);
    document.getElementById("kpiTotalNpv").textContent = fmtMoney(totalNpv);
    renderKpiBadge("kpiTotalNpvBadge", riskyScenarios.length > 0 ? riskyScenarios.length + " сценариев с риском" : "Маржа в норме", riskyScenarios.length > 0 ? "status-wait" : "status-ok");

    document.getElementById("kpiFreshness").textContent = ksgSummary.updatedSharePercent + "%";
    renderKpiBadge("kpiFreshnessBadge", ksgSummary.updatedSharePercent < 50 ? "Требует внимания" : "Актуально", ksgSummary.updatedSharePercent < 50 ? "status-wait" : "status-ok");

    state.projects = projects;
    state.latestScenarioByProject = latestScenarioByProject;
    state.ksgStages = ksgStages;
    state.allTasks = tasks; // все статусы — нужно для прогресса по направлениям
    state.signals = buildSignals(criticalKsg, riskyScenarios);
    state.feed = buildFeed(scenarios, transcriptionJobs, ksgStages);
    state.tasks = openTasks.map(function (t) { return Object.assign({}, t, { direction: taskDirection(t) }); });
    // Кэшируем для refreshTasksOnly() ниже — она пересчитывает только то, что зависит
    // от /tasks, не трогая КСГ/финансы/проекты/транскрибатор повторным запросом.
    state.scenarios = scenarios;
    state.criticalKsg = criticalKsg;

    renderDirectionsTable();
    applyFilters();
    noteUpdated();
  }

  function renderKpiBadge(id, text, chipClass) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.className = "status-chip " + chipClass;
  }

  function noteUpdated() {
    var el = document.getElementById("lastUpdatedNote");
    if (el) el.textContent = "Обновлено сегодня в " + new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  // Точечное обновление после правки/удаления ОДНОЙ задачи в карточке (task-modal.js) —
  // перезапрашивает только /tasks вместо всех 6 эндпоинтов loadDashboard(), которые
  // правка задачи никак не затрагивает.
  async function refreshTasksOnly() {
    var tasks;
    try {
      tasks = await fetchJson("/tasks?kind=TASK");
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }

    var openTasks = tasks.filter(function (t) { return t.status === "OPEN" || t.status === "IN_PROGRESS"; });
    var overdueTasks = openTasks.filter(function (t) { return t.dueDate && daysFromNow(t.dueDate) < 0; });
    document.getElementById("kpiActiveTasks").textContent = openTasks.length;
    renderKpiBadge("kpiActiveTasksBadge", overdueTasks.length > 0 ? overdueTasks.length + " просрочено" : "В срок", overdueTasks.length > 0 ? "status-risk" : "status-ok");

    state.allTasks = tasks;
    state.tasks = openTasks.map(function (t) { return Object.assign({}, t, { direction: taskDirection(t) }); });
    renderDirectionsTable();
    applyFilters();
  }

  // Направление выводится из того, какой модуль породил сигнал/событие/поручение —
  // та же таксономия тегов, что и в каталоге ассистентов (assistants.js).
  function taskDirection(t) {
    if (!t.source) return null;
    if (t.source.indexOf("transcriber:") === 0) return "Коммуникации";
    if (t.source.indexOf("mail:") === 0) return "Коммуникации";
    if (t.source.indexOf("ksg:") === 0) return "Планирование";
    return null;
  }

  function buildSignals(criticalKsg, riskyScenarios) {
    var ksgItems = criticalKsg.slice(0, 3).map(function (s) {
      return {
        title: "КСГ: отставание «" + s.name + "» (" + (s.project ? s.project.name : "") + ")",
        text: "Отклонение " + s.deviationDays + " дн. от плана. Нужна проверка причин и актуализация плана.",
        chip: "status-risk", label: "критично", direction: "Планирование", critical: true, at: s.updatedAt,
      };
    });
    var financeItems = riskyScenarios.slice(0, 3).map(function (s) {
      return {
        title: "Финмодель «" + s.name + "» ниже целевой маржи",
        text: "Маржинальность " + fmtPercent(s.margin) + " — сценарий стоит пересмотреть или сравнить с альтернативой.",
        chip: "status-wait", label: "внимание", direction: "Финансы", critical: false, at: s.createdAt,
      };
    });
    return ksgItems.concat(financeItems);
  }

  function buildFeed(scenarios, transcriptionJobs, ksgStages) {
    var events = scenarios.slice(0, 3).map(function (s) {
      return {
        at: s.createdAt, title: "Финансовый аналитик",
        text: "Рассчитан сценарий «" + s.name + "», маржа " + fmtPercent(s.margin) + ".",
        chip: "status-ok", label: "готово", direction: "Финансы", critical: false,
      };
    }).concat(
      transcriptionJobs.filter(function (j) { return j.status === "DONE"; }).slice(0, 3).map(function (j) {
        return {
          at: j.updatedAt, title: "Транскрибатор-референт",
          text: "Обработан файл «" + j.audioFileName + "».",
          chip: "status-ok", label: "готово", direction: "Коммуникации", critical: false,
        };
      })
    ).concat(
      ksgStages.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }).slice(0, 3).map(function (s) {
        return {
          at: s.updatedAt, title: "Контроль КСГ",
          text: "Обновлён этап «" + s.name + "», отклонение " + s.deviationDays + " дн.",
          chip: s.status === "критично" ? "status-risk" : "status-wait", label: s.status,
          direction: "Планирование", critical: s.status === "критично",
        };
      })
    );
    events.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    return events;
  }

  function matchesQuery(text) {
    if (!state.query) return true;
    return text.toLowerCase().indexOf(state.query) !== -1;
  }

  function matchesFilters(item) {
    if (state.direction && item.direction !== state.direction) return false;
    if (!matchesQuery(item.title + " " + item.text)) return false;
    if (state.period === "critical") return !!item.critical;
    if (state.period === "today" || state.period === "week") {
      if (!item.at) return false;
      var d = daysFromNow(item.at);
      var horizon = state.period === "today" ? 1 : 7;
      return d <= 0 && d >= -horizon; // событие произошло не более horizon дней назад
    }
    return true;
  }

  function matchesTaskFilters(task) {
    if (state.direction && task.direction !== state.direction) return false;
    if (!matchesQuery(task.title + " " + (task.project ? task.project.name : ""))) return false;
    if (state.period === "critical") return false; // у поручений нет уровня риска — раздел просто пустеет для этого фильтра
    if (state.period === "today" || state.period === "week") {
      if (!task.dueDate) return false;
      var d = daysFromNow(task.dueDate);
      var horizon = state.period === "today" ? 1 : 7;
      return d <= horizon; // просроченные и попадающие в горизонт — считаем актуальными
    }
    return true;
  }

  function applyFilters() {
    renderSignals(state.signals.filter(matchesFilters));
    renderFeed(state.feed.filter(matchesFilters));
    renderPriorityTasksAndUpcoming(state.tasks.filter(matchesTaskFilters));
    renderPriorityProjects();
  }

  function renderSignals(items) {
    var el = document.getElementById("signalsList");
    var badge = document.getElementById("signalsCountBadge");
    badge.textContent = items.length;
    badge.className = "status-chip " + (items.length > 0 ? "status-risk" : "status-new");
    if (items.length === 0) {
      el.innerHTML = '<div class="signal-card"><div><strong>Нет критических сигналов</strong><span>Риски и отклонения под контролем.</span></div><span class="status-chip status-ok">✓</span></div>';
      return;
    }
    el.innerHTML = items.slice(0, 4).map(function (i) {
      return '<div class="signal-card"><div><strong>' + esc(i.title) + "</strong><span>" + esc(i.text) +
        '</span></div><span class="status-chip ' + i.chip + '">' + i.label + "</span></div>";
    }).join("");
  }

  function renderProjectsInto(elId) {
    var el = document.getElementById(elId);
    var projects = state.projects.filter(function (p) { return matchesQuery(p.name); });
    if (state.projects.length === 0) {
      el.innerHTML = '<div class="footer-note">Проектов пока нет — создайте первый на экране «Финансовый аналитик».</div>';
      return;
    }
    if (projects.length === 0) {
      el.innerHTML = '<div class="footer-note">Ничего не найдено по запросу.</div>';
      return;
    }
    el.innerHTML = projects.slice(0, 6).map(function (p) {
      var scenario = state.latestScenarioByProject[p.id];
      var maxDeviation = state.ksgStages
        .filter(function (s) { return s.projectId === p.id; })
        .reduce(function (max, s) { return Math.max(max, s.deviationDays); }, 0);
      var atRisk = maxDeviation > 7 || (scenario && scenario.margin !== null && scenario.margin < 0.15);
      return (
        '<div class="project-card"><div><strong>' + esc(p.name) + "</strong><span>" + esc(p.businessLine) +
        (p.region ? " · " + esc(p.region) : "") + '</span><div class="mini-metrics">' +
        '<div class="mini-box"><strong>' + (scenario ? "IRR " + fmtPercent(scenario.irr) : "нет модели") + '</strong><span>финмодель</span></div>' +
        '<div class="mini-box"><strong>' + (maxDeviation > 0 ? "+" + maxDeviation + " дн." : "0 дн.") + '</strong><span>КСГ</span></div>' +
        '<div class="mini-box"><strong>' + p._count.tasks + ' поручений</strong><span>в работе</span></div>' +
        '</div></div><span class="status-chip ' + (atRisk ? "status-risk" : "status-ok") + '">' + (atRisk ? "решение" : "контроль") + "</span></div>"
      );
    }).join("");
  }

  function renderPriorityProjects() {
    if (state.priorityTab === "projects") renderProjectsInto("priorityProjectsList");
  }

  function renderFeed(events) {
    var el = document.getElementById("feedList");
    if (events.length === 0) {
      el.innerHTML = '<div class="footer-note">Нет активности по текущему фильтру.</div>';
      return;
    }
    el.innerHTML = events.slice(0, 4).map(function (e) {
      return '<div class="feed-card"><div><strong>' + esc(e.title) + "</strong><span>" + esc(e.text) +
        '</span></div><div style="display:grid;gap:6px;justify-items:end"><span class="status-chip ' + e.chip + '">' + esc(e.label) +
        '</span><span class="footer-note">' + esc(fmtFeedTime(e.at)) + "</span></div></div>";
    }).join("");
  }

  // Сортировка для "Мои приоритеты": сначала важные поручения, затем по сроку.
  function sortByPriorityThenDue(list) {
    return list.slice().sort(function (a, b) {
      var aRank = PRIORITY_RANK[a.priority] !== undefined ? PRIORITY_RANK[a.priority] : 1;
      var bRank = PRIORITY_RANK[b.priority] !== undefined ? PRIORITY_RANK[b.priority] : 1;
      var pr = aRank - bRank;
      if (pr !== 0) return pr;
      if (!a.dueDate && !b.dueDate) return new Date(a.createdAt) - new Date(b.createdAt);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }

  function sortByDue(list) {
    return list.slice().sort(function (a, b) {
      if (!a.dueDate && !b.dueDate) return new Date(a.createdAt) - new Date(b.createdAt);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }

  function wireTaskCardClicks(container, onChange) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-task-id]"), function (card) {
      card.addEventListener("click", function () {
        if (window.TaskModal) TaskModal.open(card.getAttribute("data-task-id"), onChange || refreshTasksOnly);
      });
    });
  }

  // Отметка поручения выполненным прямо с чекбокса в "Мои приоритеты" — без открытия
  // карточки. stopPropagation нужен, чтобы клик по чекбоксу не открывал модалку задачи
  // (на неё навешен обработчик клика по всей карточке, см. wireTaskCardClicks).
  function wireDoneCheckboxes(container, onChange) {
    Array.prototype.forEach.call(container.querySelectorAll("[data-done-task-id]"), function (cb) {
      cb.addEventListener("click", function (e) { e.stopPropagation(); });
      cb.addEventListener("change", async function () {
        var id = cb.getAttribute("data-done-task-id");
        try {
          await Auth.apiFetch("/tasks/" + id, { method: "PATCH", body: { status: "DONE" } });
        } catch (e) {}
        if (onChange) onChange();
      });
    });
  }

  function renderPriorityTasksAndUpcoming(filteredTasks) {
    var prioritized = sortByPriorityThenDue(filteredTasks);
    var top = prioritized.slice(0, 4);
    var topIds = {};
    top.forEach(function (t) { topIds[t.id] = true; });

    var el = document.getElementById("priorityTasksList");
    if (top.length === 0) {
      el.innerHTML = '<div class="footer-note">Нет поручений по текущему фильтру.</div>';
    } else {
      el.innerHTML = top.map(function (t) {
        return (
          '<div class="calendar-card task-card" data-task-id="' + t.id + '">' +
          '<div style="display:flex;gap:12px;align-items:flex-start;min-width:0">' +
          '<input type="checkbox" data-done-task-id="' + t.id + '" style="margin-top:4px;width:18px;height:18px;accent-color:var(--color-primary);cursor:pointer" aria-label="Отметить выполненным" />' +
          '<div><strong>' + esc(t.title) + "</strong><span>" +
          (t.project ? "Проект: " + esc(t.project.name) + " · " : "") + "срок: " + fmtDue(t.dueDate) + "</span></div></div>" +
          '<span class="status-chip ' + (PRIORITY_CHIP[t.priority] || "status-ok") + '">' + (PRIORITY_LABEL[t.priority] || "Обычно") + "</span></div>"
        );
      }).join("");
      wireTaskCardClicks(el, refreshTasksOnly);
      wireDoneCheckboxes(el, refreshTasksOnly);
    }

    // "Дальше по срокам" — всё остальное (не попавшее в топ приоритетов), сгруппировано по дню.
    var rest = sortByDue(filteredTasks.filter(function (t) { return !topIds[t.id]; })).slice(0, 6);
    var upcomingEl = document.getElementById("upcomingList");
    if (rest.length === 0) {
      upcomingEl.innerHTML = '<div class="footer-note">Больше поручений по текущему фильтру нет.</div>';
    } else {
      upcomingEl.innerHTML = rest.map(function (t) {
        return (
          '<div class="calendar-card task-card" data-task-id="' + t.id + '">' +
          '<div><span class="pill">' + esc(dueDayLabel(t.dueDate)) + '</span></div>' +
          '<div style="flex:1;min-width:0"><strong>' + esc(t.title) + "</strong></div></div>"
        );
      }).join("");
      wireTaskCardClicks(upcomingEl, refreshTasksOnly);
    }
  }

  // Вкладка "Задачи" в "Мои приоритеты" — личные напоминания (kind=REMINDER), только
  // свои (сервер сам скоупит по создателю, см. комментарий в routes/tasks.ts). Грузим
  // лениво при первом переключении на вкладку, а не вместе с остальным дашбордом —
  // иначе лишний запрос на каждую загрузку страницы ради раздела, который могут не открыть.
  async function loadRemindersIfNeeded() {
    if (state.reminders !== null) return;
    try {
      state.reminders = await fetchJson("/tasks?kind=REMINDER");
    } catch (e) {
      state.reminders = [];
    }
    renderPriorityReminders();
  }

  function renderPriorityReminders() {
    var el = document.getElementById("priorityRemindersList");
    var reminders = (state.reminders || []).filter(function (r) { return r.status === "OPEN" || r.status === "IN_PROGRESS"; });
    if (reminders.length === 0) {
      el.innerHTML = '<div class="footer-note">Личных напоминаний пока нет — добавить можно на странице «Задачи».</div>';
      return;
    }
    el.innerHTML = sortByDue(reminders).slice(0, 6).map(function (r) {
      return (
        '<div class="calendar-card task-card" data-task-id="' + r.id + '">' +
        '<div style="display:flex;gap:12px;align-items:flex-start;min-width:0">' +
        '<input type="checkbox" data-done-task-id="' + r.id + '" style="margin-top:4px;width:18px;height:18px;accent-color:var(--color-primary);cursor:pointer" aria-label="Отметить выполненным" />' +
        '<div><strong>' + esc(r.title) + "</strong><span>срок: " + fmtDue(r.dueDate) + "</span></div></div></div>"
      );
    }).join("");
    wireTaskCardClicks(el, function () { state.reminders = null; loadRemindersIfNeeded(); });
    wireDoneCheckboxes(el, function () { state.reminders = null; loadRemindersIfNeeded(); });
  }

  function switchPriorityTab(tab) {
    state.priorityTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll("#priorityTabs .tab"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === tab);
    });
    document.getElementById("priorityTasksList").style.display = tab === "tasks" ? "" : "none";
    document.getElementById("priorityRemindersList").style.display = tab === "reminders" ? "" : "none";
    document.getElementById("priorityProjectsList").style.display = tab === "projects" ? "" : "none";
    if (tab === "reminders") loadRemindersIfNeeded();
    if (tab === "projects") renderPriorityProjects();
  }

  Array.prototype.forEach.call(document.querySelectorAll("#priorityTabs .tab"), function (btn) {
    btn.addEventListener("click", function () { switchPriorityTab(btn.getAttribute("data-tab")); });
  });

  // "Ход работы по ключевым направлениям" — реальный прогресс по проекту: доля
  // завершённых поручений (DONE) от общего числа, посчитанная по полному списку
  // задач (а не только открытым, которые видны в остальных виджетах).
  function renderDirectionsTable() {
    var body = document.getElementById("directionsTableBody");
    var byProject = {};
    state.allTasks.forEach(function (t) {
      if (!t.projectId) return;
      if (!byProject[t.projectId]) byProject[t.projectId] = { total: 0, done: 0 };
      byProject[t.projectId].total += 1;
      if (t.status === "DONE") byProject[t.projectId].done += 1;
    });
    var rows = state.projects
      .map(function (p) { return { project: p, stats: byProject[p.id] }; })
      .filter(function (r) { return r.stats && r.stats.total > 0; })
      .sort(function (a, b) { return b.stats.total - a.stats.total; })
      .slice(0, 6);

    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="3" class="footer-note">Пока нет проектов с поручениями.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var percent = Math.round((r.stats.done / r.stats.total) * 100);
      return (
        "<tr><td><strong>" + esc(r.project.name) + "</strong><br/><span class=\"footer-note\">" + esc(r.project.businessLine) + "</span></td>" +
        "<td>" + r.stats.total + "</td>" +
        '<td><div style="display:flex;align-items:center;gap:10px"><div class="bar" style="flex:1;min-width:80px"><i style="width:' + percent + '%"></i></div><span style="white-space:nowrap">' + percent + "%</span></div></td></tr>"
      );
    }).join("");
  }

  Array.prototype.forEach.call(document.querySelectorAll("#directionFilters .filter"), function (btn) {
    btn.addEventListener("click", function () {
      state.direction = btn.getAttribute("data-direction");
      Array.prototype.forEach.call(document.querySelectorAll("#directionFilters .filter"), function (b) { b.classList.toggle("active", b === btn); });
      applyFilters();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("#periodFilters .filter"), function (btn) {
    btn.addEventListener("click", function () {
      var value = btn.getAttribute("data-period");
      var turningOn = state.period !== value;
      state.period = turningOn ? value : "";
      Array.prototype.forEach.call(document.querySelectorAll("#periodFilters .filter"), function (b) { b.classList.toggle("active", turningOn && b === btn); });
      applyFilters();
    });
  });

  document.getElementById("generateReportBtn").addEventListener("click", async function () {
    var btn = document.getElementById("generateReportBtn");
    btn.disabled = true;
    btn.textContent = "Формируем...";
    try {
      var visibleSignals = state.signals.filter(matchesFilters);
      var visibleTasks = state.tasks.filter(matchesTaskFilters);
      var payload = {
        kpis: [
          { label: "Активных задач по проектам", value: document.getElementById("kpiActiveTasks").textContent },
          { label: "Отставания по КСГ", value: document.getElementById("kpiKsgDelays").textContent },
          { label: "Совокупный NPV по последним моделям", value: document.getElementById("kpiTotalNpv").textContent },
          { label: "Этапов КСГ обновлены за 7 дней", value: document.getElementById("kpiFreshness").textContent },
        ],
        signals: visibleSignals.map(function (s) { return { title: s.title, text: s.text, label: s.label }; }),
        projects: state.projects.slice(0, 10).map(function (p) {
          var scenario = state.latestScenarioByProject[p.id];
          var maxDeviation = state.ksgStages.filter(function (s) { return s.projectId === p.id; }).reduce(function (m, s) { return Math.max(m, s.deviationDays); }, 0);
          var atRisk = maxDeviation > 7 || (scenario && scenario.margin !== null && scenario.margin < 0.15);
          return { name: p.name, status: atRisk ? "решение" : "контроль", note: (scenario ? "IRR " + fmtPercent(scenario.irr) + ", " : "") + "КСГ +" + maxDeviation + " дн." };
        }),
        tasks: visibleTasks.slice(0, 10).map(function (t) { return { title: t.title, due: fmtDue(t.dueDate) }; }),
      };
      var res = await Auth.apiFetch("/reports/daily-summary", { method: "POST", body: payload });
      if (!res.ok) throw new Error("Не удалось сформировать отчёт");
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "svodka-rukovoditelya.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Сформировать отчет";
    }
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    applyFilters();
  });

  document.getElementById("headerRefreshBtn").addEventListener("click", loadDashboard);
  var sidebarRefreshBtn = document.getElementById("quickRefreshBtn");
  if (sidebarRefreshBtn) sidebarRefreshBtn.addEventListener("click", loadDashboard);

  document.getElementById("scrollToSignalsBtn").addEventListener("click", function () {
    // Виджеты рабочего стола (см. widgets.js) могут быть скрыты пользователем — если
    // "Критические сигналы" спрятан, откатываемся на всю сетку виджетов вместо падения.
    var target = document.querySelector('[data-widget-id="signals"]') || document.getElementById("dashboardGrid");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("showAllSignalsBtn").addEventListener("click", function () {
    state.direction = "";
    state.period = "";
    Array.prototype.forEach.call(document.querySelectorAll("#directionFilters .filter"), function (b) { b.classList.toggle("active", b.getAttribute("data-direction") === ""); });
    Array.prototype.forEach.call(document.querySelectorAll("#periodFilters .filter"), function (b) { b.classList.remove("active"); });
    applyFilters();
    document.getElementById("signalsList").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  loadDashboard();
})();
