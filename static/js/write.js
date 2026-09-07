/* ============================================================
   write.js — 전용 글쓰기 페이지 (/write/)
   ------------------------------------------------------------
   · 마크다운 도구 모음 + 단축키
   · 나란히 보기 / 편집만 / 미리보기만 / 집중 모드
   · 이미지: 버튼 · 끌어놓기 · 붙여넣기 → 저장소에 커밋 후 본문 삽입
   · 임시저장(브라우저) 과 발행(커밋) 분리
   · ?edit=<파일경로> 로 기존 글 수정
   ============================================================ */
(function () {
  'use strict';

  var GH = window.GaonGH;
  var CFG = window.GAON_CONFIG || {};
  var base = CFG.baseurl || '';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var gate = $('#wrGate'), app = $('#wrApp');
  if (!gate || !app) return;

  var Q = new URLSearchParams(location.search);
  var EMBED = Q.get('embed') !== null && window.parent !== window;

  /** 모달로 띄웠을 때만 부모 창에 알린다 */
  function toParent(msg) {
    if (EMBED) { try { window.parent.postMessage(msg, location.origin); } catch (e) {} }
  }

  if (EMBED) {
    document.documentElement.classList.add('is-embed');
    var closeBtn = $('#wClose'), backBtn = $('#wBack');
    if (closeBtn && backBtn) {
      backBtn.hidden = true;
      closeBtn.hidden = false;
      closeBtn.addEventListener('click', function () { toParent({ gaon: 'close' }); });
    }
  }

  /* 토큰이 없거나 만료됐으면 이 화면에서 바로 연결한다 (관리자 페이지를 거치지 않는다) */
  var loginForm = $('#wrLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = $('#wrToken').value.trim();
      if (!t || !GH) return;
      $('#wrGateMsg').textContent = '확인 중…';
      GH.setToken(t);
      GH.me().then(function () { location.reload(); })
        .catch(function (err) {
          GH.clearToken();
          $('#wrGateMsg').textContent = err.message + ' 다시 시도해 주세요.';
        });
    });
  }

  if (!GH || !GH.repo) return;
  if (!GH.getToken()) return;                      // 토큰 없으면 연결 화면 그대로

  var text = $('#wText');
  var previewEl = $('#wPreview');
  var body = $('#wBody');

  var editing = null;      // 수정 중인 글 {path, sha, meta, body}
  var tags = [];
  var dirty = false;
  var DRAFT_KEY = 'gaon.writeDraft';

  /* ── 알림 ─────────────────────────────────────────── */
  var statusEl = $('#wStatus'), statusTimer = null;
  function say(msg, kind) {
    clearTimeout(statusTimer);
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.className = 'wr-status ' + (kind || 'info');
    if (kind !== 'busy') statusTimer = setTimeout(function () { statusEl.hidden = true; }, 4500);
  }
  function fail(e) { say(e && e.message ? e.message : String(e), 'error'); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ── 시작 ─────────────────────────────────────────── */
  GH.me().then(function () {
    gate.hidden = true;
    app.hidden = false;
    return GH.listDir('content/posts');
  }).then(function (files) {
    var mds = (Array.isArray(files) ? files : []).filter(function (f) { return /\.mdx?$/.test(f.name); });
    return Promise.all(mds.map(function (f) {
      return GH.getFile(f.path).then(function (r) {
        var parsed = GH.parseFM(r.text);
        return { path: f.path, sha: r.sha, meta: parsed.meta, body: parsed.body };
      });
    }));
  }).then(function (posts) {
    fillLists(posts);
    var target = new URLSearchParams(location.search).get('edit');
    var found = target && posts.filter(function (p) { return p.path === target; })[0];
    if (found) loadPost(found);
    else newPost();
  }).catch(function (e) {
    // 토큰이 만료·무효면 편집기를 열지 말고 연결 화면으로 되돌린다
    if (e && (e.status === 401 || e.status === 403)) {
      GH.clearToken();
      gate.hidden = false; app.hidden = true;
      $('#wrGateMsg').textContent = e.message + ' 새 토큰으로 다시 연결해 주세요.';
      return;
    }
    gate.hidden = true; app.hidden = false;
    fail(e);
    newPost();
  });

  function fillLists(posts) {
    var cats = {}, tg = {};
    posts.forEach(function (p) {
      [].concat(p.meta.categories || []).forEach(function (c) { cats[c] = 1; });
      [].concat(p.meta.tags || []).forEach(function (t) { tg[t] = 1; });
    });
    $('#wCats').innerHTML = Object.keys(cats).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    $('#wTagOptions').innerHTML = Object.keys(tg).map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
  }

  function newPost() {
    editing = null;
    var now = new Date();
    $('#wDate').value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    $('#wTime').value = pad(now.getHours()) + ':' + pad(now.getMinutes());
    $('#wPublish').textContent = '발행하기';

    // 임시저장해 둔 글이 있으면 이어서 쓸지 물어본다
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {}
    if (saved && (saved.title || saved.body)) {
      say('임시저장된 글을 불러왔습니다. 새로 쓰려면 "새로 시작" 을 누르세요.', 'info');
      $('#wTitle').value = saved.title || '';
      $('#wSubtitle').value = saved.subtitle || '';
      $('#wDesc').value = saved.desc || '';
      $('#wCategory').value = saved.category || '';
      $('#wImage').value = saved.image || '';
      setTags(saved.tags || []);
      text.value = saved.body || '';
      showSaved('불러옴');
    }
    renderPreview();
    updateCount();
  }

  function loadPost(p) {
    editing = p;
    var m = p.meta;
    var d = String(m.date || '');
    $('#wTitle').value = m.title || '';
    $('#wSubtitle').value = m.subtitle || '';
    $('#wDate').value = d.slice(0, 10);
    $('#wTime').value = d.slice(11, 16) || '09:00';
    $('#wCategory').value = [].concat(m.categories || []).join(', ');
    $('#wDesc').value = m.description || '';
    $('#wImage').value = m.image || '';
    $('#wPinned').checked = m.pinned === true;
    $('#wDraftFlag').checked = m.draft === true;
    setTags([].concat(m.tags || []));
    text.value = p.body || '';
    $('#wPublish').textContent = '수정 저장';
    paintCover();
    renderPreview();
    updateCount();
  }

  /* ── 태그 칩 ──────────────────────────────────────── */
  function setTags(list) { tags = []; (list || []).forEach(addTag); renderChips(); }
  function addTag(name) {
    var t = String(name || '').trim().replace(/^#/, '');
    if (!t || t.length > 24) return;
    if (tags.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) return;
    tags.push(t);
  }
  function renderChips() {
    $('#wTagChips').innerHTML = tags.map(function (t) {
      return '<span class="ad-chip">#' + esc(t) +
        '<button type="button" data-chip="' + esc(t) + '" aria-label="' + esc(t) + ' 빼기">×</button></span>';
    }).join('');
  }
  var tagInput = $('#wTagInput');
  tagInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput.value); tagInput.value = ''; renderChips(); markDirty();
    } else if (e.key === 'Backspace' && !tagInput.value && tags.length) {
      tags.pop(); renderChips(); markDirty();
    }
  });
  tagInput.addEventListener('blur', function () {
    if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; renderChips(); }
  });
  $('#wTagChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-chip]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var name = b.dataset.chip;
    tags = tags.filter(function (t) { return t !== name; });
    renderChips(); markDirty();
  });

  /* ── 세부 설정 서랍 ───────────────────────────────── */
  $('#wMeta').addEventListener('click', function () {
    var panel = $('#wMetaPanel');
    panel.hidden = !panel.hidden;
    $('#wMeta').classList.toggle('on', !panel.hidden);
  });

  /* ── 보기 모드 ────────────────────────────────────── */
  function setView(mode) {
    body.className = 'wr-body ' + mode;
    $('#wViewSplit').classList.toggle('on', mode === 'split');
    $('#wViewEdit').classList.toggle('on', mode === 'edit');
    $('#wViewPreview').classList.toggle('on', mode === 'preview');
    try { localStorage.setItem('gaon.writeView', mode); } catch (e) {}
    if (mode !== 'edit') renderPreview();
  }
  $('#wViewSplit').addEventListener('click', function () { setView('split'); });
  $('#wViewEdit').addEventListener('click', function () { setView('edit'); });
  $('#wViewPreview').addEventListener('click', function () { setView('preview'); });
  try { setView(localStorage.getItem('gaon.writeView') || 'split'); } catch (e) { setView('split'); }

  $('#wZen').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  });

  /* ── 미리보기 · 글자 수 ───────────────────────────── */
  var previewTimer = null;
  function renderPreview() {
    if (!window.GaonMD) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var title = $('#wTitle').value.trim();
      var out = window.GaonMD.render(text.value || '');
      previewEl.innerHTML = (title ? '<h1 class="wr-pv-title">' + esc(title) + '</h1>' : '') + out.html;
    }, 150);
  }
  function updateCount() {
    var v = text.value || '';
    var chars = v.replace(/\s/g, '').length;
    var words = v.trim() ? v.trim().split(/\s+/).length : 0;
    var mins = Math.max(1, Math.round(chars / 500));
    $('#wCount').textContent = chars.toLocaleString('ko-KR') + '자 · ' +
      words.toLocaleString('ko-KR') + '단어 · 약 ' + mins + '분';
  }

  text.addEventListener('input', function () { renderPreview(); updateCount(); markDirty(); });
  $('#wTitle').addEventListener('input', function () { renderPreview(); markDirty(); });
  ['#wSubtitle', '#wDesc', '#wCategory', '#wImage'].forEach(function (sel) {
    var el = $(sel);
    if (el) el.addEventListener('input', markDirty);
  });

  /* ── 임시저장 ─────────────────────────────────────── */
  var draftTimer = null;
  function markDirty() {
    if (!dirty) toParent({ gaon: 'dirty', value: true });
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 1500);
  }
  function saveDraft() {
    if (editing) return;   // 수정 중인 글은 임시저장 대상이 아니다
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        title: $('#wTitle').value, subtitle: $('#wSubtitle').value,
        desc: $('#wDesc').value, category: $('#wCategory').value,
        image: $('#wImage').value, tags: tags, body: text.value, at: Date.now(),
      }));
      showSaved('임시저장됨');
      dirty = false;
      toParent({ gaon: 'dirty', value: false });
    } catch (e) {}
  }
  function showSaved(label) {
    var el = $('#wSaved');
    var d = new Date();
    el.textContent = label + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  $('#wDraft').addEventListener('click', function () { saveDraft(); say('이 브라우저에 임시저장했습니다.', 'ok'); });

  window.addEventListener('beforeunload', function (e) {
    if (!dirty || EMBED) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* ── 마크다운 도구 ────────────────────────────────── */
  function surround(before, after, placeholder) {
    var s = text.selectionStart, e = text.selectionEnd;
    var sel = text.value.slice(s, e) || placeholder || '';
    text.setRangeText(before + sel + (after === undefined ? before : after), s, e, 'end');
    if (!text.value.slice(s, e)) {
      text.selectionStart = s + before.length;
      text.selectionEnd = s + before.length + sel.length;
    }
    text.focus();
    renderPreview(); updateCount(); markDirty();
  }
  function prefixLines(prefix) {
    var s = text.selectionStart, e = text.selectionEnd;
    var start = text.value.lastIndexOf('\n', s - 1) + 1;
    var chunk = text.value.slice(start, e) || '내용';
    var out = chunk.split('\n').map(function (l, i) {
      return (typeof prefix === 'function' ? prefix(i) : prefix) + l;
    }).join('\n');
    text.setRangeText(out, start, e, 'end');
    text.focus();
    renderPreview(); updateCount(); markDirty();
  }
  function insertBlock(str) {
    // 선택 영역을 지우지 않고 그 뒤에 넣는다
    var s = text.selectionEnd;
    var pre = text.value.slice(0, s);
    var lead = pre && !/\n\n$/.test(pre) ? (/\n$/.test(pre) ? '\n' : '\n\n') : '';
    text.setRangeText(lead + str + '\n', s, s, 'end');
    text.focus();
    renderPreview(); updateCount(); markDirty();
  }

  var ACTIONS = {
    h2: function () { prefixLines('## '); },
    h3: function () { prefixLines('### '); },
    bold: function () { surround('**', '**', '굵게'); },
    italic: function () { surround('*', '*', '기울임'); },
    strike: function () { surround('~~', '~~', '취소선'); },
    mark: function () { surround('==', '==', '형광펜'); },
    link: function () { surround('[', '](https://)', '링크 글자'); },
    code: function () { insertBlock('```js\n// 코드\n```'); },
    quote: function () { prefixLines('> '); },
    ul: function () { prefixLines('- '); },
    ol: function () { prefixLines(function (i) { return (i + 1) + '. '; }); },
    task: function () { prefixLines('- [ ] '); },
    table: function () { insertBlock('| 항목 | 값 |\n|---|---:|\n| a | 1 |\n| b | 2 |'); },
    hr: function () { insertBlock('---'); },
    tip: function () { insertBlock('> [!TIP]\n> 알아두면 좋은 내용'); },
    warn: function () { insertBlock('> [!WARNING]\n> 주의할 내용'); },
    more: function () { insertBlock('<!--more-->'); },
    image: function () { $('#wImgFile').click(); },
  };

  $$('#wTools [data-md]').forEach(function (b) {
    b.addEventListener('click', function () {
      var fn = ACTIONS[b.dataset.md];
      if (fn) fn();
    });
  });

  document.addEventListener('keydown', function (e) {
    var mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    var k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); ACTIONS.bold(); }
    else if (k === 'i') { e.preventDefault(); ACTIONS.italic(); }
    else if (k === 'k') { e.preventDefault(); ACTIONS.link(); }
    else if (k === '2') { e.preventDefault(); ACTIONS.h2(); }
    else if (k === '3') { e.preventDefault(); ACTIONS.h3(); }
    else if (k === 's') { e.preventDefault(); saveDraft(); say('임시저장했습니다.', 'ok'); }
    else if (k === 'enter') { e.preventDefault(); publish(); }
  });

  /* ── 이미지: 버튼 · 끌어놓기 · 붙여넣기 ───────────── */
  var MAX_IMG = 4 * 1024 * 1024;

  function uploadImage(file, into) {
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size > MAX_IMG) { say('이미지가 너무 큽니다 (4MB 이하).', 'error'); return; }

    var ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type];
    if (!ext) { say('지원하지 않는 형식입니다.', 'error'); return; }

    var name = 'post-' + Date.now() + '.' + ext;
    var repoPath = 'static/img/posts/' + name;
    var webPath = base + '/assets/img/posts/' + name;

    say('이미지를 올리는 중…', 'busy');
    var reader = new FileReader();
    reader.onload = function () {
      var b64 = String(reader.result).split(',')[1];
      GH.call('/repos/' + GH.repo + '/contents/' + encodeURI(repoPath), {
        method: 'PUT',
        body: { message: '이미지 추가: ' + name, content: b64, branch: 'main' },
      }).then(function () {
        if (into === 'cover') {
          $('#wImage').value = webPath;
          paintCover();
          say('대표 이미지를 올렸습니다.', 'ok');
        } else {
          insertBlock('![' + file.name.replace(/\.[^.]+$/, '') + '](' + webPath + ')');
          say('본문에 이미지를 넣었습니다.', 'ok');
        }
      }).catch(fail);
    };
    reader.readAsDataURL(file);
  }

  $('#wImgFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    uploadImage(f, 'body');
  });

  $('#wCoverPick').addEventListener('click', function () { $('#wCoverFile').click(); });
  $('#wCoverFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    uploadImage(f, 'cover');
  });
  $('#wCoverClear').addEventListener('click', function () { $('#wImage').value = ''; paintCover(); markDirty(); });
  $('#wImage').addEventListener('input', paintCover);

  function paintCover() {
    var v = $('#wImage').value.trim();
    var img = $('#wCoverPreview');
    img.hidden = !v;
    if (v) img.src = /^https?:\/\//.test(v) ? v : base + v;
  }

  text.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') === 0) {
        e.preventDefault();
        uploadImage(items[i].getAsFile(), 'body');
        return;
      }
    }
  });

  var drop = $('#wDrop');
  ['dragenter', 'dragover'].forEach(function (t) {
    body.addEventListener(t, function (e) {
      if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types || [], function (x) { return x === 'Files'; })) return;
      e.preventDefault(); drop.hidden = false;
    });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    body.addEventListener(t, function (e) {
      if (t === 'drop') {
        e.preventDefault();
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadImage(f, 'body');
      }
      if (t === 'dragleave' && e.relatedTarget && body.contains(e.relatedTarget)) return;
      drop.hidden = true;
    });
  });

  /* ── 발행 ─────────────────────────────────────────── */
  function publish() {
    var title = $('#wTitle').value.trim();
    if (!title) { say('제목을 입력해 주세요.', 'error'); $('#wTitle').focus(); return; }

    var date = $('#wDate').value || new Date().toISOString().slice(0, 10);
    var time = $('#wTime').value || '09:00';
    var meta = {
      title: title,
      subtitle: $('#wSubtitle').value.trim(),
      date: date + ' ' + time,
      categories: $('#wCategory').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean),
      tags: tags.slice(),
      image: $('#wImage').value.trim(),
      pinned: $('#wPinned').checked,
      draft: $('#wDraftFlag').checked,
      description: $('#wDesc').value.trim(),
    };
    if (!meta.categories.length) meta.categories = ['일기'];

    var content = GH.buildFM(meta, text.value);
    var slug = window.GaonMD ? window.GaonMD.slugify(title) : title.replace(/\s+/g, '-');
    var newPath = 'content/posts/' + date + '-' + slug + '.md';
    var path = editing ? editing.path : newPath;

    $('#wPublish').disabled = true;
    say('저장하는 중…', 'busy');

    GH.putFile(path, content, (editing ? '글 수정: ' : '새 글: ') + title, editing ? editing.sha : null)
      .then(function () {
        if (editing && newPath !== editing.path) {
          return GH.putFile(newPath, content, '글 이동: ' + title, null)
            .then(function () { return GH.deleteFile(editing.path, editing.sha, '옛 파일 정리: ' + title); });
        }
      })
      .then(function () {
        dirty = false;
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        $('#wPublish').disabled = false;
        if (EMBED) {
          say('발행했습니다. 1~2분 뒤 블로그에 나타납니다.', 'ok');
          toParent({ gaon: 'dirty', value: false });
          setTimeout(function () { toParent({ gaon: 'published', title: title, path: path }); }, 1200);
          return;
        }
        say('발행했습니다. 1~2분 뒤 블로그에 나타납니다. 잠시 후 이동합니다…', 'ok');
        setTimeout(function () { location.href = base + '/'; }, 2200);
      })
      .catch(function (e) { $('#wPublish').disabled = false; fail(e); });
  }
  $('#wPublish').addEventListener('click', publish);
})();
