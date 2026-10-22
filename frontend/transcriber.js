(function () {
  var state = { jobs: [], selectedId: null, pollHandle: null, query: "", lastDetailStatus: null };

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
      // Перезагружаем панель результата, пока статус активен, И ещё один раз, когда он
      // только что сменился — иначе при переходе QUEUED/TRANSCRIBING/SUMMARIZING → DONE/FAILED
      // панель навсегда застревает на последнем увиденном "в процессе" состоянии: как только
      // статус перестаёт быть активным, опрос просто перестаёт её трогать.
      if (selected && (ACTIVE_STATUSES.indexOf(selected.status) !== -1 || selected.status !== state.lastDetailStatus)) {
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
    if (job.id === state.selectedId) state.lastDetailStatus = job.status;
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
    // Полный текст расшифровки показывается не здесь, а в Настройках — см.
    // settings.js/loadTranscripts(), чтобы не растягивать этот экран на десятки тысяч символов.

    // Блок по шаблону встречи (участники/предмет/ход/решения/планы) показываем только когда
    // Claude реально его заполнил — для диктовки эти поля пустые, и блок скрыт целиком,
    // а не выводится с прочерками по всем пунктам.
    var isMeetingTemplate = (job.participants && job.participants.length > 0) || job.subject ||
      (job.discussionPoints && job.discussionPoints.length > 0) || (job.decisions && job.decisions.length > 0) ||
      (job.plans && job.plans.length > 0);
    document.getElementById("meetingBlock").style.display = isMeetingTemplate ? "block" : "none";
    if (isMeetingTemplate) {
      document.getElementById("subjectText").textContent = job.subject || "—";
      renderParticipantTags("participantsList", job.participants, "Участники не определены.");
      renderCompactList("discussionList", job.discussionPoints, "—");
      renderCompactList("decisionsList", job.decisions, "—");
      renderCompactList("plansList", job.plans, "—");
    }

    renderParticipantEmails(job.participantEmails || []);

    var exportBtn = document.getElementById("exportBtn");
    var sendBtn = document.getElementById("sendBtn");
    exportBtn.disabled = job.status !== "DONE";
    sendBtn.disabled = job.status !== "DONE" || !job.participantEmails || job.participantEmails.length === 0;
    exportBtn.onclick = function () { exportJob(job.id); };
    sendBtn.onclick = function () { sendJob(job.id); };
  }

  // Компактный маркированный список вместо отдельной карточки на каждый пункт — при 15-20
  // пунктах обсуждения (реальная встреча) карточки растягивали страницу в несколько экранов вниз.
  function renderCompactList(elId, items, emptyText) {
    var el = document.getElementById(elId);
    el.innerHTML = (items && items.length > 0)
      ? '<ul class="compact-list">' + items.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>"
      : '<div class="footer-note">' + esc(emptyText) + "</div>";
  }

  // Участники — короткие подписи ("Спикер A"), отдельная карточка на каждого была избыточной;
  // компактные чипы в строку, как email-теги ниже.
  function renderParticipantTags(elId, items, emptyText) {
    var el = document.getElementById(elId);
    el.innerHTML = (items && items.length > 0)
      ? items.map(function (p) { return '<span class="tag">' + esc(p) + "</span>"; }).join("")
      : '<span class="footer-note">' + esc(emptyText) + "</span>";
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

  // Общая загрузка — используется и формой (выбор файла), и записью с микрофона
  // (см. ниже): оба пути собирают один и тот же FormData и ту же обработку ошибок.
  async function uploadAudio(file) {
    var errorBox = document.getElementById("uploadError");
    errorBox.style.display = "none";

    var formData = new FormData();
    formData.append("audio", file, file.name);
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
  }

  document.getElementById("uploadForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var fileInput = document.getElementById("audioFile");
    var errorBox = document.getElementById("uploadError");
    if (!fileInput.files[0]) {
      errorBox.textContent = "Выберите файл или запишите аудио с микрофона.";
      errorBox.style.display = "block";
      return;
    }
    await uploadAudio(fileInput.files[0]);
    fileInput.value = "";
  });

  // --- Справочник получателей: выбор контакта подставляет email в поле рассылки ---

  function appendEmailToField(inputEl, email) {
    var current = inputEl.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (current.indexOf(email) === -1) current.push(email);
    inputEl.value = current.join(", ");
  }

  async function loadContactPickers() {
    try {
      var res = await Auth.apiFetch("/contacts");
      if (!res.ok) return;
      var contacts = await res.json();
      var optionsHtml = contacts
        .map(function (c) { return '<option value="' + esc(c.email) + '">' + esc(c.fullName) + (c.position ? " — " + esc(c.position) : "") + "</option>"; })
        .join("");

      var uploadPicker = document.getElementById("contactPickerUpload");
      if (uploadPicker) {
        uploadPicker.innerHTML = '<option value="">+ добавить из справочника...</option>' + optionsHtml;
        uploadPicker.addEventListener("change", function () {
          if (!uploadPicker.value) return;
          appendEmailToField(document.getElementById("participantEmails"), uploadPicker.value);
          uploadPicker.value = "";
        });
      }

      var jobPicker = document.getElementById("contactPickerJob");
      if (jobPicker) {
        jobPicker.innerHTML = '<option value="">+ добавить из справочника...</option>' + optionsHtml;
        jobPicker.addEventListener("change", async function () {
          if (!jobPicker.value || !state.selectedId) return;
          var res2 = await Auth.apiFetch("/transcriber/jobs/" + state.selectedId + "/participants", {
            method: "PATCH",
            body: { emails: [jobPicker.value] },
          });
          var data = await res2.json();
          if (res2.ok) {
            renderParticipantEmails(data.participantEmails || []);
            document.getElementById("sendBtn").disabled = false;
            var job = state.jobs.find(function (j) { return j.id === state.selectedId; });
            if (job) job.participantEmails = data.participantEmails;
          }
          jobPicker.value = "";
        });
      }
    } catch (e) {}
  }

  // --- Запись с микрофона: выбор устройства, запись через MediaRecorder, автозагрузка ---

  var recordState = { mediaRecorder: null, stream: null, chunks: [], timerHandle: null, startedAt: null };

  async function populateMicList() {
    var select = document.getElementById("micSelect");
    if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var mics = devices.filter(function (d) { return d.kind === "audioinput"; });
      select.innerHTML = mics.length > 0
        ? mics.map(function (d, i) { return '<option value="' + esc(d.deviceId) + '">' + esc(d.label || "Микрофон " + (i + 1)) + "</option>"; }).join("")
        : '<option value="">Микрофон по умолчанию</option>';
    } catch (e) {}
  }

  function formatTimer(ms) {
    var totalSec = Math.floor(ms / 1000);
    var m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    var s = String(totalSec % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function pickRecorderMimeType() {
    var candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return "";
  }

  async function startRecording() {
    var errorBox = document.getElementById("recordError");
    errorBox.style.display = "none";

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errorBox.textContent = "Запись с микрофона недоступна в этом браузере без защищённого соединения (HTTPS/localhost).";
      errorBox.style.display = "block";
      return;
    }

    var deviceId = document.getElementById("micSelect").value;
    try {
      recordState.stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (err) {
      errorBox.textContent = "Не удалось получить доступ к микрофону: " + err.message;
      errorBox.style.display = "block";
      return;
    }

    await populateMicList(); // теперь, когда доступ дан, у устройств появятся человекочитаемые названия

    var mimeType = pickRecorderMimeType();
    recordState.chunks = [];
    recordState.mediaRecorder = mimeType
      ? new MediaRecorder(recordState.stream, { mimeType: mimeType })
      : new MediaRecorder(recordState.stream);

    recordState.mediaRecorder.addEventListener("dataavailable", function (e) {
      if (e.data && e.data.size > 0) recordState.chunks.push(e.data);
    });

    recordState.mediaRecorder.addEventListener("stop", async function () {
      recordState.stream.getTracks().forEach(function (t) { t.stop(); });
      clearInterval(recordState.timerHandle);
      document.getElementById("recordTimer").style.display = "none";

      var blob = new Blob(recordState.chunks, { type: recordState.mediaRecorder.mimeType || "audio/webm" });
      var ext = (blob.type.indexOf("ogg") !== -1) ? "ogg" : (blob.type.indexOf("mp4") !== -1 ? "m4a" : "webm");
      var file = new File([blob], "запись-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "." + ext, { type: blob.type });
      await uploadAudio(file);
    });

    recordState.mediaRecorder.start();
    recordState.startedAt = Date.now();
    var timerEl = document.getElementById("recordTimer");
    timerEl.style.display = "inline";
    timerEl.textContent = "00:00";
    recordState.timerHandle = setInterval(function () {
      timerEl.textContent = formatTimer(Date.now() - recordState.startedAt);
    }, 1000);

    var btn = document.getElementById("recordBtn");
    btn.textContent = "⏹ Остановить запись";
    btn.classList.remove("btn-primary");
    btn.classList.add("btn-secondary");
  }

  function stopRecording() {
    if (recordState.mediaRecorder && recordState.mediaRecorder.state !== "inactive") {
      recordState.mediaRecorder.stop();
    }
    var btn = document.getElementById("recordBtn");
    btn.textContent = "● Начать запись";
    btn.classList.remove("btn-secondary");
    btn.classList.add("btn-primary");
  }

  document.getElementById("recordBtn").addEventListener("click", function () {
    var isRecording = recordState.mediaRecorder && recordState.mediaRecorder.state === "recording";
    if (isRecording) stopRecording();
    else startRecording();
  });

  document.getElementById("micRefreshBtn").addEventListener("click", populateMicList);
  populateMicList();
  loadContactPickers();

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
