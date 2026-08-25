(function () {
  var state = { objects: [], profile: "Девелопмент", listFilter: "", query: "" };

  function filteredObjects() {
    if (!state.query) return state.objects;
    return state.objects.filter(function (o) {
      return (o.title + " " + o.region).toLowerCase().indexOf(state.query) !== -1;
    });
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
  var STATUS_CLASS = { "приоритет": "status-ok", "риск": "status-risk", "углубленная проверка": "status-wait", "первичный скрининг": "status-new" };

  Array.prototype.forEach.call(document.querySelectorAll("#profileTabs .tab"), function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll("#profileTabs .tab"), function (t) { t.classList.remove("active"); });
      tab.classList.add("active");
      state.profile = tab.dataset.profile;
    });
  });

  document.getElementById("analyzeBtn").addEventListener("click", async function () {
    var url = document.getElementById("sourceUrl").value.trim();
    var text = document.getElementById("sourceText").value.trim();
    var errorBox = document.getElementById("analyzeError");
    errorBox.style.display = "none";
    if (!url && !text) { errorBox.textContent = "Укажите ссылку или вставьте текст объявления."; errorBox.style.display = "block"; return; }

    var btn = document.getElementById("analyzeBtn");
    btn.disabled = true;
    btn.textContent = "Анализируем...";
    try {
      var res = await Auth.apiFetch("/land/objects/analyze", { method: "POST", body: url ? { url: url } : { text: text } });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось проанализировать источник");
      document.getElementById("objTitle").value = data.title || "";
      document.getElementById("objRegion").value = data.region || "";
      document.getElementById("objArea").value = data.areaHectares ?? "";
      document.getElementById("objBudget").value = data.budgetMillion ?? "";
      document.getElementById("objRisk").value = data.riskNotes || "";
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Проанализировать (Claude)";
    }
  });

  document.getElementById("torgiSearchBtn").addEventListener("click", async function () {
    var errorBox = document.getElementById("torgiError");
    var resultsBox = document.getElementById("torgiResults");
    errorBox.style.display = "none";
    resultsBox.innerHTML = "";

    var dateFrom = document.getElementById("torgiDateFrom").value;
    var btn = document.getElementById("torgiSearchBtn");
    btn.disabled = true;
    btn.textContent = "Запрашиваем torgi.gov.ru...";
    try {
      var res = await Auth.apiFetch("/land/objects/search-torgi", {
        method: "POST",
        body: dateFrom ? { publishDateFrom: dateFrom } : {},
      });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось получить данные с госторгов");
      if (data.note) {
        resultsBox.innerHTML = '<div class="footer-note">' + esc(data.note) + "</div>";
        return;
      }
      resultsBox.innerHTML = data.results
        .map(function (r, i) {
          return (
            '<div class="row-card" style="margin-top:10px"><div><strong>' + esc(r.title) + " (" + esc(r.region) + ")</strong><span>" +
            (r.areaHectares ? r.areaHectares + " га · " : "") + (r.budgetMillion ? r.budgetMillion + " млн ₽ · " : "") + esc(r.riskNotes || "") +
            '</span></div><button class="btn btn-secondary" type="button" data-use-torgi-result="' + i + '">В карточку</button></div>'
          );
        })
        .join("");
      Array.prototype.forEach.call(resultsBox.querySelectorAll("[data-use-torgi-result]"), function (b) {
        b.addEventListener("click", function () {
          var r = data.results[parseInt(b.getAttribute("data-use-torgi-result"), 10)];
          document.getElementById("objTitle").value = r.title || "";
          document.getElementById("objRegion").value = r.region || "";
          document.getElementById("objArea").value = r.areaHectares ?? "";
          document.getElementById("objBudget").value = r.budgetMillion ?? "";
          document.getElementById("objRisk").value = r.riskNotes || "";
          document.getElementById("objectForm").scrollIntoView({ behavior: "smooth" });
        });
      });
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Найти лоты на госторгах";
    }
  });

  document.getElementById("objectForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("formError");
    errorBox.style.display = "none";
    var payload = {
      title: document.getElementById("objTitle").value,
      region: document.getElementById("objRegion").value,
      profile: state.profile,
      areaHectares: document.getElementById("objArea").value || undefined,
      budgetMillion: document.getElementById("objBudget").value || undefined,
      status: document.getElementById("objStatus").value,
      riskNotes: document.getElementById("objRisk").value || undefined,
      source: document.getElementById("sourceUrl").value ? "ссылка" : "ручной ввод",
      sourceUrl: document.getElementById("sourceUrl").value || undefined,
    };
    try {
      var res = await Auth.apiFetch("/land/objects", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error) || "Не удалось сохранить объект");
      e.target.reset();
      document.getElementById("sourceUrl").value = "";
      document.getElementById("sourceText").value = "";
      await loadObjects();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  document.getElementById("profileFilter").addEventListener("change", function (e) {
    state.listFilter = e.target.value;
    loadObjects();
  });

  async function loadObjects() {
    try {
      var url = "/land/objects" + (state.listFilter ? "?profile=" + encodeURIComponent(state.listFilter) : "");
      var res = await Auth.apiFetch(url);
      if (!res.ok) throw new Error("bad status");
      state.objects = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }
    render();
  }

  function render() {
    document.getElementById("statTotal").textContent = state.objects.length;
    document.getElementById("statPriority").textContent = state.objects.filter(function (o) { return o.status === "приоритет"; }).length;
    document.getElementById("statRisk").textContent = state.objects.filter(function (o) { return o.status === "риск"; }).length;

    var el = document.getElementById("objectsList");
    if (state.objects.length === 0) {
      el.innerHTML = '<div class="footer-note">Объектов пока нет — проанализируйте источник или добавьте вручную слева.</div>';
      return;
    }
    var visible = filteredObjects();
    if (visible.length === 0) {
      el.innerHTML = '<div class="footer-note">Ничего не найдено по запросу.</div>';
      return;
    }
    el.innerHTML = visible
      .map(function (o) {
        var details = [];
        if (o.areaHectares) details.push(o.areaHectares + " га");
        if (o.budgetMillion) details.push(o.budgetMillion + " млн ₽");
        details.push(o.profile);
        if (o.riskNotes) details.push(o.riskNotes);
        return (
          '<article class="row-card"><div><strong>' + esc(o.title) + " (" + esc(o.region) + ")</strong><span>" +
          esc(details.join(" · ")) + "</span></div>" +
          '<span class="status-chip ' + (STATUS_CLASS[o.status] || "status-wait") + '" data-object-id="' + o.id + '" style="cursor:pointer">' + esc(o.status) + "</span></article>"
        );
      })
      .join("");

    Array.prototype.forEach.call(el.querySelectorAll("[data-object-id]"), function (chip) {
      chip.addEventListener("click", function () { cycleStatus(chip.getAttribute("data-object-id")); });
    });
  }

  var STATUS_CYCLE = ["первичный скрининг", "углубленная проверка", "приоритет", "риск"];
  async function cycleStatus(id) {
    var obj = state.objects.find(function (o) { return o.id === id; });
    if (!obj) return;
    var next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(obj.status) + 1) % STATUS_CYCLE.length];
    var res = await Auth.apiFetch("/land/objects/" + id, { method: "PATCH", body: { status: next } });
    if (res.ok) loadObjects();
  }

  document.getElementById("quickAnalyzeBtn").addEventListener("click", function () {
    document.getElementById("sourceText").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("sourceText").focus();
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  loadObjects();
})();
