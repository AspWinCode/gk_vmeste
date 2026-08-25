(function () {
  var state = { projects: [], scenarios: [], selectedProjectId: null, selectedScenarioId: null, usageType: "Жильё", query: "" };

  function filteredScenarios() {
    if (!state.query) return state.scenarios;
    return state.scenarios.filter(function (s) {
      return (s.name + " " + s.usageType).toLowerCase().indexOf(state.query) !== -1;
    });
  }

  var money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

  function fmtMoney(v) {
    if (v === null || v === undefined) return "—";
    var abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2).replace(".", ",") + " млрд ₽";
    if (abs >= 1e6) return (v / 1e6).toFixed(0) + " млн ₽";
    return money.format(v) + " ₽";
  }
  function fmtPercent(v) {
    if (v === null || v === undefined) return "—";
    return (v * 100).toFixed(1).replace(".", ",") + "%";
  }
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

  async function loadProjects() {
    try {
      var res = await Auth.apiFetch("/projects");
      if (!res.ok) throw new Error("bad status");
      state.projects = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }
    var select = document.getElementById("projectSelect");
    if (state.projects.length === 0) {
      select.innerHTML = '<option value="">Проектов пока нет — создайте новый</option>';
      return;
    }
    select.innerHTML = state.projects
      .map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; })
      .join("");
    state.selectedProjectId = select.value;
    document.getElementById("statProjects").textContent = state.projects.length;
    loadScenarios();
  }

  document.getElementById("projectSelect").addEventListener("change", function (e) {
    state.selectedProjectId = e.target.value;
    loadScenarios();
  });

  document.getElementById("newProjectBtn").addEventListener("click", async function () {
    var name = prompt("Название нового проекта (например, Участок B-12):");
    if (!name) return;
    var res = await Auth.apiFetch("/projects", { method: "POST", body: { name: name, businessLine: "ГК ВМЕСТЕ" } });
    if (!res.ok) { alert("Не удалось создать проект"); return; }
    await loadProjects();
    var created = await res.json();
    document.getElementById("projectSelect").value = created.id;
    state.selectedProjectId = created.id;
    loadScenarios();
  });

  Array.prototype.forEach.call(document.querySelectorAll("#usageTabs .tab"), function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll("#usageTabs .tab"), function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      state.usageType = tab.dataset.usage;
      document.getElementById("bedsField").style.display = state.usageType === "Пансионат" ? "grid" : "none";
    });
  });

  async function loadScenarios() {
    if (!state.selectedProjectId) return;
    var res = await Auth.apiFetch("/finance/scenarios?projectId=" + state.selectedProjectId);
    state.scenarios = res.ok ? await res.json() : [];
    renderHistory();
    renderComparisonTable();
    document.getElementById("statTotal").textContent = state.scenarios.length;
    var withIrr = state.scenarios.filter(function (s) { return s.irr !== null; });
    document.getElementById("statAvgIrr").textContent = withIrr.length
      ? fmtPercent(withIrr.reduce(function (sum, s) { return sum + s.irr; }, 0) / withIrr.length)
      : "—";

    if (state.scenarios.length > 0 && !state.selectedScenarioId) {
      selectScenario(state.scenarios[0].id);
    }
  }

  function renderHistory() {
    var el = document.getElementById("scenarioHistoryList");
    if (state.scenarios.length === 0) {
      el.innerHTML = '<div class="footer-note">Для этого проекта сценариев ещё нет.</div>';
      return;
    }
    var visible = filteredScenarios();
    if (visible.length === 0) {
      el.innerHTML = '<div class="footer-note">Ничего не найдено по запросу.</div>';
      return;
    }
    el.innerHTML = visible
      .map(function (s) {
        var active = s.id === state.selectedScenarioId;
        return (
          '<div class="history-card" data-scenario-id="' + s.id + '" style="cursor:pointer;' +
          (active ? "border-color:var(--color-primary)" : "") + '">' +
          "<div><strong>" + esc(s.name) + " · " + esc(s.usageType) + "</strong><span>" +
          new Date(s.createdAt).toLocaleString("ru-RU") + "</span></div>" +
          '<span class="status-chip ' + (s.margin >= 0 ? "status-ok" : "status-risk") + '">' + fmtPercent(s.margin) + "</span>" +
          "</div>"
        );
      })
      .join("");
    Array.prototype.forEach.call(el.querySelectorAll("[data-scenario-id]"), function (card) {
      card.addEventListener("click", function () { selectScenario(card.getAttribute("data-scenario-id")); });
    });
  }

  function renderComparisonTable() {
    document.getElementById("comparisonTableBody").innerHTML = filteredScenarios()
      .map(function (s) {
        return (
          "<tr><td><strong>" + esc(s.name) + "</strong></td><td>" + fmtMoney(s.revenue) + "</td><td>" +
          fmtMoney(s.costs) + "</td><td>" + fmtPercent(s.margin) + "</td><td>" + fmtPercent(s.irr) +
          "</td><td>" + fmtMoney(s.npv) + "</td></tr>"
        );
      })
      .join("");
  }

  function selectScenario(id) {
    state.selectedScenarioId = id;
    var scenario = state.scenarios.find(function (s) { return s.id === id; });
    if (!scenario) return;
    renderScenarioDetail(scenario);
    renderHistory();
  }

  function renderScenarioDetail(s) {
    document.getElementById("scenarioEmpty").style.display = "none";
    document.getElementById("scenarioDetail").style.display = "block";
    document.getElementById("scenarioSubtitle").textContent = s.name + " · " + s.usageType;
    var chip = document.getElementById("scenarioStatusChip");
    chip.textContent = s.margin >= 0 ? "устойчив" : "убыточен";
    chip.className = "status-chip " + (s.margin >= 0 ? "status-ok" : "status-risk");

    document.getElementById("metricRevenue").textContent = fmtMoney(s.revenue);
    document.getElementById("metricCosts").textContent = fmtMoney(s.costs);
    document.getElementById("metricMargin").textContent = fmtPercent(s.margin);
    document.getElementById("metricPayback").textContent = s.paybackMonths != null ? s.paybackMonths : "не окупается";

    document.getElementById("scenarioPills").innerHTML =
      '<span class="pill">IRR ' + fmtPercent(s.irr) + '</span>' +
      '<span class="pill">NPV ' + fmtMoney(s.npv) + '</span>' +
      '<span class="pill">Окупаемость ' + (s.paybackMonths != null ? s.paybackMonths + " мес." : "—") + '</span>';

    document.getElementById("aiRiskText").textContent =
      s.aiRiskSummary || "Комментарий ещё не запрошен — нажмите «Оценить риски (Claude)».";

    document.getElementById("tepList").innerHTML = [
      ["Площадь реализации", (s.saleAreaSqm || 0).toLocaleString("ru-RU") + " м²"],
      ["Цена реализации", fmtMoney(s.pricePerSqm) + "/м²"],
      ["Себестоимость", fmtMoney(s.costPerSqm) + "/м²"],
      ["Срок проекта", (s.durationMonths || "—") + " мес."],
    ]
      .concat(s.floors ? [["Этажность", s.floors]] : [])
      .concat(s.bedsCount ? [["Койко-места", s.bedsCount]] : [])
      .map(function (row) { return '<div class="kpi-card"><strong>' + esc(row[1]) + "</strong><span>" + esc(row[0]) + "</span></div>"; })
      .join("");

    document.getElementById("aiReviewBtn").onclick = function () { requestAiReview(s.id); };
  }

  async function requestAiReview(id) {
    var btn = document.getElementById("aiReviewBtn");
    btn.disabled = true;
    btn.textContent = "Claude анализирует...";
    try {
      var res = await Auth.apiFetch("/finance/scenarios/" + id + "/ai-review", { method: "POST" });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось получить оценку рисков");
      var idx = state.scenarios.findIndex(function (s) { return s.id === id; });
      if (idx !== -1) state.scenarios[idx] = data;
      document.getElementById("aiRiskText").textContent = data.aiRiskSummary;
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Оценить риски (Claude)";
    }
  }

  document.getElementById("scenarioForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("formError");
    errorBox.style.display = "none";

    if (!state.selectedProjectId) {
      errorBox.textContent = "Сначала выберите или создайте проект.";
      errorBox.style.display = "block";
      return;
    }

    var payload = {
      projectId: state.selectedProjectId,
      name: document.getElementById("scenarioName").value,
      usageType: state.usageType,
      landAreaSqm: document.getElementById("landAreaSqm").value || undefined,
      saleAreaSqm: document.getElementById("saleAreaSqm").value,
      pricePerSqm: document.getElementById("pricePerSqm").value,
      costPerSqm: document.getElementById("costPerSqm").value,
      durationMonths: document.getElementById("durationMonths").value,
      bedsCount: document.getElementById("bedsCount").value || undefined,
      comment: document.getElementById("scenarioComment").value || undefined,
      withAiReview: document.getElementById("withAiReview").checked,
    };

    var btn = document.getElementById("calcBtn");
    btn.disabled = true;
    btn.textContent = "Считаем...";
    try {
      var res = await Auth.apiFetch("/finance/scenarios", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error) || "Не удалось рассчитать сценарий");
      state.selectedScenarioId = null;
      await loadScenarios();
      selectScenario(data.id);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Пересчитать модель";
    }
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    renderHistory();
    renderComparisonTable();
  });

  document.getElementById("quickNewCalcBtn").addEventListener("click", function () {
    document.getElementById("scenarioForm").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("scenarioName").focus();
    document.getElementById("scenarioName").select();
  });

  loadProjects();
})();
