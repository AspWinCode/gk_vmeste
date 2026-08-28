(function () {
  var state = { jobs: [], selectedId: null, pollHandle: null, query: "" };

  function filteredJobs() {
    if (!state.query) return state.jobs;
    return state.jobs.filter(function (j) {
      return (j.audioFileName + " " + (j.meetingType || "")).toLowerCase().indexOf(state.query) !== -1;
    });
  }

  var STATUS_LABEL = {
    QUEUED: "в очереди",
    TRANSCRIBING: "распознавание речи",
    SUMMARIZING: "анализ Claude",
    DONE: "готово",
    FAILED: "ошибка",
  };
  var STATUS_CLASS = {
    QUEUED: "status-wait",
    TRANSCRIBING: "status-wait",
    SUMMARIZING: "status-wait",
    DONE: "status-ok",
    FAILED: "status-risk",
  };
  var ACTIVE_STATUSES = ["QUEUED", "TRANSCRIBING", "SUMMARIZING"];

  function esc(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function showApiWarning(show) {
    var box = document.getElementById("apiWarning");
    document.getElementById("apiWarningUrl").textContent = window.API_BASE;
    box.style.display = show ? "block" : "none";
  }

  async function fetchJobs() {
    try {
      var res = await Auth.apiFetch("/transcriber/jobs");
      if (!res.ok) throw new Error("bad status " + res.status);
      state.jobs = await res.json();
      showApiWarning(false);
    } catch (err) {
      showApiWarning(true);
      return;
    }
    renderQueueAndHistory();
    renderHeroStats();

    if (!state.selectedId && state.jobs.length > 0) {
      selectJob(state.jobs[0].id);
    }

    var anyActive = state.jobs.some(function (j) { return ACTIVE_STATUSES.indexOf(j.status) !== -1; });
    if (state.selectedId) {
      var selected = state.jobs.find(function (j) { return j.id === state.selectedId; });
      if (selected && ACTIVE_STATUSES.indexOf(selected.status) !== -1) {
        loadJobDetail(state.selectedId);
      }
    }
    schedulePoll(anyActive);
  }

  function schedulePoll(fast) {
    if (state.pollHandle) clearTimeout(state.pollHandle);
    state.pollHandle = setTimeout(fetchJobs, fast ? 3000 : 8000);
  }

  function renderHeroStats() {
    var total = state.jobs.length;
    var active = state.jobs.filter(function (j) { return ACTIVE_STATUSES.indexOf(j.status) !== -1; }).length;
    document.getElementById("statTotal").textContent = total;
    document.getElementById("statActive").textContent = active;
    document.getElementById("statTasks").textContent = state.jobs
      .filter(function (j) { return j.status === "DONE"; }).length > 0 ? "см. поручения" : "0";
  }

  function queueItemHtml(job) {
    var progress = job.progressPercent || 0;
    var active = state.selectedId === job.id;
    return (
      '<div class="queue-item" data-job-id="' + job.id + '" style="cursor:pointer;' +
      (active ? "border-color:var(--color-primary)" : "") + '">' +
      "<strong>" + esc(job.audioFileName) + "</strong>" +
      "<span>" + esc(job.meetingType || "Аудио") + " · загружен " + formatTime(job.createdAt) + " · " + STATUS_LABEL[job.status] + "</span>" +
      '<div class="progress"><i style="width:' + progress + '%"></i></div>' +
      "</div>"
    );
  }

  function historyItemHtml(job) {
    var chipClass = STATUS_CLASS[job.status] || "status-wait";
    return (
      '<div class="history-item" data-job-id="' + job.id + '" style="cursor:pointer">' +
      "<div><strong>" + esc(job.audioFileName) + "</strong><span>" + formatTime(job.createdAt) + " · " + esc(job.meetingType || "") + "</span></div>" +
      '<span class="status-chip ' + chipClass + '">' + STATUS_LABEL[job.status] + "</span>" +
      "</div>"
    );
  }

  function renderQueueAndHistory() {
    var queueEl = document.getElementById("queueList");
    var historyEl = document.getElementById("historyList");

    if (state.jobs.length === 0) {
      queueEl.innerHTML = '<div class="footer-note">Загрузок пока нет.</div>';
      historyEl.innerHTML = '<div class="footer-note">Пока нет истории.</div>';
      return;
    }
    var visible = filteredJobs();
    if (visible.length === 0) {
      queueEl.innerHTML = '<div class="footer-note">Ничего не найдено по запросу.</div>';
      historyEl.innerHTML = '<div class="footer-note">Ничего не найдено по запросу.</div>';
      return;
    }

    queueEl.innerHTML = visible.map(queueItemHtml).join("");
    historyEl.innerHTML = visible.map(historyItemHtml).join("");

    Array.prototype.forEach.call(document.querySelectorAll("[data-job-id]"), function (el) {
      el.addEventListener("click", function () {
        selectJob(el.getAttribute("data-job-id"));
      });
    });
  }

  function selectJob(id) {
    state.selectedId = id;
    renderQueueAndHistory();
    loadJobDetail(id);
  }

  async function loadJobDetail(id) {
    var res = await Auth.apiFetch("/transcriber/jobs/" + id);
    if (!res.ok) return;
    var job = await res.json();
    renderJobDetail(job);

    if (job.status === "DONE") {
      var tasksRes = await Auth.apiFetch("/tasks?source=" + encodeURIComponent("transcriber:" + job.id));
      var tasks = tasksRes.ok ? await tasksRes.json() : [];
      renderTasks(tasks);
    } else {
      document.getElementById("taskList").innerHTML =
        '<div class="footer-note">Поручения появятся здесь после завершения обработки.</div>';
    }
  }

  function renderJobDetail(job) {
    document.getElementById("jobEmpty").style.display = "none";
    document.getElementById("jobDetail").style.display = "block";

    document.getElementById("jobSubtitle").textContent = job.audioFileName;
    var chip = document.getElementById("jobStatusChip");
    chip.textContent = STATUS_LABEL[job.status];
    chip.className = "status-chip " + (STATUS_CLASS[job.status] || "status-wait");

    var pills = [job.meetingType || "Аудио", job.language === "ru" ? "русский" : job.language];
    document.getElementById("jobMetaPills").innerHTML = pills
      .map(function (p) { return '<span class="pill">' + esc(p) + "</span>"; })
      .join("");

    document.getElementById("summaryText").textContent = job.summary || (job.status === "FAILED" ? "Обработка завершилась ошибкой: " + (job.errorMessage || "") : "Обработка ещё не завершена.");
    document.getElementById("keyPointsList").innerHTML = (job.keyPoints || [])
      .map(function (p, i) { return '<div class="quote">' + (i + 1) + ". " + esc(p) + "</div>"; })
      .join("") || '<div class="footer-note">Пока нет тезисов.</div>';
    document.getElementById("transcriptText").textContent = job.transcriptText || "—";

    // Блок по шаблону встречи (участники/предмет/ход/решения/планы) показываем только когда
    // Claude реально его заполнил — для диктовки эти поля пустые, и блок скрыт целиком,
    // а не выводится с прочерками по всем пунктам.
    var isMeetingTemplate = (job.participants && job.participants.length > 0) || job.subject ||
      (job.discussionPoints && job.discussionPoints.length > 0) || (job.decisions && job.decisions.length > 0) ||
      (job.plans && job.plans.length > 0);
    document.getElementById("meetingBlock").style.display = isMeetingTemplate ? "block" : "none";
    if (isMeetingTemplate) {
      document.getElementById("subjectText").textContent = job.subject || "—";
      renderQuoteList("participantsList", job.participants, "Участники не определены.");
      renderQuoteList("discussionList", job.discussionPoints, "—");
      renderQuoteList("decisionsList", job.decisions, "—");
      renderQuoteList("plansList", job.plans, "—");
    }

    renderParticipantEmails(job.participantEmails || []);

    var exportBtn = document.getElementById("exportBtn");
    var sendBtn = document.getElementById("sendBtn");
    exportBtn.disabled = job.status !== "DONE";
    sendBtn.disabled = job.status !== "DONE" || !job.participantEmails || job.participantEmails.length === 0;
    exportBtn.onclick = function () { exportJob(job.id); };
    sendBtn.onclick = function () { sendJob(job.id); };
  }

  function renderQuoteList(elId, items, emptyText) {
    var el = document.getElementById(elId);
    el.innerHTML = (items && items.length > 0)
      ? items.map(function (p) { return '<div class="quote">' + esc(p) + "</div>"; }).join("")
      : '<div class="footer-note">' + esc(emptyText) + "</div>";
  }

  function renderParticipantEmails(emails) {
    var el = document.getElementById("participantEmailsList");
    el.innerHTML = emails.length > 0
      ? emails.map(function (e) { return '<span class="tag">' + esc(e) + "</span>"; }).join("")
      : '<span class="footer-note">Email пока не добавлены.</span>';
  }

  function renderTasks(tasks) {
    var el = document.getElementById("taskList");
    if (tasks.length === 0) {
      el.innerHTML = '<div class="footer-note">Claude не выделил явных поручений в этой встрече.</div>';
      return;
    }
    el.innerHTML = tasks
      .map(function (t) {
        return (
          '<div class="task-item"><div><strong>' + esc(t.title) + "</strong><span>" +
          esc(t.description || "") + (t.dueDate ? " · срок: " + formatTime(t.dueDate) : "") +
          '</span></div><span class="status-chip status-new">' + esc(t.status) + "</span></div>"
        );
      })
      .join("");
  }

  async function exportJob(id) {
    var res = await Auth.apiFetch("/transcriber/jobs/" + id + "/export", { method: "POST" });
    if (!res.ok) {
      alert("Не удалось сформировать протокол");
      return;
    }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "protocol-" + id + ".docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function sendJob(id) {
    var res = await Auth.apiFetch("/transcriber/jobs/" + id + "/send", { method: "POST" });
    var data = await res.json();
    if (!res.ok) {
      alert(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось отправить письма");
      return;
    }
    if (!data.sent) {
      alert("SMTP не настроен на сервере — письма не отправлены (см. backend/.env).");
      return;
    }
    var failed = data.results.filter(function (r) { return !r.sent; });
    if (failed.length === 0) {
      alert("Письма отправлены каждому участнику отдельно: " + data.results.length + " шт.");
    } else {
      alert(
        "Отправлено: " + (data.results.length - failed.length) + " из " + data.results.length +
        ". Не удалось: " + failed.map(function (r) { return r.email; }).join(", ")
      );
    }
  }

  document.getElementById("uploadForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var fileInput = document.getElementById("audioFile");
    var errorBox = document.getElementById("uploadError");
    errorBox.style.display = "none";

    if (!fileInput.files[0]) return;

    var formData = new FormData();
    formData.append("audio", fileInput.files[0]);
    formData.append("meetingType", document.getElementById("meetingType").value);
    formData.append("participantEmails", document.getElementById("participantEmails").value);
    formData.append("language", "ru");

    var btn = document.getElementById("uploadBtn");
    btn.disabled = true;
    btn.textContent = "Загрузка...";
    try {
      var res = await Auth.apiFetch("/transcriber/jobs", { method: "POST", body: formData });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось загрузить файл");
      fileInput.value = "";
      document.getElementById("participantEmails").value = "";
      state.selectedId = data.id;
      await fetchJobs();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Загрузить и обработать";
    }
  });

  document.getElementById("addEmailForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var errorBox = document.getElementById("addEmailError");
    errorBox.style.display = "none";
    var input = document.getElementById("addEmailInput");
    var email = input.value.trim();
    if (!email || !state.selectedId) return;

    try {
      var res = await Auth.apiFetch("/transcriber/jobs/" + state.selectedId + "/participants", {
        method: "PATCH",
        body: { emails: [email] },
      });
      var data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : JSON.stringify(data.error) || "Не удалось добавить email");
      input.value = "";
      renderParticipantEmails(data.participantEmails || []);
      document.getElementById("sendBtn").disabled = false;
      // обновляем и в очереди/истории, чтобы список email не потерялся при переоткрытии
      var job = state.jobs.find(function (j) { return j.id === state.selectedId; });
      if (job) job.participantEmails = data.participantEmails;
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  document.getElementById("globalSearchInput").addEventListener("input", function (e) {
    state.query = e.target.value.trim().toLowerCase();
    renderQueueAndHistory();
  });

  document.getElementById("quickUploadBtn").addEventListener("click", function () {
    document.getElementById("uploadForm").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("audioFile").click();
  });

  fetchJobs();
})();
