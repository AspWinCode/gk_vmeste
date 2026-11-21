(function () {
  var esc = window.escHtml; // общий хелпер, см. util.js
  var state = { ideas: [], filter: "", query: "", telegramConnected: false };

  function showApiWarning(show) {
    var box = document.getElementById("apiWarning");
    document.getElementById("apiWarningUrl").textContent = window.API_BASE;
    box.style.display = show ? "block" : "none";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }

  // Публикация работает только если в Настройках подключён Telegram (см.
  // settings.js/settings.html, секция "Интеграции") — запрашиваем статус отдельно,
  // чтобы кнопка "Опубликовать" сразу показывала актуальное состояние, а не узнавала
  // об отсутствии канала только после клика и ошибки от backend.
  async function loadTelegramStatus() {
    try {
      var res = await Auth.apiFetch("/integrations");
      if (!res.ok) return;
      var integrations = await res.json();
      state.telegramConnected = integrations.some(function (i) { return i.type === "TELEGRAM"; });
    } catch (e) {}
  }

  async function loadIdeas() {
    try {
      var res = await Auth.apiFetch("/content-ideas");
      if (!res.ok) throw new Error("bad status " + res.status);
      state.ideas = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }

    var published = state.ideas.filter(function (i) { return i.published; }).length;
    document.getElementById("statTotal").textContent = state.ideas.length;
    document.getElementById("statPending").textContent = state.ideas.length - published;
    document.getElementById("statPublished").textContent = published;

    renderTable();
  }

  function matchesFilters(idea) {
    if (state.filter === "pending" && idea.published) return false;
    if (state.filter === "published" && !idea.published) return false;
    if (!state.query) return true;
    return (idea.title + " " + idea.topic).toLowerCase().indexOf(state.query) !== -1;
  }

  function renderTable() {
    var body = document.getElementById("ideasTableBody");
    var visible = state.ideas.filter(matchesFilters);

    if (state.ideas.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="footer-note">Темы появятся здесь сами после обработки записей в Транскрибаторе-референте.</td></tr>';
      return;
    }
    if (visible.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="footer-note">Ничего не найдено по текущему фильтру.</td></tr>';
      return;
    }

    body.innerHTML = visible.map(function (idea) {
      var source = idea.job
        ? esc(idea.job.subject || idea.job.audioFileName) + '<br/><span class="footer-note">' + fmtDate(idea.job.createdAt) + "</span>"
        : "—";
      var publishBtn = state.telegramConnected
        ? '<button type="button" class="btn btn-secondary btn-sm" data-publish-id="' + idea.id + '">' +
          (idea.published ? "Опубликовать ещё раз" : "Опубликовать") + "</button>"
        : '<span class="footer-note">Подключите Telegram в Настройках</span>';
      return (
        "<tr" + (idea.published ? ' style="opacity:.6"' : "") + ">" +
        "<td><strong>" + esc(idea.title) + "</strong></td>" +
        "<td>" + esc(idea.topic) + "</td>" +
        "<td>" + source + "</td>" +
        "<td>" + publishBtn + "</td>" +
        '<td><input type="checkbox" data-idea-id="' + idea.id + '"' + (idea.published ? " checked" : "") +
        ' style="width:18px;height:18px;accent-color:var(--color-primary);cursor:pointer" aria-label="Отметить выложенным" /></td>' +
        "</tr>"
      );
    }).join("");

    Array.prototype.forEach.call(body.querySelectorAll("[data-idea-id]"), function (cb) {
      cb.addEventListener("change", async function () {
        var id = cb.getAttribute("data-idea-id");
        cb.disabled = true;
        try {
          var res = await Auth.apiFetch("/content-ideas/" + id, { method: "PATCH", body: { published: cb.checked } });
          if (!res.ok) throw new Error("Не удалось обновить");
          var idea = state.ideas.find(function (i) { return i.id === id; });
          if (idea) idea.published = cb.checked;
          var published = state.ideas.filter(function (i) { return i.published; }).length;
          document.getElementById("statPending").textContent = state.ideas.length - published;
          document.getElementById("statPublished").textContent = published;
          renderTable();
        } catch (e) {
          cb.checked = !cb.checked;
          alert(e.message);
        } finally {
          cb.disabled = false;
        }
      });
    });

    Array.prototype.forEach.call(body.querySelectorAll("[data-publish-id]"), function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-publish-id");
        var idea = state.ideas.find(function (i) { return i.id === id; });
        if (!idea) return;
        if (!confirm('Опубликовать тему «' + idea.title + '» в подключённый Telegram-канал прямо сейчас?')) return;
        btn.disabled = true;
        btn.textContent = "Публикуем...";
        try {
          var res = await Auth.apiFetch("/content-ideas/" + id + "/publish", { method: "POST" });
          var data = await res.json();
          if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось опубликовать");
          idea.published = true;
          var published = state.ideas.filter(function (i) { return i.published; }).length;
          document.getElementById("statPending").textContent = state.ideas.length - published;
          document.getElementById("statPublished").textContent = published;
          renderTable();
        } catch (e) {
          alert(e.message);
          btn.disabled = false;
          btn.textContent = idea.published ? "Опубликовать ещё раз" : "Опубликовать";
        }
      });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll("#statusFilters .filter"), function (btn) {
    btn.addEventListener("click", function () {
      state.filter = btn.getAttribute("data-filter");
      Array.prototype.forEach.call(document.querySelectorAll("#statusFilters .filter"), function (b) { b.classList.toggle("active", b === btn); });
      renderTable();
    });
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    renderTable();
  });

  loadTelegramStatus().then(loadIdeas);
})();
