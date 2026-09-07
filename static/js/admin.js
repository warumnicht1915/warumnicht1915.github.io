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
      var mds = (Array.isArray(files) ? files : []).filter(function (f) { return /\.mdx?$/.test(f.name); });
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
      renderTags();
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

  /* 글 편집은 전용 페이지(/write/)로 옮겼다. 여기서는 이동만 시킨다. */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function openEditor(post) {
    location.href = (CFG.baseurl || '') + '/write/' +
      (post ? '?edit=' + encodeURIComponent(post.path) : '');
  }

  /* ── 이미지 업로드 공용 ────────────────────────────── */
  var EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/svg+xml': 'svg',
  };

  /** 파일을 static/img/<prefix>-<시각>.<확장자> 로 커밋하고 웹 경로를 돌려준다. */
  function uploadImage(file, prefix, maxBytes) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('파일이 없습니다.'));
      if (file.size > (maxBytes || 2 * 1024 * 1024)) {
        return reject(new Error('이미지가 너무 큽니다 (' + Math.round(file.size / 1024) + 'KB). ' +
          Math.round((maxBytes || 2097152) / 1048576) + 'MB 이하로 줄여주세요.'));
      }
      var ext = EXT[file.type];
      if (!ext) return reject(new Error('지원하지 않는 형식입니다: ' + file.type));

      var name = prefix + '-' + Date.now() + '.' + ext;
      var repoPath = 'static/img/' + name;
      var reader = new FileReader();
      reader.onload = function () {
        var b64 = String(reader.result).split(',')[1];
        GH.call('/repos/' + REPO + '/contents/' + encodeURI(repoPath), {
          method: 'PUT',
          body: { message: '이미지 추가: ' + name, content: b64, branch: 'main' },
        }).then(function () { resolve('/assets/img/' + name); }).catch(reject);
      };
      reader.onerror = function () { reject(new Error('파일을 읽지 못했습니다.')); };
      reader.readAsDataURL(file);
    });
  }

  /** 파일 선택 → 업로드 → 입력칸에 경로 반영, 을 한 번에 묶는다. */
  function wireUpload(opts) {
    var pickBtn = $(opts.pick), fileEl = $(opts.file), input = $(opts.input);
    var clearBtn = opts.clear ? $(opts.clear) : null;
    if (!pickBtn || !fileEl || !input) return;

    var paint = function () {
      var v = (input.value || '').trim();
      var img = opts.preview ? $(opts.preview) : null;
      if (!img) return;
      if (!v) { img.hidden = true; img.removeAttribute('src'); return; }
      img.hidden = false;
      img.src = /^https?:\/\//.test(v) ? v : (CFG.baseurl || '') + v;
    };
    paint();
    input.addEventListener('input', paint);

    pickBtn.addEventListener('click', function () { fileEl.click(); });
    fileEl.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      say('이미지를 올리는 중…', 'busy');
      uploadImage(f, opts.prefix, opts.maxBytes).then(function (path) {
        input.value = path;
        paint();
        say('올렸습니다. 이어서 “설정 저장”을 눌러주세요.', 'ok');
      }).catch(fail);
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = opts.clearValue === undefined ? '' : opts.clearValue;
        paint();
        say('“설정 저장”을 눌러야 반영됩니다.', 'info');
      });
    }
    return paint;
  }

  var AVATAR_MAX = 2 * 1024 * 1024;   // 2MB
  var avatarInput = $('#sAvatar');

  function paintAvatar() {
    if (!avatarInput) return;
    var v = (avatarInput.value || '').trim();
    var img = $('#sAvatarPreview');
    if (img) img.src = /^https?:\/\//.test(v) ? v : (CFG.baseurl || '') + (v || '/assets/img/avatar.svg');
  }

  wireUpload({
    pick: '#sAvatarPick', file: '#sAvatarFile', input: '#sAvatar', preview: '#sAvatarPreview',
    clear: '#sAvatarReset', clearValue: '/assets/img/avatar.svg',
    prefix: 'avatar', maxBytes: AVATAR_MAX,
  });
  wireUpload({
    pick: '#bMarkPick', file: '#bMarkFile', input: '#bMarkImage', preview: '#bMarkPreview',
    clear: '#bMarkClear', prefix: 'logo', maxBytes: AVATAR_MAX,
  });
  wireUpload({
    pick: '#bHeroPick', file: '#bHeroFile', input: '#bHeroImage', preview: '#bHeroPreview',
    clear: '#bHeroClear', prefix: 'hero', maxBytes: 4 * 1024 * 1024,
  });

  var overlay = $('#bHeroOverlay');
  if (overlay) {
    overlay.addEventListener('input', function () { $('#bOverlayVal').textContent = overlay.value; });
  }

  /* ── 태그 전체 관리 (이름 변경 · 삭제) ─────────────── */
  function allTags() {
    var map = {};
    posts.forEach(function (p) {
      [].concat(p.meta.tags || []).forEach(function (t) {
        var key = String(t);
        if (!map[key]) map[key] = [];
        map[key].push(p);
      });
    });
    return Object.keys(map).sort(function (a, b) {
      return map[b].length - map[a].length || a.localeCompare(b, 'ko');
    }).map(function (name) { return { name: name, posts: map[name] }; });
  }

  function renderTags() {
    var ul = $('#adTagList');
    if (!ul) return;
    var list = allTags();
    $('#adTagCount').textContent = list.length + '개';

    // 편집기 자동완성 목록도 함께 채운다
    var dl = $('#adTagOptions');
    if (dl) dl.innerHTML = list.map(function (t) { return '<option value="' + esc(t.name) + '">'; }).join('');

    if (!list.length) { ul.innerHTML = '<li class="ad-empty">아직 태그가 없습니다.</li>'; return; }
    ul.innerHTML = list.map(function (t, i) {
      return '<li class="ad-tagitem">' +
        '<span class="tag mid">#' + esc(t.name) + '</span>' +
        '<em>' + t.posts.length + '개 글</em>' +
        '<span class="ad-tagposts">' +
          esc(t.posts.map(function (p) { return p.meta.title || p.name; }).join(', ')).slice(0, 80) +
        '</span>' +
        '<span class="ad-tagbtns">' +
          '<button type="button" class="btn-line" data-tag-rename="' + i + '">이름 변경</button>' +
          '<button type="button" class="btn-line danger" data-tag-del="' + i + '">삭제</button>' +
        '</span></li>';
    }).join('');
  }

  /** 여러 글의 태그 목록을 한 번에 고쳐 쓴다. */
  function rewriteTag(target, replacement) {
    var affected = posts.filter(function (p) {
      return [].concat(p.meta.tags || []).some(function (t) { return t === target; });
    });
    if (!affected.length) return Promise.resolve(0);

    var message = replacement
      ? '태그 이름 변경: ' + target + ' → ' + replacement
      : '태그 삭제: ' + target;

    // 한 글씩 순서대로 커밋한다 (동시에 보내면 sha 충돌이 난다)
    return affected.reduce(function (chain, p) {
      return chain.then(function () {
        var next = [].concat(p.meta.tags || [])
          .map(function (t) { return t === target ? replacement : t; })
          .filter(Boolean);
        // 중복 제거
        next = next.filter(function (t, i) { return next.indexOf(t) === i; });

        var meta = Object.assign({}, p.meta, { tags: next });
        meta.categories = [].concat(p.meta.categories || []);
        var text = buildFM(meta, p.body);
        return putFile(p.path, text, message, p.sha);
      });
    }, Promise.resolve()).then(function () { return affected.length; });
  }

  var tagList = $('#adTagList');
  if (tagList) {
    tagList.addEventListener('click', function (e) {
      var del = e.target.closest('[data-tag-del]');
      var ren = e.target.closest('[data-tag-rename]');
      var list = allTags();

      if (del) {
        var t = list[+del.dataset.tagDel];
        confirmBox('태그를 삭제할까요?',
          '“#' + t.name + '” 태그가 ' + t.posts.length + '개 글에서 제거됩니다. 글 자체는 그대로 남습니다.')
          .then(function (yes) {
            if (!yes) return;
            say('태그를 지우는 중…', 'busy');
            rewriteTag(t.name, null)
              .then(function (n) {
                say(n + '개 글에서 “#' + t.name + '” 을 지웠습니다. 1~2분 뒤 반영됩니다.', 'ok');
                return loadPosts();
              })
              .catch(fail);
          });
      }

      if (ren) {
        var t2 = list[+ren.dataset.tagRename];
        promptBox('태그 이름 변경', '“#' + t2.name + '” 을 무엇으로 바꿀까요?', t2.name)
          .then(function (value) {
            var next = String(value || '').trim().replace(/^#/, '');
            if (!next || next === t2.name) return;
            say('태그를 바꾸는 중…', 'busy');
            rewriteTag(t2.name, next)
              .then(function (n) {
                say(n + '개 글의 태그를 “#' + next + '” 로 바꿨습니다.', 'ok');
                return loadPosts();
              })
              .catch(fail);
          });
      }
    });
  }

  var reloadTags = $('#adTagReload');
  if (reloadTags) {
    reloadTags.addEventListener('click', function () {
      say('불러오는 중…', 'busy');
      loadPosts().then(function () { say('최신 상태입니다.', 'ok'); });
    });
  }

  /** 입력을 받는 모달 (window.prompt 대신) */
  function promptBox(title, text, initial) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'ad-modal';
      wrap.innerHTML =
        '<div class="ad-modal-box" role="dialog" aria-modal="true">' +
        '<b></b><p></p><input type="text" class="ad-modal-input">' +
        '<div class="ad-modal-btns">' +
        '<button type="button" class="btn-line" data-no>취소</button>' +
        '<button type="button" class="btn ad-primary" data-yes>바꾸기</button>' +
        '</div></div>';
      wrap.querySelector('b').textContent = title;
      wrap.querySelector('p').textContent = text;
      var input = wrap.querySelector('input');
      input.value = initial || '';
      document.body.appendChild(wrap);
      input.focus();
      input.select();

      var done = function (v) { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-yes]').onclick = function () { done(input.value); };
      wrap.querySelector('[data-no]').onclick = function () { done(null); };
      input.onkeydown = function (e) { if (e.key === 'Enter') done(input.value); };
      wrap.onclick = function (e) { if (e.target === wrap) done(null); };
    });
  }

  /* ── 인기 검색어 · 채팅 관리 ───────────────────────── */
  var Store = window.GaonStore;

  function renderTrends() {
    var ol = $('#adTrendList');
    if (!ol || !Store) return;
    Store.getTrends(30).then(function (list) {
      $('#adTrendCount').textContent = list.length + '개';
      if (!list.length) { ol.innerHTML = '<li class="ad-empty">아직 검색 기록이 없습니다.</li>'; return; }
      ol.innerHTML = list.map(function (t) {
        return '<li class="ad-trenditem">' +
          '<span class="rk">' + t.rank + '</span>' +
          '<b>' + esc(t.kw) + '</b>' +
          '<em>' + t.score + '점</em>' +
          '<button type="button" class="btn-line danger" data-trend-del="' + esc(t.kw) + '">삭제</button>' +
          '</li>';
      }).join('');
    });
  }

  var trendList = $('#adTrendList');
  if (trendList) {
    trendList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-trend-del]');
      if (!b || !Store) return;
      Store.removeTrend(b.dataset.trendDel).then(function () {
        say('“' + b.dataset.trendDel + '” 을 지웠습니다.', 'ok');
        renderTrends();
      });
    });
  }

  var trendClear = $('#adTrendClear');
  if (trendClear) {
    trendClear.addEventListener('click', function () {
      confirmBox('검색어를 전부 비울까요?', '집계된 인기 검색어가 모두 사라집니다. 되돌릴 수 없습니다.')
        .then(function (yes) {
          if (!yes || !Store) return;
          Store.clearTrends().then(function () { say('검색어를 모두 비웠습니다.', 'ok'); renderTrends(); });
        });
    });
  }

  var chatClear = $('#adChatClear');
  if (chatClear) {
    chatClear.addEventListener('click', function () {
      confirmBox('대화를 전부 지울까요?', '채팅방의 메시지와 이미지가 모두 삭제됩니다. 되돌릴 수 없습니다.')
        .then(function (yes) {
          if (!yes || !Store) return;
          Store.chat.clearAll().then(function () { say('대화를 모두 지웠습니다.', 'ok'); paintUsage(); });
        });
    });
  }

  var liveReload = $('#adLiveReload');
  if (liveReload) liveReload.addEventListener('click', function () { renderTrends(); paintUsage(); });

  function paintUsage() {
    var el = $('#adChatUsage');
    if (!el || !Store) return;
    var q = Store.chat.myQuota();
    var lim = Store.limits || {};
    el.innerHTML = '저장 방식: <b>' + (Store.remote ? '실시간 DB (모든 방문자 공유)' : '이 브라우저에만 (로컬 모드)') + '</b><br>' +
      '이미지 한도 — 1장 ' + Math.round((lim.maxBytes || 0) / 1024) + 'KB · ' +
      '사람당 ' + Math.round((lim.perUserBytes || 0) / 1048576) + 'MB / ' + (lim.perUserCount || 0) + '장 · ' +
      '전체 ' + Math.round((lim.totalBytes || 0) / 1048576) + 'MB';
  }

  renderTrends();
  paintUsage();

  /* 내 사용자 ID (관리자 등록용) */
  var uidEl = $('#adUid');
  if (uidEl && Store) {
    Store.whoami().then(function (who) {
      if (who.local) {
        uidEl.textContent = '공유 DB 미설정 (로컬 모드)';
        return;
      }
      uidEl.textContent = who.uid || '(받지 못함)';
      if (who.admin) uidEl.textContent += '  ← 관리자로 등록됨';
    });
  }
  var uidCopy = $('#adUidCopy');
  if (uidCopy) {
    uidCopy.addEventListener('click', function () {
      var v = (uidEl.textContent || '').split('  ')[0];
      if (navigator.clipboard) navigator.clipboard.writeText(v);
      say('복사했습니다: ' + v, 'ok');
    });
  }

  /** 블로그 화면의 "새 글 / 수정" 버튼에서 넘어온 요청을 처리한다. */
  function applyQuery() {
    var q = new URLSearchParams(location.search);
    if (q.get('new') !== null) { openEditor(null); return; }
    var target = q.get('edit');
    if (target) { location.href = (CFG.baseurl || '') + '/write/?edit=' + encodeURIComponent(target); }
  }
  function cleanUrl() {
    history.replaceState(null, '', location.pathname);
  }

  /* ── 시작 ──────────────────────────────────────────── */
  if (!REPO) {
    $('#adLoginMsg').textContent =
      'site.config.json 의 comments.repo 에 "소유자/저장소" 를 먼저 채워주세요.';
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
