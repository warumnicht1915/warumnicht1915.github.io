/* ============================================================
   store.js — 공유 상태 저장소
   ------------------------------------------------------------
   조회수 · 인기 검색어 · 접속자 · 실시간 채팅이 쓰는 공통 계층.

   1) site.config.json 의 realtime.firebase.databaseURL 이 채워져 있으면
      → 원격 모드. 모든 방문자가 같은 값을 본다.
        · 읽기/쓰기: Realtime Database REST
        · 원자적 증가: ETag + if-match 조건부 쓰기 (재시도 포함)
        · 실시간 수신: EventSource(SSE)
   2) 비어 있으면
      → 로컬 모드. localStorage 에 저장하고 BroadcastChannel 로
        같은 브라우저의 다른 탭과만 동기화한다. 위젯에 그 사실을 표시한다.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.GAON_CONFIG || {};
  var DB = (CFG.firebase && CFG.firebase.databaseURL || '').replace(/\/$/, '');
  var ROOM = CFG.room || 'main';
  var REMOTE = !!DB;

  var NS = 'gaon.';
  var HEARTBEAT = 20000;   // 20초마다 생존 신호
  var ALIVE = 65000;       // 65초 안에 신호가 있으면 접속 중으로 본다

  /* ── 작은 유틸 ───────────────────────────────────────── */

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function yesterday() {
    var d = new Date(Date.now() - 86400000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function readLS(key, fallback) {
    try {
      var v = localStorage.getItem(NS + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function writeLS(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) {}
  }

  /** URL 을 Realtime Database 키로 안전하게 바꾼다. (. $ # [ ] / 금지) */
  function keyOf(url) {
    return String(url || '/').replace(/[.$#\[\]\/]/g, '_').replace(/^_+|_+$/g, '') || 'root';
  }

  function clientId() {
    var id = readLS('cid', null);
    if (!id) {
      id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      writeLS('cid', id);
    }
    return id;
  }

  var ME = clientId();

  /* ── 원격(Realtime Database) 어댑터 ─────────────────── */

  function rget(path) {
    return fetch(DB + path + '.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function rput(path, value) {
    return fetch(DB + path + '.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  function rpush(path, value) {
    return fetch(DB + path + '.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function rdelete(path) {
    return fetch(DB + path + '.json', { method: 'DELETE', keepalive: true })
      .catch(function () {});
  }

  /**
   * 원자적 증가.
   * REST 에는 increment 가 없으므로 ETag 로 낙관적 잠금을 건다.
   * 다른 사람이 먼저 썼으면 412 가 돌아오고, 새 값으로 다시 시도한다.
   */
  function rincr(path, by, tries) {
    by = by || 1;
    tries = tries === undefined ? 4 : tries;

    return fetch(DB + path + '.json', {
      cache: 'no-store',
      headers: { 'X-Firebase-ETag': 'true' },
    }).then(function (res) {
      var etag = res.headers.get('ETag') || 'null_etag';
      return res.json().then(function (cur) {
        var next = (typeof cur === 'number' ? cur : 0) + by;
        return fetch(DB + path + '.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'if-match': etag },
          body: JSON.stringify(next),
        }).then(function (put) {
          if (put.ok) return next;
          if (put.status === 412 && tries > 0) return rincr(path, by, tries - 1);
          return null;
        });
      });
    }).catch(function () { return null; });
  }

  /* ── 로컬 어댑터 (BroadcastChannel 로 탭 간 동기화) ── */

  var channel = null;
  try { channel = new BroadcastChannel('gaon-store'); } catch (e) { channel = null; }

  var localSubs = {};
  function localEmit(topic, payload) {
    (localSubs[topic] || []).forEach(function (fn) { fn(payload); });
    if (channel) { try { channel.postMessage({ topic: topic, payload: payload }); } catch (e) {} }
  }
  function localOn(topic, fn) {
    (localSubs[topic] = localSubs[topic] || []).push(fn);
    return function () {
      localSubs[topic] = (localSubs[topic] || []).filter(function (f) { return f !== fn; });
    };
  }
  if (channel) {
    channel.onmessage = function (e) {
      var d = e.data || {};
      (localSubs[d.topic] || []).forEach(function (fn) { fn(d.payload); });
    };
  }

  /* ── 공개 API ────────────────────────────────────────── */

  var Store = {
    mode: REMOTE ? 'remote' : 'local',
    remote: REMOTE,
    me: ME,

    /* ── 조회수 ────────────────────────────────────── */

    /** 이 글을 처음 본 세션이면 1 올린다. (같은 글 6시간 중복 방지) */
    countView: function (url) {
      var seen = readLS('seen', {});
      var now = Date.now();
      var fresh = !seen[url] || now - seen[url] > 6 * 3600 * 1000;
      if (fresh) { seen[url] = now; writeLS('seen', seen); }

      if (!REMOTE) {
        var local = readLS('views', {});
        if (fresh) { local[url] = (local[url] || 0) + 1; writeLS('views', local); }
        return Promise.resolve(local[url] || 0);
      }
      if (!fresh) return this.getViews([url]).then(function (m) { return m[url] || 0; });
      return rincr('/views/' + keyOf(url));
    },

    /** 여러 글의 조회수를 한 번에 가져온다. */
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

    /* ── 인기 검색어 ───────────────────────────────── */

    /** 검색어를 정규화해 집계한다. 같은 말은 10분에 한 번만 센다. */
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
        localEmit('trends', counts);
        return Promise.resolve(true);
      }
      return rincr('/trends/' + keyOf(kw)).then(function () { return true; });
    },

    /** 순위 + 직전 대비 변동(신규/상승/하락/유지)까지 계산해서 돌려준다. */
    getTrends: function (size) {
      size = size || 10;
      var seed = (CFG.trends && CFG.trends.seed) || [];

      var load = REMOTE
        ? rget('/trends').then(function (m) { return m || {}; })
        : Promise.resolve(readLS('trends', {}));

      return load.then(function (counts) {
        var merged = {};
        // 시드는 아주 낮은 가중치로만 넣어 초기 화면이 비지 않게 한다
        seed.forEach(function (kw, i) { merged[kw.toLowerCase()] = seed.length - i; });
        Object.keys(counts).forEach(function (k) {
          var kw = REMOTE ? k.replace(/_/g, ' ') : k;
          merged[kw] = (merged[kw] || 0) + counts[k] * 10;
        });

        var list = Object.keys(merged)
          .map(function (kw) { return { kw: kw, score: merged[kw] }; })
          .sort(function (a, b) { return b.score - a.score || a.kw.localeCompare(b.kw, 'ko'); })
          .slice(0, size);

        var prev = readLS('trendRank', {});
        var next = {};
        list.forEach(function (item, i) {
          var before = prev[item.kw];
          next[item.kw] = i;
          if (before === undefined) { item.delta = 'new'; item.deltaText = 'NEW'; }
          else if (before > i) { item.delta = 'up'; item.deltaText = '▲' + (before - i); }
          else if (before < i) { item.delta = 'down'; item.deltaText = '▼' + (i - before); }
          else { item.delta = 'same'; item.deltaText = '–'; }
          item.rank = i + 1;
        });
        writeLS('trendRank', next);
        return list;
      });
    },

    onTrendsChange: function (fn) {
      if (!REMOTE) return localOn('trends', fn);
      return function () {};
    },

    /* ── 방문자 통계 ───────────────────────────────── */

    /** 하루 한 번만 집계하고, 오늘/어제/전체를 돌려준다. */
    visitors: function () {
      var t = today(), y = yesterday();
      var stamp = readLS('visitStamp', '');
      var first = stamp !== t;
      if (first) writeLS('visitStamp', t);

      if (!REMOTE) {
        var v = readLS('visits', {});
        if (first) { v[t] = (v[t] || 0) + 1; v.total = (v.total || 0) + 1; writeLS('visits', v); }
        return Promise.resolve({
          today: v[t] || 0, yesterday: v[y] || 0, total: v.total || 0, shared: false,
        });
      }

      var jobs = first
        ? [rincr('/visits/daily/' + t), rincr('/visits/total')]
        : [rget('/visits/daily/' + t), rget('/visits/total')];

      return Promise.all(jobs.concat([rget('/visits/daily/' + y)])).then(function (r) {
        return {
          today: r[0] || 0,
          yesterday: r[2] || 0,
          total: r[1] || 0,
          shared: true,
        };
      });
    },

    /* ── 접속자(프레즌스) ──────────────────────────── */

    /**
     * 주기적으로 생존 신호를 남기고, 살아있는 항목 수를 콜백으로 준다.
     * 로컬 모드에서는 같은 브라우저의 열린 탭 수를 센다.
     */
    watchPresence: function (onCount) {
      var stopped = false;

      if (!REMOTE) {
        var tabs = {};
        var mine = 'tab' + Math.random().toString(36).slice(2, 8);
        var beat = function () {
          tabs[mine] = Date.now();
          localEmit('presence', { id: mine, at: Date.now() });
          sweepLocal();
        };
        var sweepLocal = function () {
          var now = Date.now();
          Object.keys(tabs).forEach(function (k) { if (now - tabs[k] > ALIVE) delete tabs[k]; });
          onCount(Math.max(1, Object.keys(tabs).length));
        };
        var off = localOn('presence', function (p) { tabs[p.id] = p.at; sweepLocal(); });
        beat();
        var lt = setInterval(beat, HEARTBEAT);
        return function () { stopped = true; clearInterval(lt); off(); };
      }

      var path = '/presence/' + ROOM + '/' + ME;
      var beatRemote = function () { if (!stopped) rput(path, { at: Date.now() }); };
      var sweep = function () {
        rget('/presence/' + ROOM).then(function (all) {
          if (stopped) return;
          var now = Date.now(), n = 0;
          Object.keys(all || {}).forEach(function (k) {
            var e = all[k];
            if (e && now - (e.at || 0) < ALIVE) n++;
            else if (e && now - (e.at || 0) > ALIVE * 6) rdelete('/presence/' + ROOM + '/' + k);
          });
          onCount(Math.max(1, n));
        });
      };

      beatRemote(); sweep();
      var t1 = setInterval(beatRemote, HEARTBEAT);
      var t2 = setInterval(sweep, HEARTBEAT + 5000);
      var bye = function () { rdelete(path); };
      global.addEventListener('pagehide', bye);

      return function () {
        stopped = true;
        clearInterval(t1); clearInterval(t2);
        global.removeEventListener('pagehide', bye);
        bye();
      };
    },

    /* ── 실시간 채팅 ───────────────────────────────── */

    chat: {
      /** 메시지 목록이 바뀔 때마다 배열을 통째로 넘겨준다. */
      subscribe: function (onList) {
        var max = (CFG.chat && CFG.chat.max) || 100;

        if (!REMOTE) {
          var emit = function () { onList(readLS('chat.' + ROOM, [])); };
          var off = localOn('chat', emit);
          emit();
          return function () { off(); };
        }

        var url = DB + '/rooms/' + ROOM + '/messages.json?orderBy=%22%24key%22&limitToLast=' + max;
        var cache = {};
        var es;

        var flush = function () {
          var list = Object.keys(cache).sort().map(function (k) { return cache[k]; })
            .filter(Boolean).slice(-max);
          onList(list);
        };

        var apply = function (data) {
          if (!data) return;
          var p = data.path || '/';
          var v = data.data;
          if (p === '/') {
            cache = {};
            if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { cache[k] = v[k]; });
          } else {
            var key = p.replace(/^\//, '').split('/')[0];
            if (v === null) delete cache[key];
            else cache[key] = v;
          }
          flush();
        };

        try {
          es = new EventSource(url);
          es.addEventListener('put', function (e) { apply(JSON.parse(e.data)); });
          es.addEventListener('patch', function (e) { apply(JSON.parse(e.data)); });
          es.onerror = function () { /* 브라우저가 자동으로 재연결한다 */ };
        } catch (err) {
          // SSE 를 못 쓰면 폴링으로 내려앉는다
          var poll = setInterval(function () {
            rget('/rooms/' + ROOM + '/messages').then(function (all) {
              cache = all || {}; flush();
            });
          }, 4000);
          return function () { clearInterval(poll); };
        }

        return function () { if (es) es.close(); };
      },

      /** 메시지 전송. 3초에 한 번으로 제한한다. */
      send: function (nick, text) {
        var now = Date.now();
        var last = readLS('chatLast', 0);
        if (now - last < 3000) return Promise.resolve({ ok: false, reason: 'rate' });

        nick = String(nick || '익명').trim().slice(0, (CFG.chat && CFG.chat.nickMax) || 12);
        text = String(text || '').trim().slice(0, (CFG.chat && CFG.chat.textMax) || 300);
        if (!text) return Promise.resolve({ ok: false, reason: 'empty' });

        writeLS('chatLast', now);
        writeLS('nick', nick);

        var msg = { n: nick, t: text, at: now, by: ME };

        if (!REMOTE) {
          var list = readLS('chat.' + ROOM, []);
          list.push(msg);
          if (list.length > 100) list = list.slice(-100);
          writeLS('chat.' + ROOM, list);
          localEmit('chat', list);
          return Promise.resolve({ ok: true });
        }
        return rpush('/rooms/' + ROOM + '/messages', msg)
          .then(function (r) { return { ok: !!r }; });
      },

      nick: function () { return readLS('nick', ''); },
    },
  };

  global.GaonStore = Store;
})(window);
