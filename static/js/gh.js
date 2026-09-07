/* ============================================================
   gh.js — GitHub Contents API 얇은 래퍼
   관리자 페이지(/admin)와 블로그 안의 관리 버튼이 함께 쓴다.

   토큰은 이 브라우저의 localStorage 에만 있고,
   api.github.com 외에는 어디로도 나가지 않는다.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.GAON_CONFIG || {};
  var REPO = CFG.repo || '';
  var KEY = 'gaon.gh.token';
  var API = 'https://api.github.com';

  function getToken() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) { try { localStorage.setItem(KEY, t); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* UTF-8 안전 base64 (한글 본문 때문에 반드시 필요하다) */
  function toB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function call(path, options) {
    options = options || {};
    return fetch(API + path, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + getToken(),
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().then(function (data) {
        if (res.ok) return data;
        var msg = (data && data.message) || ('HTTP ' + res.status);
        if (res.status === 401) msg = '토큰이 만료됐거나 잘못되었습니다.';
        else if (res.status === 403) msg = '권한이 부족합니다. 토큰의 Contents 권한을 확인하세요.';
        else if (res.status === 404) msg = '파일이나 저장소를 찾을 수 없습니다: ' + path;
        else if (res.status === 409) msg = '다른 곳에서 먼저 수정됐습니다. 새로고침 후 다시 시도하세요.';
        var err = new Error(msg);
        err.status = res.status;
        throw err;
      });
    });
  }

  var GH = {
    repo: REPO,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    toB64: toB64,
    fromB64: fromB64,
    call: call,

    me: function () { return call('/user'); },

    getFile: function (p) {
      return call('/repos/' + REPO + '/contents/' + encodeURI(p) + '?ref=main')
        .then(function (d) { return { sha: d.sha, text: fromB64(d.content) }; });
    },
    listDir: function (p) {
      return call('/repos/' + REPO + '/contents/' + encodeURI(p) + '?ref=main');
    },
    putFile: function (p, text, message, sha) {
      var body = { message: message, content: toB64(text), branch: 'main' };
      if (sha) body.sha = sha;
      return call('/repos/' + REPO + '/contents/' + encodeURI(p), { method: 'PUT', body: body });
    },
    deleteFile: function (p, sha, message) {
      return call('/repos/' + REPO + '/contents/' + encodeURI(p),
        { method: 'DELETE', body: { message: message, sha: sha, branch: 'main' } });
    },

    /* front matter 읽기 / 쓰기 (관리 화면 공용) */
    parseFM: function (text) {
      var m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) return { meta: {}, body: text };
      var meta = {};
      m[1].split('\n').forEach(function (line) {
        var kv = line.match(/^([\w]+):\s*(.*)$/);
        if (!kv) return;
        var k = kv[1], v = kv[2].trim();
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (/^\[.*\]$/.test(v)) {
          v = v.slice(1, -1).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        } else v = v.replace(/^["']|["']$/g, '');
        meta[k] = v;
      });
      return { meta: meta, body: m[2] };
    },

    buildFM: function (meta, body) {
      var lines = ['---'];
      lines.push('title: ' + meta.title);
      if (meta.subtitle) lines.push('subtitle: ' + meta.subtitle);
      lines.push('date: ' + meta.date);
      lines.push('categories: [' + (meta.categories || []).join(', ') + ']');
      lines.push('tags: [' + (meta.tags || []).join(', ') + ']');
      if (meta.image) lines.push('image: ' + meta.image);
      if (meta.pinned) lines.push('pinned: true');
      if (meta.draft) lines.push('draft: true');
      if (meta.description) lines.push('description: ' + meta.description);
      lines.push('---', '');
      return lines.join('\n') + String(body || '').replace(/^\n+/, '') + '\n';
    },
  };

  global.GaonGH = GH;
})(window);
