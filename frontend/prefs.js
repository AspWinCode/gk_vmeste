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
    { id: "signals", label: "Критические сигналы", wide: true },
    { id: "tasks", label: "Поручения дня", wide: false },
    { id: "projects", label: "Проекты под контролем", wide: true },
    { id: "focus", label: "Ассистенты в фокусе", wide: false },
    { id: "feed", label: "Лента действий ассистентов", wide: true },
    { id: "upcoming", label: "Дальше по срокам", wide: false },
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
    var defaults = {
      order: DASHBOARD_WIDGETS.map(function (w) { return w.id; }),
      hidden: [],
      wide: DASHBOARD_WIDGETS.filter(function (w) { return w.wide; }).map(function (w) { return w.id; }),
    };
    var stored = readJSON(DASHBOARD_STORAGE_KEY, null);
    if (!stored) return defaults;
    // Если в реестре появились новые виджеты уже после того, как пользователь
    // что-то сохранил — дописываем их в конец порядка, чтобы не потерялись.
    var knownIds = DASHBOARD_WIDGETS.map(function (w) { return w.id; });
    var order = (stored.order || []).filter(function (id) { return knownIds.indexOf(id) !== -1; });
    knownIds.forEach(function (id) { if (order.indexOf(id) === -1) order.push(id); });
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
