/*
 * chatbot.js — 챗봇의 대화 부분
 * ------------------------------------------------------------
 * 흐름:  질문 → (nlp.js) 의도 분류 + 개체 찾기 → 이 파일에서 의도에 맞는 답 만들기
 *
 * 답은 { html, chips, actions } 모양으로 돌려줍니다.
 *   html    : 채팅창에 보일 내용
 *   chips   : 이어서 눌러 볼 추천 질문
 *   actions : 3D 지도에 시킬 일 (예: 그 팀 자리로 카메라 이동)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CODEON_CHATBOT = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var MIN_CONFIDENCE = 0.42;   // 이보다 확신이 낮으면 "잘 모르겠어요"로 답함
  var MIN_COVERAGE = 0.34;     // 질문의 글자 조각 중 아는 것이 이 비율보다 적으면 모르는 말로 봄

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function create(DATA, MODEL, NLP, options) {
    options = options || {};
    var model = NLP.loadModel(MODEL);
    var lexicon = NLP.buildLexicon(DATA);
    var vocabIndex = NLP.makeVocabIndex(model.vocab);
    var getPart = options.getPart || function () { return 1; };
    var state = { lastTeam: null, turns: 0 };

    // ---------- 자료 찾기 도우미 ----------
    var teamById = {}, zoneById = {}, careerById = {};
    DATA.teams.forEach(function (t) { teamById[t.id] = t; });
    DATA.zones.forEach(function (z) { zoneById[z.id] = z; });
    DATA.career.forEach(function (c) { careerById[c.id] = c; });
    var A = DATA.assignment;
    var tempNote = '';   // 질문을 받을 때마다 현재 배정 상태로 다시 정한다
    function updateTempNote() { tempNote = A.confirmed ? '' : ' <span class="note">자리는 임시 배정이에요.</span>'; }
    updateTempNote();

    function partLabel(n) { var p = DATA.parts[n - 1]; return p.label + '(' + p.time + ')'; }

    // 팀이 어느 부, 어느 구역에 있는지
    function placeOf(team) {
      if (team.type === 'exh') {
        for (var w in A.exhibit) if (A.exhibit[w] === team.id) return { zone: zoneById['ex' + w], part: 0 };
        return null;
      }
      for (var p = 1; p <= 2; p++) {
        var map = A['part' + p];
        for (var z in map) if (map[z] === team.id) return { zone: zoneById[z], part: p };
      }
      return null;
    }
    function teamAt(zoneId, part) {
      var id = A['part' + part][zoneId];
      return id ? teamById[id] : null;
    }
    var COLS = ['입구 쪽 줄', '가운데 줄', '선생님 자리 쪽 줄'];
    function seatWhere(zone) {
      if (zone.kind === 'wall') return '뒷벽 ' + zone.name + ' 자리';
      var seats = zone.seats, col = Math.floor(((seats[0] - 1) % 6) / 2);
      var rows = {};
      seats.forEach(function (s) { rows[Math.floor((s - 1) / 6) + 1] = 1; });
      var r = Object.keys(rows).map(Number);
      var rowText = r.length > 1 ? '앞에서 ' + r[0] + '~' + r[r.length - 1] + '번째 책상' : '앞에서 ' + r[0] + '번째 책상';
      return COLS[col] + ' ' + rowText + ' (' + seats.join('·') + '번 자리)';
    }
    function badge(team) {
      return '<span class="badge ' + team.type + '">' + (team.type === 'exp' ? '체험형' : '전시형') + '</span>';
    }
    function teamLink(team) {
      return '<button class="inline-link" data-team="' + team.id + '">' + esc(team.name) + '</button>';
    }
    function teamLine(team) {
      return '<li>' + teamLink(team) + ' <span class="dim">' + esc(team.topic) + '</span></li>';
    }
    function zonesOfKind(kind) {
      return DATA.zones.filter(function (z) { return z.kind === kind; }).map(function (z) { return z.id; });
    }
    function currentTeams() {
      var part = getPart();
      return ['A', 'B', 'C', 'D'].map(function (z) { return teamAt(z, part); }).filter(Boolean);
    }

    // ---------- 답 만들기 ----------
    function whereText(team) {
      var pl = placeOf(team);
      if (!pl) return { html: esc(team.name) + ' 팀의 자리는 아직 정해지지 않았어요.', actions: [] };
      if (team.type === 'exh') {
        return {
          html: '<b>' + esc(team.name) + '</b> 팀은 전시형이라 <b>' + seatWhere(pl.zone) + '</b>에 붙어 있어요. 1부, 2부 내내 볼 수 있어요.' + tempNote,
          actions: [{ type: 'focus', ids: [pl.zone.id] }]
        };
      }
      var now = getPart(), html = '<b>' + esc(team.name) + '</b> 팀은 <b>' + partLabel(pl.part) + '</b>에 <b>' + seatWhere(pl.zone) + '</b>에서 해요.';
      var actions = [{ type: 'focus', ids: [pl.zone.id] }];
      if (pl.part !== now) {
        var other = teamAt(pl.zone.id, now);
        html += ' 지금 화면은 ' + DATA.parts[now - 1].label + '라서 그 자리에는 ' + (other ? esc(other.name) + ' 팀이' : '다른 팀이') + ' 보여요.';
        actions.unshift({ type: 'part', part: pl.part });
        html += ' 지도를 ' + DATA.parts[pl.part - 1].label + ' 배치로 바꿔서 보여 드릴게요.';
      }
      return { html: html + tempNote, actions: actions };
    }

    function teamCard(team) {
      var w = whereText(team);
      var html = '<div class="card"><div class="card-title">' + esc(team.name) + ' ' + badge(team) + '</div>' +
        '<div class="card-topic">' + esc(team.topic) + '</div>' +
        '<p>' + esc(team.desc) + '</p>' +
        '<p class="dim">' + (team.type === 'exp' ? '체험 방법: ' : '관람 방법: ') + esc(team.how) + '</p></div>' +
        '<p>' + w.html + '</p>';
      return { html: html, actions: w.actions };
    }

    var HANDLERS = {
      greet: function () {
        return { html: '안녕하세요! 코드온 부스 안내 챗봇이에요. 부스 위치, 팀 소개, 도장 받는 법을 물어보세요.',
          chips: ['체험 부스 뭐 있어?', '도장 어떻게 받아?', '추천해줘'] };
      },
      thanks: function () {
        return { html: '도움이 됐다니 다행이에요. 더 궁금한 게 있으면 또 물어보세요.', chips: ['동선 알려줘', '포토부스 어떻게 해?'] };
      },
      bye: function () {
        return { html: '즐겁게 구경하세요! 도장을 다 모으면 출구에서 보상 받는 것 잊지 마세요.', chips: ['출구 어디야?'] };
      },
      bot_who: function () {
        var cat = teamById.cat;
        return { html: '저는 코드온 부스를 안내하는 챗봇이에요. 체험형 팀 ' + (cat ? teamLink(cat) : '고양이') + ' 팀이 만들었고, 인터넷 없이 이 컴퓨터 안에서만 돌아가요.',
          chips: ['어떻게 만들었어?', '뭘 물어볼 수 있어?'] };
      },
      bot_how: function () {
        var m = model.meta || {};
        return { html: '<p>외부 AI 서비스를 쓰지 않고, 직접 학습시킨 작은 신경망으로 답해요.</p>' +
          '<ol class="steps"><li>질문에서 팀 이름 같은 <b>개체</b>를 찾아요.</li>' +
          '<li>문장을 글자 1~3개짜리 <b>조각</b>으로 쪼개 숫자로 바꿔요.</li>' +
          '<li><b>신경망</b>(은닉층 2개)이 ' + model.K + '가지 의도 중 무엇인지 확률을 계산해요.</li>' +
          '<li>가장 확률이 높은 의도에 맞는 답을 행사 자료에서 꺼내요.</li></ol>' +
          '<p class="dim">예시 문장 ' + (m.samples || '-') + '개로 학습했고, 처음 보는 시험 질문 ' + (m.testCount || '-') + '개 중 ' + (m.testAccuracy || '-') + '%를 맞혔어요.</p>',
          chips: ['작동 원리 보기'], actions: [{ type: 'explain' }] };
      },
      help: function () {
        return { html: '이런 걸 물어볼 수 있어요.<ul><li>팀 위치와 소개: "로봇 축구 어디야?"</li><li>주제로 찾기: "게임 있어?"</li><li>도장과 보상: "도장 어떻게 받아?"</li><li>길 안내: "동선 알려줘", "투어 해줘"</li></ul>',
          chips: ['체험 부스 뭐 있어?', '전시 뭐 있어?', '진로 전시가 뭐야?', '투어 해줘'] };
      },
      event_when: function () {
        var e = DATA.event;
        return { html: '<b>' + e.dateText + ' ' + e.timeText + '</b>에 해요. 1부는 ' + DATA.parts[0].time + ', 2부는 ' + DATA.parts[1].time + '이고 2교시 쉬는 시간에 체험 팀이 교대해요.',
          chips: ['1부 2부 팀 알려줘', '지금 몇 부야?'] };
      },
      event_where: function () {
        return { html: '코드온 부스는 <b>' + DATA.event.place + '</b>에서 해요. 지금 보이는 3D 지도가 바로 그 ' + DATA.event.place + '이에요.',
          chips: ['입구 어디야?', '동선 알려줘'], actions: [{ type: 'overview' }] };
      },
      event_what: function () {
        var e = DATA.event;
        return { html: '<b>' + e.title + '</b>의 ' + e.club + ' 부스예요. ' + e.target + ' 누구나 올 수 있고, 체험형 8팀과 전시형 4팀, 진로 전시, 포토부스가 있어요.',
          chips: ['체험 부스 뭐 있어?', '도장 어떻게 받아?'] };
      },
      parts: function () {
        function list(p) {
          return ['A', 'B', 'C', 'D'].map(function (z) { var t = teamAt(z, p); return t ? teamLink(t) : ''; }).filter(Boolean).join(', ');
        }
        return { html: '체험형 8팀은 둘로 나눠서 교대해요.<ul><li><b>' + partLabel(1) + '</b>: ' + list(1) + '</li><li><b>' + partLabel(2) + '</b>: ' + list(2) + '</li></ul>전시형 4팀, 진로 전시, 포토부스는 계속 운영해요.' + tempNote,
          chips: ['지금 몇 부야?', '전시 뭐 있어?'], actions: [{ type: 'highlight', ids: ['A', 'B', 'C', 'D'] }] };
      },
      now_part: function () {
        var part = getPart();
        return { html: '지금 화면은 <b>' + partLabel(part) + '</b> 배치예요. 체험할 수 있는 팀은 이렇게 있어요.<ul>' + currentTeams().map(teamLine).join('') + '</ul>' + tempNote,
          chips: ['추천해줘', '전시 뭐 있어?'], actions: [{ type: 'highlight', ids: ['A', 'B', 'C', 'D'] }] };
      },
      list_experience: function () {
        var teams = DATA.teams.filter(function (t) { return t.type === 'exp'; });
        return { html: '체험형은 8팀이에요. 가운데와 오른쪽 초록색 자리에서 1부, 2부로 4팀씩 운영해요.<ul>' + teams.map(teamLine).join('') + '</ul>',
          chips: ['1부 2부 팀 알려줘', '추천해줘'], actions: [{ type: 'highlight', ids: ['A', 'B', 'C', 'D'] }] };
      },
      list_exhibit: function () {
        var teams = DATA.teams.filter(function (t) { return t.type === 'exh'; });
        return { html: '전시형은 4팀이고, 뒷벽 파란색 자리에 계속 붙어 있어요. 전시는 도장이 없어요.<ul>' + teams.map(teamLine).join('') + '</ul>',
          chips: ['체험 부스 뭐 있어?', '도장 어떻게 받아?'], actions: [{ type: 'focus', ids: zonesOfKind('wall') }] };
      },
      list_all: function () {
        var exp = DATA.teams.filter(function (t) { return t.type === 'exp'; });
        var exh = DATA.teams.filter(function (t) { return t.type === 'exh'; });
        return { html: '모두 12팀이에요.<p><b>체험형 8팀</b></p><ul>' + exp.map(teamLine).join('') + '</ul><p><b>전시형 4팀</b></p><ul>' + exh.map(teamLine).join('') + '</ul>여기에 진로 전시와 포토부스가 더 있어요.',
          chips: ['진로 전시가 뭐야?', '포토부스 어떻게 해?'], actions: [{ type: 'overview' }] };
      },
      team_info: function (ctx) {
        if (!ctx.team) return askWhichTeam('어느 팀이 궁금한가요?');
        var c = teamCard(ctx.team);
        return { html: c.html, actions: c.actions, chips: [ctx.team.name + ' 어디야?', '추천해줘'] };
      },
      team_where: function (ctx) {
        if (!ctx.team) return askWhichTeam('어느 팀 자리를 찾을까요?');
        var w = whereText(ctx.team);
        return { html: w.html, actions: w.actions, chips: [ctx.team.name + ' 뭐하는 팀이야?', '동선 알려줘'] };
      },
      team_when: function (ctx) {
        if (!ctx.team) return askWhichTeam('어느 팀이 언제 하는지 알려 드릴까요?');
        var t = ctx.team, pl = placeOf(t);
        if (!pl) return { html: esc(t.name) + ' 팀의 시간은 아직 정해지지 않았어요.' };
        if (t.type === 'exh') {
          return { html: '<b>' + esc(t.name) + '</b> 팀은 전시형이라 1부, 2부 내내 뒷벽에서 볼 수 있어요.' + tempNote,
            actions: [{ type: 'focus', ids: [pl.zone.id] }], chips: [t.name + ' 뭐하는 팀이야?'] };
        }
        var now = getPart();
        var html = '<b>' + esc(t.name) + '</b> 팀은 <b>' + partLabel(pl.part) + '</b>에 운영해요. ' +
          (pl.part === now ? '지금 화면의 ' + DATA.parts[now - 1].label + '에 있는 팀이에요.' : '지금 화면은 ' + DATA.parts[now - 1].label + '라서, ' + DATA.parts[pl.part - 1].label + ' 배치로 바꿔서 보여 드릴게요.');
        var actions = [{ type: 'focus', ids: [pl.zone.id] }];
        if (pl.part !== now) actions.unshift({ type: 'part', part: pl.part });
        return { html: html + tempNote, actions: actions, chips: [t.name + ' 어디야?', t.name + ' 뭐하는 팀이야?'] };
      },
      topic_search: function (ctx) {
        if (!ctx.tag) return HANDLERS.recommend(ctx);
        var teams = DATA.teams.filter(function (t) { return (t.tags || []).indexOf(ctx.tag) !== -1; });
        var fields = DATA.career.filter(function (c) {
          return (ctx.tag === '보안' && c.id === 'aisec') || (ctx.tag === 'ai' && c.id === 'aisec') ||
                 (ctx.tag === '앱' && c.id === 'app') || (ctx.tag === '하드웨어' && c.id === 'iot');
        });
        var label = ctx.tag === 'ai' ? 'AI' : ctx.tag;
        if (!teams.length && !fields.length) return { html: esc(label) + ' 관련 팀은 찾지 못했어요.', chips: ['전체 팀 알려줘'] };
        var ids = [];
        teams.forEach(function (t) { var pl = placeOf(t); if (pl) ids.push(pl.zone.id); });
        var html = '<b>' + esc(label) + '</b> 관련해서는 이런 곳이 있어요.<ul>' + teams.map(function (t) {
          var pl = placeOf(t), when = t.type === 'exh' ? '전시 · 계속' : (pl ? DATA.parts[pl.part - 1].label : '');
          return '<li>' + teamLink(t) + ' ' + badge(t) + ' <span class="dim">' + esc(t.topic) + (when ? ' · ' + when : '') + '</span></li>';
        }).join('');
        fields.forEach(function (c) {
          var z = DATA.zones.filter(function (zz) { return zz.field === c.id; })[0];
          if (z) ids.push(z.id);
          html += '<li><button class="inline-link" data-field="' + c.id + '">진로 전시 PC ' + c.pc + ' · ' + esc(c.name) + '</button></li>';
        });
        html += '</ul>이름을 누르면 자리를 보여 줘요.';
        return { html: html, actions: [{ type: 'highlight', ids: ids }], chips: teams.slice(0, 2).map(function (t) { return t.name + ' 어디야?'; }) };
      },
      recommend: function () {
        var part = getPart();
        return { html: '지금(' + DATA.parts[part - 1].label + ') 체험할 수 있는 팀이에요. 체험은 1인당 2~3분이라 4곳 모두 돌 수 있어요.<ul>' + currentTeams().map(teamLine).join('') + '</ul>관심 있는 분야를 고르면 맞는 팀을 찾아 줄게요.' + tempNote,
          chips: ['게임 있어?', '로봇 있어?', '보안 쪽 뭐 있어?', 'AI 관련 팀'], actions: [{ type: 'highlight', ids: ['A', 'B', 'C', 'D'] }] };
      },
      stamp_how: function () {
        return { html: '도장판에는 칸이 <b>' + DATA.stamp.slots + '개</b> 있어요.<ul>' + DATA.stamp.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>',
          chips: ['도장 다 모으면 뭐 줘?', '도장판 어디서 받아?'], actions: [{ type: 'highlight', ids: ['info', 'A', 'B', 'C', 'D'].concat(zonesOfKind('career')) }] };
      },
      reward: function () {
        return { html: esc(DATA.stamp.reward) + ' 포토부스를 고르면 티켓을 받아요. ' + esc(DATA.stamp.snackNote),
          chips: ['포토부스 어떻게 해?', '출구 어디야?'], actions: [{ type: 'focus', ids: ['check'] }] };
      },
      photo: function () {
        var z = zoneById.photo;
        return { html: '<b>포토부스</b>는 ' + seatWhere(z) + ' 뒤쪽이에요. ' + esc(z.desc) + ' 포토부스에서는 도장을 찍지 않아요.',
          chips: ['도장 다 모으면 뭐 줘?', '도장 어떻게 받아?'], actions: [{ type: 'focus', ids: ['photo'] }] };
      },
      career: function () {
        return { html: '<b>진로 관련 전시</b>는 입구 쪽 줄 노란색 자리의 PC 4대예요. 3가지 이상 체험하면 도장판 ⑤번 칸에 도장을 받아요.<ul>' +
          DATA.career.map(function (c) { return '<li><button class="inline-link" data-field="' + c.id + '">PC ' + c.pc + ' · ' + esc(c.name) + '</button></li>'; }).join('') + '</ul>',
          chips: ['AI 보안 뭐야?', '웹 개발 뭐야?'], actions: [{ type: 'focus', ids: zonesOfKind('career') }] };
      },
      field_info: function (ctx) {
        if (!ctx.field) return HANDLERS.career(ctx);
        var c = ctx.field, z = DATA.zones.filter(function (zz) { return zz.field === c.id; })[0];
        return { html: '<div class="card"><div class="card-title">진로 전시 PC ' + c.pc + ' · ' + esc(c.name) + '</div><p><b>목표</b> ' + esc(c.goal) + '</p><p><b>체험 방법</b> ' + esc(c.how) + '</p></div>' +
          (z ? '<p>자리는 ' + seatWhere(z) + '예요.' + tempNote + '</p>' : ''),
          chips: ['진로 전시가 뭐야?', '도장 어떻게 받아?'], actions: z ? [{ type: 'focus', ids: [z.id] }] : [] };
      },
      where_entrance: function () {
        var z = zoneById.info;
        return { html: '<b>입구</b>는 칠판을 바라보고 왼쪽 앞문이에요. 들어오면 바로 앞 ' + z.seats.join('·') + '번 자리에서 도장판을 1인당 1장 받아요.',
          chips: ['도장 어떻게 받아?', '동선 알려줘'], actions: [{ type: 'focus', ids: ['info'] }] };
      },
      where_exit: function () {
        var z = zoneById.check;
        return { html: '<b>출구</b>는 뒤쪽 왼쪽 문이에요. 나가기 전에 ' + z.seats.join('·') + '번 자리에서 도장을 확인받고 포토부스 티켓이나 간식을 받아요.',
          chips: ['도장 다 모으면 뭐 줘?', '포토부스 어떻게 해?'], actions: [{ type: 'focus', ids: ['check'] }] };
      },
      route: function () {
        return { html: '이 순서로 돌면 돼요. 지도에 길을 표시할게요.<ol class="steps"><li>입구에서 도장판 받기</li><li>체험형 부스 4곳 체험하고 도장 받기</li><li>진로 전시 PC 3가지 이상 체험하고 도장 받기</li><li>뒷벽 전시 구경하기</li><li>출구에서 도장 확인받고 보상 고르기</li></ol>',
          chips: ['투어 해줘', '도장 어떻게 받아?'], actions: [{ type: 'route' }] };
      },
      tour: function () {
        return { html: '부스를 하나씩 보여 드릴게요. 지도를 만지면 멈춰요.', actions: [{ type: 'tour' }], chips: ['전체 지도 보여줘'] };
      },
      map_show: function () {
        return { html: '컴퓨터실 전체를 보여 드릴게요. 책상을 누르면 그 자리 설명이 나와요.', actions: [{ type: 'overview' }], chips: ['동선 알려줘', '투어 해줘'] };
      },
      wait: function () {
        return { html: esc(DATA.stamp.playTime) + ' 안이 붐비면 입구에서 조금씩 끊어서 들여보내요. 전시는 기다리지 않고 볼 수 있어요.',
          chips: ['추천해줘', '전시 뭐 있어?'] };
      },
      club_about: function () {
        var e = DATA.event;
        return { html: '<b>' + e.club + '(' + e.clubEn + ')</b>은 코딩 동아리예요. 부원은 ' + e.members + '명이고, 이번 발표회에는 직접 만든 프로젝트 12개(체험형 8, 전시형 4)를 가지고 나왔어요. 노트북을 하는 여우가 마스코트예요.',
          chips: ['전체 팀 알려줘', '어떻게 가입해?'] };
      },
      club_join: function () {
        return { html: '가입 방법은 제가 가진 자료에 없어요. 부스에 있는 코드온 부원에게 직접 물어보면 알려 줄 거예요.', chips: ['코드온이 뭐야?'] };
      },
      outside: function () {
        return { html: '저는 이 컴퓨터실 안만 안내할 수 있어요. 컴퓨터실 밖 장소는 입구에 있는 안내 담당에게 물어보세요.',
          chips: ['입구 어디야?', '전체 지도 보여줘'] };
      },
      chitchat: function () {
        var lines = ['고마워요! 부스 이야기라면 더 잘할 수 있어요.', '저는 부스 안내 말고는 잘 못해요. 궁금한 팀이 있나요?', '재밌게 보고 있나요? 아직 안 가 본 부스를 찾아 줄게요.'];
        return { html: lines[state.turns % lines.length], chips: ['추천해줘', '뭘 물어볼 수 있어?'] };
      },
      oos: function () { return fallback(); }
    };

    function askWhichTeam(question) {
      return { html: question, chips: currentTeams().map(function (t) { return t.name; }).slice(0, 4) };
    }
    function fallback() {
      return { html: '그건 제가 배우지 않은 내용이에요. 저는 코드온 부스 안내만 할 수 있어요.',
        chips: ['뭘 물어볼 수 있어?', '체험 부스 뭐 있어?', '도장 어떻게 받아?'], fallback: true };
    }

    var PRONOUN = /(거기|그팀|그 팀|그거|그 부스|그부스|걔네|그곳|그 전시)/;

    // ---------- 질문 하나 처리 ----------
    function ask(text) {
      state.turns++;
      updateTempNote();
      var raw = String(text || '').trim();
      // "거기 어디야?"처럼 앞에서 말한 팀을 가리키면, 그 팀 이름으로 바꿔서 이해한다
      var usesContext = !!(PRONOUN.test(raw) && state.lastTeam);
      var understood = usesContext ? raw.replace(PRONOUN, state.lastTeam.name + ' ') : raw;
      var r = NLP.classify(understood, model, lexicon, vocabIndex, {});
      var ents = r.analysis.entities;
      var teamEnt = ents.filter(function (e) { return e.type === 'T'; })[0];
      var fieldEnt = ents.filter(function (e) { return e.type === 'F'; })[0];
      var tagEnt = ents.filter(function (e) { return e.type === 'G'; })[0];

      var top = r.ranked[0], intent = top.intent, reason = 'dnn';
      var onlyEntity = r.analysis.masked.replace(/[ⓉⒻⒼ]/g, '').length <= 1 && ents.length > 0;

      if (!r.analysis.masked) { intent = 'oos'; reason = 'empty'; }
      else if (onlyEntity) {
        // 팀 이름만 입력한 경우: 소개를 보여 준다
        intent = teamEnt ? 'team_info' : (fieldEnt ? 'field_info' : 'topic_search'); reason = 'entity-only';
      } else if (top.p < MIN_CONFIDENCE || r.feat.coverage < MIN_COVERAGE) {
        if (teamEnt) { intent = 'team_info'; reason = 'low-confidence+entity'; }
        else if (fieldEnt) { intent = 'field_info'; reason = 'low-confidence+entity'; }
        else if (tagEnt) { intent = 'topic_search'; reason = 'low-confidence+entity'; }
        else { intent = 'oos'; reason = 'low-confidence'; }
      }

      var ctx = {
        team: teamEnt ? teamById[teamEnt.id] : null,
        field: fieldEnt ? careerById[fieldEnt.id] : null,
        tag: tagEnt ? tagEnt.id : null
      };
      // 팀을 물었는데 그 의도가 팀이 필요 없는 것이면, 팀 소개가 더 알맞은 답이다
      var res = (HANDLERS[intent] || HANDLERS.oos)(ctx);
      if (ctx.team && /^team_/.test(intent)) state.lastTeam = ctx.team;
      if (intent === 'oos') res.fallback = true;

      res.intent = intent;
      res.debug = {
        input: raw, understood: understood, cleaned: r.analysis.cleaned, masked: r.analysis.masked,
        entities: ents.map(function (e) {
          var name = e.type === 'T' ? teamById[e.id].name : (e.type === 'F' ? careerById[e.id].name : e.id);
          return { type: e.type, text: e.text, name: name, fuzzy: e.fuzzy };
        }),
        gramCount: r.feat.grams.length, knownCount: r.feat.idx.length, coverage: r.feat.coverage,
        gramList: (function () {
          var seen = {}, list = [];
          r.feat.grams.forEach(function (g) {
            if (g.length < 2 || seen[g] || list.length >= 26) return;
            seen[g] = 1; list.push({ g: g, known: vocabIndex[g] !== undefined });
          });
          return list;
        })(),
        raw: r.raw.slice(0, 5), ranked: r.ranked.slice(0, 5),
        hidden1: Array.from(r.hidden1), hidden2: Array.from(r.hidden2),
        chosen: intent, reason: reason, confidence: top.p
      };
      return res;
    }

    return {
      ask: ask, state: state, model: model,
      teamById: teamById, zoneById: zoneById, careerById: careerById,
      placeOf: placeOf, teamAt: teamAt, seatWhere: seatWhere, partLabel: partLabel,
      teamCard: teamCard, fieldAnswer: function (id) { return HANDLERS.field_info({ field: careerById[id] }); }
    };
  }

  return { create: create, esc: esc };
});
