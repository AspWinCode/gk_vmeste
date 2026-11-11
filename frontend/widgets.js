// Логика виджетов рабочего стола (index.html): применение сохранённых настроек
// (порядок/скрытые/широкие), перетаскивание для перестановки, переключение
// ширины и быстрое скрытие прямо с карточки. Сетка — CSS grid с dense-упаковкой
// (см. .dashboard-grid в styles.css), поэтому при скрытии/смене ширины виджета
// остальные сами перетекают и закрывают пустоты — расчёт позиций не нужен,
// браузер делает это за нас, мы только проставляем порядок и класс ширины.
//
// Высоты виджетов при этом разные (например, "Мои приоритеты" с 4 поручениями
// заметно выше, чем "Ключевые показатели") — обычный CSS grid без явного row-span
// выравнивает все элементы ОДНОЙ строки по высоте самого высокого соседа, оставляя
// под короткими виджетами пустой зазор до конца строки. Чтобы это не происходило,
// сетка переведена на мелкие авто-строки (grid-auto-rows, см. styles.css) и каждому
// виджету выставляется grid-row-end: span N по его РЕАЛЬНОЙ измеренной высоте —
// тогда dense-упаковка затягивает следующие виджеты в освободившееся место по
// высоте так же, как и по ширине (классический приём "JS-masonry" для CSS grid).
(function () {
  var grid = document.getElementById("dashboardGrid");
  if (!grid || !window.Prefs) return;

  var ROW_UNIT = 8; // px — должен совпадать с grid-auto-rows в styles.css
  var ROW_GAP = 20; // px — должен совпадать с gap в styles.css

  var widgets = Array.prototype.slice.call(grid.querySelectorAll("[data-widget-id]"));
  var widgetById = {};
  widgets.forEach(function (el) { widgetById[el.getAttribute("data-widget-id")] = el; });

  function relayoutMasonry() {
    widgets.forEach(function (el) {
      if (el.classList.contains("widget-hidden")) return;
      var height = el.getBoundingClientRect().height;
      var span = Math.max(1, Math.ceil((height + ROW_GAP) / (ROW_UNIT + ROW_GAP)));
      el.style.gridRowEnd = "span " + span;
    });
  }

  var relayoutQueued = false;
  function scheduleRelayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(function () {
      relayoutQueued = false;
      relayoutMasonry();
    });
  }

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
    scheduleRelayout();
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
    if (from === -1 || prefs.order.indexOf(targetId) === -1) return;
    prefs.order.splice(from, 1);
    // Индекс цели пересчитываем ПОСЛЕ удаления перетаскиваемого виджета из массива —
    // если dragged шёл раньше target, удаление сдвигает все последующие индексы на 1,
    // и индекс, посчитанный до splice, указывал бы на позицию на один слот дальше.
    var to = prefs.order.indexOf(targetId);
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

  // ResizeObserver сам ловит ЛЮБОе изменение высоты виджета — в том числе асинхронную
  // подгрузку данных index.js (когда "Загрузка..." заменяется на реальный список) —
  // без этого пересчёт понадобился бы отдельным вызовом из каждого места в index.js,
  // которое меняет innerHTML виджета.
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(scheduleRelayout);
    widgets.forEach(function (el) { ro.observe(el); });
  } else {
    scheduleRelayout();
  }
  window.addEventListener("resize", scheduleRelayout);

  // Чтобы скрытые/показанные через "Настройки" в другой вкладке виджеты
  // применялись и здесь без перезагрузки страницы.
  window.addEventListener("storage", function (e) {
    if (e.key === "vmeste-dashboard-prefs") applyPrefs();
  });

  window.VmesteDashboard = { applyPrefs: applyPrefs, relayout: scheduleRelayout };
})();
