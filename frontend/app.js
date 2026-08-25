(function () {
  var root = document.documentElement;
  var btn = document.querySelector('[data-theme-toggle]');
  var saved = localStorage.getItem('vmeste-theme');
  var current = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', current);
  if (btn) {
    btn.addEventListener('click', function () {
      current = current === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', current);
      localStorage.setItem('vmeste-theme', current);
    });
  }
})();
