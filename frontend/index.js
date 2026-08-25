(function () {
  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }
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

  async function loadDashboard() {
    var tasks, ksgSummary, ksgStages, scenarios, projects, transcriptionJobs;
    try {
      [tasks, ksgSummary, ksgStages, scenarios, projects, transcriptionJobs] = await Promise.all([
        fetchJson("/tasks"),
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
    var todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    var newTasksToday = tasks.filter(function (t) { return new Date(t.createdAt) >= todayStart; }).length;

    var criticalKsg = ksgStages.filter(function (s) { return s.status === "критично"; });
    var riskyScenarios = scenarios.filter(function (s) { return s.margin !== null && s.margin < 0.15; });
    var projectsAtRisk = new Set(
      criticalKsg.map(function (s) { return s.projectId; }).concat(riskyScenarios.map(function (s) { return s.projectId; }))
    );

    document.getElementById("statCritical").textContent = criticalKsg.length + riskyScenarios.length;
    document.getElementById("statNewTasks").textContent = newTasksToday;
    document.getElementById("statProjectsAtRisk").textContent = projectsAtRisk.size;

    document.getElementById("kpiActiveTasks").textContent = openTasks.length;
    document.getElementById("kpiKsgDelays").textContent = ksgSummary.criticalStages;
    var latestScenarioByProject = {};
    scenarios.forEach(function (s) {
      if (!latestScenarioByProject[s.projectId]) latestScenarioByProject[s.projectId] = s; // уже отсортировано desc по createdAt
    });
    var totalNpv = Object.values(latestScenarioByProject).reduce(function (sum, s) { return sum + (s.npv || 0); }, 0);
    document.getElementById("kpiTotalNpv").textContent = fmtMoney(totalNpv);
    document.getElementById("kpiFreshness").textContent = ksgSummary.updatedSharePercent + "%";

    renderSignals(criticalKsg, riskyScenarios);
    renderProjects(projects, latestScenarioByProject, ksgStages);
    renderFeed(scenarios, transcriptionJobs, ksgStages);
    renderTasks(openTasks);
    renderFocus(scenarios, criticalKsg, tasks);
  }

  function renderSignals(criticalKsg, riskyScenarios) {
    var el = document.getElementById("signalsList");
    var items = criticalKsg.slice(0, 3).map(function (s) {
      return {
        title: "КСГ: отставание «" + s.name + "» (" + (s.project ? s.project.name : "") + ")",
        text: "Отклонение " + s.deviationDays + " дн. от плана. Нужна проверка причин и актуализация плана.",
        chip: "status-risk", label: "критично",
      };
    }).concat(riskyScenarios.slice(0, 3).map(function (s) {
      return {
        title: "Финмодель «" + s.name + "» ниже целевой маржи",
        text: "Маржинальность " + fmtPercent(s.margin) + " — сценарий стоит пересмотреть или сравнить с альтернативой.",
        chip: "status-wait", label: "внимание",
      };
    }));

    if (items.length === 0) {
      el.innerHTML = '<div class="footer-note">Критических сигналов нет — все КСГ и финмодели в норме.</div>';
      return;
    }
    el.innerHTML = items.slice(0, 4).map(function (i) {
      return '<div class="signal-card"><div><strong>' + esc(i.title) + "</strong><span>" + esc(i.text) +
        '</span></div><span class="status-chip ' + i.chip + '">' + i.label + "</span></div>";
    }).join("");
  }

  function renderProjects(projects, latestScenarioByProject, ksgStages) {
    var el = document.getElementById("projectList");
    if (projects.length === 0) {
      el.innerHTML = '<div class="footer-note">Проектов пока нет — создайте первый на экране «Финансовый аналитик».</div>';
      return;
    }
    el.innerHTML = projects.slice(0, 4).map(function (p) {
      var scenario = latestScenarioByProject[p.id];
      var maxDeviation = ksgStages
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

  function renderFeed(scenarios, transcriptionJobs, ksgStages) {
    var el = document.getElementById("feedList");
    var events = scenarios.slice(0, 3).map(function (s) {
      return { at: s.createdAt, title: "Финансовый аналитик", text: "Рассчитан сценарий «" + s.name + "», маржа " + fmtPercent(s.margin) + ".", chip: "status-ok", label: "готово" };
    }).concat(
      transcriptionJobs.filter(function (j) { return j.status === "DONE"; }).slice(0, 3).map(function (j) {
        return { at: j.updatedAt, title: "Транскрибатор-референт", text: "Обработан файл «" + j.audioFileName + "».", chip: "status-ok", label: "готово" };
      })
    ).concat(
      ksgStages.slice().sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); }).slice(0, 3).map(function (s) {
        return { at: s.updatedAt, title: "Контроль КСГ", text: "Обновлён этап «" + s.name + "», отклонение " + s.deviationDays + " дн.", chip: s.status === "критично" ? "status-risk" : "status-wait", label: s.status };
      })
    );
    events.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });

    if (events.length === 0) {
      el.innerHTML = '<div class="footer-note">Активности пока нет.</div>';
      return;
    }
    el.innerHTML = events.slice(0, 4).map(function (e) {
      return '<div class="feed-card"><div><strong>' + esc(e.title) + "</strong><span>" + esc(e.text) +
        '</span></div><span class="status-chip ' + e.chip + '">' + esc(e.label) + "</span></div>";
    }).join("");
  }

  function sortByDue(list) {
    return list.slice().sort(function (a, b) {
      if (!a.dueDate && !b.dueDate) return new Date(a.createdAt) - new Date(b.createdAt);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }

  function renderTasks(openTasks) {
    var sorted = sortByDue(openTasks);
    var el = document.getElementById("taskList");
    var top = sorted.slice(0, 4);
    if (top.length === 0) {
      el.innerHTML = '<div class="footer-note">Открытых поручений нет.</div>';
    } else {
      el.innerHTML = top.map(function (t) {
        return (
          '<div class="calendar-card"><div><strong>' + esc(t.title) + "</strong><span>" +
          (t.project ? "Проект: " + esc(t.project.name) + " · " : "") + "срок: " + fmtDue(t.dueDate) + '</span></div>' +
          '<span class="status-chip status-wait">' + (t.status === "IN_PROGRESS" ? "в работе" : "новое") + "</span></div>"
        );
      }).join("");
    }

    var rest = sorted.slice(4, 8);
    var upcomingEl = document.getElementById("upcomingList");
    if (rest.length === 0) {
      upcomingEl.innerHTML = '<div class="footer-note">Больше открытых поручений нет.</div>';
    } else {
      upcomingEl.innerHTML = rest.map(function (t) {
        return '<div class="calendar-card"><div><strong>' + esc(t.title) + "</strong><span>срок: " + fmtDue(t.dueDate) + "</span></div></div>";
      }).join("");
    }
  }

  function renderFocus(scenarios, criticalKsg, tasks) {
    document.getElementById("focusFinance").textContent =
      scenarios.length + " сценариев рассчитано" + (scenarios.some(function (s) { return s.margin < 0.15; }) ? ", есть риск по марже" : ".");
    document.getElementById("focusKsg").textContent = criticalKsg.length + " критических отставаний на текущую дату.";
    var fromTranscriber = tasks.filter(function (t) { return t.source && t.source.indexOf("transcriber:") === 0; }).length;
    document.getElementById("focusTranscriber").textContent = fromTranscriber + " поручений из встреч и звонков.";
  }

  loadDashboard();
})();
