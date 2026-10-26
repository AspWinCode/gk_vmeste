// Общие хелперы для всех страниц. Подключать сразу после config.js, до любого другого
// скрипта — раньше esc() был побайтово продублирован в 13 файлах (assistants.js, auth.js,
// finance.js, finance-monitor.js, index.js, ksg.js, land.js, mail.js, settings.js,
// support.js, task-modal.js, tasks.js, transcriber.js); правка экранирования требовала
// находить и чинить все копии разом.
window.escHtml = function (str) {
  var div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
};
