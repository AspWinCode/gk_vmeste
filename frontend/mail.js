(function () {
  var state = { messages: [] };
  var PRIORITY_CLASS = { "высокий": "status-risk", "средний": "status-wait", "низкий": "status-ok" };

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

  async function loadHistory() {
    try {
      var res = await Auth.apiFetch("/mail/messages");
      if (!res.ok) throw new Error("bad status");
      state.messages = await res.json();
      showApiWarning(false);
    } catch (e) {
      showApiWarning(true);
      return;
    }
    renderStats();
    renderHistory();
  }

  function renderStats() {
    document.getElementById("statTotal").textContent = state.messages.length;
    document.getElementById("statHigh").textContent = state.messages.filter(function (m) { return m.priority === "высокий"; }).length;
  }

  function renderHistory() {
    var el = document.getElementById("historyList");
    if (state.messages.length === 0) {
      el.innerHTML = '<div class="footer-note">Писем пока нет.</div>';
      return;
    }
    el.innerHTML = state.messages
      .map(function (m) {
        return (
          '<div class="history-item"><div><strong>' + esc(m.subject || "(без темы)") + "</strong><span>" +
          new Date(m.createdAt).toLocaleString("ru-RU") + " · " + esc(m.category) + " · " + esc(m.summary) + '</span></div>' +
          '<span class="status-chip ' + (PRIORITY_CLASS[m.priority] || "status-wait") + '">' + esc(m.priority) + "</span></div>"
        );
      })
      .join("");
  }

  function renderResult(message, tasks) {
    document.getElementById("resultEmpty").style.display = "none";
    document.getElementById("resultDetail").style.display = "block";
    var chip = document.getElementById("resultChip");
    chip.textContent = message.priority + " приоритет · " + message.category;
    chip.className = "status-chip " + (PRIORITY_CLASS[message.priority] || "status-wait");
    document.getElementById("resultSummary").textContent = message.summary;

    var tasksEl = document.getElementById("resultTasks");
    document.getElementById("statTasks").textContent =
      (parseInt(document.getElementById("statTasks").textContent, 10) || 0) + tasks.length;
    tasksEl.innerHTML = tasks.length
      ? tasks
          .map(function (t) {
            return (
              '<div class="task-item"><div><strong>' + esc(t.title) + "</strong><span>" + esc(t.description || "") +
              (t.dueDate ? " · срок: " + new Date(t.dueDate).toLocaleDateString("ru-RU") : "") + "</span></div>" +
              '<span class="status-chip status-new">' + esc(t.status) + "</span></div>"
            );
          })
          .join("")
      : '<div class="footer-note">Claude не выделил явных поручений в этом письме.</div>';
  }

  document.getElementById("mailForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("formError");
    errorBox.style.display = "none";
    var payload = {
      subject: document.getElementById("mailSubject").value || undefined,
      fromAddress: document.getElementById("mailFrom").value || undefined,
      text: document.getElementById("mailText").value,
    };

    var btn = document.getElementById("analyzeBtn");
    btn.disabled = true;
    btn.textContent = "Claude анализирует...";
    try {
      var res = await Auth.apiFetch("/mail/analyze", { method: "POST", body: payload });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось разобрать письмо");
      renderResult(data.message, data.tasks);
      document.getElementById("mailForm").reset();
      await loadHistory();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Разобрать (Claude)";
    }
  });

  document.getElementById("quickAnalyzeBtn").addEventListener("click", function () {
    document.getElementById("mailForm").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("mailText").focus();
  });

  loadHistory();
})();
