/* ============================================================
   chat.js — 실시간 채팅 패널
   저장·수신은 store.js 가 맡고, 여기서는 화면만 그린다.
   ============================================================ */
(function () {
  'use strict';

  var Store = window.GaonStore;
  var $ = function (s) { return document.querySelector(s); };

  var fab = $('#chatFab');
  var panel = $('#chatPanel');
  if (!Store || !fab || !panel) return;

  var log = $('#chatLog');
  var form = $('#chatForm');
  var nickInput = $('#chatNick');
  var textInput = $('#chatText');
  var closeBtn = $('#chatClose');
  var modeBox = $('#chatMode');
  var dot = $('#chatDot');
  var preview = $('#chatPreview');

  var messages = [];
  var open = false;
  var lastSeen = 0;

  try { lastSeen = Number(localStorage.getItem('gaon.chatSeen') || 0); } catch (e) {}

  /* 저장 방식이 로컬이면 솔직하게 알린다 */
  if (Store.mode === 'local' && modeBox) {
    modeBox.hidden = false;
    modeBox.textContent =
      '실시간 DB가 설정되지 않아 지금은 이 브라우저(다른 탭 포함)에서만 대화가 오갑니다. ' +
      'SETUP.md 를 따라 설정하면 모든 방문자와 연결됩니다.';
  }

  nickInput.value = Store.chat.nick() || '';

  /* ── 열고 닫기 ────────────────────────────────────── */
  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    fab.setAttribute('aria-expanded', String(v));
    if (v) {
      if (dot) dot.hidden = true;
      lastSeen = Date.now();
      try { localStorage.setItem('gaon.chatSeen', String(lastSeen)); } catch (e) {}
      scrollDown();
      (nickInput.value ? textInput : nickInput).focus();
    }
  }
  fab.addEventListener('click', function () { setOpen(!open); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) setOpen(false); });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-open-chat]')) setOpen(true);
  });

  /* ── 그리기 ───────────────────────────────────────── */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function timeOf(ms) {
    var d = new Date(ms || Date.now());
    var h = d.getHours(), m = d.getMinutes();
    var ap = h < 12 ? '오전' : '오후';
    var hh = h % 12 === 0 ? 12 : h % 12;
    return ap + ' ' + hh + ':' + (m < 10 ? '0' + m : m);
  }
  function nearBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 90;
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function render(list) {
    var stick = nearBottom();
    messages = list || [];

    if (!messages.length) {
      log.innerHTML = '<li class="sys">아직 대화가 없습니다. 첫 인사를 남겨보세요.</li>';
    } else {
      log.innerHTML = messages.map(function (m) {
        var mine = m.by === Store.me;
        return '<li class="msg-row' + (mine ? ' me' : '') + '">' +
          '<span class="msg-head"><b>' + esc(m.n || '익명') + '</b>' + timeOf(m.at) + '</span>' +
          '<span class="msg-body">' + esc(m.t || '') + '</span></li>';
      }).join('');
    }

    if (stick || open) scrollDown();
    paintPreview();

    var latest = messages.length ? (messages[messages.length - 1].at || 0) : 0;
    var fromOther = messages.length && messages[messages.length - 1].by !== Store.me;
    if (dot && !open && fromOther && latest > lastSeen) dot.hidden = false;
  }

  /** 사이드바 위젯에 마지막 대화 세 줄을 미리 보여준다. */
  function paintPreview() {
    if (!preview) return;
    var last = messages.slice(-3);
    if (!last.length) {
      preview.innerHTML = '<li class="empty">아직 대화가 없습니다.</li>';
      return;
    }
    preview.innerHTML = last.map(function (m) {
      return '<li><span class="nm">' + esc(m.n || '익명') + '</span>' +
        '<span class="msg">' + esc(m.t || '') + '</span></li>';
    }).join('');
  }

  Store.chat.subscribe(render);

  /* ── 전송 ─────────────────────────────────────────── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var nick = nickInput.value.trim() || '익명';
    var text = textInput.value.trim();
    if (!text) return;

    var btn = form.querySelector('button');
    btn.disabled = true;

    Store.chat.send(nick, text).then(function (res) {
      btn.disabled = false;
      if (res.ok) {
        textInput.value = '';
        textInput.focus();
        lastSeen = Date.now();
        return;
      }
      if (res.reason === 'rate') notice('너무 빠릅니다. 3초 뒤에 다시 시도해 주세요.');
      else notice('전송하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    });
  });

  function notice(text) {
    var li = document.createElement('li');
    li.className = 'sys';
    li.textContent = text;
    log.appendChild(li);
    scrollDown();
    setTimeout(function () { li.remove(); }, 3000);
  }
})();
