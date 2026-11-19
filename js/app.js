/*
 * app.js — 화면 전체를 이어 주는 부분
 * ------------------------------------------------------------
 * 챗봇(chatbot.js)의 답을 채팅창에 그리고, 답에 딸린 지시(actions)를 3D 지도(map3d.js)에 전달합니다.
 * 행사 안내 창, 구역 상세 카드, 작동 원리 화면, 관리자 창, 인기도, 피드백, 자동 초기화도 여기서 다룹니다.
 */
(function () {
  'use strict';
  var DATA = window.CODEON_DATA, NLP = window.CODEON_NLP, MODEL = window.CODEON_MODEL, STORE = window.CODEON_STORE;

  // ---------- 설정 ----------
  var IDLE_RESET_MS = 120000;   // 이 시간 동안 아무도 안 만지면 첫 화면으로 돌아감 (2분, 0 이면 끔)
  var TOUR_STEP_MS = 4300;      // 투어에서 한 곳에 머무는 시간
  var MAX_VISITORS = 80;        // 방문자 모형 최대 수
  var KEY = {
    settings: 'codeon.settings',     // 관리자 설정 (자리 배정, 방문 인원, 인기도 직접 설정, 비밀번호 해시)
    stats: 'codeon.stats',           // 팀별 검색·조회 횟수
    feedback: 'codeon.feedback',     // 답변 피드백
    unanswered: 'codeon.unanswered', // 못 알아들은 질문
    hideAdmin: 'codeon.hideAdminButton',
    session: 'codeon.admin'          // 로그인 상태 (탭을 닫으면 사라짐)
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.CODEON_CHATBOT.esc;
  var state = { part: 1, tour: null, explain: false, lastDebug: null, idleTimer: null, adminTab: 'assign', loginFails: 0, loginLockUntil: 0 };

  // ---------- 관리자 설정 읽기 ----------
  // 우선순위: data.js 기본값 → data.js 의 saved(붙여넣은 설정 코드) → 이 브라우저에 저장된 값
  var BLOCKS = ['A', 'B', 'C', 'D'], WALLS = ['1', '2', '3', '4'];
  var DEFAULT_ASSIGN = JSON.parse(JSON.stringify(DATA.assignment));
  var expIds = DATA.teams.filter(function (t) { return t.type === 'exp'; }).map(function (t) { return t.id; });
  var exhIds = DATA.teams.filter(function (t) { return t.type === 'exh'; }).map(function (t) { return t.id; });
  var allIds = DATA.teams.map(function (t) { return t.id; });
  var settings = { visitors: DATA.settings.visitors, manual: {}, passHash: DATA.settings.adminPasswordHash };
  var stats = STORE.get(KEY.stats, { search: {} });
  if (!stats || typeof stats.search !== 'object') stats = { search: {} };

  // 배정이 올바른지 검사: 체험형 8팀이 8자리에 한 번씩, 전시형 4팀이 4자리에 한 번씩
  function checkAssignment(a) {
    if (!a || !a.part1 || !a.part2 || !a.exhibit) return '1부, 2부, 전시 배정이 모두 있어야 해요.';
    var exp = [], exh = [];
    BLOCKS.forEach(function (b) { exp.push(a.part1[b], a.part2[b]); });
    WALLS.forEach(function (w) { exh.push(a.exhibit[w]); });
    function same(list, ids) { return list.slice().sort().join() === ids.slice().sort().join(); }
    if (!same(exp, expIds)) return '체험형 8팀이 A~D 자리(1부, 2부)에 한 번씩 들어가야 해요.';
    if (!same(exh, exhIds)) return '전시형 4팀이 전시 1~4에 한 번씩 들어가야 해요.';
    return '';
  }
  // DATA.assignment 를 통째로 바꾸지 않고 내용만 바꾼다 (지도와 챗봇이 같은 것을 보고 있으므로)
  function applyAssignment(a) {
    var A = DATA.assignment;
    A.confirmed = !!a.confirmed;
    BLOCKS.forEach(function (b) { A.part1[b] = a.part1[b]; A.part2[b] = a.part2[b]; });
    WALLS.forEach(function (w) { A.exhibit[w] = a.exhibit[w]; });
  }
  function clampVisitors(n) { n = Math.round(Number(n)); return isFinite(n) ? Math.max(0, Math.min(MAX_VISITORS, n)) : 0; }
  // 설정 묶음 하나를 적용한다. 잘못된 부분은 건너뛰고, 문제를 글로 돌려준다.
  function applySaved(obj) {
    if (!obj || typeof obj !== 'object') return '설정 코드를 읽을 수 없어요.';
    var problem = '';
    if (obj.assignment) { problem = checkAssignment(obj.assignment); if (!problem) applyAssignment(obj.assignment); }
    if (obj.visitors !== undefined) settings.visitors = clampVisitors(obj.visitors);
    if (obj.manual && typeof obj.manual === 'object') {
      settings.manual = {};
      allIds.forEach(function (id) {
        var v = Number(obj.manual[id]);
        if (obj.manual[id] !== undefined && obj.manual[id] !== null && isFinite(v)) settings.manual[id] = Math.max(0, Math.min(100, Math.round(v)));
      });
    }
    if (typeof obj.passHash === 'string' && /^[0-9a-f]{64}$/.test(obj.passHash)) settings.passHash = obj.passHash;
    return problem;
  }
  function settingsBundle() {
    return { assignment: DATA.assignment, visitors: settings.visitors, manual: settings.manual, passHash: settings.passHash };
  }
  function saveSettings() { return STORE.set(KEY.settings, settingsBundle()); }
  applySaved(DATA.saved || {});
  applySaved(STORE.get(KEY.settings, {}) || {});

  // ---------- 인기도 ----------
  // 관리자가 직접 정한 값이 있으면 그 값, 없으면 검색·조회된 횟수
  function popularity(id) {
    var m = settings.manual[id];
    return m !== undefined && m !== null ? m : (stats.search[id] || 0);
  }
  function rankedTeams() {
    return allIds.slice().sort(function (a, b) { return popularity(b) - popularity(a); });
  }
  function hotTeams() { return rankedTeams().filter(function (id) { return popularity(id) > 0; }).slice(0, 3); }

  // ---------- 혼잡도와 동선 ----------
  // 서버나 센서가 없으므로, 혼잡도는 관리자가 정한 "방문 인원수"로 판단한다.
  var LEVEL_LABEL = { quiet: '여유', normal: '보통', busy: '혼잡' };
  var ROUTE_KIND = { quiet: 'full', normal: 'basic', busy: 'fast' };
  var ROUTE_NAME = { full: '골고루 즐기는 동선', basic: '기본 동선', fast: '빠른 동선', stamp: '도장 완성 동선' };
  function congestion() {
    var n = settings.visitors, c = DATA.congestion;
    var level = n >= c.busyFrom ? 'busy' : (n < c.quietBelow ? 'quiet' : 'normal');
    return { level: level, label: LEVEL_LABEL[level], visitors: n };
  }
  var FRONT = -4.85, BACK = 5.95;     // 앞 복도, 뒤 복도의 위치 (map3d.js 와 같은 값)
  var MID = 3.75;                     // 27·28번과 33·34번 책상 사이 복도의 위치 (map3d.js 와 같은 값)
  var fastFlip = 0;                   // 빠른 동선을 물어볼 때마다 다른 팀을 추천하기 위한 번호
  /*
   * 동선 만들기. 들르는 곳은 입구와 출구를 포함해 4~9곳이다.
   *   fast  (4곳): 입구 → 한산한 체험 1팀 → 진로 1분야 → 출구                    (붐빌 때)
   *   basic (6곳): 입구 → 인기 체험 2팀 → 진로 1분야 → 전시 1팀 → 출구            (보통일 때)
   *   full  (9곳): 입구 → 인기 체험 3팀 → 포토부스 → 전시 1팀 → 진로 2분야 → 출구  (여유로울 때, 골고루)
   *   stamp (9곳): 입구 → 체험 4팀 → 진로 3분야 → 출구                            (도장 5개를 모두 모으는 길)
   * want 로 조건을 줄 수 있다 (챗봇 질문에서 뽑아 냄):
   *   teams 꼭 넣을 팀 / fields 꼭 넣을 진로 분야 / tag 주제 / photo, wall, career 넣기 / size 들르는 곳 수 / kind
   *
   * 걷는 길 (한 방향으로 한 바퀴, 같은 통로를 두 번 지나지 않게):
   *   입구 → 앞 복도 → 오른쪽 안쪽 통로로 내려가며 체험 팀
   *        → (포토부스·전시가 있으면 뒤 복도로) / (없으면 27·28번과 33·34번 사이 복도를 건너)
   *        → 왼쪽 안쪽 통로로 올라가며 진로 전시 → 앞 복도 → 벽 쪽 통로로 내려가 출구
   *   33·34번 뒤쪽은 포토부스나 전시를 볼 때만 지나간다.
   */
  var ROUTE_SIZE = { fast: 4, basic: 6, full: 9, stamp: 9 }, MIN_STOPS = 4, MAX_STOPS = 9;
  var PCS = ['pc4', 'pc3', 'pc2', 'pc1'];   // 왼쪽 안쪽 통로를 올라가며 만나는 순서
  var careerFlip = 0;                       // 진로 분야를 번갈아 추천하기 위한 번호
  function routePlan(kind, variant, want) {
    want = want || {};
    var c = congestion();
    var base = kind || want.kind || ROUTE_KIND[c.level];
    var custom = !!((want.teams && want.teams.length) || (want.fields && want.fields.length) || want.tag || want.photo || want.wall || want.career || want.size || want.kind);
    var size = want.size ? Math.max(MIN_STOPS, Math.min(MAX_STOPS, want.size)) : ROUTE_SIZE[base];
    var picks = [], notes = [], applied = [];
    function cap() { return size - 2; }
    function has(zid) { return picks.indexOf(zid) !== -1; }
    // 꼭 넣어야 하는 곳: 자리가 모자라면 최대 개수까지 늘린다
    function must(zid) {
      if (!zid) return false;
      if (has(zid)) return true;
      if (picks.length >= cap() && size < MAX_STOPS) size++;
      if (picks.length >= cap()) return false;
      picks.push(zid); return true;
    }
    function fill(zid) { if (zid && !has(zid) && picks.length < cap()) picks.push(zid); }
    function zoneNow(teamId) {   // 그 팀이 지금 지도에 있으면 구역 id, 없으면 이유
      var t = bot.teamById[teamId], pl = t && bot.placeOf(t);
      if (!pl) return { why: '자리가 정해지지 않았어요' };
      if (pl.part && pl.part !== state.part) return { why: DATA.parts[pl.part - 1].label + '에 운영해요' };
      return { id: pl.zone.id };
    }
    function pcOf(fieldId) { var z = DATA.zones.filter(function (q) { return q.field === fieldId; })[0]; return z ? z.id : null; }
    var expZones = BLOCKS.filter(function (id) { return bot.teamAt(id, state.part); });
    function popOf(zid) { var t = teamOfZone(zid); return t ? popularity(t.id) : 0; }
    function inOrder(a, b) { return BLOCKS.indexOf(a) - BLOCKS.indexOf(b); }
    var byPop = expZones.slice().sort(function (a, b) { return popOf(b) - popOf(a) || inOrder(a, b); });
    var byQuiet = expZones.slice().sort(function (a, b) { return popOf(a) - popOf(b) || inOrder(a, b); });
    var walls = WALLS.map(function (w) { return 'ex' + w; }).sort(function (a, b) { return popOf(b) - popOf(a) || Number(a.slice(2)) - Number(b.slice(2)); });
    if (variant === undefined) variant = base === 'fast' ? fastFlip : 0;
    // 진로 분야는 인기도가 없으므로 돌아가며 추천한다 (도장 완성 동선은 항상 가까운 3곳)
    var shift = base === 'stamp' ? 0 : (careerFlip + variant) % PCS.length;
    var pcs = PCS.slice(shift).concat(PCS.slice(0, shift));

    // 1) 질문에서 콕 집은 팀과 진로 분야
    (want.teams || []).forEach(function (id) {
      var t = bot.teamById[id], z = zoneNow(id);
      if (!z.id) { notes.push(t.name + ' 팀은 ' + z.why + '. 그래서 지금 동선에는 넣지 못했어요.'); return; }
      if (must(z.id)) applied.push(t.name + ' 팀'); else notes.push('들르는 곳은 최대 ' + MAX_STOPS + '곳이라 ' + t.name + ' 팀은 넣지 못했어요.');
    });
    (want.fields || []).forEach(function (id) { if (must(pcOf(id))) applied.push('진로 전시 ' + bot.careerById[id].name); });
    // 2) 주제 (게임, 로봇 …)
    if (want.tag) {
      var label = want.tag === 'ai' ? 'AI' : want.tag;
      var tagged = DATA.teams.filter(function (t) { return (t.tags || []).indexOf(want.tag) !== -1; })
        .map(function (t) { return zoneNow(t.id).id; }).filter(Boolean).sort(function (a, b) { return popOf(b) - popOf(a); });
      if (!tagged.length) notes.push(label + ' 관련 팀은 지금 운영하지 않아요.');
      else { tagged.forEach(function (zid) { must(zid); }); applied.push(label + ' 관련 팀'); }
    }
    // 3) 포토부스, 전시, 진로 전시
    if (want.photo && must('photo')) applied.push('포토부스');
    if (want.wall && !picks.some(function (p) { return /^ex/.test(p); }) && must(walls[0])) applied.push('전시');
    if (want.career && !picks.some(function (p) { return /^pc/.test(p); }) && must(pcs[0])) applied.push('진로 전시');
    // 4) 남은 자리 채우기
    var order;
    if (base === 'fast') order = [byQuiet.length ? byQuiet[variant % byQuiet.length] : null, pcs[0], byQuiet[(variant + 1) % Math.max(1, byQuiet.length)]];
    else if (base === 'basic') order = [byPop[0], byPop[1], pcs[0], walls[0], byPop[2], 'photo', byPop[3]];
    else if (base === 'stamp') order = byPop.concat(pcs.slice(0, 3));
    else order = [byPop[0], byPop[1], byPop[2], 'photo', walls[0], pcs[0], pcs[1], byPop[3], walls[1]];
    // 기본 동선에서 진로 전시나 전시를 이미 골랐으면, 같은 종류를 하나 더 채우지 않는다
    if (base === 'basic') {
      var hasPc = picks.some(function (p) { return /^pc/.test(p); }), hasEx = picks.some(function (p) { return /^ex/.test(p); });
      order = order.filter(function (z) { return !(hasPc && /^pc/.test(z || '')) && !(hasEx && /^ex/.test(z || '')); });
    }
    if (!(base === 'fast' && custom && picks.length >= 2)) order.forEach(fill);   // 빠른 맞춤 동선은 말한 곳만 들름
    if (picks.length < MIN_STOPS - 2) [byQuiet[0], pcs[0], byQuiet[1]].forEach(function (z) { if (picks.length < MIN_STOPS - 2 && z && !has(z)) picks.push(z); });

    // 걷는 순서 정하기
    var exp = picks.filter(function (p) { return BLOCKS.indexOf(p) !== -1; }).sort(inOrder);
    var right = ['photo', 'ex1', 'ex2'].filter(has);                       // 뒤 복도 오른쪽 → 가운데
    var left = picks.filter(function (p) { return p === 'ex3' || p === 'ex4'; });
    var car = PCS.filter(has);                                             // 올라가며 만나는 순서
    var stops = [{ id: 'info' }];
    var through = exp.length || right.length;                              // 방 안쪽을 한 바퀴 도는 길인가
    var leftAisle = exp.length === 1 && !right.length && !car.length && (exp[0] === 'A' || exp[0] === 'C');
    exp.forEach(function (id) { stops.push({ id: id, ax: leftAisle ? -1.95 : 1.95 }); });
    right.forEach(function (id) { stops.push({ id: id }); });
    if (car.length && through) {
      if (exp.length && !right.length) stops.push({ x: 1.95, z: MID, ax: 1.95 }, { x: -1.95, z: MID, ax: -1.95 });   // 가운데 복도를 건너
      car.forEach(function (id) { stops.push({ id: id, ax: -1.95 }); });                                             // 왼쪽 안쪽 통로를 올라가며
      stops.push({ x: -1.95, z: FRONT, lane: 'front' }, { x: -5.9, z: BACK, ax: -5.9 });                             // 앞 복도 → 벽 쪽 통로로 내려감
      left.sort(function (a, b) { return a < b ? 1 : -1; });                                                         // 출구 쪽에서 가까운 전시 4 → 전시 3
    } else if (car.length) {
      car.slice().reverse().forEach(function (id) { stops.push({ id: id, ax: -5.9 }); });                            // 진로 전시만 갈 때는 벽 쪽 통로로 내려가며
      left.sort(function (a, b) { return a < b ? 1 : -1; });
    } else {
      if (exp.length && !right.length && !leftAisle) stops.push({ x: 1.95, z: MID, ax: 1.95 }, { x: -1.95, z: MID, ax: -1.95 });
      left.sort();                                                                                                   // 오른쪽에서 오므로 전시 3 → 전시 4
    }
    left.forEach(function (id) { stops.push({ id: id }); });
    stops.push({ id: 'check' });

    var m = DATA.congestion.minutes, minutes = m.inOut, steps = [], short = [];
    stops.forEach(function (st) {
      if (st.id === undefined) return;
      var z = bot.zoneById[st.id], t = teamOfZone(st.id);
      if (z.kind === 'exp') { steps.push('체험 · ' + t.name); short.push(t.name); minutes += m.exp; }
      else if (z.kind === 'wall') { steps.push('전시 · ' + t.name); short.push(t.name); minutes += m.wall; }
      else if (z.kind === 'career') { var cr = bot.careerById[z.field]; steps.push('진로 전시 · ' + cr.name); short.push(cr.name); minutes += m.career; }
      else if (z.kind === 'photo') { steps.push('포토부스 · 네 컷 사진'); short.push('포토부스'); minutes += m.photo; }
      else if (z.kind === 'info') { steps.push('입구 · 도장판 받기'); short.push('입구'); }
      else { steps.push('출구 · 도장 확인하고 보상 고르기'); short.push('출구'); }
    });
    if (has('photo')) notes.push('포토부스는 도장을 모두 모아 출구에서 티켓을 받은 사람만 찍을 수 있어요.');
    var reason;
    if (custom) reason = applied.length ? applied.join(', ') + '을(를) 넣어서 짰어요.' : (base === 'fast' ? '빨리 돌 수 있게 짧게 짰어요.' : base === 'stamp' ? '도장 5개를 모두 모을 수 있게 짰어요.' : '요청에 맞춰 짰어요.');
    else if (base === 'full') reason = '사람이 적어서 체험, 포토부스, 전시, 진로 전시를 골고루 즐길 수 있어요.';
    else if (base === 'basic') reason = '인기 있는 체험 2팀과 진로 전시, 뒷벽 전시를 하나씩 들러요.';
    else if (base === 'stamp') reason = '체험 4팀과 진로 전시 3분야를 돌아 도장 5개를 모두 모아요.';
    else reason = '붐빌 때는 한산한 체험 팀과 진로 전시를 하나씩만 들르고 나가요. 다시 누르면 다른 곳을 알려 줘요.';
    return { kind: custom ? 'custom' : base, base: base, custom: custom, variant: variant, title: custom ? '맞춤 동선' : ROUTE_NAME[base],
      level: c.level, levelLabel: c.label, visitors: c.visitors, recommended: ROUTE_KIND[c.level],
      reason: reason, notes: notes, stops: stops, steps: steps, short: short, minutes: Math.round(minutes) };
  }
  // 챗봇 질문에서 동선 조건을 뽑아 낸다
  function routeWant(req) {
    var text = req.text || '', want = { teams: req.teams || [], fields: req.fields || [], tag: req.tag || null };
    if (/포토|사진|네\s*컷|네컷/.test(text)) want.photo = true;
    if (/진로/.test(text)) want.career = true;
    else if (/전시/.test(text)) want.wall = true;
    if (/도장|스탬프/.test(text)) want.kind = 'stamp';
    else if (/빨리|빠르|금방|짧|급해|시간\s*없|후딱/.test(text)) want.kind = 'fast';
    else if (/전부|모두|다\s*(돌|보|즐)|많이|골고루|여유|천천히/.test(text)) want.kind = 'full';
    var num = text.match(/([4-9])\s*(곳|군데|개|번)/), word = text.match(/(네|다섯|여섯|일곱|여덟|아홉)\s*(곳|군데)/);
    if (num) want.size = Number(num[1]);
    else if (word) want.size = { '네': 4, '다섯': 5, '여섯': 6, '일곱': 7, '여덟': 8, '아홉': 9 }[word[1]];
    return want;
  }
  var pendingPlan = null;   // 챗봇이 방금 추천한 동선 (지도에 같은 것을 그리기 위해 잠깐 보관)

  var bot = window.CODEON_CHATBOT.create(DATA, MODEL, NLP, {
    getPart: function () { return state.part; },
    getHotTeams: hotTeams,
    getRanking: function () { return rankedTeams().map(function (id) { return { id: id, score: popularity(id) }; }); },
    getCongestion: congestion,
    getRoutePlan: function (req) {
      pendingPlan = routePlan(null, undefined, routeWant(req || {}));
      if (!pendingPlan.custom) { careerFlip++; if (pendingPlan.base === 'fast') fastFlip++; }   // 다음 사람에게는 다른 곳을 추천
      return pendingPlan;
    }
  });
  var map = null;
  var foxClicks = [];

  // 인기도를 지도에 반영: 인기 높은 부스에 방문자 모형이 더 몰리고, 상위 팀에 "인기" 표시가 붙는다
  function applyCrowd() {
    if (!map) return;
    var max = 0, weights = {}, hot = hotTeams(), hotZones = [];
    allIds.forEach(function (id) { max = Math.max(max, popularity(id)); });
    DATA.teams.forEach(function (t) {
      var pl = bot.placeOf(t);
      if (!pl || (pl.part && pl.part !== state.part)) return;   // 다른 부의 체험 팀은 지금 자리에 없음
      weights[pl.zone.id] = max ? 0.5 + 3.5 * popularity(t.id) / max : 1;
      if (hot.indexOf(t.id) !== -1) hotZones.push(pl.zone.id);
    });
    // 혼잡할수록 모형들이 적게 들르고 빨리 나가며, 여유로울수록 많이 들르고 오래 머문다
    var level = congestion().level;
    var mode = level === 'busy' ? { visits: [2, 3], wait: [3, 7], spread: true }
      : level === 'quiet' ? { visits: [4, 6], wait: [8, 18], spread: false }
      : { visits: [2, 4], wait: [5, 14], spread: false };
    map.setCrowd(settings.visitors, weights, mode);
    map.setHot(hotZones);
    var flag = $('crowdFlag');
    flag.className = 'crowd-flag ' + level;
    flag.innerHTML = '<i></i>혼잡도 ' + LEVEL_LABEL[level];
    if (map.isRouteOn()) setRoute(true);   // 혼잡도가 바뀌면 표시 중인 동선도 새로 추천
  }
  var crowdTimer = null;
  function countSearch(teamId) {
    if (!bot.teamById[teamId]) return;
    stats.search[teamId] = (stats.search[teamId] || 0) + 1;
    STORE.set(KEY.stats, stats);
    clearTimeout(crowdTimer);
    crowdTimer = setTimeout(applyCrowd, 400);
  }

  var INTENT_LABEL = {
    greet: '인사', thanks: '감사 인사', bye: '작별 인사', bot_who: '챗봇 정체', bot_how: '작동 원리', help: '도움말',
    event_when: '행사 시간', event_where: '행사 장소', event_what: '행사 소개', parts: '1부·2부 안내', now_part: '지금 운영 팀',
    list_experience: '체험 부스 목록', list_exhibit: '전시 목록', list_all: '전체 팀 목록',
    team_info: '팀 소개', team_where: '팀 위치', team_when: '팀 운영 시간', topic_search: '주제로 찾기', recommend: '추천', popular: '인기 부스',
    stamp_how: '도장 받는 법', reward: '보상', photo: '포토부스', career: '진로 전시', field_info: '진로 분야 설명',
    where_entrance: '입구', where_exit: '출구', route: '관람 동선', tour: '부스 투어', map_show: '지도 보기', wait: '대기 시간',
    club_about: '동아리 소개', club_join: '가입 문의', outside: '컴퓨터실 밖', chitchat: '잡담', oos: '범위 밖 질문'
  };
  var KIND_LABEL = { info: '입구 안내', exp: '체험형', career: '진로 전시', wall: '전시형', photo: '포토부스', check: '출구 확인' };
  var START_CHIPS = ['체험 부스 뭐 있어?', '로봇 축구 어디야?', '도장 어떻게 받아?', '게임 있어?', '투어 해줘', '어떻게 만들었어?'];

  // ---------- 채팅 ----------
  var messages = $('messages');
  function scrollDown() { messages.scrollTop = messages.scrollHeight; }
  function addUser(text) {
    var el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = '<div class="bubble"></div>';
    el.firstChild.textContent = text;
    messages.appendChild(el);
    scrollDown();
  }
  // meta 가 있으면(실제 질문에 대한 답이면) 답 아래에 피드백 버튼을 붙인다
  function addBot(html, chips, meta) {
    var el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = '<div class="avatar" aria-hidden="true"></div><div class="bubble">' + html + '</div>';
    messages.appendChild(el);
    if (meta) {
      var fb = document.createElement('div');
      fb.className = 'fb';
      fb.dataset.q = meta.q; fb.dataset.intent = meta.intent; fb.dataset.conf = String(meta.conf);
      fb.innerHTML = '<span>이 답이</span><button type="button" data-fb="up">도움 됐어요</button><button type="button" data-fb="down">틀렸어요</button>';
      messages.appendChild(fb);
    }
    if (chips && chips.length) {
      var row = document.createElement('div');
      row.className = 'chips';
      chips.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = c;
        row.appendChild(b);
      });
      messages.appendChild(row);
    }
    scrollDown();
    return el;
  }
  function greet() {
    messages.innerHTML = '';
    bot.state.lastTeam = null;
    addBot('안녕하세요! 코드온 부스를 안내하는 챗봇이에요. 궁금한 걸 적거나 아래 버튼을 눌러 보세요.', START_CHIPS);
  }

  var busy = false;
  function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    if (text === '작동 원리 보기') { setExplain(true); return; }
    stopTour();
    addUser(text);
    busy = true;
    var typing = addBot('<span class="typing"><i></i><i></i><i></i></span>');
    setTimeout(function () {
      var res = bot.ask(text);
      typing.remove();
      addBot(res.html, res.chips, { q: text, intent: res.intent, conf: res.debug.confidence });
      busy = false;
      state.lastDebug = res.debug;
      if (state.explain) renderExplain();
      if (res.fallback) logUnanswered(text);
      // 질문에 나온 팀은 "검색된 횟수"에 더한다
      var counted = {};
      res.debug.entities.forEach(function (e) {
        if (e.type === 'T' && !counted[e.id]) { counted[e.id] = 1; countSearch(e.id); }
      });
      runActions(res.actions || []);
    }, 260);
  }

  function runActions(actions) {
    var keepRoute = actions.some(function (a) { return a.type === 'route'; });
    if (!keepRoute && map.isRouteOn() && actions.length) setRoute(false);
    actions.forEach(function (a) {
      if (a.type === 'part') setPart(a.part);
      else if (a.type === 'focus') { map.focus(a.ids); if (a.ids.length === 1) showDetail(a.ids[0]); else hideDetail(); }
      else if (a.type === 'highlight') { hideDetail(); map.highlight(a.ids); }
      else if (a.type === 'overview') { hideDetail(); map.overview(); }
      else if (a.type === 'route') { hideDetail(); setRoute(true, pendingPlan); pendingPlan = null; }
      else if (a.type === 'tour') startTour();
      else if (a.type === 'frames') openSheet('photo');
    });
  }

  messages.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('.chips') && t.tagName === 'BUTTON') { send(t.textContent); return; }
    var link = t.closest('.inline-link');
    if (link) {
      if (link.dataset.team) send(bot.teamById[link.dataset.team].name + ' 어디야?');
      else if (link.dataset.field) send(bot.careerById[link.dataset.field].name + ' 뭐야?');
      return;
    }
    var fbBtn = t.closest('[data-fb]');
    if (fbBtn) handleFeedback(fbBtn);
  });
  $('composer').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q');
    send(q.value);
    q.value = '';
  });
  $('q').addEventListener('input', function () { if (map) map.poke(); });

  // ---------- 답변 피드백 ----------
  function saveFeedback(entry) {
    var list = STORE.get(KEY.feedback, []);
    if (!Array.isArray(list)) list = [];
    entry.at = new Date().toISOString();
    list.push(entry);
    return STORE.set(KEY.feedback, list.slice(-500));
  }
  function handleFeedback(btn) {
    var box = btn.closest('.fb'), kind = btn.dataset.fb;
    var base = { q: box.dataset.q, intent: box.dataset.intent, conf: Number(box.dataset.conf) };
    if (kind === 'up') {
      base.vote = 'up';
      saveFeedback(base);
      box.innerHTML = '<span>알려 줘서 고마워요.</span>';
    } else if (kind === 'down') {
      // 무엇을 원했는지 고르거나 적을 수 있는 칸을 연다 (둘 다 비워도 됨)
      var options = Object.keys(INTENT_LABEL).filter(function (k) { return k !== 'oos' && k !== 'chitchat'; }).map(function (k) {
        return '<option value="' + k + '">' + INTENT_LABEL[k] + '</option>';
      }).join('');
      box.innerHTML = '<div class="fb-form"><label>어떤 답을 원했나요? (고르지 않아도 돼요)<select data-want><option value="">잘 모르겠어요</option>' + options + '</select></label>' +
        '<label>하고 싶은 말<input type="text" data-comment maxlength="120" placeholder="예: 자리가 아니라 체험 방법이 궁금했어요"></label>' +
        '<div class="row"><button type="button" class="send" data-fb="send">보내기</button><button type="button" data-fb="cancel">취소</button></div></div>';
      scrollDown();
    } else if (kind === 'send') {
      base.vote = 'down';
      base.want = box.querySelector('[data-want]').value;
      base.comment = box.querySelector('[data-comment]').value.trim();
      var ok = saveFeedback(base);
      box.innerHTML = '<span>' + (ok ? '의견을 저장했어요. 챗봇을 고치는 데 쓸게요.' : '이 브라우저에서는 의견을 저장할 수 없어요.') + '</span>';
    } else if (kind === 'cancel') {
      box.innerHTML = '<span>이 답이</span><button type="button" data-fb="up">도움 됐어요</button><button type="button" data-fb="down">틀렸어요</button>';
    }
  }

  // ---------- 못 알아들은 질문 기록 ----------
  function readLog() { var l = STORE.get(KEY.unanswered, []); return Array.isArray(l) ? l : []; }
  function logUnanswered(text) {
    var list = readLog();
    list.push({ q: text, at: new Date().toISOString() });
    STORE.set(KEY.unanswered, list.slice(-300));
  }

  // ---------- 1부 / 2부 ----------
  function buildPartSeg() {
    var seg = $('partSeg');
    seg.innerHTML = DATA.parts.map(function (p) {
      return '<button type="button" data-part="' + p.id + '">' + p.label + '<small>' + p.time + '</small></button>';
    }).join('');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) { setPart(Number(b.dataset.part)); hideDetail(); map.clear(); }
    });
  }
  function setPart(n) {
    var changed = state.part !== n;
    state.part = n;
    Array.prototype.forEach.call($('partSeg').children, function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.part) === n));
    });
    if (map) { map.setPart(n); if (changed) applyCrowd(); }
  }
  // 행사 당일에 교대 시각이 지나면 자동으로 2부로 바꾼다 (data.js 의 partSwitchTime)
  function autoPart() {
    var sw = DATA.event.partSwitchTime;
    if (!sw) return;
    var now = new Date(), pad = function (x) { return (x < 10 ? '0' : '') + x; };
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    if (today !== DATA.event.date) return;
    var want = pad(now.getHours()) + ':' + pad(now.getMinutes()) >= sw ? 2 : 1;
    if (want !== state.autoApplied) { state.autoApplied = want; setPart(want); }
  }

  // ---------- 구역 상세 카드 ----------
  var detail = $('detail');
  function zoneDef(id) { return bot.zoneById[id]; }
  function teamOfZone(id) {
    var z = zoneDef(id);
    if (!z) return null;
    if (z.kind === 'exp') return bot.teamAt(id, state.part);
    if (z.kind === 'wall') return bot.teamById[DATA.assignment.exhibit[z.wall]];
    return null;
  }
  function showDetail(id) {
    var z = zoneDef(id);
    if (!z) { hideDetail(); return; }
    var color = map.colorOf(id), html = '', A = DATA.assignment;
    var seats = z.seats ? z.seats.join(' · ') + '번' : z.name + ' (뒷벽)';
    if (z.kind === 'exp' || z.kind === 'wall') {
      var team = teamOfZone(id);
      if (!team) { hideDetail(); return; }
      var other = z.kind === 'exp' ? bot.teamAt(id, state.part === 1 ? 2 : 1) : null;
      html = '<div class="kind">' + (z.kind === 'exp' ? '체험형 · ' + bot.partLabel(state.part) : '전시형 · 1부, 2부 계속') + '</div>' +
        '<h3>' + esc(team.name) + '</h3><div class="topic">' + esc(team.topic) + '</div>' +
        '<p>' + esc(team.desc) + '</p>' +
        '<dl><dt>' + (z.kind === 'exp' ? '체험 방법' : '관람 방법') + '</dt><dd>' + esc(team.how) + '</dd>' +
        '<dt>자리</dt><dd>' + seats + (A.confirmed ? '' : ' (임시 배정)') + '</dd>' +
        '<dt>도장</dt><dd>' + (z.kind === 'exp' ? '체험 후 담당자가 찍어 줘요' : '전시형은 도장이 없어요') + '</dd>' +
        (other ? '<dt>' + DATA.parts[state.part === 1 ? 1 : 0].label + '에는</dt><dd>' + esc(other.name) + ' 팀</dd>' : '') + '</dl>';
    } else if (z.kind === 'career') {
      var c = bot.careerById[z.field];
      html = '<div class="kind">진로 전시 · PC ' + c.pc + '</div><h3>' + esc(c.name) + '</h3>' +
        '<p>' + esc(c.goal) + '</p><dl><dt>체험 방법</dt><dd>' + esc(c.how) + '</dd><dt>자리</dt><dd>' + seats + (A.confirmed ? '' : ' (임시 배정)') + '</dd>' +
        '<dt>도장</dt><dd>PC 4대 중 3가지 이상 체험하면 ⑤번 칸</dd></dl>';
    } else {
      html = '<div class="kind">' + KIND_LABEL[z.kind] + '</div><h3>' + esc(z.name) + '</h3><p>' + esc(z.desc) + '</p><dl><dt>자리</dt><dd>' + seats + '</dd></dl>' +
        (z.kind === 'photo' && (DATA.photoFrames || []).length ? '<div class="row"><button type="button" class="btn small" data-open-frames>사진 틀 ' + DATA.photoFrames.length + '종 보기</button></div>' : '');
    }
    detail.style.setProperty('--accent', color);
    detail.innerHTML = '<button class="close" type="button" aria-label="상세 닫기">닫기</button>' + html;
    detail.hidden = false;
    // 같은 카드가 다시 열릴 때도 나타나는 움직임이 보이도록
    detail.style.animation = 'none'; void detail.offsetWidth; detail.style.animation = '';
  }
  function hideDetail() { detail.hidden = true; }
  detail.addEventListener('click', function (e) {
    if (e.target.closest('.close')) { hideDetail(); map.clear(); }
    else if (e.target.closest('[data-open-frames]')) openSheet('photo');
  });

  // ---------- 지도 보기 버튼 ----------
  // 동선 켜기/끄기. plan 을 주지 않으면 지금 혼잡도에 맞는 동선을 고른다.
  function setRoute(on, plan) {
    var bar = $('routeBar');
    document.querySelector('[data-view="route"]').setAttribute('aria-pressed', String(!!on));
    if (!on) { map.showRoute(false); bar.hidden = true; return; }
    plan = plan || routePlan();
    state.routePlan = plan;
    map.showRoute(true, plan.stops);
    // 세 가지 동선을 나란히 보여 주고 고르게 한다. 지금 혼잡도에 맞는 것에 "추천" 표시가 붙는다.
    var WHEN = { fast: '붐빌 때 · 체험 1 + 진로 1', basic: '보통일 때 · 체험 2 + 진로 + 전시', full: '여유로울 때 · 체험 3 + 포토 + 전시 + 진로 2', stamp: '도장 5개 · 체험 4 + 진로 3' };
    var cards = ['fast', 'basic', 'full', 'stamp'].map(function (k) {
      var p = k === plan.kind ? plan : routePlan(k, k === 'fast' ? fastFlip : undefined);
      return '<button type="button" class="route-card" data-route="' + k + '" aria-pressed="' + (k === plan.kind) + '">' +
        '<span class="name">' + ROUTE_NAME[k] + (k === plan.recommended ? '<em>지금 추천</em>' : '') + '</span>' +
        '<span class="when">' + WHEN[k] + '</span><span class="nums">' + p.steps.length + '곳 · 약 ' + p.minutes + '분</span></button>';
    }).join('');
    bar.innerHTML = '<div class="head"><span class="level ' + plan.level + '">혼잡도 ' + plan.levelLabel + '</span><h3>' + (plan.custom ? '맞춤 동선' : '관람 동선 고르기') + '</h3>' +
      (plan.kind === 'fast' ? '<button type="button" class="btn small close" data-route="fast-other">다른 곳으로</button>' : '') +
      '<button type="button" class="btn small' + (plan.kind === 'fast' ? '' : ' close') + '" data-route="off">닫기</button></div>' +
      '<div class="route-cards">' + cards + '</div>' +
      '<p class="why"><span>' + esc(plan.reason) + (plan.notes.length ? ' ' + esc(plan.notes.join(' ')) : '') + '</span></p>' +
      '<ol class="route-steps">' + plan.short.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ol>';
    bar.hidden = false;
  }
  $('routeBar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-route]');
    if (!b) return;
    var k = b.dataset.route;
    if (k === 'off') { setRoute(false); map.overview(); }
    else if (k === 'fast-other') setRoute(true, routePlan('fast', (state.routePlan ? state.routePlan.variant : 0) + 1));
    else setRoute(true, routePlan(k, k === 'fast' ? fastFlip : undefined));
  });
  document.querySelector('.views').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (!b) return;
    var v = b.dataset.view;
    map.poke();
    if (v !== 'tour') stopTour();
    if (v === 'overview') { hideDetail(); setRoute(false); map.overview(); }
    else if (v === 'top') { map.topView(); }
    else if (v === 'entrance') { hideDetail(); map.clear(); map.entranceView(); }
    else if (v === 'route') { hideDetail(); setRoute(!map.isRouteOn()); if (!map.isRouteOn()) map.overview(); }
    else if (v === 'tour') { state.tour ? stopTour() : startTour(); }
  });

  function buildLegend() {
    var kinds = ['info', 'exp', 'career', 'wall', 'photo', 'check'];
    var legend = $('legend');
    legend.innerHTML = kinds.map(function (k) {
      return '<li><button type="button" data-kind="' + k + '"><i style="background:' + window.CODEON_MAP.COLORS[k].css + '"></i>' + KIND_LABEL[k] + '</button></li>';
    }).join('');
    legend.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      stopTour(); hideDetail(); setRoute(false); map.poke();
      var ids = DATA.zones.filter(function (z) { return z.kind === b.dataset.kind; }).map(function (z) { return z.id; });
      if (ids.length === 1) { map.focus(ids); showDetail(ids[0]); } else if (b.dataset.kind === 'wall') map.focus(ids); else map.highlight(ids);
    });
  }

  // ---------- 부스 투어 ----------
  function tourSteps() {
    var steps = [{ ids: ['info'], text: '입구 안내 · 여기서 도장판을 받아요' }];
    BLOCKS.forEach(function (id) {
      var t = bot.teamAt(id, state.part);
      if (t) steps.push({ ids: [id], text: t.name + ' · ' + t.topic });
    });
    steps.push({ ids: ['pc1', 'pc2', 'pc3', 'pc4'], text: '진로 전시 · PC 4대 중 3가지 이상 체험하면 도장' });
    steps.push({ ids: ['ex1', 'ex2', 'ex3', 'ex4'], text: '뒷벽 전시 · 전시형 4팀' });
    steps.push({ ids: ['check'], text: '출구 확인 · 도장을 확인받고 보상을 골라요' });
    steps.push({ ids: ['photo'], text: '포토부스 · 티켓이 있으면 네 컷 사진' });
    return steps;
  }
  function startTour() {
    stopTour(); setRoute(false);
    var steps = tourSteps(), i = -1;
    function next() {
      i++;
      if (i >= steps.length) { stopTour(); hideDetail(); map.overview(); return; }
      var s = steps[i];
      map.focus(s.ids);
      if (s.ids.length === 1) showDetail(s.ids[0]); else hideDetail();
      $('tourText').textContent = '투어 ' + (i + 1) + '/' + steps.length + ' · ' + s.text;
    }
    $('tourBar').hidden = false;
    state.tour = setInterval(next, TOUR_STEP_MS);
    next();
  }
  function stopTour() {
    if (!state.tour) return;
    clearInterval(state.tour); state.tour = null;
    $('tourBar').hidden = true;
  }
  $('tourStop').addEventListener('click', function () { stopTour(); });

  // ---------- 행사 안내 창 ----------
  var TABS = [
    { id: 'event', label: '행사 소개' }, { id: 'exp', label: '체험 부스' }, { id: 'exh', label: '작품 전시' },
    { id: 'career', label: '진로 전시' }, { id: 'stamp', label: '스탬프 투어' }, { id: 'photo', label: '포토부스' }
  ];
  function teamCards(type) {
    var A = DATA.assignment;
    return '<div class="team-grid">' + DATA.teams.filter(function (t) { return t.type === type; }).map(function (t) {
      var pl = bot.placeOf(t), where = '';
      if (pl) where = (type === 'exp' ? DATA.parts[pl.part - 1].label + ' · ' : '계속 운영 · ') + (pl.zone.seats ? pl.zone.seats.join('·') + '번 자리' : '뒷벽 ' + pl.zone.name) + (A.confirmed ? '' : ' (임시)');
      return '<button type="button" class="team-card" data-team="' + t.id + '" style="--accent:' + window.CODEON_MAP.COLORS[type === 'exp' ? 'exp' : 'wall'].css + '">' +
        '<span class="name">' + esc(t.name) + '</span><span class="topic">' + esc(t.topic) + '</span><span class="desc">' + esc(t.desc) + '</span><span class="where">' + where + '</span></button>';
    }).join('') + '</div>';
  }
  function tabContent(id) {
    var e = DATA.event, s = DATA.stamp;
    if (id === 'event') {
      return '<h3>' + esc(e.title) + ' · ' + esc(e.club) + ' 부스</h3>' +
        '<dl class="facts"><dt>일시</dt><dd>' + e.dateText + ' ' + e.timeText + '</dd><dt>장소</dt><dd>' + e.place + '</dd><dt>대상</dt><dd>' + e.target + '</dd>' +
        '<dt>운영</dt><dd>1부 ' + DATA.parts[0].time + ' · 2부 ' + DATA.parts[1].time + ' (2교시 쉬는 시간에 체험 팀 교대)</dd></dl>' +
        '<h3>이렇게 둘러보세요</h3><ol class="flow"><li>입구에서 도장판 받기</li><li>체험형 부스 4곳 체험</li><li>진로 전시 3가지 이상 체험</li><li>뒷벽 전시 구경</li><li>출구에서 보상 고르기</li></ol>' +
        '<h3>' + esc(e.club) + ' 동아리</h3><p>' + esc(e.club) + '(' + esc(e.clubEn) + ')은 코딩 동아리예요. 부원 ' + e.members + '명이 팀을 나눠 직접 만든 프로젝트 12개를 이번 발표회에 가지고 나왔어요. 체험형 8팀은 직접 해 볼 수 있고, 전시형 4팀은 뒷벽에서 볼 수 있어요.</p>';
    }
    if (id === 'exp') return '<p>직접 해 볼 수 있는 8팀이에요. 1부와 2부에 4팀씩 운영하고, 체험하면 담당자가 도장을 찍어 줘요. 카드를 누르면 지도에서 자리를 보여 줘요.</p>' + teamCards('exp');
    if (id === 'exh') return '<p>뒷벽에 계속 전시하는 4팀이에요. 전시형은 도장이 없어요. 카드를 누르면 지도에서 자리를 보여 줘요.</p>' + teamCards('exh');
    if (id === 'career') {
      return '<p>컴퓨터와 소프트웨어 분야 진로를 PC 4대로 체험하는 전시예요. 3가지 이상 체험하면 도장판 ⑤번 칸에 도장을 받아요.</p><div class="team-grid">' +
        DATA.career.map(function (c) {
          return '<button type="button" class="team-card" data-field="' + c.id + '" style="--accent:' + window.CODEON_MAP.COLORS.career.css + '"><span class="name">PC ' + c.pc + ' · ' + esc(c.name) + '</span><span class="topic">' + esc(c.goal) + '</span><span class="desc">' + esc(c.how) + '</span></button>';
        }).join('') + '</div>';
    }
    if (id === 'stamp') {
      return '<p>도장판의 칸 ' + s.slots + '개를 모두 채워 출구로 오세요.</p><div class="stamp-board">' +
        [1, 2, 3, 4].map(function (n) { return '<div class="stamp-slot"><span><b>' + n + '</b>체험형 부스</span></div>'; }).join('') +
        '<div class="stamp-slot"><span><b>5</b>진로 전시</span></div></div>' +
        '<h3>도장 받는 법</h3><ul class="rule-list">' + s.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
        '<h3>다 모으면</h3><p>' + esc(s.reward) + ' ' + esc(s.snackNote) + '</p>';
    }
    if (id === 'photo') {
      var z = bot.zoneById.photo;
      return '<p>' + esc(z.desc) + '</p><h3>이용 순서</h3><ol class="flow"><li>도장 5개 모으기</li><li>출구에서 포토부스 티켓 고르기</li><li>' + z.seats.join('·') + '번 자리 뒤 포토부스에서 촬영</li><li>인화한 사진은 나중에 받기</li></ol>' +
        '<p>포토부스에서는 도장을 찍지 않아요.</p><p><button type="button" class="btn" data-zone="photo">지도에서 포토부스 보기</button></p>' +
        ((DATA.photoFrames || []).length ? '<h3>사진 틀</h3><p>네 컷 사진은 아래 틀 중 하나에 담겨요. 누르면 크게 볼 수 있어요.</p><div class="frame-grid">' +
          DATA.photoFrames.map(function (f) {
            return '<button type="button" class="frame" data-frame="' + f.id + '"><img src="' + esc(f.file) + '" alt="' + esc(f.name) + ' 사진 틀" loading="lazy"><span>' + esc(f.name) + '</span></button>';
          }).join('') + '</div>' : '');
    }
    return '';
  }
  function openSheet(tab) {
    $('tabs').innerHTML = TABS.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + t.id + '" aria-selected="' + (t.id === tab) + '">' + t.label + '</button>';
    }).join('');
    $('sheetContent').innerHTML = tabContent(tab);
    $('sheetContent').scrollTop = 0;
    $('sheet').hidden = false;
  }
  function closeSheet() { $('sheet').hidden = true; }
  $('guideBtn').addEventListener('click', function () { stopTour(); openSheet('event'); });
  $('sheet').addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('[data-close]')) { closeSheet(); return; }
    var tab = t.closest('[data-tab]');
    if (tab) { openSheet(tab.dataset.tab); return; }
    var card = t.closest('[data-team]');
    if (card) {
      var team = bot.teamById[card.dataset.team], pl = bot.placeOf(team);
      closeSheet(); setRoute(false); countSearch(team.id);
      if (pl) { if (pl.part) setPart(pl.part); map.focus([pl.zone.id]); showDetail(pl.zone.id); }
      return;
    }
    var f = t.closest('[data-field]');
    if (f) {
      var z = DATA.zones.filter(function (q) { return q.field === f.dataset.field; })[0];
      closeSheet(); setRoute(false);
      if (z) { map.focus([z.id]); showDetail(z.id); }
      return;
    }
    var fr = t.closest('[data-frame]');
    if (fr) { openFrame(fr.dataset.frame); return; }
    var zb = t.closest('[data-zone]');
    if (zb) { closeSheet(); setRoute(false); map.focus([zb.dataset.zone]); showDetail(zb.dataset.zone); }
  });

  // ---------- 숨은 기능: 3D 여우가 커져서 화면 앞까지 다가와 노려본다 ----------
  var SCARE_MS = 4000, scaring = false;
  function foxScare() {
    if (scaring) return;
    scaring = true;
    var composer = $('composer'), q = $('q'), button = composer.querySelector('button');
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 채팅 잠그기
    var oldHint = q.placeholder;
    busy = true; q.disabled = true; button.disabled = true; q.blur();
    q.placeholder = '여우가 지켜보고 있어요...';
    composer.classList.add('locked');
    stopTour(); hideDetail(); setRoute(false);
    // 지도 속 여우가 커지고, 카메라가 여우 얼굴 앞으로 다가간다
    map.foxRage(SCARE_MS / 1000);
    if (!calm) { $('app').classList.add('shaking'); setTimeout(function () { $('app').classList.remove('shaking'); }, 600); }
    setTimeout(function () {
      scaring = false;
      busy = false; q.disabled = false; button.disabled = false; q.placeholder = oldHint;
      composer.classList.remove('locked');
    }, SCARE_MS);
  }

  // ---------- 사진 틀 크게 보기 ----------
  function openFrame(id) {
    var frames = DATA.photoFrames || [], i = 0;
    frames.forEach(function (f, k) { if (f.id === id) i = k; });
    var f = frames[i];
    if (!f) return;
    $('lightboxImg').src = f.file; $('lightboxImg').alt = f.name + ' 사진 틀';
    $('lightboxName').textContent = f.name + ' (' + (i + 1) + '/' + frames.length + ')';
    $('lightbox').dataset.index = String(i);
    $('lightbox').hidden = false;
  }
  $('lightbox').addEventListener('click', function (e) {
    var step = e.target.closest('[data-step]');
    if (step) {
      var frames = DATA.photoFrames, n = frames.length;
      openFrame(frames[(Number($('lightbox').dataset.index) + Number(step.dataset.step) + n) % n].id);
      return;
    }
    if (e.target.closest('[data-close]') || e.target === $('lightbox')) $('lightbox').hidden = true;
  });

  // ---------- 관리자 로그인 ----------
  function isAdmin() { return STORE.sessionGet(KEY.session) === '1'; }
  function openLogin() {
    stopTour(); closeSheet();
    $('loginMsg').textContent = '';
    $('loginPw').value = '';
    $('login').hidden = false;
    setTimeout(function () { $('loginPw').focus(); }, 50);
  }
  function closeLogin() { $('login').hidden = true; }
  function logout() { STORE.sessionSet(KEY.session, null); closeEditor(); }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var now = Date.now();
    if (now < state.loginLockUntil) { $('loginMsg').textContent = '여러 번 틀렸어요. ' + Math.ceil((state.loginLockUntil - now) / 1000) + '초 뒤에 다시 해 보세요.'; return; }
    if (STORE.sha256($('loginPw').value) === settings.passHash) {
      state.loginFails = 0;
      STORE.sessionSet(KEY.session, '1');
      closeLogin();
      openEditor();
    } else {
      state.loginFails++;
      if (state.loginFails >= 5) { state.loginLockUntil = now + 30000; state.loginFails = 0; }
      $('loginMsg').textContent = '비밀번호가 맞지 않아요.';
      $('loginPw').value = '';
    }
  });
  $('login').addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeLogin(); });
  function openAdmin() { if (isAdmin()) openEditor(); else openLogin(); }
  $('adminBtn').addEventListener('click', openAdmin);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); if (!$('editor').hidden) closeEditor(); else openAdmin(); }
    else if (e.key === 'Escape') { if (!$('lightbox').hidden) $('lightbox').hidden = true; else { closeSheet(); closeEditor(); closeLogin(); } }
  });

  // ---------- 관리자 창 ----------
  var ADMIN_TABS = [{ id: 'assign', label: '자리 배정' }, { id: 'pop', label: '인기도 · 방문 인원' }, { id: 'fb', label: '피드백' }, { id: 'set', label: '설정' }];
  var editorMsg = { text: '', bad: false };
  function msgHtml() { return '<span class="editor-msg' + (editorMsg.bad ? ' bad' : '') + '" role="status">' + esc(editorMsg.text) + '</span>'; }
  function selectHtml(slot, ids, current) {
    return '<select data-slot="' + slot + '" aria-label="' + slot + '">' + ids.map(function (id) {
      var t = bot.teamById[id];
      return '<option value="' + id + '"' + (id === current ? ' selected' : '') + '>' + esc(t.name) + ' · ' + esc(t.topic.length > 16 ? t.topic.slice(0, 16) + '…' : t.topic) + '</option>';
    }).join('') + '</select>';
  }
  function assignTab() {
    var A = DATA.assignment;
    var rows = BLOCKS.map(function (b) {
      var z = bot.zoneById[b];
      return '<tr><td class="zone"><i style="background:' + window.CODEON_MAP.COLORS.exp.css + '"></i>' + esc(z.name) + '</td><td class="seat">' + z.seats.join(' · ') + '번</td>' +
        '<td class="' + (state.part === 1 ? 'now' : '') + '">' + selectHtml('part1.' + b, expIds, A.part1[b]) + '</td>' +
        '<td class="' + (state.part === 2 ? 'now' : '') + '">' + selectHtml('part2.' + b, expIds, A.part2[b]) + '</td></tr>';
    }).join('');
    var walls = ['4', '3', '2', '1'].map(function (w) {
      return '<label>전시 ' + w + selectHtml('exhibit.' + w, exhIds, A.exhibit[w]) + '</label>';
    }).join('');
    return '<p>팀을 고르면 원래 그 자리에 있던 팀과 서로 자리가 바뀌어요. 바꾸는 즉시 지도와 챗봇 답에 반영돼요.</p>' +
      '<h3>체험형 자리</h3><table class="assign"><thead><tr><th>구역</th><th>좌석</th><th>1부 (' + DATA.parts[0].time + ')</th><th>2부 (' + DATA.parts[1].time + ')</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3>뒷벽 전시</h3><div class="wall-row">' + walls + '</div><p class="wall-hint">배치도(칠판이 위쪽)에서 왼쪽부터 순서예요.</p>' +
      '<label class="check"><input type="checkbox" id="confirmChk"' + (A.confirmed ? ' checked' : '') + '>배정 확정 <small>화면과 챗봇 답에서 "임시 배정" 표시를 없애요</small></label>' +
      '<div class="editor-actions"><button type="button" class="btn" data-act="reset-assign">data.js 배정으로 되돌리기</button>' + msgHtml() + '</div>';
  }
  function popTab() {
    var max = 0;
    allIds.forEach(function (id) { max = Math.max(max, popularity(id)); });
    var rows = rankedTeams().map(function (id, i) {
      var t = bot.teamById[id], m = settings.manual[id], p = popularity(id);
      return '<tr><td class="name">' + (i + 1) + '. ' + esc(t.name) + '<small>' + (t.type === 'exp' ? '체험형' : '전시형') + '</small></td>' +
        '<td>' + (stats.search[id] || 0) + '</td>' +
        '<td><input class="num" type="number" min="0" max="100" step="1" data-manual="' + id + '" value="' + (m !== undefined && m !== null ? m : '') + '" placeholder="자동" aria-label="' + esc(t.name) + ' 인기도 직접 설정"></td>' +
        '<td><div class="meter"><span><b style="width:' + (max ? (100 * p / max).toFixed(0) : 0) + '%"></b></span><em>' + p + '</em></div></td></tr>';
    }).join('');
    return '<h3>동아리 방문 인원수</h3><p>지도에 걸어 다니는 방문자 모형이 이 숫자만큼 나와요. (0 ~ ' + MAX_VISITORS + '명) 지금 혼잡도는 <b>' + congestion().label + '</b>이고, ' +
      DATA.congestion.quietBelow + '명 미만은 여유, ' + DATA.congestion.busyFrom + '명 이상은 혼잡으로 봐요. 혼잡도에 따라 추천 동선이 바뀌어요.</p>' +
      '<div class="visitors"><input type="range" id="visRange" min="0" max="' + MAX_VISITORS + '" step="1" value="' + settings.visitors + '" aria-label="방문 인원수 조절"><input class="num" type="number" id="visNum" min="0" max="' + MAX_VISITORS + '" value="' + settings.visitors + '" aria-label="방문 인원수"><span>명</span></div>' +
      '<h3>팀별 인기도</h3><p>기본은 챗봇에서 검색되거나 지도·안내 창에서 눌린 횟수예요. "직접 설정" 칸에 0~100을 적으면 그 값을 쓰고, 비우면 다시 자동이 돼요. 인기도가 높은 부스일수록 방문자 모형이 더 자주 들러요.</p>' +
      '<table class="assign pop"><thead><tr><th>팀</th><th>검색·조회 횟수</th><th>직접 설정</th><th>현재 인기도</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="editor-actions"><button type="button" class="btn" data-act="reset-counts">검색·조회 횟수 0으로</button><button type="button" class="btn" data-act="clear-manual">직접 설정 모두 지우기</button>' + msgHtml() + '</div>';
  }
  function feedbackList() { var l = STORE.get(KEY.feedback, []); return Array.isArray(l) ? l : []; }
  function fbTab() {
    var list = feedbackList(), up = 0, down = [];
    list.forEach(function (f) { if (f.vote === 'up') up++; else down.push(f); });
    var unanswered = readLog();
    var items = down.slice().reverse().map(function (f) {
      return '<div class="fb-item"><div class="q">' + esc(f.q) + '</div>' +
        '<div class="meta">챗봇이 고른 답: ' + (INTENT_LABEL[f.intent] || esc(f.intent)) + ' (확신도 ' + Math.round((f.conf || 0) * 100) + '%) · ' + esc(String(f.at || '').slice(0, 16).replace('T', ' ')) + '</div>' +
        (f.want ? '<div class="want">원했던 답: ' + (INTENT_LABEL[f.want] || esc(f.want)) + '</div>' : '') +
        (f.comment ? '<div>의견: ' + esc(f.comment) + '</div>' : '') + '</div>';
    }).join('');
    var un = unanswered.slice().reverse().slice(0, 60).map(function (u) { return '<div class="fb-item"><div class="q">' + esc(u.q) + '</div></div>'; }).join('');
    return '<div class="stat-row"><div class="stat"><b>' + up + '</b><span>도움 됐어요</span></div><div class="stat"><b>' + down.length + '</b><span>틀렸어요</span></div><div class="stat"><b>' + unanswered.length + '</b><span>못 알아들은 질문</span></div></div>' +
      '<div class="editor-actions"><button type="button" class="btn" data-act="copy-train">학습 자료용으로 복사</button><button type="button" class="btn" data-act="copy-csv">표(CSV)로 복사</button><button type="button" class="btn" data-act="clear-fb">모두 비우기</button>' + msgHtml() + '</div>' +
      '<p>"학습 자료용으로 복사"한 내용을 js/intents.js 의 알맞은 의도에 예시로 넣고 node train.js 를 실행하면 챗봇이 그 질문을 배워요.</p>' +
      '<h3>틀렸다고 표시된 답</h3>' + (items ? '<div class="fb-list">' + items + '</div>' : '<p class="empty-note">아직 없어요.</p>') +
      '<h3>못 알아들은 질문</h3>' + (un ? '<div class="fb-list">' + un + '</div>' : '<p class="empty-note">아직 없어요.</p>');
  }
  function setTab() {
    var hidden = STORE.get(KEY.hideAdmin, false) === true;
    return '<p class="warn-note">이 관리자 잠금은 부스 PC에서 방문자가 설정을 건드리지 못하게 막는 용도예요. 서버가 없어서 설정·검색 횟수·피드백은 이 컴퓨터의 이 브라우저에만 저장돼요.</p>' +
      '<h3>비밀번호 바꾸기</h3><label class="field">새 비밀번호 (4자 이상)<input type="password" id="newPw" autocomplete="new-password"></label><label class="field">한 번 더<input type="password" id="newPw2" autocomplete="new-password"></label>' +
      '<div class="editor-actions"><button type="button" class="btn" data-act="change-pw">비밀번호 바꾸기</button></div>' +
      '<h3>설정 옮기기</h3><p>자리 배정, 방문 인원수, 인기도 직접 설정, 비밀번호를 한 번에 담은 코드예요. 다른 컴퓨터에서는 이 칸에 붙여넣고 "코드 적용"을 누르세요. 인터넷에 올린 사이트의 모든 방문자에게 적용하려면 js/data.js 의 <b>var saved = null;</b> 에서 null 을 이 코드로 바꾼 뒤 다시 올리세요.</p>' +
      '<textarea class="code-box" id="settingsCode" rows="7" spellcheck="false">' + esc(JSON.stringify(settingsBundle(), null, 1)) + '</textarea>' +
      '<div class="editor-actions"><button type="button" class="btn" data-act="copy-settings">코드 복사</button><button type="button" class="btn" data-act="apply-settings">코드 적용</button><button type="button" class="btn" data-act="reset-all">이 브라우저의 설정 모두 지우기</button>' + msgHtml() + '</div>' +
      '<label class="check"><input type="checkbox" id="hideChk"' + (hidden ? ' checked' : '') + '>화면에서 "관리자" 버튼 숨기기 <small>숨긴 뒤에는 Ctrl + Shift + E 로 로그인 창을 열어요</small></label>';
  }
  function renderEditor() {
    $('adminTabs').innerHTML = ADMIN_TABS.map(function (t) {
      return '<button type="button" role="tab" data-atab="' + t.id + '" aria-selected="' + (t.id === state.adminTab) + '">' + t.label + '</button>';
    }).join('');
    var tab = state.adminTab;
    $('editorContent').innerHTML = tab === 'assign' ? assignTab() : tab === 'pop' ? popTab() : tab === 'fb' ? fbTab() : setTab();
  }
  function openEditor() { stopTour(); closeSheet(); editorMsg = { text: '', bad: false }; renderEditor(); $('editor').hidden = false; }
  function closeEditor() { $('editor').hidden = true; }
  function applyHideSetting() { $('adminBtn').hidden = STORE.get(KEY.hideAdmin, false) === true; }
  // 설정이 바뀐 뒤 공통으로 할 일: 저장, 화면 갱신
  function settingsChanged(message, bad, keepEditor) {
    var saved = saveSettings();
    editorMsg = { text: bad || saved ? message : message + ' (이 브라우저에는 저장하지 못했어요)', bad: !!bad };
    $('tempFlag').hidden = !!DATA.assignment.confirmed;
    hideDetail();
    map.refresh();
    applyCrowd();
    if (!keepEditor) renderEditor();
  }
  function copyText(text, doneMessage) {
    var ok = function () { editorMsg = { text: doneMessage, bad: false }; renderEditor(); };
    var fail = function () { window.prompt('아래 내용을 복사하세요 (Ctrl + C)', text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  }
  function trainingText() {
    var groups = {}, lines = [];
    feedbackList().forEach(function (f) {
      if (f.vote !== 'down') return;
      var k = f.want || '(원했던 답을 고르지 않음)';
      (groups[k] = groups[k] || []).push("  '" + String(f.q).replace(/'/g, '') + "',   // 챗봇 답: " + (INTENT_LABEL[f.intent] || f.intent) + (f.comment ? ' / 의견: ' + f.comment : ''));
    });
    Object.keys(groups).forEach(function (k) { lines.push('// ' + k + (INTENT_LABEL[k] ? ' (' + INTENT_LABEL[k] + ')' : '')); lines = lines.concat(groups[k]); lines.push(''); });
    var un = readLog();
    if (un.length) { lines.push('// 못 알아들은 질문 (알맞은 의도를 찾아 넣으세요)'); un.forEach(function (u) { lines.push("  '" + String(u.q).replace(/'/g, '') + "',"); }); }
    return lines.join('\n');
  }
  function csvText() {
    function cell(v) { return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"'; }
    var rows = [['시각', '평가', '질문', '챗봇이 고른 답', '확신도', '원했던 답', '의견'].map(cell).join(',')];
    feedbackList().forEach(function (f) {
      rows.push([f.at, f.vote === 'up' ? '도움 됨' : '틀림', f.q, INTENT_LABEL[f.intent] || f.intent, Math.round((f.conf || 0) * 100) + '%', f.want ? (INTENT_LABEL[f.want] || f.want) : '', f.comment].map(cell).join(','));
    });
    readLog().forEach(function (u) { rows.push([u.at, '못 알아들음', u.q, '', '', '', ''].map(cell).join(',')); });
    return rows.join('\n');
  }
  $('editor').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closeEditor(); return; }
    var tab = e.target.closest('[data-atab]');
    if (tab) { state.adminTab = tab.dataset.atab; editorMsg = { text: '', bad: false }; renderEditor(); $('editorContent').scrollTop = 0; return; }
    var b = e.target.closest('[data-act]');
    if (!b || !isAdmin()) return;
    var act = b.dataset.act;
    if (act === 'logout') { logout(); }
    else if (act === 'reset-assign') { applyAssignment(DEFAULT_ASSIGN); settingsChanged('data.js 에 적힌 배정으로 되돌렸어요.'); }
    else if (act === 'reset-counts') { stats = { search: {} }; STORE.set(KEY.stats, stats); settingsChanged('검색·조회 횟수를 0으로 되돌렸어요.'); }
    else if (act === 'clear-manual') { settings.manual = {}; settingsChanged('직접 설정을 모두 지웠어요. 이제 검색·조회 횟수로 정해져요.'); }
    else if (act === 'copy-train') { copyText(trainingText() || '// 아직 모인 피드백이 없어요', '학습 자료용 내용을 복사했어요.'); }
    else if (act === 'copy-csv') { copyText(csvText(), '표(CSV) 내용을 복사했어요. 스프레드시트에 붙여넣으세요.'); }
    else if (act === 'clear-fb') { STORE.remove(KEY.feedback); STORE.remove(KEY.unanswered); editorMsg = { text: '피드백과 못 알아들은 질문을 비웠어요.', bad: false }; renderEditor(); if (state.explain) renderExplain(); }
    else if (act === 'change-pw') {
      var p1 = $('newPw').value, p2 = $('newPw2').value;
      if (p1.length < 4) { editorMsg = { text: '비밀번호는 4자 이상이어야 해요.', bad: true }; renderEditor(); return; }
      if (p1 !== p2) { editorMsg = { text: '두 칸의 비밀번호가 서로 달라요.', bad: true }; renderEditor(); return; }
      settings.passHash = STORE.sha256(p1);
      settingsChanged('비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요.');
    }
    else if (act === 'copy-settings') { copyText(JSON.stringify(settingsBundle(), null, 1), '설정 코드를 복사했어요.'); }
    else if (act === 'apply-settings') {
      var text = $('settingsCode').value, parsed = null;
      try { parsed = JSON.parse(text.replace(/^\s*var\s+saved\s*=\s*/, '').replace(/;\s*$/, '')); } catch (err) { parsed = null; }
      if (!parsed) { editorMsg = { text: '적용하지 못했어요. 복사한 설정 코드 전체를 그대로 붙여넣었는지 확인하세요.', bad: true }; renderEditor(); $('settingsCode').value = text; return; }
      var problem = applySaved(parsed);
      settingsChanged(problem ? '자리 배정은 적용하지 못했어요. ' + problem : '설정 코드를 적용했어요.', !!problem);
    }
    else if (act === 'reset-all') {
      [KEY.settings, KEY.stats, KEY.feedback, KEY.unanswered, KEY.hideAdmin].forEach(STORE.remove);
      applyAssignment(DEFAULT_ASSIGN);
      settings = { visitors: DATA.settings.visitors, manual: {}, passHash: DATA.settings.adminPasswordHash };
      applySaved(DATA.saved || {});
      stats = { search: {} };
      applyHideSetting();
      editorMsg = { text: '이 브라우저에 저장된 설정을 모두 지웠어요. data.js 의 값으로 돌아갔어요.', bad: false };
      $('tempFlag').hidden = !!DATA.assignment.confirmed; hideDetail(); map.refresh(); applyCrowd(); renderEditor();
    }
  });
  $('editor').addEventListener('change', function (e) {
    var t = e.target, A = DATA.assignment;
    if (!isAdmin()) return;
    if (t.id === 'confirmChk') { A.confirmed = t.checked; settingsChanged(t.checked ? '배정을 확정으로 표시했어요.' : '임시 배정으로 표시했어요.'); return; }
    if (t.id === 'hideChk') { STORE.set(KEY.hideAdmin, t.checked); applyHideSetting(); return; }
    if (t.id === 'visNum' || t.id === 'visRange') { settings.visitors = clampVisitors(t.value); settingsChanged('방문 인원수를 ' + settings.visitors + '명으로 바꿨어요.'); return; }
    if (t.dataset.manual) {
      var id = t.dataset.manual, raw = t.value.trim();
      if (raw === '') { delete settings.manual[id]; settingsChanged(bot.teamById[id].name + ' 팀의 인기도를 자동으로 돌렸어요.'); }
      else { settings.manual[id] = Math.max(0, Math.min(100, Math.round(Number(raw) || 0))); settingsChanged(bot.teamById[id].name + ' 팀의 인기도를 ' + settings.manual[id] + '(으)로 정했어요.'); }
      return;
    }
    if (!t.dataset.slot) return;
    // 고른 팀이 원래 있던 자리를 찾아서, 두 자리의 팀을 맞바꾼다
    var slot = t.dataset.slot.split('.'), group = slot[0], key = slot[1], chosen = t.value, before = A[group][key];
    if (chosen === before) return;
    (group === 'exhibit' ? ['exhibit'] : ['part1', 'part2']).forEach(function (g) {
      Object.keys(A[g]).forEach(function (k) { if (A[g][k] === chosen) A[g][k] = before; });
    });
    A[group][key] = chosen;
    settingsChanged(bot.teamById[chosen].name + ' 팀과 ' + bot.teamById[before].name + ' 팀의 자리를 바꿨어요.');
  });
  // 슬라이더를 끄는 동안에도 모형 수가 바로 바뀌게
  $('editor').addEventListener('input', function (e) {
    if (e.target.id !== 'visRange' || !isAdmin()) return;
    settings.visitors = clampVisitors(e.target.value);
    $('visNum').value = settings.visitors;
    applyCrowd();
  });

  // ---------- 작동 원리 ----------
  function setExplain(on) {
    state.explain = on;
    $('explain').hidden = !on;
    $('explainBtn').setAttribute('aria-pressed', String(on));
    if (on) renderExplain();
    scrollDown();
  }
  $('explainBtn').addEventListener('click', function () { setExplain(!state.explain); });

  function layerHtml(values, cols) {
    var max = 0;
    values.forEach(function (v) { if (v > max) max = v; });
    return '<div class="layer" style="grid-template-columns:repeat(' + cols + ',1fr)">' + values.map(function (v) {
      return '<i style="opacity:' + (0.07 + 0.93 * (max ? v / max : 0)).toFixed(2) + '"></i>';
    }).join('') + '</div>';
  }
  function renderExplain() {
    var el = $('explain'), d = state.lastDebug, m = bot.model, meta = m.meta || {};
    var foot = '<div class="foot"><span>어휘 ' + m.V.toLocaleString() + '개 · 은닉층 ' + m.H1 + '→' + m.H2 + ' · 의도 ' + m.K + '개 · 학습 문장 ' + (meta.samples || 0).toLocaleString() + '개</span>' +
      '<span>못 알아들은 질문 ' + readLog().length + '개 (관리자 창에서 확인)</span></div>';
    if (!d) { el.innerHTML = '<p class="empty">질문을 하나 보내면, 신경망이 그 문장을 어떻게 이해했는지 단계별로 보여 줘요.</p>' + foot; return; }

    // 1) 개체를 기호로 바꾼 문장
    var ents = d.entities.slice(), sent = '';
    Array.prototype.forEach.call(d.masked, function (ch) {
      var type = ch === NLP.PH.T ? 'T' : ch === NLP.PH.F ? 'F' : ch === NLP.PH.G ? 'G' : null;
      if (type) { var e = ents.shift(); sent += '<span class="ent ' + type + '">' + esc(e ? e.name : '') + (e && e.fuzzy ? ' (오타 보정)' : '') + '</span>'; }
      else sent += esc(ch);
    });
    var typeName = { T: '팀', F: '진로 분야', G: '주제' };
    var entText = d.entities.length ? d.entities.map(function (e) { return typeName[e.type] + ' "' + esc(e.text) + '"'; }).join(', ') + ' 을(를) 찾아 기호로 바꿨어요.' : '팀 이름이나 주제어는 없었어요.';

    var changed = d.raw[0].intent !== d.ranked[0].intent;
    var bars = d.ranked.map(function (r, i) {
      return '<div class="bar' + (i === 0 ? ' win' : '') + '"><span class="name">' + (INTENT_LABEL[r.intent] || r.intent) + '</span><span class="track"><span class="fill" style="width:' + (r.p * 100).toFixed(1) + '%"></span></span><span class="pct">' + (r.p * 100).toFixed(1) + '%</span></div>';
    }).join('');

    var pct = (d.confidence * 100).toFixed(0), why;
    if (d.reason === 'dnn') why = '확신도 ' + pct + '%로 기준(42%)을 넘어서 이 의도로 답했어요.';
    else if (d.reason === 'entity-only') why = '이름만 입력해서, 그 대상을 소개하는 답을 골랐어요.';
    else if (d.reason === 'low-confidence+entity') why = '확신도는 ' + pct + '%로 낮지만 이름을 찾았기 때문에, 그 대상을 소개하는 답을 골랐어요.';
    else if (d.reason === 'empty') why = '읽을 수 있는 글자가 없었어요.';
    else why = '확신도 ' + pct + '%, 아는 조각 ' + (d.coverage * 100).toFixed(0) + '%로 기준에 못 미쳐서 "배우지 않은 질문"으로 처리했어요.';

    el.innerHTML =
      '<h3><b>1</b>개체 찾기 <span>' + entText + '</span></h3><div class="sentence">' + (sent || '(빈 문장)') + '</div>' +
      '<h3><b>2</b>글자 조각으로 쪼개기 <span>조각 ' + d.gramCount + '개 중 ' + Math.round(d.coverage * d.gramCount) + '개가 학습 때 본 조각</span></h3>' +
      '<div class="grams">' + d.gramList.map(function (g) { return '<span class="' + (g.known ? '' : 'unk') + '">' + esc(g.g) + '</span>'; }).join('') + '</div>' +
      '<h3><b>3</b>신경망 계산 <span>칸이 진할수록 강하게 반응한 뉴런</span></h3>' +
      layerHtml(d.hidden1, 32) + layerHtml(d.hidden2, 32) +
      '<h3><b>4</b>의도별 확률 <span>' + (changed ? '개체 보정으로 1위가 바뀌었어요' : '상위 5개') + '</span></h3><div class="bars">' + bars + '</div>' +
      '<h3><b>5</b>결정</h3><div class="verdict"><b>' + (INTENT_LABEL[d.chosen] || d.chosen) + '</b> · ' + why + '</div>' + foot;
  }

  // ---------- 첫 화면과 자동 초기화 ----------
  var splash = $('splash');
  function showSplash() {
    splash.classList.remove('gone');
    if (map) map.setAutoRotate(true);
  }
  function hideSplash() {
    splash.classList.add('gone');
    map.setAutoRotate(false);
    map.overview();
    armIdle();
  }
  function resetAll() {
    stopTour(); closeSheet(); closeLogin(); hideDetail(); setRoute(false);
    $('lightbox').hidden = true;
    logout();   // 자리를 비운 사이에 다른 사람이 관리자 창을 쓰지 못하게
    state.lastDebug = null;
    if (state.explain) renderExplain();
    greet();
    map.overview();
    $('q').value = '';
    showSplash();
  }
  function armIdle() {
    clearTimeout(state.idleTimer);
    if (!IDLE_RESET_MS) return;
    state.idleTimer = setTimeout(function () {
      if (!splash.classList.contains('gone')) return;
      if (state.tour) { armIdle(); return; }   // 투어가 도는 동안에는 초기화하지 않음
      resetAll();
    }, IDLE_RESET_MS);
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, armIdle, { passive: true });
  });
  $('startBtn').addEventListener('click', function () { hideSplash(); setTimeout(function () { $('q').focus(); }, 400); });
  $('resetBtn').addEventListener('click', resetAll);

  // ---------- 시작 ----------
  function start() {
    var e = DATA.event;
    $('eventLine').textContent = e.title + ' · ' + e.dateText + ' · ' + e.place;
    $('splashLine').textContent = e.dateText + ' ' + e.timeText + ' · ' + e.place;
    $('tempFlag').hidden = !!DATA.assignment.confirmed;
    applyHideSetting();
    buildPartSeg();
    buildLegend();

    map = window.CODEON_MAP.create($('map'), DATA, {
      onSelect: function (id) {
        stopTour();
        if (!id) { hideDetail(); map.clear(); return; }
        setRoute(false);
        map.focus([id]); showDetail(id);
        var team = teamOfZone(id);
        if (team) countSearch(team.id);
      },
      onFox: function () {
        if (!splash.classList.contains('gone')) return;
        // 숨은 기능: 3초 안에 여우를 3번 누르면 여우가 하소연한다
        var now = Date.now();
        foxClicks = foxClicks.filter(function (t) { return now - t < 3000; });
        foxClicks.push(now);
        if (foxClicks.length >= 3) {
          foxClicks = [];
          addBot('그만 건드려... 지금 이걸 만드는 부기장은 몇 시에 잘 수 있을까... 살려줘');
          foxScare();
        } else if (foxClicks.length === 1) {
          addBot('저를 찾았네요! 저는 코드온 마스코트 여우예요. 궁금한 부스가 있으면 물어보세요.', ['추천해줘', '코드온이 뭐야?']);
        }
      },
      onUserMove: function () { $('hint').hidden = true; if (state.tour) stopTour(); }
    });
    setPart(1);
    autoPart(); setInterval(autoPart, 20000);
    applyCrowd();
    greet();
    map.setAutoRotate(true);
    window.CODEON_APP = { map: map, bot: bot, send: send, state: state, settings: function () { return settings; }, popularity: popularity };
  }

  // 3D 안의 글자(칠판, 좌석 번호)에 글꼴이 적용되도록, 글꼴을 먼저 불러온 뒤 시작한다
  var started = false;
  function once() { if (!started) { started = true; start(); } }
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('700 20px Pretendard'), document.fonts.load('400 20px Jua')]).then(once, once);
    setTimeout(once, 1800);
  } else once();
})();
