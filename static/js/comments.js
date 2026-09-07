/* ============================================================
   comments.js — 자체 구현 댓글 (giscus 를 대신한다)
   ------------------------------------------------------------
   저장은 store.js 를 거쳐 Realtime Database 로 간다.
   · 로그인 없이 이름만 적고 바로 남긴다 (뒤에서는 익명 인증이 걸린다)
   · 답글 한 단계
   · 본인 댓글은 본인이, 모든 댓글은 관리자가 지울 수 있다
   · 지운 자리에는 "삭제된 댓글입니다" 가 남는다
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

  var items = [];
  var replyTo = null;
  var isAdmin = false;

  nameEl.value = Store.comments.myName() || '';

  Store.whoami().then(function (who) {
    isAdmin = !!who.admin || who.local;
    paint();
  });

  /* ── 그리기 ───────────────────────────────────────── */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

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

  function row(c, isReply) {
    var mine = Store.comments.isMine(c);
    var canDelete = !c.del && (mine || isAdmin);

    if (c.del) {
      return '<li class="cmt' + (isReply ? ' reply' : '') + '">' +
        '<div class="cmt-body deleted">삭제된 댓글입니다</div></li>';
    }

    var initial = String(c.n || '익').trim().charAt(0);
    return '<li class="cmt' + (isReply ? ' reply' : '') + '" data-id="' + esc(c.id) + '">' +
      '<span class="cmt-av" aria-hidden="true">' + esc(initial) + '</span>' +
      '<div class="cmt-main">' +
        '<div class="cmt-head">' +
          '<b>' + esc(c.n || '익명') + '</b>' +
          (mine ? '<em class="cmt-badge">나</em>' : '') +
          '<time>' + ago(c.at) + '</time>' +
          '<span class="cmt-acts">' +
            (isReply ? '' : '<button type="button" data-reply="' + esc(c.id) + '">답글</button>') +
            (canDelete ? '<button type="button" class="danger" data-del="' + esc(c.id) + '">삭제</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="cmt-body">' + nl2br(c.t) + '</div>' +
      '</div></li>';
  }

  function paint() {
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
      listEl.innerHTML = '<li class="cmt-empty">첫 댓글을 남겨보세요.</li>';
      return;
    }
    listEl.innerHTML = tops.map(function (c) {
      return row(c, false) + (byParent[c.id] || []).map(function (r) { return row(r, true); }).join('');
    }).join('');
  }

  Store.comments.subscribe(pageUrl, function (list) {
    items = list || [];
    paint();
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
      var c2 = items.filter(function (x) { return x.id === d.dataset.del; })[0];
      confirmBox('댓글을 지울까요?', '지운 자리에는 “삭제된 댓글입니다” 가 남습니다.')
        .then(function (yes) {
          if (!yes) return;
          Store.comments.remove(pageUrl, d.dataset.del).then(function (ok) {
            if (!ok) hint('지우지 못했습니다. 권한을 확인해 주세요.', true);
          });
        });
    }
  });

  $('#cmtReplyCancel').addEventListener('click', function () {
    replyTo = null;
    replyBox.hidden = true;
  });

  /* ── 등록 ─────────────────────────────────────────── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = nameEl.value.trim() || '익명';
    var text = textEl.value.trim();
    if (text.length < 2) { hint('두 글자 이상 써주세요.', true); return; }

    var btn = $('#cmtSend');
    btn.disabled = true;
    Store.comments.add(pageUrl, name, text, replyTo).then(function (res) {
      btn.disabled = false;
      if (res.ok) {
        textEl.value = '';
        replyTo = null;
        replyBox.hidden = true;
        hint('등록했습니다.');
        return;
      }
      if (res.reason === 'rate') hint('너무 빠릅니다. 5초 뒤에 다시 시도해 주세요.', true);
      else if (res.reason === 'empty') hint('내용을 입력해 주세요.', true);
      else hint('등록하지 못했습니다.', true);
    });
  });

  var hintTimer = null;
  var baseHint = $('#cmtHint').textContent;
  function hint(msg, bad) {
    var el = $('#cmtHint');
    clearTimeout(hintTimer);
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    hintTimer = setTimeout(function () {
      el.textContent = baseHint;
      el.classList.remove('bad');
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
