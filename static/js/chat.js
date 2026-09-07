/* ============================================================
   chat.js — 실시간 채팅 패널
   ------------------------------------------------------------
   저장·수신은 store.js 가 맡고 여기서는 화면과 이미지 처리를 한다.

     · 불러오는 동안 마스코트 애니메이션
     · 이미지 첨부 (브라우저에서 축소 후 전송, 용량 한도 검사)
     · 관리자만 보이는 삭제 버튼 → "삭제된 메시지입니다"
   ============================================================ */
(function () {
  'use strict';

  var Store = window.GaonStore;
  var CFG = window.GAON_CONFIG || {};
  var IMG = (CFG.chat && CFG.chat.image) || {};
  var $ = function (s) { return document.querySelector(s); };

  var fab = $('#chatFab');
  var panel = $('#chatPanel');
  if (!Store || !fab || !panel) return;

  var log = $('#chatLog');
  var loading = $('#chatLoading');
  var form = $('#chatForm');
  var nickInput = $('#chatNick');
  var textInput = $('#chatText');
  var modeBox = $('#chatMode');
  var dot = $('#chatDot');
  var preview = $('#chatPreview');
  var quotaLine = $('#chatQuota');
  var lightbox = $('#chatLightbox');

  var messages = [];
  var open = false;
  var lastSeen = 0;
  var pending = null;      // 첨부 대기 중인 이미지
  var firstPaint = true;

  try { lastSeen = Number(localStorage.getItem('gaon.chatSeen') || 0); } catch (e) {}

  var isOwner = !!(window.GaonGH && window.GaonGH.getToken());
  if (isOwner) {
    panel.classList.add('is-owner');
    var clearBtn = $('#chatClear');
    if (clearBtn) clearBtn.hidden = false;
  }

  if (Store.mode === 'local' && modeBox) {
    modeBox.hidden = false;
    modeBox.textContent =
      '실시간 DB가 아직 연결되지 않아 지금은 이 브라우저(다른 탭 포함)에서만 대화가 오갑니다. ' +
      'SETUP.md 3번을 따라 설정하면 모든 방문자와 이어집니다.';
  }

  nickInput.value = Store.chat.nick() || '';
  paintQuota();

  /* ── 열고 닫기 ────────────────────────────────────── */
  var openTimer = null;
  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    fab.setAttribute('aria-expanded', String(v));
    if (v) {
      // 열 때마다 마스코트를 잠깐 보여준다 (불러오는 느낌을 준다)
      clearTimeout(openTimer);
      loading.hidden = false;
      log.hidden = true;
      openTimer = setTimeout(function () {
        loading.hidden = true;
        log.hidden = false;
        scrollDown();
      }, 620);
      if (dot) dot.hidden = true;
      lastSeen = Date.now();
      try { localStorage.setItem('gaon.chatSeen', String(lastSeen)); } catch (e) {}
      scrollDown();
      (nickInput.value ? textInput : nickInput).focus();
    }
  }
  fab.addEventListener('click', function () { setOpen(!open); });
  var closeBtn = $('#chatClose');
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (lightbox && !lightbox.hidden) { lightbox.hidden = true; return; }
    if (open) setOpen(false);
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-open-chat]')) setOpen(true);
  });

  /* ── 그리기 ───────────────────────────────────────── */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function timeOf(ms) {
    var d = new Date(ms || Date.now());
    var h = d.getHours(), m = d.getMinutes();
    return (h < 12 ? '오전 ' : '오후 ') + (h % 12 === 0 ? 12 : h % 12) + ':' + (m < 10 ? '0' + m : m);
  }
  function nearBottom() { return log.scrollHeight - log.scrollTop - log.clientHeight < 90; }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function render(list) {
    var stick = nearBottom();
    messages = list || [];

    if (firstPaint) firstPaint = false;

    if (!messages.length) {
      log.innerHTML = '<li class="sys">아직 대화가 없습니다. 첫 인사를 남겨보세요.</li>';
    } else {
      log.innerHTML = messages.map(function (m) {
        var mine = m.by === Store.me;
        if (m.del) {
          return '<li class="msg-row' + (mine ? ' me' : '') + '">' +
            '<span class="msg-head"><b>' + esc(m.n || '익명') + '</b>' + timeOf(m.at) + '</span>' +
            '<span class="msg-body deleted">삭제된 메시지입니다</span></li>';
        }
        var body = '';
        if (m.img) {
          body += '<img class="msg-img" src="' + esc(m.img) + '" alt="첨부 이미지" loading="lazy">';
        }
        if (m.t) body += '<span class="msg-text">' + esc(m.t) + '</span>';

        return '<li class="msg-row' + (mine ? ' me' : '') + '" data-id="' + esc(m.id || '') + '">' +
          '<span class="msg-head"><b>' + esc(m.n || '익명') + '</b>' + timeOf(m.at) +
            (isOwner && m.id ? '<button type="button" class="msg-del" data-del="' + esc(m.id) +
              '" title="이 메시지 지우기">지우기</button>' : '') +
          '</span>' +
          '<span class="msg-body">' + body + '</span></li>';
      }).join('');
    }

    if (stick || open) scrollDown();
    paintPreview();

    var latest = messages.length ? (messages[messages.length - 1].at || 0) : 0;
    var fromOther = messages.length && messages[messages.length - 1].by !== Store.me;
    if (dot && !open && fromOther && latest > lastSeen) dot.hidden = false;
  }

  function paintPreview() {
    if (!preview) return;
    var last = messages.slice(-3);
    if (!last.length) { preview.innerHTML = '<li class="empty">아직 대화가 없습니다.</li>'; return; }
    preview.innerHTML = last.map(function (m) {
      var body = m.del ? '삭제된 메시지입니다' : (m.t || (m.img ? '(이미지)' : ''));
      return '<li><span class="nm">' + esc(m.n || '익명') + '</span>' +
        '<span class="msg">' + esc(body) + '</span></li>';
    }).join('');
  }

  Store.chat.subscribe(render);

  /* ── 이미지 크게 보기 ─────────────────────────────── */
  log.addEventListener('click', function (e) {
    var img = e.target.closest('.msg-img');
    if (img && lightbox) {
      lightbox.querySelector('img').src = img.src;
      lightbox.hidden = false;
      return;
    }
    var del = e.target.closest('[data-del]');
    if (del) removeMessage(del.dataset.del);
  });
  if (lightbox) lightbox.addEventListener('click', function () { lightbox.hidden = true; });

  /* ── 관리자 삭제 ──────────────────────────────────── */
  function removeMessage(id) {
    if (!isOwner) return;
    Store.chat.remove(id).then(function () { notice('메시지를 지웠습니다.'); });
  }
  var clearAll = $('#chatClear');
  if (clearAll) {
    clearAll.addEventListener('click', function () {
      if (!isOwner) return;
      confirmBox('대화를 모두 지울까요?', '이 채팅방의 메시지와 이미지가 전부 삭제됩니다. 되돌릴 수 없습니다.')
        .then(function (yes) {
          if (!yes) return;
          Store.chat.clearAll().then(function () { notice('모두 지웠습니다.'); });
        });
    });
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
      wrap.onclick = function (e) { if (e.target === wrap) done(false); };
    });
  }

  /* ── 이미지 첨부 ──────────────────────────────────── */
  var imgBtn = $('#chatImgBtn');
  var imgFile = $('#chatImgFile');
  var attach = $('#chatAttach');

  if (!IMG.enabled && imgBtn) imgBtn.hidden = true;

  if (imgBtn && imgFile) {
    imgBtn.addEventListener('click', function () { imgFile.click(); });
    imgFile.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { notice('이미지 파일만 보낼 수 있습니다.'); return; }
      notice('이미지를 줄이는 중…');
      shrink(file).then(function (out) {
        return Store.chat.checkQuota(out.bytes).then(function (res) {
          if (!res.ok) { notice(res.reason); return; }
          pending = out;
          showAttach();
        });
      }).catch(function () { notice('이미지를 처리하지 못했습니다.'); });
    });
  }

  /** 캔버스로 긴 변을 maxWidth 까지 줄이고, 한도 안에 들어올 때까지 화질을 낮춘다. */
  function shrink(file) {
    var maxW = IMG.maxWidth || 900;
    var maxB = IMG.maxBytes || 160000;

    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, maxW / Math.max(im.width, im.height));
        var w = Math.max(1, Math.round(im.width * scale));
        var h = Math.max(1, Math.round(im.height * scale));

        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(im, 0, 0, w, h);

        var q = 0.82;
        var data = canvas.toDataURL('image/jpeg', q);
        // 한도에 들어올 때까지 화질을 단계적으로 낮춘다
        while (data.length > maxB && q > 0.32) {
          q -= 0.1;
          data = canvas.toDataURL('image/jpeg', q);
        }
        if (data.length > maxB) { reject(new Error('too big')); return; }
        resolve({ data: data, bytes: data.length, w: w, h: h });
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('load')); };
      im.src = url;
    });
  }

  function showAttach() {
    if (!attach || !pending) return;
    $('#chatAttachPreview').src = pending.data;
    $('#chatAttachInfo').textContent =
      pending.w + '×' + pending.h + ' · ' + Math.round(pending.bytes / 1024) + 'KB';
    attach.hidden = false;
  }
  var attachCancel = $('#chatAttachCancel');
  if (attachCancel) {
    attachCancel.addEventListener('click', function () {
      pending = null;
      if (attach) attach.hidden = true;
    });
  }

  function paintQuota() {
    if (!quotaLine || !IMG.enabled) return;
    var q = Store.chat.myQuota();
    quotaLine.textContent = '내 이미지 ' + q.count + '/' + q.maxCount + '장 · ' +
      Math.round(q.bytes / 1024) + 'KB / ' + Math.round(q.maxBytes / 1024) + 'KB';
  }

  /* ── 전송 ─────────────────────────────────────────── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var nick = nickInput.value.trim() || '익명';
    var text = textInput.value.trim();
    if (!text && !pending) return;

    var btn = $('#chatSend');
    btn.disabled = true;

    Store.chat.send(nick, text, pending).then(function (res) {
      btn.disabled = false;
      if (res.ok) {
        textInput.value = '';
        pending = null;
        if (attach) attach.hidden = true;
        paintQuota();
        textInput.focus();
        lastSeen = Date.now();
        return;
      }
      if (res.reason === 'rate') notice('너무 빠릅니다. 3초 뒤에 다시 보내주세요.');
      else if (res.reason === 'empty') notice('내용을 입력해 주세요.');
      else notice('보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    });
  });

  function notice(text) {
    var li = document.createElement('li');
    li.className = 'sys';
    li.textContent = text;
    log.appendChild(li);
    scrollDown();
    setTimeout(function () { li.remove(); }, 3200);
  }
})();
