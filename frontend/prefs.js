// Общий реестр и хранилище пользовательских настроек интерфейса (меню слева,
// виджеты рабочего стола). Подключается на каждой странице перед app.js —
// применяет видимость пунктов меню сразу при загрузке, чтобы не было мигания.
// Хранится только в этом браузере (localStorage), как и тема оформления.
(function () {
  var NAV_STORAGE_KEY = "vmeste-nav-hidden";
  var DASHBOARD_STORAGE_KEY = "vmeste-dashboard-prefs";

  // Пункты меню, которые можно скрывать. "Настройки" сюда намеренно не входит —
  // иначе пользователь может случайно спрятать единственный путь обратно к этим
  // настройкам.
  var NAV_ITEMS = [
    { id: "index", label: "Рабочий стол" },
    { id: "tasks", label: "Задачи" },
    { id: "assistants", label: "Каталог ассистентов" },
    { id: "finance", label: "Финансовый аналитик" },
    { id: "transcriber", label: "Транскрибатор-референт" },
    { id: "ksg", label: "Контроль КСГ" },
    { id: "land", label: "Земля и объекты" },
    { id: "support", label: "Меры поддержки" },
    { id: "finance-monitor", label: "Финмониторинг" },
    { id: "mail", label: "Разборщик почты" },
  ];

  // Виджеты рабочего стола (index.html). "wide" — ширина по умолчанию (span 2 колонки
  // в сетке), порядок — порядок по умолчанию, пока пользователь не перетащил карточки.
  var DASHBOARD_WIDGETS = [
    { id: "kpi", label: "Ключевые показатели", wide: true },
    { id: "priorities", label: "Мои приоритеты", wide: true },
    { id: "signals", label: "Критические сигналы", wide: false },
    { id: "upcoming", label: "Дальше по срокам", wide: false },
    { id: "directions", label: "Ход работы по направлениям", wide: true },
    { id: "feed", label: "Лента действий ассистентов", wide: true },
    { id: "quickactions", label: "Быстрые действия", wide: true },
  ];

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  function getHiddenNavIds() {
    var hidden = readJSON(NAV_STORAGE_KEY, []);
    return Array.isArray(hidden) ? hidden : [];
  }

  function setHiddenNavIds(ids) {
    writeJSON(NAV_STORAGE_KEY, ids);
    applyNavVisibility();
  }

  // Прячет/показывает пункты меню на ТЕКУЩЕЙ странице согласно сохранённым
  // настройкам. Вызывается при загрузке каждой страницы и сразу после изменения
  // чекбокса в "Настройках", чтобы собственное меню страницы тоже обновилось.
  function applyNavVisibility() {
    var hidden = getHiddenNavIds();
    document.querySelectorAll("[data-nav-id]").forEach(function (el) {
      var id = el.getAttribute("data-nav-id");
      if (id === "settings") return; // всегда видим
      el.style.display = hidden.indexOf(id) === -1 ? "" : "none";
    });
  }

  function getDashboardPrefs() {
    var knownIds = DASHBOARD_WIDGETS.map(function (w) { return w.id; });
    var defaults = {
      order: knownIds.slice(),
      hidden: [],
      wide: DASHBOARD_WIDGETS.filter(function (w) { return w.wide; }).map(function (w) { return w.id; }),
    };
    var stored = readJSON(DASHBOARD_STORAGE_KEY, null);
    if (!stored) return defaults;

    // Если в реестре появились новые виджеты уже после того, как пользователь
    // что-то сохранил — дописываем их в конец порядка, чтобы не потерялись.
    var knownIdsSet = {};
    knownIds.forEach(function (id) { knownIdsSet[id] = true; });
    var storedOrder = Array.isArray(stored.order) ? stored.order : [];
    var order = storedOrder.filter(function (id) { return knownIdsSet[id]; });
    knownIds.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });

    // Набор виджетов мог полностью перекроиться между версиями интерфейса (как при
    // редизайне рабочего стола, когда часть id заменили на новые) — сохранённые
    // hidden/wide для уже не существующих id ничего не говорят про НОВЫЕ виджеты,
    // и без этой проверки новый wide:true-виджет из реестра молча становился бы
    // узким (его id просто ещё не было в старом сохранённом массиве). Признак
    // такого расхождения — набор id в сохранённом порядке не совпадает с текущим
    // реестром; тогда hidden/wide берём из дефолтов заново, а порядок всё равно
    // максимально сохраняем (см. order выше).
    var registryChanged = storedOrder.length !== knownIds.length ||
      storedOrder.some(function (id) { return !knownIdsSet[id]; });
    if (registryChanged) {
      return { order: order, hidden: [], wide: defaults.wide };
    }

    return {
      order: order,
      hidden: Array.isArray(stored.hidden) ? stored.hidden : [],
      wide: Array.isArray(stored.wide) ? stored.wide : defaults.wide,
    };
  }

  function setDashboardPrefs(prefs) {
    writeJSON(DASHBOARD_STORAGE_KEY, prefs);
  }

  window.Prefs = {
    NAV_ITEMS: NAV_ITEMS,
    DASHBOARD_WIDGETS: DASHBOARD_WIDGETS,
    getHiddenNavIds: getHiddenNavIds,
    setHiddenNavIds: setHiddenNavIds,
    applyNavVisibility: applyNavVisibility,
    getDashboardPrefs: getDashboardPrefs,
    setDashboardPrefs: setDashboardPrefs,
  };

  document.addEventListener("DOMContentLoaded", applyNavVisibility);
})();
