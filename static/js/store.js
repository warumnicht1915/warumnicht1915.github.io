/* ============================================================
   store.js — 공유 상태 저장소 (조회수 · 방문자 · 검색어 · 채팅 · 댓글)
   ------------------------------------------------------------
   원격 모드 (realtime.firebase.databaseURL + apiKey 가 있을 때)
     · 인증  : Identity Toolkit REST 로 익명 로그인. SDK 를 쓰지 않는다.
               브라우저마다 고정된 uid 를 받고, 토큰은 만료 전에 갱신한다.
     · 읽기/쓰기: Realtime Database REST (?auth=<idToken>)
     · 증가  : ETag + if-match 조건부 쓰기 (규칙에서 +1 만 허용)
     · 수신  : EventSource(SSE), 토큰 만료 전에 다시 연결

   보안은 서버 규칙이 담당한다 (SETUP.md 3번).
     · 로그인하지 않으면 아무것도 쓸 수 없다
     · 글쓴이(uid)만 자기 글을 고치거나 지울 수 있다
     · /admins/<uid> 에 등록된 관리자는 무엇이든 지울 수 있다
     · 카운터는 한 번에 +1 만 허용해 숫자를 부풀릴 수 없다

   설정이 비어 있으면 로컬 모드로 내려앉고, 화면에 그 사실을 표시한다.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.GAON_CONFIG || {};
  var FB = CFG.firebase || {};
  var DB = (FB.databaseURL || '').replace(/\/$/, '');
  var KEY = FB.apiKey || '';
  var ROOM = CFG.room || 'main';
  var REMOTE = !!(DB && KEY);
  var CHAT = CFG.chat || {};
  var IMG = CHAT.image || {};

  var NS = 'gaon.';
  var HEARTBEAT = 20000;
  var ALIVE = 65000;
  var VIEW_WINDOW = 1800000;

  /* ── 작은 헬퍼 ──────────────────────────────────────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(offset) {
    var d = new Date(Date.now() - (offset || 0) * 86400000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function readLS(key, fallback) {
    try {
      var v = localStorage.getItem(NS + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function writeLS(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) {}
  }
  function keyOf(s) {
    return String(s || '/').replace(/[.$#\[\]\/]/g, '_').replace(/^_+|_+$/g, '') || 'root';
  }

  /* ═════════════════ 인증 (Identity Toolkit REST) ═════════ */

  var auth = {
    uid: readLS('uid', ''),
    token: '',
    expires: 0,
    ready: null,
    admin: false,
  };

  function signInAnonymously() {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.idToken) throw new Error(d.error && d.error.message || 'anonymous sign-in failed');
      writeLS('refresh', d.refreshToken);
      writeLS('uid', d.localId);
      auth.uid = d.localId;
      auth.token = d.idToken;
      auth.expires = Date.now() + (Number(d.expiresIn || 3600) - 120) * 1000;
      return auth.token;
    });
  }

  function refreshToken(rt) {
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rt),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.id_token) throw new Error('token refresh failed');
      writeLS('refresh', d.refresh_token);
      writeLS('uid', d.user_id);
      auth.uid = d.user_id;
      auth.token = d.id_token;
      auth.expires = Date.now() + (Number(d.expires_in || 3600) - 120) * 1000;
      return auth.token;
    });
  }

  /** 항상 살아 있는 토큰을 돌려준다. 없으면 만들고, 곧 만료면 갱신한다. */
  function token() {
    if (!REMOTE) return Promise.resolve('');
    if (auth.token && Date.now() < auth.expires) return Promise.resolve(auth.token);

    var rt = readLS('refresh', '');
    var job = rt ? refreshToken(rt).catch(signInAnonymously) : signInAnonymously();
    auth.ready = job.then(function (t) {
      // 관리자 등록 여부는 한 번만 확인한다
      return rawGet('/admins/' + auth.uid, t).then(function (v) {
        auth.admin = v === true;
        return t;
      }).catch(function () { return t; });
    });
    return auth.ready;
  }

  /* ═════════════════ Realtime Database REST ═══════════════ */

  function url(path, t, extra) {
    return DB + path + '.json?auth=' + encodeURIComponent(t) + (extra ? '&' + extra : '');
  }

  function rawGet(path, t) {
    return fetch(url(path, t), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function rget(path) {
    return token().then(function (t) { return rawGet(path, t); });
  }
  function rsend(method, path, value) {
    return token().then(function (t) {
      return fetch(url(path, t), {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: value === undefined ? undefined : JSON.stringify(value),
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (txt) { throw new Error(txt || ('HTTP ' + r.status)); });
        return r.status === 204 ? true : r.json();
      });
    });
  }
  var rput = function (p, v) { return rsend('PUT', p, v).then(function () { return true; }).catch(function () { return false; }); };
  var rpatch = function (p, v) { return rsend('PATCH', p, v).then(function () { return true; }).catch(function () { return false; }); };
  var rpush = function (p, v) { return rsend('POST', p, v).catch(function () { return null; }); };
  var rdelete = function (p) { return rsend('DELETE', p).then(function () { return true; }).catch(function () { return false; }); };

  /** 원자적 +1. 규칙이 "이전 값 + 1" 만 허용하므로 by 는 1 이 기본. */
  function rincr(path, by, tries) {
    by = by === undefined ? 1 : by;
    tries = tries === undefined ? 5 : tries;

    return token().then(function (t) {
      return fetch(url(path, t), { cache: 'no-store', headers: { 'X-Firebase-ETag': 'true' } })
        .then(function (res) {
          var etag = res.headers.get('ETag') || 'null_etag';
          return res.json().then(function (cur) {
            var next = (typeof cur === 'number' ? cur : 0) + by;
            return fetch(url(path, t), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'if-match': etag },
              body: JSON.stringify(next),
            }).then(function (put) {
              if (put.ok) return next;
              if (put.status === 412 && tries > 0) {
                return new Promise(function (r) { setTimeout(r, 60 + Math.random() * 160); })
                  .then(function () { return rincr(path, by, tries - 1); });
              }
              return null;
            });
          });
        });
    }).catch(function () { return null; });
  }

  /**
   * 실시간 구독. 기본은 SSE 이고, 막혀 있으면 폴링으로 내려앉는다.
   * 토큰이 만료되기 전에 스스로 다시 연결한다.
   */
  function subscribe(path, query, onData) {
    var es = null, poll = null, stopped = false, timer = null;
    var errors = 0;

    function fallbackToPolling() {
      if (stopped || poll) return;
      if (es) { es.close(); es = null; }
      var last = '';
      var tick = function () {
        rget(path).then(function (all) {
          if (stopped) return;
          var json = JSON.stringify(all);
          if (json === last) return;
          last = json;
          onData({ path: '/', data: all });
        });
      };
      tick();
      poll = setInterval(tick, 5000);
    }

    function connect() {
      if (stopped) return;
      token().then(function (t) {
        if (stopped) return;
        try {
          es = new EventSource(url(path, t, query));
          es.addEventListener('put', function (e) { errors = 0; onData(JSON.parse(e.data)); });
          es.addEventListener('patch', function (e) { errors = 0; onData(JSON.parse(e.data)); });
          es.onerror = function () {
            // 완전히 닫혔으면 (readyState 2) 재연결이 없으므로 바로 폴링으로 바꾼다.
            // 재연결 중(0)이면 몇 번은 기다려 본다.
            errors += 1;
            if (es.readyState === 2 || errors >= 3) fallbackToPolling();
          };
        } catch (err) {
          fallbackToPolling();
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(function () {   // 50분마다 새 토큰으로 재연결
          if (es) { es.close(); es = null; }
          connect();
        }, 50 * 60 * 1000);

        // SSE 가 4초 안에 연결되지 않으면 폴링으로 바꾼다
        setTimeout(function () {
          if (!stopped && es && es.readyState !== 1) fallbackToPolling();
        }, 4000);
      });
    }

    connect();
    return function () {
      stopped = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (es) es.close();
    };
  }

  /* ── 로컬 모드 (탭 간 동기화) ───────────────────────── */
  var channel = null;
  try { channel = new BroadcastChannel('gaon-store'); } catch (e) { channel = null; }
  var subs = {};
  function emit(topic, payload) {
    (subs[topic] || []).forEach(function (fn) { fn(payload); });
    if (channel) { try { channel.postMessage({ topic: topic, payload: payload }); } catch (e) {} }
  }
  function on(topic, fn) {
    (subs[topic] = subs[topic] || []).push(fn);
    return function () { subs[topic] = (subs[topic] || []).filter(function (f) { return f !== fn; }); };
  }
  if (channel) {
    channel.onmessage = function (e) {
      var d = e.data || {};
      (subs[d.topic] || []).forEach(function (fn) { fn(d.payload); });
    };
  }

  var ME = (function () {
    var id = readLS('cid', null);
    if (!id) {
      id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      writeLS('cid', id);
    }
    return id;
  })();

  /* ═════════════════════ 공개 API ═════════════════════ */

  var Store = {
    mode: REMOTE ? 'remote' : 'local',
    remote: REMOTE,
    me: ME,
    limits: IMG,

    /** 로그인 완료를 기다린다. uid 와 관리자 여부를 돌려준다. */
    whoami: function () {
      if (!REMOTE) return Promise.resolve({ uid: ME, admin: null, local: true });
      return token().then(function () {
        return { uid: auth.uid, admin: auth.admin, local: false };
      }).catch(function () { return { uid: '', admin: false, local: false, error: true }; });
    },
    uid: function () { return REMOTE ? auth.uid : ME; },
    isAdmin: function () { return REMOTE ? auth.admin : true; },

    /* ── 글 조회수 ──────────────────────────────────── */
    countView: function (u) {
      var seen = readLS('seen', {});
      var now = Date.now();
      var fresh = !seen[u] || now - seen[u] > VIEW_WINDOW;
      if (fresh) { seen[u] = now; writeLS('seen', seen); }

      if (!REMOTE) {
        var local = readLS('views', {});
        if (fresh) { local[u] = (local[u] || 0) + 1; writeLS('views', local); }
        return Promise.resolve(local[u] || 0);
      }
      if (!fresh) return this.getViews([u]).then(function (m) { return m[u] || 0; });
      return rincr('/views/' + keyOf(u)).then(function (n) { return typeof n === 'number' ? n : 0; });
    },

    getViews: function (urls) {
      if (!REMOTE) {
        var local = readLS('views', {});
        var out = {};
        urls.forEach(function (u) { out[u] = local[u] || 0; });
        return Promise.resolve(out);
      }
      return rget('/views').then(function (all) {
        var out = {};
        all = all || {};
        urls.forEach(function (u) { out[u] = all[keyOf(u)] || 0; });
        return out;
      });
    },

    /* ── 방문자 (UV · PV) ───────────────────────────── */
    trackVisit: function () {
      var today = dayKey(0), yest = dayKey(1);
      var newToday = readLS('lastVisitDay', '') !== today;
      var newEver = !readLS('everVisited', false);
      if (newToday) writeLS('lastVisitDay', today);
      if (newEver) writeLS('everVisited', true);

      if (!REMOTE) {
        var v = readLS('visits', {});
        v.days = v.days || {};
        v.days[today] = v.days[today] || { uv: 0, pv: 0 };
        v.days[today].pv += 1;
        if (newToday) v.days[today].uv += 1;
        v.pv = (v.pv || 0) + 1;
        if (newEver) v.uv = (v.uv || 0) + 1;
        writeLS('visits', v);
        return Promise.resolve({
          shared: false, today: v.days[today],
          yesterday: v.days[yest] || { uv: 0, pv: 0 },
          total: { uv: v.uv || 0, pv: v.pv || 0 },
        });
      }

      return Promise.all([
        rincr('/visits/days/' + today + '/pv'),
        newToday ? rincr('/visits/days/' + today + '/uv') : rget('/visits/days/' + today + '/uv'),
        rincr('/visits/total/pv'),
        newEver ? rincr('/visits/total/uv') : rget('/visits/total/uv'),
        rget('/visits/days/' + yest),
      ]).then(function (r) {
        var y = r[4] || {};
        return {
          shared: true,
          today: { pv: r[0] || 0, uv: r[1] || 0 },
          yesterday: { pv: y.pv || 0, uv: y.uv || 0 },
          total: { pv: r[2] || 0, uv: r[3] || 0 },
        };
      });
    },

    /* ── 인기 검색어 ────────────────────────────────── */
    bumpTrend: function (raw) {
      var kw = String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (kw.length < 2 || kw.length > 24) return Promise.resolve(false);
      var recent = readLS('kwSent', {});
      var now = Date.now();
      if (recent[kw] && now - recent[kw] < 600000) return Promise.resolve(false);
      recent[kw] = now;
      writeLS('kwSent', recent);

      if (!REMOTE) {
        var counts = readLS('trends', {});
        counts[kw] = (counts[kw] || 0) + 1;
        writeLS('trends', counts);
        emit('trends', counts);
        return Promise.resolve(true);
      }
      return rpatch('/trends/' + keyOf(kw), { kw: kw })
        .then(function () { return rincr('/trends/' + keyOf(kw) + '/n'); })
        .then(function () { return true; });
    },

    getTrends: function (size) {
      size = size || 10;
      var seed = (CFG.trends && CFG.trends.seed) || [];
      var load = REMOTE ? rget('/trends').then(function (m) { return m || {}; })
                        : Promise.resolve(readLS('trends', {}));
      return load.then(function (raw) {
        var merged = {};
        seed.forEach(function (kw, i) { merged[String(kw).toLowerCase()] = seed.length - i; });
        Object.keys(raw).forEach(function (k) {
          var row = raw[k], kw, n;
          if (row && typeof row === 'object') { kw = row.kw || k.replace(/_/g, ' '); n = row.n || 0; }
          else { kw = REMOTE ? k.replace(/_/g, ' ') : k; n = row || 0; }
          if (!kw) return;
          merged[kw] = (merged[kw] || 0) + n * 10;
        });
        var list = Object.keys(merged)
          .map(function (kw) { return { kw: kw, score: merged[kw] }; })
          .sort(function (a, b) { return b.score - a.score || a.kw.localeCompare(b.kw, 'ko'); })
          .slice(0, size);
        var prev = readLS('trendRank', {}), next = {};
        list.forEach(function (item, i) {
          var before = prev[item.kw];
          next[item.kw] = i;
          item.rank = i + 1;
          if (before === undefined) { item.delta = 'new'; item.deltaText = 'NEW'; }
          else if (before > i) { item.delta = 'up'; item.deltaText = '▲' + (before - i); }
          else if (before < i) { item.delta = 'down'; item.deltaText = '▼' + (i - before); }
          else { item.delta = 'same'; item.deltaText = '–'; }
        });
        writeLS('trendRank', next);
        return list;
      });
    },
    onTrendsChange: function (fn) { return REMOTE ? function () {} : on('trends', fn); },
    removeTrend: function (kw) {
      if (!REMOTE) {
        var c = readLS('trends', {});
        delete c[String(kw).toLowerCase()];
        writeLS('trends', c); emit('trends', c);
        return Promise.resolve(true);
      }
      return rdelete('/trends/' + keyOf(String(kw).toLowerCase()));
    },
    clearTrends: function () {
      if (!REMOTE) { writeLS('trends', {}); emit('trends', {}); return Promise.resolve(true); }
      return rdelete('/trends');
    },

    /* ── 접속자 ─────────────────────────────────────── */
    watchPresence: function (onCount) {
      var stopped = false;
      if (!REMOTE) {
        var tabs = {}, mine = 'tab' + Math.random().toString(36).slice(2, 8);
        var sweepLocal = function () {
          var now = Date.now();
          Object.keys(tabs).forEach(function (k) { if (now - tabs[k] > ALIVE) delete tabs[k]; });
          onCount(Math.max(1, Object.keys(tabs).length));
        };
        var beat = function () { tabs[mine] = Date.now(); emit('presence', { id: mine, at: Date.now() }); sweepLocal(); };
        var off = on('presence', function (p) { tabs[p.id] = p.at; sweepLocal(); });
        beat();
        var lt = setInterval(beat, HEARTBEAT);
        return function () { stopped = true; clearInterval(lt); off(); };
      }

      var beatRemote = function () {
        if (stopped) return;
        rput('/presence/' + ROOM + '/' + auth.uid, { at: Date.now() });
      };
      var sweep = function () {
        rget('/presence/' + ROOM).then(function (all) {
          if (stopped) return;
          var now = Date.now(), n = 0;
          Object.keys(all || {}).forEach(function (k) {
            var e = all[k];
            if (e && now - (e.at || 0) < ALIVE) n++;
          });
          onCount(Math.max(1, n));
        });
      };
      token().then(function () { beatRemote(); sweep(); });
      var t1 = setInterval(beatRemote, HEARTBEAT);
      var t2 = setInterval(sweep, HEARTBEAT + 5000);
      var bye = function () { if (auth.uid) rdelete('/presence/' + ROOM + '/' + auth.uid); };
      global.addEventListener('pagehide', bye);
      return function () {
        stopped = true; clearInterval(t1); clearInterval(t2);
        global.removeEventListener('pagehide', bye); bye();
      };
    },

    /* ── 실시간 채팅 ────────────────────────────────── */
    chat: {
      subscribe: function (onList) {
        var max = CHAT.maxMessages || 100;
        if (!REMOTE) {
          var push = function () { onList(readLS('chat.' + ROOM, [])); };
          var off = on('chat', push);
          setTimeout(push, 350);
          return function () { off(); };
        }
        var cache = {};
        var flush = function () {
          onList(Object.keys(cache).sort().map(function (k) {
            var m = cache[k];
            if (m) m.id = k;
            return m;
          }).filter(Boolean).slice(-max));
        };
        return subscribe('/rooms/' + ROOM + '/messages',
          'orderBy=%22%24key%22&limitToLast=' + max, function (data) {
            if (!data) return;
            var p = data.path || '/', v = data.data;
            if (p === '/') {
              cache = {};
              if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { cache[k] = v[k]; });
            } else {
              var parts = p.replace(/^\//, '').split('/'), key = parts[0];
              if (parts.length === 1) { if (v === null) delete cache[key]; else cache[key] = v; }
              else if (cache[key]) cache[key][parts[1]] = v;
            }
            flush();
          });
      },

      send: function (nick, text, image) {
        var now = Date.now();
        if (now - readLS('chatLast', 0) < 3000) return Promise.resolve({ ok: false, reason: 'rate' });
        nick = String(nick || '익명').trim().slice(0, CHAT.nickMaxLength || 12);
        text = String(text || '').trim().slice(0, CHAT.textMaxLength || 300);
        if (!text && !image) return Promise.resolve({ ok: false, reason: 'empty' });
        writeLS('chatLast', now);
        writeLS('nick', nick);

        if (!REMOTE) {
          var msg = { n: nick, t: text, at: now, by: ME, id: 'l' + now.toString(36) };
          if (image) { msg.img = image.data; msg.iw = image.w; msg.ih = image.h; msg.ib = image.bytes; }
          var list = readLS('chat.' + ROOM, []);
          list.push(msg);
          if (list.length > (CHAT.maxMessages || 100)) list = list.slice(-(CHAT.maxMessages || 100));
          writeLS('chat.' + ROOM, list);
          if (image) bumpQuota(image.bytes);
          emit('chat', list);
          return Promise.resolve({ ok: true });
        }

        return token().then(function () {
          var msg = { n: nick, t: text, at: now, uid: auth.uid };
          if (image) { msg.img = image.data; msg.iw = image.w; msg.ih = image.h; msg.ib = image.bytes; }
          return rpush('/rooms/' + ROOM + '/messages', msg).then(function (r) {
            if (r && image) {
              rincr('/rooms/' + ROOM + '/usage/' + auth.uid + '/bytes', image.bytes);
              rincr('/rooms/' + ROOM + '/usage/' + auth.uid + '/count', 1);
              rincr('/rooms/' + ROOM + '/usage/_total', image.bytes);
              bumpQuota(image.bytes);
            }
            return { ok: !!r };
          });
        });
      },

      remove: function (id) {
        if (!REMOTE) {
          var list = readLS('chat.' + ROOM, []).map(function (m) {
            if (m.id === id) { m.t = ''; m.img = null; m.del = 1; }
            return m;
          });
          writeLS('chat.' + ROOM, list); emit('chat', list);
          return Promise.resolve(true);
        }
        return rpatch('/rooms/' + ROOM + '/messages/' + id, { t: '', img: null, del: 1 });
      },

      clearAll: function () {
        if (!REMOTE) { writeLS('chat.' + ROOM, []); emit('chat', []); return Promise.resolve(true); }
        return rdelete('/rooms/' + ROOM + '/messages')
          .then(function () { return rdelete('/rooms/' + ROOM + '/usage'); });
      },

      nick: function () { return readLS('nick', ''); },

      checkQuota: function (bytes) {
        if (!IMG.enabled) return Promise.resolve({ ok: false, reason: '이미지 전송이 꺼져 있습니다.' });
        if (bytes > (IMG.maxBytes || 160000)) {
          return Promise.resolve({ ok: false, reason: '이미지가 너무 큽니다. 더 작게 줄여주세요.' });
        }
        var mine = readLS('imgQuota', { bytes: 0, count: 0 });
        if (mine.count + 1 > (IMG.perUserCount || 20)) {
          return Promise.resolve({ ok: false, reason: '올릴 수 있는 이미지 수(' + IMG.perUserCount + '장)를 다 썼습니다.' });
        }
        if (mine.bytes + bytes > (IMG.perUserBytes || 3000000)) {
          return Promise.resolve({ ok: false, reason: '내 이미지 용량 한도를 넘었습니다.' });
        }
        if (!REMOTE) return Promise.resolve({ ok: true });
        return rget('/rooms/' + ROOM + '/usage/_total').then(function (total) {
          if ((total || 0) + bytes > (IMG.totalBytes || 60000000)) {
            return { ok: false, reason: '채팅방 전체 이미지 용량이 가득 찼습니다.' };
          }
          return { ok: true };
        });
      },

      myQuota: function () {
        var mine = readLS('imgQuota', { bytes: 0, count: 0 });
        return {
          bytes: mine.bytes, count: mine.count,
          maxBytes: IMG.perUserBytes || 3000000, maxCount: IMG.perUserCount || 20,
        };
      },
    },

    /* ── 댓글 (자체 구현) ───────────────────────────── */
    comments: {
      /** 이 페이지의 댓글을 실시간으로 구독한다. */
      subscribe: function (pageUrl, onList) {
        var page = keyOf(pageUrl);
        if (!REMOTE) {
          var push = function () {
            var all = readLS('comments', {});
            onList(sortComments(all[page] || {}));
          };
          var off = on('comments', push);
          setTimeout(push, 300);
          return function () { off(); };
        }
        var cache = {};
        return subscribe('/comments/' + page, 'orderBy=%22%24key%22&limitToLast=500', function (data) {
          if (!data) return;
          var p = data.path || '/', v = data.data;
          if (p === '/') {
            cache = {};
            if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { cache[k] = v[k]; });
          } else {
            var parts = p.replace(/^\//, '').split('/'), key = parts[0];
            if (parts.length === 1) { if (v === null) delete cache[key]; else cache[key] = v; }
            else if (cache[key]) cache[key][parts[1]] = v;
          }
          onList(sortComments(cache));
        });
      },

      /** 댓글 남기기. parent 가 있으면 답글. */
      add: function (pageUrl, name, text, parent) {
        var now = Date.now();
        if (now - readLS('cmtLast', 0) < 5000) return Promise.resolve({ ok: false, reason: 'rate' });
        name = String(name || '익명').trim().slice(0, 16) || '익명';
        text = String(text || '').trim().slice(0, 1500);
        if (text.length < 2) return Promise.resolve({ ok: false, reason: 'empty' });
        writeLS('cmtLast', now);
        writeLS('cmtName', name);

        var page = keyOf(pageUrl);
        if (!REMOTE) {
          var all = readLS('comments', {});
          all[page] = all[page] || {};
          var id = 'l' + now.toString(36) + Math.random().toString(36).slice(2, 5);
          all[page][id] = { n: name, t: text, at: now, uid: ME, p: parent || null };
          writeLS('comments', all);
          emit('comments', null);
          return Promise.resolve({ ok: true });
        }
        return token().then(function () {
          return rpush('/comments/' + page, {
            n: name, t: text, at: now, uid: auth.uid, p: parent || null,
          }).then(function (r) { return { ok: !!r }; });
        });
      },

      /** 글쓴이 본인 또는 관리자만 지울 수 있다 (규칙에서도 막는다). */
      remove: function (pageUrl, id) {
        var page = keyOf(pageUrl);
        if (!REMOTE) {
          var all = readLS('comments', {});
          if (all[page] && all[page][id]) { all[page][id].t = ''; all[page][id].del = 1; }
          writeLS('comments', all);
          emit('comments', null);
          return Promise.resolve(true);
        }
        return rpatch('/comments/' + page + '/' + id, { t: '', del: 1 });
      },

      /** 내가 쓴 댓글인지 */
      isMine: function (c) { return c && c.uid && c.uid === (REMOTE ? auth.uid : ME); },

      myName: function () { return readLS('cmtName', ''); },
    },
  };

  function sortComments(map) {
    return Object.keys(map || {}).map(function (k) {
      var c = map[k] || {};
      c.id = k;
      return c;
    }).sort(function (a, b) { return (a.at || 0) - (b.at || 0); });
  }

  function bumpQuota(bytes) {
    var mine = readLS('imgQuota', { bytes: 0, count: 0 });
    mine.bytes += bytes;
    mine.count += 1;
    writeLS('imgQuota', mine);
  }

  // 원격 모드면 페이지가 열리자마자 로그인을 시작해 둔다
  if (REMOTE) token().catch(function () {});

  global.GaonStore = Store;
})(window);
