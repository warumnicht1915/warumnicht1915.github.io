/* ============================================================
   archive.js — 글목록 페이지의 즉석 필터
   ============================================================ */
(function () {
  'use strict';

  var input = document.getElementById('arcFilter');
  var count = document.getElementById('arcCount');
  var empty = document.getElementById('arcEmpty');
  if (!input) return;

  var items = Array.prototype.slice.call(document.querySelectorAll('.arc-y .row-item'));
  var years = Array.prototype.slice.call(document.querySelectorAll('.arc-y'));
  var total = items.length;

  function apply() {
    var q = input.value.trim().toLowerCase();
    var shown = 0;

    items.forEach(function (li) {
      var hit = !q || (li.dataset.k || '').indexOf(q) !== -1;
      li.hidden = !hit;
      if (hit) shown++;
    });

    years.forEach(function (sec) {
      var any = Array.prototype.some.call(sec.querySelectorAll('.row-item'), function (li) {
        return !li.hidden;
      });
      sec.hidden = !any;
    });

    if (count) count.textContent = shown;
    if (empty) empty.hidden = shown !== 0;
  }

  var timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 120);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; apply(); }
  });

  if (count) count.textContent = total;
})();
