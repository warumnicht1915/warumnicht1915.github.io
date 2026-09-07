/* ============================================================
   comments.js — 자체 구현 댓글
   ------------------------------------------------------------
   저장은 store.js 를 거쳐 Realtime Database 로 간다.
   · 로그인 없이 이름만 적고 바로 남긴다 (뒤에서는 익명 인증이 걸린다)
   · 답글 한 단계
   · 본인 댓글은 본인이, 모든 댓글은 관리자가 지울 수 있다
   · 지운 자리에는 "삭제된 댓글입니다" 가 남는다
   · 다시 그릴 때 화면이 튀지 않도록 스크롤 위치를 붙잡아 둔다
   ============================================================ */
(function () {
  'use strict';

  var Store = window.GaonStore;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var box = $('#comments');
  if (!Store || !box) return;

  var pageUrl = box.dataset.page || location.pathname;
  var listEl = $('#cmtList');
  var loading = $('#cmtLoading');
  var form = $('#cmtForm');
  var nameEl = $('#cmtName');
  var textEl = $('#cmtText');
  var replyBox = $('#cmtReplyTo');
  var myAv = $('#cmtMyAv');

  var items = [];
  var replyTo = null;
  var isAdmin = false;
  var painted = false;
  var freshId = null;          // 방금 내가 올린 댓글 (한 번만 반짝인다)

  nameEl.value = Store.comments.myName() || '';
  paintMyAvatar();
  nameEl.addEventListener('input', paintMyAvatar);

  Store.whoami().then(function (who) {
    isAdmin = !!who.admin || !!who.local;
    if (who.local) {
      var m = $('#cmtMode');
      m.hidden = false;
      m.textContent = '이 브라우저에만 저장됩니다';
    }
    if (painted) render();
  });

  /* ── 도구 ─────────────────────────────────────────── */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  /** 이름에서 아바타 색상(색상환 각도)을 만든다 — 같은 이름은 늘 같은 색 */
  function hue(name) {
    var s = String(name || '익명'), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function initial(name) {
    var s = String(name || '익명').trim();
    return s ? s.charAt(0) : '익';
  }
  function paintMyAvatar() {
    var n = nameEl.value.trim() || '익명';
    myAv.textContent = initial(n);
    myAv.style.setProperty('--h', hue(n));
  }

  /** 방금 · n분 전 · n시간 전 · 날짜 */
  function ago(ms) {
    var diff = Date.now() - (ms || 0);
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    var d = new Date(ms);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /** 다시 그리는 동안 댓글 영역의 화면상 위치를 그대로 붙잡아 둔다.
      이게 없으면 목록 높이가 바뀔 때 보던 자리에서 튕겨 나간다. */
  function keepScroll(fn) {
    var before = box.getBoundingClientRect().top;
    fn();
    var after = box.getBoundingClientRect().top;
    var delta = after - before;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }

  /* ── 그리기 ───────────────────────────────────────── */
  function card(c, isReply) {
    var mine = Store.comments.isMine(c);
    var canDelete = !c.del && (mine || isAdmin);
    var cls = 'cmt' + (isReply ? ' reply' : '') + (c.id === freshId ? ' fresh' : '');

    if (c.del) {
      return '<li class="' + cls + '">' +
        '<span class="cmt-av" aria-hidden="true" style="--h:220;filter:grayscale(1);opacity:.5">–</span>' +
        '<div class="cmt-card"><div class="cmt-body deleted">삭제된 댓글입니다</div></div></li>';
    }

    var name = c.n || '익명';
    return '<li class="' + cls + '" data-id="' + esc(c.id) + '">' +
      '<span class="cmt-av" aria-hidden="true" style="--h:' + hue(name) + '">' + esc(initial(name)) + '</span>' +
      '<div class="cmt-card">' +
        '<div class="cmt-head">' +
          '<b>' + esc(name) + '</b>' +
          (mine ? '<em class="cmt-badge">나</em>' : '') +
          '<time datetime="' + new Date(c.at || 0).toISOString() + '">' + ago(c.at) + '</time>' +
          '<span class="cmt-acts">' +
            (isReply ? '' : '<button type="button" data-reply="' + esc(c.id) + '">답글</button>') +
            (canDelete ? '<button type="button" class="danger" data-del="' + esc(c.id) + '">삭제</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="cmt-body">' + nl2br(c.t) + '</div>' +
      '</div></li>';
  }

  function render() {
    painted = true;
    loading.hidden = true;
    listEl.hidden = false;

    var tops = items.filter(function (c) { return !c.p; });
    var byParent = {};
    items.filter(function (c) { return c.p; }).forEach(function (c) {
      (byParent[c.p] = byParent[c.p] || []).push(c);
    });

    var alive = items.filter(function (c) { return !c.del; }).length;
    $('#cmtCount').textContent = alive;

    if (!tops.length) {
      listEl.innerHTML = '<li class="cmt-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</li>';
      return;
    }
    listEl.innerHTML = tops.map(function (c) {
      var kids = byParent[c.id] || [];
      return card(c, false) +
        (kids.length
          ? '<li class="cmt-replies-wrap"><ul class="cmt-replies">' +
              kids.map(function (r) { return card(r, true); }).join('') +
            '</ul></li>'
          : '');
    }).join('');
  }

  Store.comments.subscribe(pageUrl, function (list) {
    items = list || [];
    keepScroll(render);
  });

  /* ── 답글 · 삭제 ──────────────────────────────────── */
  listEl.addEventListener('click', function (e) {
    var r = e.target.closest('[data-reply]');
    var d = e.target.closest('[data-del]');

    if (r) {
      var target = items.filter(function (c) { return c.id === r.dataset.reply; })[0];
      replyTo = r.dataset.reply;
      replyBox.hidden = false;
      replyBox.querySelector('b').textContent = (target && target.n) || '익명';
      textEl.focus();
      return;
    }
    if (d) {
      confirmBox('댓글을 지울까요?', '지운 자리에는 “삭제된 댓글입니다” 가 남습니다.')
        .then(function (yes) {
          if (!yes) return;
          Store.comments.remove(pageUrl, d.dataset.del).then(function (ok) {
            if (!ok) hint('지우지 못했습니다. 권한을 확인해 주세요.', 'bad');
          });
        });
    }
  });

  $('#cmtReplyCancel').addEventListener('click', function () {
    replyTo = null;
    replyBox.hidden = true;
  });

  /* ── 등록 ─────────────────────────────────────────── */
  textEl.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

  function submit() {
    var name = nameEl.value.trim() || '익명';
    var text = textEl.value.trim();
    if (text.length < 2) { hint('두 글자 이상 써주세요.', 'bad'); textEl.focus(); return; }

    var btn = $('#cmtSend');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '올리는 중…';

    var known = {};
    items.forEach(function (c) { known[c.id] = true; });

    Store.comments.add(pageUrl, name, text, replyTo).then(function (res) {
      btn.disabled = false;
      btn.textContent = '등록';
      if (res.ok) {
        textEl.value = '';
        replyTo = null;
        replyBox.hidden = true;
        hint('등록했습니다.', 'ok');
        // 새로 생긴 항목을 찾아 한 번 반짝여 준다 (스크롤은 그대로 둔다)
        var mark = function () {
          var added = items.filter(function (c) { return !known[c.id]; })[0];
          if (!added) return;
          freshId = added.id;
          keepScroll(render);
          setTimeout(function () { freshId = null; }, 2200);
        };
        setTimeout(mark, 400);
        setTimeout(mark, 1500);
        return;
      }
      if (res.reason === 'rate') hint('너무 빠릅니다. 5초 뒤에 다시 시도해 주세요.', 'bad');
      else if (res.reason === 'empty') hint('내용을 입력해 주세요.', 'bad');
      else hint('등록하지 못했습니다.', 'bad');
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = '등록';
      hint('등록하지 못했습니다.', 'bad');
    });
  }

  var hintTimer = null;
  var baseHint = $('#cmtHint').textContent;
  function hint(msg, kind) {
    var el = $('#cmtHint');
    clearTimeout(hintTimer);
    el.textContent = msg;
    el.className = 'cmt-hint' + (kind ? ' ' + kind : '');
    hintTimer = setTimeout(function () {
      el.textContent = baseHint;
      el.className = 'cmt-hint';
    }, 3500);
  }

  function confirmBox(title, text) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'ad-modal';
      wrap.innerHTML = '<div class="ad-modal-box" role="dialog" aria-modal="true"><b></b><p></p>' +
        '<div class="ad-modal-btns"><button type="button" class="btn-line" data-no>취소</button>' +
        '<button type="button" class="btn ad-danger" data-yes>삭제</button></div></div>';
      wrap.querySelector('b').textContent = title;
      wrap.querySelector('p').textContent = text;
      document.body.appendChild(wrap);
      var done = function (v) { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-yes]').onclick = function () { done(true); };
      wrap.querySelector('[data-no]').onclick = function () { done(false); };
      wrap.onclick = function (ev) { if (ev.target === wrap) done(false); };
    });
  }
})();
