// Выполняется до отрисовки: включает JS-стили и решает, показывать ли интро.
(function () {
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');
  try {
    var home = location.pathname === '/' || location.pathname === '/index.html';
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var seen = sessionStorage.getItem('gc-intro');
    if (home && !reduce && !seen && !location.hash) root.classList.add('intro-play');
  } catch (e) {
    /* sessionStorage недоступен — просто без интро */
  }
})();
