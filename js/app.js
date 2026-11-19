/*
 * app.js — 화면 전체를 이어 주는 부분
 * ------------------------------------------------------------
 * 챗봇(chatbot.js)의 답을 채팅창에 그리고, 답에 딸린 지시(actions)를 3D 지도(map3d.js)에 전달합니다.
 * 행사 안내 창, 구역 상세 카드, 작동 원리 화면, 자동 초기화도 여기서 다룹니다.
 */
(function () {
  'use strict';
  var DATA = window.CODEON_DATA, NLP = window.CODEON_NLP, MODEL = window.CODEON_MODEL;

  // ---------- 설정 ----------
  var IDLE_RESET_MS = 120000;   // 이 시간 동안 아무도 안 만지면 첫 화면으로 돌아감 (2분)
  var TOUR_STEP_MS = 4300;      // 투어에서 한 곳에 머무는 시간
  var LOG_KEY = 'codeon.unanswered';

  var $ = function (id) { return document.getElementById(id); };
  var esc = window.CODEON_CHATBOT.esc;
  var state = { part: 1, tour: null, explain: false, lastDebug: null, idleTimer: null };

  // ---------- 자리 배정: 이 브라우저에 저장해 둔 것이 있으면 data.js 값 대신 쓴다 ----------
  var ASSIGN_KEY = 'codeon.assignment', HIDE_KEY = 'codeon.hideAssignButton';
  var BLOCKS = ['A', 'B', 'C', 'D'], WALLS = ['1', '2', '3', '4'];
  var DEFAULT_ASSIGN = JSON.parse(JSON.stringify(DATA.assignment));
  var expIds = DATA.teams.filter(function (t) { return t.type === 'exp'; }).map(function (t) { return t.id; });
  var exhIds = DATA.teams.filter(function (t) { return t.type === 'exh'; }).map(function (t) { return t.id; });

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
  function saveAssignment() {
    try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(DATA.assignment)); return true; } catch (e) { return false; }
  }
  (function loadSaved() {
    try {
      var saved = JSON.parse(localStorage.getItem(ASSIGN_KEY) || 'null');
      if (saved && !checkAssignment(saved)) applyAssignment(saved);
    } catch (e) { /* 저장된 것이 없거나 읽을 수 없으면 data.js 값을 그대로 씀 */ }
  })();

  var bot = window.CODEON_CHATBOT.create(DATA, MODEL, NLP, { getPart: function () { return state.part; } });
  var map = null;

  var INTENT_LABEL = {
    greet: '인사', thanks: '감사 인사', bye: '작별 인사', bot_who: '챗봇 정체', bot_how: '작동 원리', help: '도움말',
    event_when: '행사 시간', event_where: '행사 장소', event_what: '행사 소개', parts: '1부·2부 안내', now_part: '지금 운영 팀',
    list_experience: '체험 부스 목록', list_exhibit: '전시 목록', list_all: '전체 팀 목록',
    team_info: '팀 소개', team_where: '팀 위치', team_when: '팀 운영 시간', topic_search: '주제로 찾기', recommend: '추천',
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
  function addBot(html, chips) {
    var el = document.createElement('div');
    el.className = 'msg bot';
    el.innerHTML = '<div class="avatar" aria-hidden="true"></div><div class="bubble">' + html + '</div>';
    messages.appendChild(el);
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
      addBot(res.html, res.chips);
      busy = false;
      state.lastDebug = res.debug;
      if (state.explain) renderExplain();
      if (res.fallback) logUnanswered(text);
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
      else if (a.type === 'route') { hideDetail(); setRoute(true); }
      else if (a.type === 'tour') startTour();
      else if (a.type === 'explain') { /* 버튼(작동 원리 보기)으로 열도록 둔다 */ }
    });
  }

  messages.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('.chips') && t.tagName === 'BUTTON') { send(t.textContent); return; }
    var link = t.closest('.inline-link');
    if (link) {
      if (link.dataset.team) send(bot.teamById[link.dataset.team].name + ' 어디야?');
      else if (link.dataset.field) send(bot.careerById[link.dataset.field].name + ' 뭐야?');
    }
  });
  $('composer').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q');
    send(q.value);
    q.value = '';
  });

  // ---------- 못 알아들은 질문 기록 ----------
  function readLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
  function logUnanswered(text) {
    try {
      var list = readLog();
      list.push({ q: text, at: new Date().toISOString() });
      localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-300)));
    } catch (e) { /* 저장이 막힌 환경이면 기록하지 않음 */ }
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
    state.part = n;
    Array.prototype.forEach.call($('partSeg').children, function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.part) === n));
    });
    if (map) map.setPart(n);
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
  function showDetail(id) {
    var z = zoneDef(id);
    if (!z) { hideDetail(); return; }
    var color = map.colorOf(id), html = '', A = DATA.assignment;
    var seats = z.seats ? z.seats.join(' · ') + '번' : z.name + ' (뒷벽)';
    if (z.kind === 'exp' || z.kind === 'wall') {
      var team = z.kind === 'exp' ? bot.teamAt(id, state.part) : bot.teamById[A.exhibit[z.wall]];
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
      html = '<div class="kind">' + KIND_LABEL[z.kind] + '</div><h3>' + esc(z.name) + '</h3><p>' + esc(z.desc) + '</p><dl><dt>자리</dt><dd>' + seats + '</dd></dl>';
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
  });

  // ---------- 지도 보기 버튼 ----------
  function setRoute(on) {
    map.showRoute(on);
    document.querySelector('[data-view="route"]').setAttribute('aria-pressed', String(on));
  }
  document.querySelector('.views').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (!b) return;
    var v = b.dataset.view;
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
      stopTour(); hideDetail(); setRoute(false);
      var ids = DATA.zones.filter(function (z) { return z.kind === b.dataset.kind; }).map(function (z) { return z.id; });
      if (ids.length === 1) { map.focus(ids); showDetail(ids[0]); } else if (b.dataset.kind === 'wall') map.focus(ids); else map.highlight(ids);
    });
  }

  // ---------- 부스 투어 ----------
  function tourSteps() {
    var steps = [{ ids: ['info'], text: '입구 안내 · 여기서 도장판을 받아요' }];
    ['A', 'B', 'C', 'D'].forEach(function (id) {
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
        '<p>포토부스에서는 도장을 찍지 않아요.</p><p><button type="button" class="btn" data-zone="photo">지도에서 포토부스 보기</button></p>';
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
      closeSheet(); setRoute(false);
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
    var zb = t.closest('[data-zone]');
    if (zb) { closeSheet(); setRoute(false); map.focus([zb.dataset.zone]); showDetail(zb.dataset.zone); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeSheet(); } });

  // ---------- 자리 배정 바꾸기 ----------
  var editorMsg = { text: '', bad: false };
  function assignmentCode() {
    var A = DATA.assignment;
    function row(obj, keys) { return '{ ' + keys.map(function (k) { return k + ": '" + obj[k] + "'"; }).join(', ') + ' }'; }
    return '  var assignment = {\n    confirmed: ' + !!A.confirmed + ',\n    part1: ' + row(A.part1, BLOCKS) + ',\n    part2: ' + row(A.part2, BLOCKS) +
      ',\n    exhibit: ' + row(A.exhibit, WALLS) + '\n  };';
  }
  // 붙여넣은 코드(또는 JSON)에서 배정을 읽어 낸다
  function parseAssignmentCode(text) {
    function section(name) {
      var m = text.match(new RegExp('["\']?' + name + '["\']?\\s*:\\s*\\{([^}]*)\\}'));
      if (!m) return null;
      var out = {}, re = /["']?(\w+)["']?\s*:\s*["'](\w+)["']/g, p;
      while ((p = re.exec(m[1]))) out[p[1]] = p[2];
      return out;
    }
    var c = text.match(/["']?confirmed["']?\s*:\s*(true|false)/);
    return { confirmed: c ? c[1] === 'true' : false, part1: section('part1'), part2: section('part2'), exhibit: section('exhibit') };
  }
  function selectHtml(slot, ids, current) {
    return '<select data-slot="' + slot + '" aria-label="' + slot + '">' + ids.map(function (id) {
      var t = bot.teamById[id];
      return '<option value="' + id + '"' + (id === current ? ' selected' : '') + '>' + esc(t.name) + ' · ' + esc(t.topic.length > 16 ? t.topic.slice(0, 16) + '…' : t.topic) + '</option>';
    }).join('') + '</select>';
  }
  function renderEditor() {
    var A = DATA.assignment, hidden = false;
    try { hidden = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* 무시 */ }
    var rows = BLOCKS.map(function (b) {
      var z = bot.zoneById[b];
      return '<tr><td class="zone"><i style="background:' + window.CODEON_MAP.COLORS.exp.css + '"></i>' + esc(z.name) + '</td><td class="seat">' + z.seats.join(' · ') + '번</td>' +
        '<td class="' + (state.part === 1 ? 'now' : '') + '">' + selectHtml('part1.' + b, expIds, A.part1[b]) + '</td>' +
        '<td class="' + (state.part === 2 ? 'now' : '') + '">' + selectHtml('part2.' + b, expIds, A.part2[b]) + '</td></tr>';
    }).join('');
    var walls = ['4', '3', '2', '1'].map(function (w) {
      return '<label>전시 ' + w + selectHtml('exhibit.' + w, exhIds, A.exhibit[w]) + '</label>';
    }).join('');
    $('editorContent').innerHTML =
      '<p>팀을 고르면 원래 그 자리에 있던 팀과 서로 자리가 바뀌어요. 바꾸는 즉시 지도와 챗봇 답에 반영돼요.</p>' +
      '<h3>체험형 자리</h3><table class="assign"><thead><tr><th>구역</th><th>좌석</th><th>1부 (' + DATA.parts[0].time + ')</th><th>2부 (' + DATA.parts[1].time + ')</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3>뒷벽 전시</h3><div class="wall-row">' + walls + '</div><p class="wall-hint">뒷벽을 바라봤을 때가 아니라, 배치도(칠판이 위쪽)에서 왼쪽부터 순서예요.</p>' +
      '<label class="check"><input type="checkbox" id="confirmChk"' + (A.confirmed ? ' checked' : '') + '>배정 확정 <small>화면과 챗봇 답에서 "임시 배정" 표시를 없애요</small></label>' +
      '<h3>다른 컴퓨터로 옮기기</h3><p>바꾼 내용은 이 컴퓨터의 이 브라우저에만 저장돼요. 다른 컴퓨터에서도 쓰려면 아래 코드를 복사해서, 그 컴퓨터의 이 창에 붙여넣고 "코드 적용"을 누르세요. js/data.js 의 assignment 부분을 이 코드로 바꿔도 돼요.</p>' +
      '<textarea class="code-box" id="assignCode" rows="6" spellcheck="false">' + esc(assignmentCode()) + '</textarea>' +
      '<div class="editor-actions"><button type="button" class="btn" data-act="copy">코드 복사</button><button type="button" class="btn" data-act="apply">코드 적용</button>' +
      '<button type="button" class="btn" data-act="reset">data.js 배정으로 되돌리기</button><span class="editor-msg' + (editorMsg.bad ? ' bad' : '') + '" role="status">' + esc(editorMsg.text) + '</span></div>' +
      '<label class="check"><input type="checkbox" id="hideChk"' + (hidden ? ' checked' : '') + '>발표회 때 "자리 배정" 버튼 숨기기 <small>숨긴 뒤에는 Ctrl + Shift + E 로 이 창을 열어요</small></label>';
  }
  function assignmentChanged(message, bad) {
    var saved = saveAssignment();
    editorMsg = { text: bad ? message : (saved ? message : message + ' (이 브라우저에는 저장하지 못했어요)'), bad: !!bad };
    $('tempFlag').hidden = !!DATA.assignment.confirmed;
    hideDetail();
    map.refresh();
    renderEditor();
  }
  function openEditor() { stopTour(); closeSheet(); editorMsg = { text: '', bad: false }; renderEditor(); $('editor').hidden = false; }
  function closeEditor() { $('editor').hidden = true; }
  function applyHideSetting() {
    var hidden = false;
    try { hidden = localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { /* 무시 */ }
    $('assignBtn').hidden = hidden;
  }
  $('assignBtn').addEventListener('click', openEditor);
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); $('editor').hidden ? openEditor() : closeEditor(); }
    else if (e.key === 'Escape') closeEditor();
  });
  $('editor').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closeEditor(); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'copy') {
      var code = assignmentCode();
      var ok = function () { editorMsg = { text: '코드를 복사했어요.', bad: false }; renderEditor(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(ok, function () { $('assignCode').select(); });
      else { $('assignCode').select(); try { document.execCommand('copy'); ok(); } catch (err) { /* 직접 복사 */ } }
    } else if (b.dataset.act === 'apply') {
      var parsed = parseAssignmentCode($('assignCode').value), problem = checkAssignment(parsed);
      if (problem) { editorMsg = { text: '적용하지 못했어요. ' + problem, bad: true }; var keep = $('assignCode').value; renderEditor(); $('assignCode').value = keep; return; }
      applyAssignment(parsed);
      assignmentChanged('코드의 배정을 적용했어요.');
    } else if (b.dataset.act === 'reset') {
      applyAssignment(DEFAULT_ASSIGN);
      try { localStorage.removeItem(ASSIGN_KEY); } catch (err) { /* 무시 */ }
      editorMsg = { text: 'data.js 에 적힌 배정으로 되돌렸어요.', bad: false };
      $('tempFlag').hidden = !!DATA.assignment.confirmed;
      hideDetail(); map.refresh(); renderEditor();
    }
  });
  $('editor').addEventListener('change', function (e) {
    var t = e.target, A = DATA.assignment;
    if (t.id === 'confirmChk') { A.confirmed = t.checked; assignmentChanged(t.checked ? '배정을 확정으로 표시했어요.' : '임시 배정으로 표시했어요.'); return; }
    if (t.id === 'hideChk') { try { localStorage.setItem(HIDE_KEY, t.checked ? '1' : '0'); } catch (err) { /* 무시 */ } applyHideSetting(); return; }
    if (!t.dataset.slot) return;
    // 고른 팀이 원래 있던 자리를 찾아서, 두 자리의 팀을 맞바꾼다
    var slot = t.dataset.slot.split('.'), group = slot[0], key = slot[1], chosen = t.value, before = A[group][key];
    if (chosen === before) return;
    var groups = group === 'exhibit' ? ['exhibit'] : ['part1', 'part2'];
    groups.forEach(function (g) {
      Object.keys(A[g]).forEach(function (k) { if (A[g][k] === chosen) A[g][k] = before; });
    });
    A[group][key] = chosen;
    assignmentChanged(bot.teamById[chosen].name + ' 팀과 ' + bot.teamById[before].name + ' 팀의 자리를 바꿨어요.');
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
      '<span>못 알아들은 질문 ' + readLog().length + '개 <button type="button" class="btn" data-log="copy">복사</button> <button type="button" class="btn" data-log="clear">비우기</button></span></div>';
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
  $('explain').addEventListener('click', function (e) {
    var b = e.target.closest('[data-log]');
    if (!b) return;
    if (b.dataset.log === 'clear') { try { localStorage.removeItem(LOG_KEY); } catch (err) { /* 무시 */ } renderExplain(); return; }
    var text = readLog().map(function (x) { return x.q; }).join('\n');
    var done = function () { b.textContent = '복사됨'; setTimeout(function () { b.textContent = '복사'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt('아래 내용을 복사하세요', text); });
    else window.prompt('아래 내용을 복사하세요', text);
  });

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
    stopTour(); closeSheet(); closeEditor(); hideDetail(); setRoute(false);
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
      },
      onFox: function () {
        if (!splash.classList.contains('gone')) return;
        addBot('저를 찾았네요! 저는 코드온 마스코트 여우예요. 궁금한 부스가 있으면 물어보세요.', ['추천해줘', '코드온이 뭐야?']);
      },
      onUserMove: function () { $('hint').hidden = true; if (state.tour) stopTour(); }
    });
    setPart(1);
    autoPart(); setInterval(autoPart, 20000);
    greet();
    map.setAutoRotate(true);
    window.CODEON_APP = { map: map, bot: bot, send: send, state: state };
  }

  // 3D 안의 글자(칠판, 좌석 번호)에 글꼴이 적용되도록, 글꼴을 먼저 불러온 뒤 시작한다
  var started = false;
  function once() { if (!started) { started = true; start(); } }
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load('700 20px Pretendard'), document.fonts.load('400 20px Jua')]).then(once, once);
    setTimeout(once, 1800);
  } else once();
})();
