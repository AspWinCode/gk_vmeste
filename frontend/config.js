// Единая точка настройки адреса бэкенда.
// Локальная разработка: фронтенд раздаётся отдельным статик-сервером (напр. :5500),
// бэкенд — на :4000, поэтому нужен полный адрес с портом.
// Продакшен (VPS): nginx раздаёт фронтенд и проксирует /api на тот же origin —
// в этом случае достаточно относительного пути.
(function () {
  var isLocalDev = ["localhost", "127.0.0.1"].indexOf(window.location.hostname) !== -1 && window.location.port !== "";
  window.API_BASE = window.API_BASE || (isLocalDev ? "http://localhost:4000/api" : "/api");
})();
