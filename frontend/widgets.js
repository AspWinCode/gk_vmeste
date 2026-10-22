// Логика виджетов рабочего стола (index.html): применение сохранённых настроек
// (порядок/скрытые/широкие), перетаскивание для перестановки, переключение
// ширины и быстрое скрытие прямо с карточки. Сетка — CSS grid с dense-упаковкой
// (см. .dashboard-grid в styles.css), поэтому при скрытии/смене ширины виджета
// остальные сами перетекают и закрывают пустоты — расчёт позиций не нужен,
// браузер делает это за нас, мы только проставляем порядок и класс ширины.
(function () {
  var grid = document.getElementById("dashboardGrid");
  if (!grid || !window.Prefs) return;

  var widgets = Array.prototype.slice.call(grid.querySelectorAll("[data-widget-id]"));
  var widgetById = {};
  widgets.forEach(function (el) { widgetById[el.getAttribute("data-widget-id")] = el; });

  function applyPrefs() {
    var prefs = Prefs.getDashboardPrefs();

    // Порядок: CSS order проще и безопаснее, чем перемещать узлы в DOM
    // (не теряем обработчики/состояние скролла при каждом применении).
    prefs.order.forEach(function (id, index) {
      var el = widgetById[id];
      if (el) el.style.order = index;
    });

    widgets.forEach(function (el) {
      var id = el.getAttribute("data-widget-id");
      el.classList.toggle("widget-hidden", prefs.hidden.indexOf(id) !== -1);
      el.classList.toggle("widget-wide", prefs.wide.indexOf(id) !== -1);
    });
  }

  function hideWidget(id) {
    var prefs = Prefs.getDashboardPrefs();
    if (prefs.hidden.indexOf(id) === -1) prefs.hidden.push(id);
    Prefs.setDashboardPrefs(prefs);
    applyPrefs();
  }

  function toggleWide(id) {
    var prefs = Prefs.getDashboardPrefs();
    var pos = prefs.wide.indexOf(id);
    if (pos === -1) prefs.wide.push(id);
    else prefs.wide.splice(pos, 1);
    Prefs.setDashboardPrefs(prefs);
    applyPrefs();
  }

  function reorder(draggedId, targetId) {
    if (draggedId === targetId) return;
    var prefs = Prefs.getDashboardPrefs();
    var from = prefs.order.indexOf(draggedId);
    var to = prefs.order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    prefs.order.splice(from, 1);
    prefs.order.splice(to, 0, draggedId);
    Prefs.setDashboardPrefs(prefs);
    applyPrefs();
  }

  widgets.forEach(function (el) {
    var id = el.getAttribute("data-widget-id");

    var hideBtn = el.querySelector(".widget-hide-btn");
    if (hideBtn) hideBtn.addEventListener("click", function () { hideWidget(id); });

    var wideBtn = el.querySelector(".widget-wide-toggle");
    if (wideBtn) wideBtn.addEventListener("click", function () { toggleWide(id); });

    el.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", function () {
      el.classList.remove("dragging");
      widgets.forEach(function (w) { w.classList.remove("drag-over"); });
    });
    el.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", function () {
      el.classList.remove("drag-over");
    });
    el.addEventListener("drop", function (e) {
      e.preventDefault();
      el.classList.remove("drag-over");
      var draggedId = e.dataTransfer.getData("text/plain");
      reorder(draggedId, id);
    });
  });

  applyPrefs();

  // Чтобы скрытые/показанные через "Настройки" в другой вкладке виджеты
  // применялись и здесь без перезагрузки страницы.
  window.addEventListener("storage", function (e) {
    if (e.key === "vmeste-dashboard-prefs") applyPrefs();
  });

  window.VmesteDashboard = { applyPrefs: applyPrefs };
})();
