/* ============================================================
   editor-modal.js — 글쓰기 편집기를 같은 화면 위에 큰 창으로 띄운다
   ------------------------------------------------------------
   /write/ 로 페이지를 옮기지 않고, 보던 자리를 그대로 둔 채
   편집기를 겹쳐 연다. 편집기 자체는 /write/?embed=1 을 그대로 쓴다.
   (같은 출처이므로 postMessage 로만 이야기한다)

     GaonEditor.open()              → 새 글
     GaonEditor.open('content/...') → 그 글 수정
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.GAON_CONFIG || {};
  var base = CFG.baseurl || '';
  var wrap = null, frame = null, dirty = false, onDone = null;

  function close(force) {
    if (!wrap) return;
    if (dirty && !force) {
      ask().then(function (yes) { if (yes) close(true); });
      return;
    }
    wrap.classList.remove('on');
    var w = wrap;
    wrap = null; frame = null; dirty = false;
    document.body.classList.remove('ed-open');
    setTimeout(function () { w.remove(); }, 180);
  }

  function ask() {
    return new Promise(function (resolve) {
      var m = document.createElement('div');
      m.className = 'ad-modal';
      m.innerHTML = '<div class="ad-modal-box" role="dialog" aria-modal="true">' +
        '<b>편집기를 닫을까요?</b><p>아직 발행하지 않은 내용이 있습니다. ' +
        '임시저장한 내용은 다음에 열 때 그대로 남아 있습니다.</p>' +
        '<div class="ad-modal-btns"><button type="button" class="btn-line" data-no>계속 쓰기</button>' +
        '<button type="button" class="btn ad-danger" data-yes>닫기</button></div></div>';
      document.body.appendChild(m);
      var done = function (v) { m.remove(); resolve(v); };
      m.querySelector('[data-yes]').onclick = function () { done(true); };
      m.querySelector('[data-no]').onclick = function () { done(false); };
      m.onclick = function (e) { if (e.target === m) done(false); };
    });
  }

  function open(srcPath, after) {
    if (wrap) return;
    onDone = typeof after === 'function' ? after : null;

    wrap = document.createElement('div');
    wrap.className = 'ed-modal';
    wrap.innerHTML =
      '<div class="ed-box" role="dialog" aria-modal="true" aria-label="글쓰기">' +
        '<div class="ed-loading"><span class="ed-spin"></span>편집기를 여는 중…</div>' +
        '<iframe title="글쓰기" src="' + base + '/write/?embed=1' +
          (srcPath ? '&edit=' + encodeURIComponent(srcPath) : '') + '"></iframe>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('ed-open');
    frame = wrap.querySelector('iframe');
    frame.addEventListener('load', function () { wrap.classList.add('ready'); });
    requestAnimationFrame(function () { wrap.classList.add('on'); });

    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(); });
  }

  global.addEventListener('message', function (e) {
    if (e.source !== (frame && frame.contentWindow)) return;
    var d = e.data || {};
    if (d.gaon === 'dirty') dirty = !!d.value;
    else if (d.gaon === 'close') close(true);
    else if (d.gaon === 'published') {
      dirty = false;
      close(true);
      if (onDone) onDone(d);
      else setTimeout(function () { location.reload(); }, 900);
    }
  });

  global.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && wrap) close();
  });

  global.GaonEditor = { open: open, close: close, isOpen: function () { return !!wrap; } };
})(window);
