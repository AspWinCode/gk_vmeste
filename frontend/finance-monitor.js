(function () {
  var STATUS_CLASS = {
    "по плану": "status-ok",
    "выше плана": "status-ok",
    внимание: "status-wait",
    риск: "status-risk",
    "нет факта": "status-new",
    "нет плана": "status-new",
  };

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }
  function fmtMoney(v) {
    if (v === null || v === undefined) return "—";
    var abs = Math.abs(v);
    var sign = v < 0 ? "-" : "";
    if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2).replace(".", ",") + " млрд ₽";
    if (abs >= 1e6) return sign + Math.round(abs / 1e6) + " млн ₽";
    return sign + Math.round(abs) + " ₽";
  }
  function fmtPercent(v) {
    if (v === null || v === undefined) return "—";
    return (v * 100).toFixed(1).replace(".", ",") + "%";
  }
  function showApiWarning(show) {
    var box = document.getElementById("apiWarning");
    document.getElementById("apiWarningUrl").textContent = window.API_BASE;
    box.style.display = show ? "block" : "none";
  }

  async function loadProjectsIntoSelect() {
    var res = await Auth.apiFetch("/projects");
    if (!res.ok) return;
    var projects = await res.json();
    document.getElementById("actualProject").innerHTML = projects
      .map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; })
      .join("") || '<option value="">Сначала создайте проект</option>';
  }

  async function loadSummary() {
    try {
      var res = await Auth.apiFetch("/finance-monitor/summary");
      if (!res.ok) throw new Error("bad status");
      var data = await res.json();
      showApiWarning(false);
      render(data);
    } catch (e) {
      showApiWarning(true);
    }
  }

  function render(data) {
    document.getElementById("statRevenue").textContent = fmtMoney(data.totals.totalRevenue);
    document.getElementById("statMargin").textContent = fmtPercent(data.totals.avgMargin);
    document.getElementById("statDeviating").textContent = data.totals.deviatingProjects;

    var body = document.getElementById("monitorTableBody");
    if (data.rows.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="footer-note">Проектов пока нет.</td></tr>';
    } else {
      body.innerHTML = data.rows
        .map(function (r) {
          return (
            "<tr><td><strong>" + esc(r.projectName) + "</strong></td><td>" + fmtMoney(r.planRevenue) + "</td><td>" +
            fmtMoney(r.actualRevenue) + (r.periodLabel ? " <span style=\"color:var(--color-text-faint)\">(" + esc(r.periodLabel) + ")</span>" : "") +
            "</td><td>" + fmtMoney(r.deviation) + '</td><td><span class="status-chip ' +
            (STATUS_CLASS[r.status] || "status-wait") + '">' + esc(r.status) + "</span></td></tr>"
          );
        })
        .join("");
    }

    var signalsEl = document.getElementById("signalsList");
    var signals = data.rows.filter(function (r) { return r.status === "риск" || r.status === "внимание"; });
    var growing = data.rows.filter(function (r) { return r.status === "выше плана"; });
    var items = signals
      .map(function (r) {
        return {
          title: r.projectName + " " + (r.status === "риск" ? "просел по выручке" : "ниже плана"),
          text: "Отклонение " + fmtMoney(r.deviation) + " от плановой выручки " + fmtMoney(r.planRevenue) + ".",
          chip: r.status === "риск" ? "status-risk" : "status-wait",
        };
      })
      .concat(
        growing.map(function (r) {
          return { title: r.projectName + " растёт выше ожиданий", text: "Отклонение +" + fmtMoney(r.deviation) + " — можно использовать как положительный сигнал.", chip: "status-ok" };
        })
      );
    signalsEl.innerHTML = items.length
      ? items.map(function (i) {
          return '<article class="row-card"><div><strong>' + esc(i.title) + "</strong><span>" + esc(i.text) + '</span></div><span class="status-chip ' + i.chip + '">сигнал</span></article>';
        }).join("")
      : '<div class="footer-note">Отклонений нет — по всем проектам с фактом либо план выполняется, либо факт ещё не внесён.</div>';

    var blBody = document.getElementById("businessLineTableBody");
    blBody.innerHTML = data.byBusinessLine.length
      ? data.byBusinessLine.map(function (b) {
          return "<tr><td><strong>" + esc(b.businessLine) + "</strong></td><td>" + fmtMoney(b.revenue) + "</td><td>" + fmtPercent(b.avgMargin) + "</td></tr>";
        }).join("")
      : '<tr><td colspan="3" class="footer-note">Пока нет фактических данных ни по одному направлению.</td></tr>';
  }

  document.getElementById("refreshBtn").addEventListener("click", loadSummary);
  document.getElementById("quickRefreshBtn").addEventListener("click", loadSummary);

  document.getElementById("actualForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("formError");
    errorBox.style.display = "none";
    var payload = {
      projectId: document.getElementById("actualProject").value,
      periodLabel: document.getElementById("actualPeriod").value,
      actualRevenue: document.getElementById("actualRevenue").value,
      actualMargin: document.getElementById("actualMargin").value || undefined,
    };
    if (!payload.projectId) { errorBox.textContent = "Сначала создайте проект."; errorBox.style.display = "block"; return; }
    try {
      var res = await Auth.apiFetch("/finance-monitor/actuals", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error) || "Не удалось сохранить факт");
      e.target.reset();
      await loadSummary();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  loadProjectsIntoSelect();
  loadSummary();
})();
