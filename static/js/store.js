/* ============================================================
   store.js — 공유 상태 저장소
   ------------------------------------------------------------
   조회수 · 방문자 · 인기 검색어 · 실시간 채팅이 함께 쓰는 계층.

   site.config.json 의 realtime.firebase.databaseURL 이 채워져 있으면
     → 원격 모드. 모든 방문자가 같은 값을 본다.
       읽기/쓰기 : Realtime Database REST
       원자적 증가: ETag + if-match 조건부 쓰기 (충돌 시 재시도)
       실시간 수신: EventSource(SSE)
   비어 있으면
     → 로컬 모드. localStorage + BroadcastChannel 로 같은 브라우저에서만.
       위젯이 "이 브라우저 기준"이라고 화면에 표시한다.

   세는 방식 (이전 판의 계산 오류를 바로잡음)
     UV = 순 방문자. 한 브라우저는 하루에 한 번만, 전체에는 최초 1회만.
     PV = 페이지 조회. 페이지를 열 때마다.
     글 조회수 = 글마다 30분 중복 방지.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = global.GAON_CONFIG || {};
  var DB = ((CFG.firebase && CFG.firebase.databaseURL) || '').replace(/\/$/, '');
  var ROOM = CFG.room || 'main';
  var REMOTE = !!DB;
  var CHAT = CFG.chat || {};
  var IMG = CHAT.image || {};

  var NS = 'gaon.';
  var HEARTBEAT = 20000;      // 20초마다 생존 신호
  var ALIVE = 65000;          // 65초 안에 신호가 있으면 접속 중
  var VIEW_WINDOW = 1800000;  // 같은 글 30분 안에는 다시 세지 않는다

  /* ── 날짜 · 저장소 헬퍼 ─────────────────────────────── */
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

  /** URL·검색어를 Realtime Database 키로 안전하게 바꾼다 (. $ # [ ] / 금지) */
  function keyOf(s) {
    return String(s || '/').replace(/[.$#\[\]\/]/g, '_').replace(/^_+|_+$/g, '') || 'root';
  }

  var ME = (function () {
    var id = readLS('cid', null);
    if (!id) {
      id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      writeLS('cid', id);
    }
    return id;
  })();

  /* ── 원격(Realtime Database) ────────────────────────── */
  function rget(path) {
    return fetch(DB + path + '.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function rput(path, value) {
    return fetch(DB + path + '.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function rpatch(path, value) {
    return fetch(DB + path + '.json', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function rpush(path, value) {
    return fetch(DB + path + '.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function rdelete(path) {
    return fetch(DB + path + '.json', { method: 'DELETE', keepalive: true })
      .then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  /**
   * 원자적 증가. REST 에는 increment 가 없어 ETag 로 낙관적 잠금을 건다.
   * 누가 먼저 썼으면 412 가 돌아오고, 새 값으로 다시 시도한다.
   */
  function rincr(path, by, tries) {
    by = by === undefined ? 1 : by;
    tries = tries === undefined ? 5 : tries;

    return fetch(DB + path + '.json', {
      cache: 'no-store', headers: { 'X-Firebase-ETag': 'true' },
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
          if (put.status === 412 && tries > 0) {
            return new Promise(function (r) { setTimeout(r, 60 + Math.random() * 140); })
              .then(function () { return rincr(path, by, tries - 1); });
          }
          return null;
        });
      });
    }).catch(function () { return null; });
  }

  /* ── 로컬 어댑터 (탭 간 동기화) ─────────────────────── */
  var channel = null;
  try { channel = new BroadcastChannel('gaon-store'); } catch (e) { channel = null; }

  var subs = {};
  function emit(topic, payload) {
    (subs[topic] || []).forEach(function (fn) { fn(payload); });
    if (channel) { try { channel.postMessage({ topic: topic, payload: payload }); } catch (e) {} }
  }
  function on(topic, fn) {
    (subs[topic] = subs[topic] || []).push(fn);
    return function () {
      subs[topic] = (subs[topic] || []).filter(function (f) { return f !== fn; });
    };
  }
  if (channel) {
    channel.onmessage = function (e) {
      var d = e.data || {};
      (subs[d.topic] || []).forEach(function (fn) { fn(d.payload); });
    };
  }

  /* ═══════════════════════ 공개 API ═══════════════════ */

  var Store = {
    mode: REMOTE ? 'remote' : 'local',
    remote: REMOTE,
    me: ME,
    limits: IMG,

    /* ── 글 조회수 ──────────────────────────────────── */

    /** 이 글을 30분 내에 본 적 없으면 1 올린다. 항상 현재 값을 돌려준다. */
    countView: function (url) {
      var seen = readLS('seen', {});
      var now = Date.now();
      var fresh = !seen[url] || now - seen[url] > VIEW_WINDOW;
      if (fresh) { seen[url] = now; writeLS('seen', seen); }

      if (!REMOTE) {
        var local = readLS('views', {});
        if (fresh) { local[url] = (local[url] || 0) + 1; writeLS('views', local); emit('views', local); }
        return Promise.resolve(local[url] || 0);
      }
      if (!fresh) {
        return this.getViews([url]).then(function (m) { return m[url] || 0; });
      }
      return rincr('/views/' + keyOf(url)).then(function (n) {
        return typeof n === 'number' ? n : 0;
      });
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

    /**
     * 페이지가 열릴 때마다 한 번 호출한다.
     *   PV : 매번 +1
     *   UV : 그 브라우저가 오늘 처음이면 오늘 +1, 사상 처음이면 전체 +1
     */
    trackVisit: function () {
      var today = dayKey(0), yest = dayKey(1);
      var lastDay = readLS('lastVisitDay', '');
      var everVisited = readLS('everVisited', false);
      var newToday = lastDay !== today;
      var newEver = !everVisited;

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

        var y = v.days[yest] || { uv: 0, pv: 0 };
        return Promise.resolve({
          shared: false,
          today: v.days[today], yesterday: y,
          total: { uv: v.uv || 0, pv: v.pv || 0 },
        });
      }

      var jobs = [
        rincr('/visits/days/' + today + '/pv'),
        newToday ? rincr('/visits/days/' + today + '/uv') : rget('/visits/days/' + today + '/uv'),
        rincr('/visits/total/pv'),
        newEver ? rincr('/visits/total/uv') : rget('/visits/total/uv'),
        rget('/visits/days/' + yest),
      ];
      return Promise.all(jobs).then(function (r) {
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

    /** 검색어를 정규화해 집계한다. 같은 말은 10분에 한 번만. */
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
      // 원본 문자열도 같이 저장해 두어야 키 인코딩 때문에 글자가 깨지지 않는다
      return rpatch('/trends/' + keyOf(kw), { kw: kw }).then(function () {
        return rincr('/trends/' + keyOf(kw) + '/n');
      }).then(function () { return true; });
    },

    /** 상위 size개 + 직전 대비 순위 변동 */
    getTrends: function (size) {
      size = size || 10;
      var seed = (CFG.trends && CFG.trends.seed) || [];
      var load = REMOTE ? rget('/trends').then(function (m) { return m || {}; })
                        : Promise.resolve(readLS('trends', {}));

      return load.then(function (raw) {
        var merged = {};
        // 시드는 아주 낮은 가중치로만 넣어 초기 화면이 비지 않게 한다
        seed.forEach(function (kw, i) { merged[String(kw).toLowerCase()] = seed.length - i; });

        Object.keys(raw).forEach(function (k) {
          var row = raw[k];
          var kw, n;
          if (row && typeof row === 'object') { kw = row.kw || k.replace(/_/g, ' '); n = row.n || 0; }
          else { kw = REMOTE ? k.replace(/_/g, ' ') : k; n = row || 0; }
          if (!kw) return;
          merged[kw] = (merged[kw] || 0) + n * 10;
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

    /** 관리자용: 검색어 하나 지우기 / 전부 비우기 */
    removeTrend: function (kw) {
      if (!REMOTE) {
        var counts = readLS('trends', {});
        delete counts[String(kw).toLowerCase()];
        writeLS('trends', counts);
        emit('trends', counts);
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
        var tabs = {};
        var mine = 'tab' + Math.random().toString(36).slice(2, 8);
        var sweepLocal = function () {
          var now = Date.now();
          Object.keys(tabs).forEach(function (k) { if (now - tabs[k] > ALIVE) delete tabs[k]; });
          onCount(Math.max(1, Object.keys(tabs).length));
        };
        var beat = function () {
          tabs[mine] = Date.now();
          emit('presence', { id: mine, at: Date.now() });
          sweepLocal();
        };
        var off = on('presence', function (p) { tabs[p.id] = p.at; sweepLocal(); });
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

    /* ── 실시간 채팅 ────────────────────────────────── */

    chat: {
      /** 메시지 배열이 바뀔 때마다 통째로 넘겨준다. */
      subscribe: function (onList) {
        var max = CHAT.maxMessages || 100;

        if (!REMOTE) {
          var push = function () { onList(readLS('chat.' + ROOM, [])); };
          var off = on('chat', push);
          setTimeout(push, 350);   // 로딩 애니메이션이 한 번은 보이도록
          return function () { off(); };
        }

        var url = DB + '/rooms/' + ROOM + '/messages.json?orderBy=%22%24key%22&limitToLast=' + max;
        var cache = {};
        var es;

        var flush = function () {
          var list = Object.keys(cache).sort().map(function (k) {
            var m = cache[k];
            if (m) m.id = k;
            return m;
          }).filter(Boolean).slice(-max);
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
            var parts = p.replace(/^\//, '').split('/');
            var key = parts[0];
            if (parts.length === 1) {
              if (v === null) delete cache[key]; else cache[key] = v;
            } else if (cache[key]) {
              // 필드 하나만 바뀐 경우 (예: 삭제 표시)
              cache[key][parts[1]] = v;
            }
          }
          flush();
        };

        try {
          es = new EventSource(url);
          es.addEventListener('put', function (e) { apply(JSON.parse(e.data)); });
          es.addEventListener('patch', function (e) { apply(JSON.parse(e.data)); });
          es.onerror = function () { /* 브라우저가 알아서 재연결한다 */ };
        } catch (err) {
          var poll = setInterval(function () {
            rget('/rooms/' + ROOM + '/messages').then(function (all) {
              cache = all || {}; flush();
            });
          }, 4000);
          return function () { clearInterval(poll); };
        }
        return function () { if (es) es.close(); };
      },

      /** 메시지 전송. 3초에 한 번. image 는 {data, bytes, w, h} */
      send: function (nick, text, image) {
        var now = Date.now();
        var last = readLS('chatLast', 0);
        if (now - last < 3000) return Promise.resolve({ ok: false, reason: 'rate' });

        nick = String(nick || '익명').trim().slice(0, CHAT.nickMaxLength || 12);
        text = String(text || '').trim().slice(0, CHAT.textMaxLength || 300);
        if (!text && !image) return Promise.resolve({ ok: false, reason: 'empty' });

        writeLS('chatLast', now);
        writeLS('nick', nick);

        var msg = { n: nick, t: text, at: now, by: ME };
        if (image) { msg.img = image.data; msg.iw = image.w; msg.ih = image.h; msg.ib = image.bytes; }

        if (!REMOTE) {
          var list = readLS('chat.' + ROOM, []);
          msg.id = 'l' + now.toString(36);
          list.push(msg);
          if (list.length > (CHAT.maxMessages || 100)) list = list.slice(-(CHAT.maxMessages || 100));
          writeLS('chat.' + ROOM, list);
          if (image) bumpQuota(image.bytes);
          emit('chat', list);
          return Promise.resolve({ ok: true });
        }

        return rpush('/rooms/' + ROOM + '/messages', msg).then(function (r) {
          if (r && image) {
            rincr('/rooms/' + ROOM + '/usage/' + ME + '/bytes', image.bytes);
            rincr('/rooms/' + ROOM + '/usage/' + ME + '/count', 1);
            rincr('/rooms/' + ROOM + '/usage/_total', image.bytes);
            bumpQuota(image.bytes);
          }
          return { ok: !!r };
        });
      },

      /** 관리자용 삭제 — 내용만 지우고 자리는 남긴다 */
      remove: function (id) {
        if (!REMOTE) {
          var list = readLS('chat.' + ROOM, []).map(function (m) {
            if (m.id === id) { m.t = ''; m.img = null; m.del = 1; }
            return m;
          });
          writeLS('chat.' + ROOM, list);
          emit('chat', list);
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

      /** 이미지 용량 한도를 넘지 않는지 미리 확인한다. */
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
          return Promise.resolve({ ok: false, reason: '내 이미지 용량 한도(' + Math.round((IMG.perUserBytes || 0) / 1e6) + 'MB)를 넘었습니다.' });
        }
        if (!REMOTE) return Promise.resolve({ ok: true });

        return rget('/rooms/' + ROOM + '/usage/_total').then(function (total) {
          if ((total || 0) + bytes > (IMG.totalBytes || 60000000)) {
            return { ok: false, reason: '채팅방 전체 이미지 용량이 가득 찼습니다. 관리자에게 알려주세요.' };
          }
          return { ok: true };
        });
      },

      myQuota: function () {
        var mine = readLS('imgQuota', { bytes: 0, count: 0 });
        return {
          bytes: mine.bytes, count: mine.count,
          maxBytes: IMG.perUserBytes || 3000000,
          maxCount: IMG.perUserCount || 20,
        };
      },
    },
  };

  function bumpQuota(bytes) {
    var mine = readLS('imgQuota', { bytes: 0, count: 0 });
    mine.bytes += bytes;
    mine.count += 1;
    writeLS('imgQuota', mine);
  }

  global.GaonStore = Store;
})(window);
