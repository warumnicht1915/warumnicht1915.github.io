/* ============================================================
   admin.js — 블로그 관리자 페이지
   ------------------------------------------------------------
   GitHub Contents API 로 저장소 파일을 직접 읽고 쓴다.
   저장하면 커밋이 되고, Actions 가 빌드해서 배포한다.

   토큰은 이 브라우저의 localStorage 에만 있고,
   api.github.com 외에는 어디로도 나가지 않는다.
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.GAON_CONFIG || {};
  var REPO = CFG.repo || '';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var root = $('#admin');
  if (!root) return;

  var me = null;
  var posts = [];      // {path, sha, name, meta, body}
  var siteCfg = null, siteSha = '';
  var navData = null, navSha = '';
  var noticeData = null, noticeSha = '';
  var editing = null;  // 수정 중인 글의 path (새 글이면 null)

  var GH = window.GaonGH;
  if (!GH) { console.error('gh.js 가 먼저 로드되어야 합니다.'); return; }

  var getFile = GH.getFile, listDir = GH.listDir, putFile = GH.putFile, deleteFile = GH.deleteFile;

  /* ── 알림 ──────────────────────────────────────────── */
  var statusEl = $('#adStatus');
  var statusTimer = null;
  function say(text, kind) {
    clearTimeout(statusTimer);
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.className = 'ad-status ' + (kind || 'info');
    if (kind !== 'busy') statusTimer = setTimeout(function () { statusEl.hidden = true; }, 5000);
  }
  function fail(e) { say(e && e.message ? e.message : String(e), 'error'); }

  /* ── 확인 모달 (window.confirm 대신) ───────────────── */
  var modal = $('#adModal');
  function confirmBox(title, text) {
    return new Promise(function (resolve) {
      $('#adModalTitle').textContent = title;
      $('#adModalText').textContent = text;
      modal.hidden = false;
      var done = function (v) {
        modal.hidden = true;
        $('#adModalYes').onclick = null;
        $('#adModalNo').onclick = null;
        resolve(v);
      };
      $('#adModalYes').onclick = function () { done(true); };
      $('#adModalNo').onclick = function () { done(false); };
    });
  }

  /* ── front matter (gh.js 공용) ─────────────────────── */
  var parseFM = GH.parseFM, buildFM = GH.buildFM;

  /* ── 로그인 ────────────────────────────────────────── */
  var gate = $('#adGate'), app = $('#adApp');

  function connect(t, remember) {
    GH.setToken(t);
    return GH.me().then(function (user) {
      me = user;
      if (remember) GH.setToken(t);
      $('#adUser').textContent = user.login;
      $('#adAvatar').src = user.avatar_url;
      $('#adRepo').textContent = REPO;
      gate.hidden = true;
      app.hidden = false;
      return Promise.all([loadPosts(), loadSite(), loadData()]).then(applyQuery);
    });
  }

  $('#adLoginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('#adToken').value.trim();
    if (!t) return;
    $('#adLoginMsg').textContent = '확인 중…';
    connect(t, $('#adRemember').checked).catch(function (err) {
      if (!$('#adRemember').checked) GH.clearToken();
      $('#adLoginMsg').textContent = err.message;
    });
  });

  $('#adLogout').addEventListener('click', function () {
    GH.clearToken();
    me = null;
    app.hidden = true; gate.hidden = false;
    $('#adToken').value = '';
    $('#adLoginMsg').textContent = '로그아웃했습니다. 토큰을 지웠습니다.';
  });

  /* ── 탭 ────────────────────────────────────────────── */
  $$('.ad-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });
  function showTab(name) {
    $$('.ad-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $$('.ad-panel').forEach(function (p) { p.classList.toggle('on', p.dataset.panel === name); });
  }

  /* ── 글 목록 ───────────────────────────────────────── */
  function loadPosts() {
    return listDir('content/posts').then(function (files) {
      var mds = files.filter(function (f) { return /\.mdx?$/.test(f.name); });
      return Promise.all(mds.map(function (f) {
        return getFile(f.path).then(function (r) {
          var parsed = parseFM(r.text);
          return { path: f.path, sha: r.sha, name: f.name, meta: parsed.meta, body: parsed.body };
        });
      }));
    }).then(function (list) {
      posts = list.sort(function (a, b) { return String(b.name).localeCompare(String(a.name)); });
      renderPosts();
      fillCategories();
    }).catch(fail);
  }

  function renderPosts() {
    var ul = $('#adPostList');
    $('#adPostCount').textContent = posts.length + '개';
    if (!posts.length) { ul.innerHTML = '<li class="ad-empty">아직 글이 없습니다. “새 글” 탭에서 첫 글을 써보세요.</li>'; return; }

    ul.innerHTML = posts.map(function (p, i) {
      var cats = [].concat(p.meta.categories || []).join(', ');
      return '<li class="ad-item">' +
        '<div class="ad-item-main">' +
          '<b>' + esc(p.meta.title || p.name) + '</b>' +
          '<span class="ad-item-meta">' +
            esc(String(p.meta.date || '').slice(0, 10)) +
            (cats ? ' · ' + esc(cats) : '') +
            (p.meta.pinned ? ' · <em class="ad-flag">고정</em>' : '') +
            (p.meta.draft ? ' · <em class="ad-flag draft">초안</em>' : '') +
          '</span>' +
        '</div>' +
        '<div class="ad-item-btns">' +
          '<button type="button" class="btn-line" data-edit="' + i + '">수정</button>' +
          '<button type="button" class="btn-line danger" data-del="' + i + '">삭제</button>' +
        '</div></li>';
    }).join('');
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  $('#adPostList').addEventListener('click', function (e) {
    var edit = e.target.closest('[data-edit]');
    var del = e.target.closest('[data-del]');
    if (edit) return openEditor(posts[+edit.dataset.edit]);
    if (del) {
      var p = posts[+del.dataset.del];
      confirmBox('글을 삭제할까요?', '“' + (p.meta.title || p.name) + '” 이 저장소에서 지워집니다. ' +
        'GitHub 커밋 이력에는 남으니 나중에 되살릴 수 있습니다.').then(function (yes) {
        if (!yes) return;
        say('삭제하는 중…', 'busy');
        deleteFile(p.path, p.sha, '글 삭제: ' + (p.meta.title || p.name))
          .then(function () { say('삭제했습니다. 1~2분 뒤 사이트에 반영됩니다.', 'ok'); return loadPosts(); })
          .catch(fail);
      });
    }
  });

  $('#adReload').addEventListener('click', function () { say('불러오는 중…', 'busy'); loadPosts().then(function () { say('최신 상태입니다.', 'ok'); }); });

  function fillCategories() {
    var set = {};
    posts.forEach(function (p) { [].concat(p.meta.categories || []).forEach(function (c) { set[c] = 1; }); });
    $('#adCats').innerHTML = Object.keys(set).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
  }

  /* ── 편집기 ────────────────────────────────────────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function openEditor(post) {
    editing = post || null;
    $('#adEditTitle').textContent = post ? '글 수정' : '새 글 쓰기';
    $('#adSave').textContent = post ? '수정 저장' : '발행하기';

    var m = post ? post.meta : {};
    var d = new Date();
    var dateStr = String(m.date || '');
    $('#fTitle').value = m.title || '';
    $('#fSubtitle').value = m.subtitle || '';
    $('#fDate').value = dateStr.slice(0, 10) ||
      (d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
    $('#fTime').value = (dateStr.slice(11, 16)) || (pad(d.getHours()) + ':' + pad(d.getMinutes()));
    $('#fCategory').value = [].concat(m.categories || []).join(', ');
    $('#fTags').value = [].concat(m.tags || []).join(', ');
    $('#fDesc').value = m.description || '';
    $('#fImage').value = m.image || '';
    $('#fPinned').checked = m.pinned === true;
    $('#fDraft').checked = m.draft === true;
    $('#fBody').value = post ? post.body : '';
    showTab('write');
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('#adSave').addEventListener('click', function () {
    var title = $('#fTitle').value.trim();
    if (!title) { say('제목을 입력해 주세요.', 'error'); $('#fTitle').focus(); return; }

    var date = $('#fDate').value || new Date().toISOString().slice(0, 10);
    var time = $('#fTime').value || '09:00';
    var meta = {
      title: title,
      subtitle: $('#fSubtitle').value.trim(),
      date: date + ' ' + time,
      categories: splitList($('#fCategory').value),
      tags: splitList($('#fTags').value),
      image: $('#fImage').value.trim(),
      pinned: $('#fPinned').checked,
      draft: $('#fDraft').checked,
      description: $('#fDesc').value.trim(),
    };
    var text = buildFM(meta, $('#fBody').value);

    var slug = (window.GaonMD ? window.GaonMD.slugify(title) : title.replace(/\s+/g, '-'));
    var newPath = 'content/posts/' + date + '-' + slug + '.md';
    var path = editing ? editing.path : newPath;

    say('저장하는 중…', 'busy');
    putFile(path, text, (editing ? '글 수정: ' : '새 글: ') + title, editing ? editing.sha : null)
      .then(function () {
        // 제목이나 날짜가 바뀌어 파일명이 달라졌으면 옛 파일을 정리한다
        if (editing && newPath !== editing.path) {
          return putFile(newPath, text, '글 이동: ' + title, null)
            .then(function () { return deleteFile(editing.path, editing.sha, '옛 파일 정리: ' + title); });
        }
      })
      .then(function () {
        say('저장했습니다. 1~2분 뒤 사이트에 반영됩니다.', 'ok');
        editing = null;
        showTab('posts');
        return loadPosts();
      })
      .catch(fail);
  });

  function splitList(v) {
    return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* 미리보기 — 빌드에 쓰는 것과 같은 파서를 쓴다 */
  var previewOn = false;
  $('#adPreviewBtn').addEventListener('click', function () {
    previewOn = !previewOn;
    $('#adPreview').hidden = !previewOn;
    $('#adPreviewBtn').textContent = previewOn ? '미리보기 끄기' : '미리보기';
    root.classList.toggle('split', previewOn);
    renderPreview();
  });
  $('#fBody').addEventListener('input', function () { if (previewOn) renderPreview(); });
  $('#fTitle').addEventListener('input', function () { if (previewOn) renderPreview(); });

  var previewTimer = null;
  function renderPreview() {
    if (!previewOn || !window.GaonMD) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var title = $('#fTitle').value.trim();
      var out = window.GaonMD.render($('#fBody').value || '');
      $('#adPreviewBody').innerHTML =
        (title ? '<h1 class="ad-pv-title">' + esc(title) + '</h1>' : '') + out.html;
    }, 180);
  }

  /* ── 사이트 설정 ───────────────────────────────────── */
  function loadSite() {
    return getFile('site.config.json').then(function (r) {
      siteCfg = JSON.parse(r.text);
      siteSha = r.sha;
      var a = siteCfg.author || {};
      $('#sTitle').value = siteCfg.title || '';
      $('#sSubtitle').value = siteCfg.subtitle || '';
      $('#sDesc').value = siteCfg.description || '';
      $('#sAuthorName').value = a.name || '';
      $('#sBio').value = a.bio || '';
      $('#sGithub').value = a.github || '';
      $('#sEmail').value = a.email || '';
      $('#sAvatar').value = a.avatar || '';
      $('#sPerPage').value = siteCfg.perPage || 6;
      var g = (siteCfg.comments && siteCfg.comments.giscus) || {};
      $('#gRepoId').value = g.repoId || '';
      $('#gCatId').value = g.categoryId || '';
      var f = (siteCfg.realtime && siteCfg.realtime.firebase) || {};
      $('#rDbUrl').value = f.databaseURL || '';
    }).catch(fail);
  }

  $('#adSaveSite').addEventListener('click', function () {
    if (!siteCfg) return;
    siteCfg.title = $('#sTitle').value.trim();
    siteCfg.subtitle = $('#sSubtitle').value.trim();
    siteCfg.description = $('#sDesc').value.trim();
    siteCfg.perPage = Number($('#sPerPage').value) || 6;
    siteCfg.author = siteCfg.author || {};
    siteCfg.author.name = $('#sAuthorName').value.trim();
    siteCfg.author.bio = $('#sBio').value.trim();
    siteCfg.author.github = $('#sGithub').value.trim();
    siteCfg.author.avatar = $('#sAvatar').value.trim();

    var email = $('#sEmail').value.trim();
    if (email) siteCfg.author.email = email; else delete siteCfg.author.email;

    siteCfg.comments = siteCfg.comments || {};
    siteCfg.comments.giscus = siteCfg.comments.giscus || {};
    siteCfg.comments.giscus.repoId = $('#gRepoId').value.trim();
    siteCfg.comments.giscus.categoryId = $('#gCatId').value.trim();

    siteCfg.realtime = siteCfg.realtime || {};
    siteCfg.realtime.firebase = siteCfg.realtime.firebase || {};
    siteCfg.realtime.firebase.databaseURL = $('#rDbUrl').value.trim();

    say('설정을 저장하는 중…', 'busy');
    putFile('site.config.json', JSON.stringify(siteCfg, null, 2) + '\n', '사이트 설정 변경', siteSha)
      .then(function (r) { siteSha = r.content.sha; say('저장했습니다. 1~2분 뒤 반영됩니다.', 'ok'); })
      .catch(fail);
  });

  /* ── 메뉴 · 공지 ───────────────────────────────────── */
  function loadData() {
    return Promise.all([getFile('data/nav.json'), getFile('data/notice.json')])
      .then(function (r) {
        navData = JSON.parse(r[0].text); navSha = r[0].sha;
        noticeData = JSON.parse(r[1].text); noticeSha = r[1].sha;
        renderRows();
      }).catch(fail);
  }

  function renderRows() {
    $('#adNoticeRows').innerHTML = noticeData.map(function (n, i) {
      return '<li class="ad-rowitem">' +
        '<input type="text" data-n="text" data-i="' + i + '" value="' + esc(n.text) + '" placeholder="공지 내용">' +
        '<input type="text" data-n="url" data-i="' + i + '" value="' + esc(n.url) + '" placeholder="/posts/...">' +
        '<input type="text" data-n="date" data-i="' + i + '" value="' + esc(n.date) + '" placeholder="2026-09-06">' +
        '<button type="button" class="ad-x" data-rm-notice="' + i + '" aria-label="삭제">×</button></li>';
    }).join('');

    $('#adNavRows').innerHTML = navData.map(function (m, i) {
      return '<li class="ad-rowitem">' +
        '<input type="text" data-m="title" data-i="' + i + '" value="' + esc(m.title) + '" placeholder="메뉴 이름">' +
        '<input type="text" data-m="url" data-i="' + i + '" value="' + esc(m.url) + '" placeholder="/archive/">' +
        '<input type="text" data-m="icon" data-i="' + i + '" value="' + esc(m.icon) + '" placeholder="list">' +
        '<button type="button" class="ad-x" data-rm-nav="' + i + '" aria-label="삭제">×</button></li>';
    }).join('');
  }

  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.n !== undefined && t.dataset.i !== undefined) noticeData[+t.dataset.i][t.dataset.n] = t.value;
    if (t.dataset.m !== undefined && t.dataset.i !== undefined) navData[+t.dataset.i][t.dataset.m] = t.value;
  });

  root.addEventListener('click', function (e) {
    var rn = e.target.closest('[data-rm-notice]');
    var rv = e.target.closest('[data-rm-nav]');
    if (rn) { noticeData.splice(+rn.dataset.rmNotice, 1); renderRows(); }
    if (rv) { navData.splice(+rv.dataset.rmNav, 1); renderRows(); }
  });

  $('#adAddNotice').addEventListener('click', function () {
    noticeData.push({ text: '', url: '/', date: new Date().toISOString().slice(0, 10) });
    renderRows();
  });
  $('#adAddNav').addEventListener('click', function () {
    navData.push({ title: '', url: '/', icon: 'list' });
    renderRows();
  });

  $('#adSaveData').addEventListener('click', function () {
    say('저장하는 중…', 'busy');
    putFile('data/notice.json', JSON.stringify(noticeData, null, 2) + '\n', '공지사항 수정', noticeSha)
      .then(function (r) {
        noticeSha = r.content.sha;
        return putFile('data/nav.json', JSON.stringify(navData, null, 2) + '\n', '메뉴 수정', navSha);
      })
      .then(function (r) { navSha = r.content.sha; say('저장했습니다. 1~2분 뒤 반영됩니다.', 'ok'); })
      .catch(fail);
  });

  /** 블로그 화면의 "새 글 / 수정" 버튼에서 넘어온 요청을 처리한다. */
  function applyQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get('new') !== null) { openEditor(null); cleanUrl(); return; }
    var target = q.get('edit');
    if (!target) return;
    var found = posts.filter(function (p) { return p.path === target; })[0];
    if (found) openEditor(found);
    else say('그 글을 찾지 못했습니다: ' + target, 'error');
    cleanUrl();
  }
  function cleanUrl() {
    history.replaceState(null, '', location.pathname);
  }

  /* ── 시작 ──────────────────────────────────────────── */
  if (!REPO) {
    $('#adLoginMsg').textContent =
      'site.config.json 의 comments.giscus.repo 에 "소유자/저장소" 를 먼저 채워주세요.';
    return;
  }
  var saved = GH.getToken();
  if (saved) {
    connect(saved, true).catch(function (err) {
      GH.clearToken();
      $('#adLoginMsg').textContent = err.message + ' 다시 연결해 주세요.';
    });
  }
})();
