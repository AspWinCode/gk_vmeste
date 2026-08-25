(function () {
  var state = { programs: [], regionFilter: "" };
  var STATUS_CLASS = { "актуально": "status-ok", "требует решения": "status-risk", "на проверке": "status-wait" };
  var STATUS_CYCLE = ["на проверке", "актуально", "требует решения"];

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

  document.getElementById("analyzeBtn").addEventListener("click", async function () {
    var url = document.getElementById("sourceUrl").value.trim();
    var text = document.getElementById("sourceText").value.trim();
    var errorBox = document.getElementById("analyzeError");
    errorBox.style.display = "none";
    if (!url && !text) { errorBox.textContent = "Укажите ссылку или вставьте текст."; errorBox.style.display = "block"; return; }

    var btn = document.getElementById("analyzeBtn");
    btn.disabled = true;
    btn.textContent = "Анализируем...";
    try {
      var res = await Auth.apiFetch("/support/programs/analyze", { method: "POST", body: url ? { url: url } : { text: text } });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось проанализировать источник");
      document.getElementById("progTitle").value = data.title || "";
      document.getElementById("progType").value = data.type || "Иное";
      document.getElementById("progRegion").value = data.region || "";
      document.getElementById("progBusinessLine").value = data.businessLine || "Девелопмент";
      document.getElementById("progPotential").value = data.potential || "";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Проанализировать (Claude)";
    }
  });

  document.getElementById("programForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("formError");
    errorBox.style.display = "none";
    var payload = {
      title: document.getElementById("progTitle").value,
      type: document.getElementById("progType").value,
      region: document.getElementById("progRegion").value,
      businessLine: document.getElementById("progBusinessLine").value,
      potential: document.getElementById("progPotential").value,
      status: document.getElementById("progStatus").value,
      sourceUrl: document.getElementById("sourceUrl").value || undefined,
    };
    try {
      var res = await Auth.apiFetch("/support/programs", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error) || "Не удалось сохранить программу");
      e.target.reset();
      document.getElementById("sourceUrl").value = "";
      document.getElementById("sourceText").value = "";
      await loadPrograms();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  document.getElementById("regionFilter").addEventListener("change", function (e) {
    state.regionFilter = e.target.value;
    loadPrograms();
  });

  async function loadPrograms() {
    try {
      var url = "/support/programs" + (state.regionFilter ? "?region=" + encodeURIComponent(state.regionFilter) : "");
      var res = await Auth.apiFetch(url);
      if (!res.ok) throw new Error("bad status");
      state.programs = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }
    render();
  }

  function render() {
    document.getElementById("statTotal").textContent = state.programs.length;
    document.getElementById("statActual").textContent = state.programs.filter(function (p) { return p.status === "актуально"; }).length;
    document.getElementById("statReview").textContent = state.programs.filter(function (p) { return p.status === "на проверке"; }).length;

    var regions = Array.from(new Set(state.programs.map(function (p) { return p.region; })));
    var filterEl = document.getElementById("regionFilter");
    var current = filterEl.value;
    filterEl.innerHTML = '<option value="">Все регионы</option>' + regions.map(function (r) { return '<option' + (r === current ? " selected" : "") + ">" + esc(r) + "</option>"; }).join("");

    var body = document.getElementById("programsTableBody");
    if (state.programs.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="footer-note">Программ пока нет — проанализируйте источник или добавьте вручную слева.</td></tr>';
      return;
    }
    body.innerHTML = state.programs
      .map(function (p) {
        return (
          "<tr><td><strong>" + esc(p.title) + '</strong><div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px">' + esc(p.potential) + "</div></td>" +
          "<td>" + esc(p.type) + "</td><td>" + esc(p.businessLine) + "</td><td>" + esc(p.region) + "</td>" +
          '<td><span class="status-chip ' + (STATUS_CLASS[p.status] || "status-wait") + '" data-program-id="' + p.id + '" style="cursor:pointer">' + esc(p.status) + "</span></td></tr>"
        );
      })
      .join("");

    Array.prototype.forEach.call(body.querySelectorAll("[data-program-id]"), function (chip) {
      chip.addEventListener("click", function () { cycleStatus(chip.getAttribute("data-program-id")); });
    });
  }

  async function cycleStatus(id) {
    var prog = state.programs.find(function (p) { return p.id === id; });
    if (!prog) return;
    var next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(prog.status) + 1) % STATUS_CYCLE.length];
    var res = await Auth.apiFetch("/support/programs/" + id, { method: "PATCH", body: { status: next } });
    if (res.ok) loadPrograms();
  }

  loadPrograms();
})();
