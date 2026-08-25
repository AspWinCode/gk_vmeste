(function () {
  var state = { projects: [], stages: [], projectFilter: "", query: "" };

  function filteredStages() {
    if (!state.query) return state.stages;
    return state.stages.filter(function (s) {
      return (s.name + " " + s.stageType + " " + (s.project ? s.project.name : "")).toLowerCase().indexOf(state.query) !== -1;
    });
  }

  var STATUS_CLASS = {
    "по плану": "status-ok",
    контроль: "status-wait",
    внимание: "status-wait",
    критично: "status-risk",
  };

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  function showApiWarning(show) {
    var box = document.getElementById("apiWarning");
    document.getElementById("apiWarningUrl").textContent = window.API_BASE;
    box.style.display = show ? "block" : "none";
  }

  async function loadProjects() {
    var res = await Auth.apiFetch("/projects");
    if (!res.ok) return;
    state.projects = await res.json();
    var options = state.projects.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; }).join("");
    document.getElementById("ksgProjectFilter").innerHTML = '<option value="">Все проекты</option>' + options;
    document.getElementById("stageProject").innerHTML = options || '<option value="">Сначала создайте проект на экране «Финансовый аналитик»</option>';
  }

  async function loadSummary() {
    var res = await Auth.apiFetch("/ksg/summary");
    if (!res.ok) return;
    var s = await res.json();
    document.getElementById("statCritical").textContent = s.criticalStages;
    document.getElementById("statMaxDeviation").textContent = s.maxDeviationDays;
    document.getElementById("statUpdated").textContent = s.updatedSharePercent + "%";
  }

  async function loadStages() {
    try {
      var url = "/ksg/stages" + (state.projectFilter ? "?projectId=" + state.projectFilter : "");
      var res = await Auth.apiFetch(url);
      if (!res.ok) throw new Error("bad status");
      state.stages = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }
    renderTable();
    renderSignals();
    renderRecent();
  }

  function renderTable() {
    var body = document.getElementById("stagesTableBody");
    if (state.stages.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="footer-note">Этапов пока нет — добавьте вручную или импортируйте из Excel.</td></tr>';
      return;
    }
    var visible = filteredStages();
    if (visible.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="footer-note">Ничего не найдено по запросу.</td></tr>';
      return;
    }
    body.innerHTML = visible
      .map(function (s) {
        return (
          "<tr><td><strong>" + esc(s.name) + "</strong> <span style=\"color:var(--color-text-faint)\">· " + esc(s.stageType) + "</span></td>" +
          "<td>" + esc(s.project ? s.project.name : "") + "</td>" +
          "<td>" + fmtDate(s.planDate) + "</td>" +
          '<td><a href="#" data-set-fact="' + s.id + '">' + (s.factDate ? fmtDate(s.factDate) : "указать факт") + "</a></td>" +
          "<td>" + (s.deviationDays > 0 ? "+" + s.deviationDays : s.deviationDays) + " дн.</td>" +
          '<td><span class="status-chip ' + (STATUS_CLASS[s.status] || "status-wait") + '">' + esc(s.status) + "</span></td></tr>"
        );
      })
      .join("");

    Array.prototype.forEach.call(body.querySelectorAll("[data-set-fact]"), function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        setFactDate(link.getAttribute("data-set-fact"));
      });
    });
  }

  async function setFactDate(stageId) {
    var input = prompt("Фактическая дата (ГГГГ-ММ-ДД):", new Date().toISOString().slice(0, 10));
    if (!input) return;
    var iso = new Date(input + "T00:00:00.000Z").toISOString();
    var res = await Auth.apiFetch("/ksg/stages/" + stageId, { method: "PATCH", body: { factDate: iso } });
    if (!res.ok) { alert("Не удалось сохранить дату"); return; }
    await Promise.all([loadStages(), loadSummary()]);
  }

  function renderSignals() {
    var el = document.getElementById("signalsList");
    var signals = state.stages
      .filter(function (s) { return s.status !== "по плану"; })
      .sort(function (a, b) { return b.deviationDays - a.deviationDays; })
      .slice(0, 6);
    if (signals.length === 0) {
      el.innerHTML = '<div class="footer-note">Все этапы идут по плану.</div>';
      return;
    }
    el.innerHTML = signals
      .map(function (s) {
        return (
          '<article class="row-card"><div><strong>' + esc(s.name) + " (" + esc(s.project ? s.project.name : "") + ")</strong>" +
          "<span>Отклонение " + s.deviationDays + " дн. от плана " + fmtDate(s.planDate) + ".</span></div>" +
          '<span class="status-chip ' + (STATUS_CLASS[s.status] || "status-wait") + '">' + esc(s.status) + "</span></article>"
        );
      })
      .join("");
  }

  function renderRecent() {
    var el = document.getElementById("recentList");
    var recent = state.stages
      .slice()
      .sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); })
      .slice(0, 6);
    if (recent.length === 0) {
      el.innerHTML = '<div class="footer-note">Пока нет обновлений.</div>';
      return;
    }
    el.innerHTML = recent
      .map(function (s) {
        return (
          '<article class="timeline-item"><strong>' + esc(s.name) + "</strong><span>" +
          new Date(s.updatedAt).toLocaleString("ru-RU") + " · отклонение " + s.deviationDays + " дн.</span></article>"
        );
      })
      .join("");
  }

  document.getElementById("ksgProjectFilter").addEventListener("change", function (e) {
    state.projectFilter = e.target.value;
    loadStages();
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    renderTable();
  });

  function refreshAll() {
    loadStages();
    loadSummary();
  }
  document.getElementById("refreshBtn").addEventListener("click", refreshAll);
  document.getElementById("quickRefreshBtn").addEventListener("click", refreshAll);

  document.getElementById("addStageForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var projectId = document.getElementById("stageProject").value;
    if (!projectId) { alert("Сначала создайте проект (экран «Финансовый аналитик» → + Новый проект)."); return; }
    var payload = {
      projectId: projectId,
      stageType: document.getElementById("stageType").value,
      name: document.getElementById("stageName").value,
      planDate: new Date(document.getElementById("stagePlanDate").value + "T00:00:00.000Z").toISOString(),
    };
    var res = await Auth.apiFetch("/ksg/stages", { method: "POST", body: payload });
    if (!res.ok) { alert("Не удалось добавить этап"); return; }
    document.getElementById("stageName").value = "";
    document.getElementById("stagePlanDate").value = "";
    await Promise.all([loadStages(), loadSummary()]);
  });

  document.getElementById("importBtn").addEventListener("click", function () {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", async function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var formData = new FormData();
    formData.append("file", file);
    var resultBox = document.getElementById("importResult");
    resultBox.style.display = "block";
    resultBox.textContent = "Импорт...";
    try {
      var res = await Auth.apiFetch("/ksg/import", { method: "POST", body: formData });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка импорта");
      resultBox.textContent = "Импортировано этапов: " + data.importedRows + (data.errors.length ? " · ошибки: " + data.errors.join("; ") : "");
      await Promise.all([loadProjects(), loadStages(), loadSummary()]);
    } catch (err) {
      resultBox.style.color = "#9E3D3D";
      resultBox.textContent = err.message;
    } finally {
      e.target.value = "";
    }
  });

  (async function init() {
    await loadProjects();
    await Promise.all([loadStages(), loadSummary()]);
  })();
})();
