/*
 * data.js — 행사, 좌석, 팀 정보
 * ------------------------------------------------------------
 * 이 파일만 고치면 지도와 챗봇 답변이 함께 바뀝니다.
 * 고친 뒤 브라우저에서 새로고침(F5)만 하면 됩니다. (다시 학습할 필요 없음)
 * 단, 팀의 "aliases(다르게 부르는 이름)"를 고쳤다면 node train.js 를 한 번 실행하세요.
 */
(function (root, factory) {
  var data = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.CODEON_DATA = data;
})(typeof self !== 'undefined' ? self : this, function () {

  var event = {
    title: '2026학년도 동아리 발표회',
    club: '코드온',
    clubEn: 'CODE:ON',
    date: '2026-12-24',               // 자동 1부/2부 전환에 쓰는 날짜
    dateText: '2026년 12월 24일(목)',
    timeText: '1교시 ~ 4교시',
    place: '컴퓨터실',
    target: '전교생',
    members: 26,
    // 2교시 쉬는 시간(교대 시각)을 "10:30" 처럼 적으면 행사 당일에 1부→2부가 자동으로 바뀝니다.
    // null 이면 화면의 1부/2부 버튼으로만 바뀝니다.
    partSwitchTime: null
  };

  var parts = [
    { id: 1, label: '1부', time: '1~2교시' },
    { id: 2, label: '2부', time: '3~4교시' }
  ];

  /*
   * 좌석 구역 (컴퓨터실 배치도 기준, 좌석 번호는 배치도와 같음)
   * kind: info(입구 안내) / exp(체험형) / career(진로 전시) / check(출구 확인) / photo(포토부스) / wall(뒷벽 전시)
   */
  var zones = [
    { id: 'info',  kind: 'info',   name: '입구 안내',   seats: [1, 2],
      short: '도장판 받는 곳',
      desc: '도장판(스탬프 용지)을 1인당 1장 받고, 관람 순서와 동선을 안내받는 곳이에요.' },

    { id: 'A', kind: 'exp', name: '체험 A', seats: [3, 4, 9, 10] },
    { id: 'B', kind: 'exp', name: '체험 B', seats: [5, 6, 11, 12] },
    { id: 'C', kind: 'exp', name: '체험 C', seats: [15, 16, 21, 22] },
    { id: 'D', kind: 'exp', name: '체험 D', seats: [17, 18, 23, 24] },

    { id: 'pc1', kind: 'career', name: '진로 전시 PC 1', seats: [7, 8],   field: 'web' },
    { id: 'pc2', kind: 'career', name: '진로 전시 PC 2', seats: [13, 14], field: 'iot' },
    { id: 'pc3', kind: 'career', name: '진로 전시 PC 3', seats: [19, 20], field: 'aisec' },
    { id: 'pc4', kind: 'career', name: '진로 전시 PC 4', seats: [25, 26], field: 'app' },

    { id: 'check', kind: 'check', name: '출구 확인', seats: [31, 32],   // 출구 문 바로 옆 (왼쪽 뒤)
      short: '도장 확인 · 보상 받는 곳',
      desc: '도장 개수를 확인하고, 다 모았으면 학교 동아리 도장을 찍어 줘요. 포토부스 티켓이나 간식 중 하나를 고를 수 있어요.' },

    { id: 'photo', kind: 'photo', name: '포토부스', seats: [35, 36],
      short: '네 컷 사진 찍는 곳',
      desc: '인생네컷처럼 네 컷 사진을 찍는 곳이에요. 출구에서 티켓을 받은 사람만 찍을 수 있고, 사진은 나중에 인화해서 나눠 줘요.' },

    { id: 'ex1', kind: 'wall', name: '전시 1', wall: 1 },
    { id: 'ex2', kind: 'wall', name: '전시 2', wall: 2 },
    { id: 'ex3', kind: 'wall', name: '전시 3', wall: 3 },
    { id: 'ex4', kind: 'wall', name: '전시 4', wall: 4 }
  ];

  /*
   * 팀 목록 (계획서 "코드온 팀 프로젝트 리스트" 기준)
   * desc / how 는 주제만 보고 적은 임시 문구입니다. 각 팀에게 받아서 고쳐 주세요.
   * aliases: 사람들이 이 팀을 부를 만한 말 (띄어쓰기 없이, 소문자로)
   * tags: 주제 묶음 ("게임 있어?" 같은 질문에 쓰임)
   */
  var teams = [
    { id: 'mokaji', name: '목아지', type: 'exp', topic: '게임 만들기',
      desc: '팀이 직접 만든 게임을 해 볼 수 있는 부스예요.',
      how: '자리에 앉아 게임을 한 판 해 보세요.',
      aliases: ['목아지', '모가지', '게임만들기'], tags: ['게임'] },

    { id: 'joyeonguk', name: '조영욱 엔터테인먼트', type: 'exp', topic: '주가 예측 AI',
      desc: '인공지능으로 주가를 예측해 보는 프로젝트예요.',
      how: 'AI가 내놓는 예측 결과를 직접 확인해 보세요.',
      aliases: ['조영욱엔터테인먼트', '조영욱엔터', '조영욱', '주가예측ai', '주가예측', '주가', '주식'], tags: ['ai'] },

    { id: 'chidonggo', name: '치동고 인재들', type: 'exp', topic: '자동문 쓰레기통',
      desc: '다가가면 뚜껑이 자동으로 열리는 쓰레기통을 만든 팀이에요.',
      how: '쓰레기통에 손을 가까이 대서 뚜껑이 열리는지 확인해 보세요.',
      aliases: ['치동고인재들', '치동고인재', '인재들', '자동문쓰레기통', '쓰레기통', '자동문'], tags: ['하드웨어'] },

    { id: 'chidongfc', name: '치동fc', type: 'exp', topic: '로봇 축구',
      desc: '로봇으로 축구를 하는 프로젝트예요.',
      how: '로봇을 조종해서 골을 넣어 보세요.',
      aliases: ['치동fc', '치동에프씨', '로봇축구', '축구'], tags: ['로봇', '하드웨어'] },

    { id: 'ctrlcook', name: 'ctrl+cook', type: 'exp', topic: '스마트 샐러드 조리기',
      desc: '샐러드 조리를 도와주는 스마트 조리기를 만든 팀이에요.',
      how: '조리기가 어떻게 움직이는지 직접 작동시켜 보세요.',
      aliases: ['ctrl+cook', 'ctrlcook', '컨트롤쿡', '컨트롤+쿡', '컨트롤쿠크', '샐러드조리기', '스마트샐러드', '샐러드', '조리기'], tags: ['하드웨어'] },

    { id: 'udangtang', name: '우당탕 개발사', type: 'exp', topic: '1인칭 사격장(점수 랭크) 게임',
      desc: '1인칭 시점으로 과녁을 맞히고 점수 순위를 겨루는 사격장 게임이에요.',
      how: '제한 시간 동안 과녁을 맞혀 점수 순위에 도전해 보세요.',
      aliases: ['우당탕개발사', '우당탕', '사격장게임', '사격장', '사격게임', '사격', '1인칭사격', 'fps', '슈팅게임', '총게임'], tags: ['게임'] },

    { id: 'nurungji', name: '누룽지', type: 'exp', topic: 'C언어 가상 로그인 환경의 오버플로우 취약점 분석 · 시큐어 코딩 가이드',
      desc: 'C언어로 만든 가상 로그인 화면에서 오버플로우 취약점이 어떻게 생기는지 보여 주고, 안전하게 코딩하는 방법을 안내해요.',
      how: '가상 로그인 화면에 입력을 넣어 보며 취약점이 드러나는 과정을 따라가 보세요.',
      aliases: ['누룽지', '오버플로우취약점', '버퍼오버플로우', '오버플로우', '오버플로', '시큐어코딩', '취약점분석', '취약점', 'c언어', '가상로그인'], tags: ['보안'] },

    { id: 'cat', name: '고양이', type: 'exp', topic: '자연어 처리(NLP) · 심층 신경망(DNN) 기반 독립형 동아리 안내 챗봇',
      desc: '지금 이 화면의 안내 챗봇을 만든 팀이에요. 인터넷 없이, 직접 학습시킨 신경망이 질문의 뜻을 알아듣고 답해요.',
      how: '챗봇에게 부스 위치나 도장 받는 법을 물어보세요. "작동 원리"를 켜면 신경망이 질문을 어떻게 이해했는지 볼 수 있어요.',
      aliases: ['고양이', '안내챗봇', '동아리안내챗봇', '챗봇'], tags: ['ai'] },

    { id: 'lol', name: '리그오브레전드', type: 'exh', topic: '게임 데이터 분석을 통한 승률과 플레이 스타일 탐구',
      desc: '게임 데이터를 분석해서 승률과 플레이 스타일 사이의 관계를 탐구한 전시예요.',
      how: '뒷벽에 붙은 전시물을 자유롭게 읽어 보세요.',
      aliases: ['리그오브레전드', '리그오브레전드팀', '롤', 'lol', '승률', '플레이스타일', '게임데이터'], tags: ['게임', '데이터'] },

    { id: 'medical', name: 'Medical Guide', type: 'exh', topic: '환자 맞춤형 복약 가이드 · 성분 충돌 방지 검색 앱',
      desc: '환자에게 맞는 복약 방법을 안내하고, 함께 먹으면 안 되는 성분을 검색해 주는 앱을 소개하는 전시예요.',
      how: '뒷벽에 붙은 전시물을 자유롭게 읽어 보세요.',
      aliases: ['medicalguide', 'medical', '메디컬가이드', '메디칼가이드', '메디컬', '복약가이드', '복약', '성분충돌', '약검색'], tags: ['앱'] },

    { id: 'ttobot', name: '또봇', type: 'exh', topic: '피지컬 컴퓨팅을 이용한 로봇 만들기',
      desc: '피지컬 컴퓨팅으로 로봇을 만든 과정을 소개하는 전시예요.',
      how: '뒷벽에 붙은 전시물을 자유롭게 읽어 보세요.',
      aliases: ['또봇', '피지컬컴퓨팅', '로봇만들기'], tags: ['로봇', '하드웨어'] },

    { id: 'j', name: 'J', type: 'exh', topic: '비밀번호 강도 측정 툴',
      desc: '비밀번호가 얼마나 안전한지 측정해 주는 도구를 소개하는 전시예요.',
      how: '뒷벽에 붙은 전시물을 자유롭게 읽어 보세요.',
      aliases: ['j', '제이', '비밀번호강도', '비밀번호', '비번', '패스워드'], tags: ['보안'] }
  ];

  /*
   * 팀별 자리 배정
   * confirmed 를 true 로 바꾸면 화면의 "임시 배정" 표시가 사라집니다.
   * part1 / part2: 체험 구역(A~D)에 앉는 팀 id
   * exhibit: 뒷벽 전시 1~4번에 붙는 팀 id
   */
  var assignment = {
    confirmed: false,
    part1: { A: 'mokaji',   B: 'joyeonguk', C: 'chidonggo', D: 'chidongfc' },
    part2: { A: 'ctrlcook', B: 'udangtang', C: 'nurungji',  D: 'cat' },
    exhibit: { 1: 'lol', 2: 'medical', 3: 'ttobot', 4: 'j' }
  };

  /*
   * 혼잡도 기준 (방문 인원수로 판단)
   *   quietBelow 명보다 적으면 "여유"  → 전부 즐기는 동선 추천
   *   busyFrom 명 이상이면 "혼잡"      → 도장만 빠르게 모으는 동선 추천
   *   그 사이는 "보통"                 → 기본 동선 추천
   * minutes: 예상 시간 계산에 쓰는 어림값(분). exp 는 계획서의 "1인당 2~3분" 기준.
   */
  var congestion = {
    quietBelow: 15,
    busyFrom: 35,
    minutes: { exp: 2.5, career: 2, wall: 1, photo: 3, inOut: 2 }
  };

  /*
   * 관리자 · 방문자 기본 설정
   * visitors: 지도에 걸어 다니는 방문자 모형 수 (동아리 방문 인원수, 0~80)
   * adminPasswordHash: 관리자 비밀번호의 SHA-256 해시. 기본 비밀번호는 codeon2026 입니다.
   *                    관리자 창 > 설정에서 바꾸세요. (비밀번호를 글자 그대로 적어 두지 않기 위해 해시로 저장)
   */
  var settings = {
    visitors: 20,
    adminPasswordHash: 'f63851b6643059304f1f35d68b6bc1de175296b13de8b854c754ab20d261dda4'
  };

  /*
   * 관리자 창 > 설정 > "설정 코드"를 복사해서 아래 null 자리에 붙여넣으면,
   * 이 파일로 여는 모든 사람(인터넷에 올렸다면 모든 방문자)에게 그 설정이 적용됩니다.
   *   예)  var saved = { "assignment": { ... }, "visitors": 30, "manual": { ... }, "passHash": "..." };
   */
  var saved = null;

  /* 진로 관련 전시 (계획서 "PC 웹/앱 내용") */
  var career = [
    { id: 'web', pc: 1, name: '웹 개발',
      goal: '눈에 보이는 화면(프론트엔드)과 보이지 않는 데이터 처리(백엔드)가 어떻게 이어지는지 이해하기',
      how: '왼쪽에서 색, 토글, 글꼴 같은 HTML/CSS 설정을 바꾸면 오른쪽 미리보기에 바로 반영돼요. 방명록을 쓰거나 좋아요를 누르면 DB 카운트가 올라가는 것도 볼 수 있어요.',
      aliases: ['웹개발', '웹', '웹사이트', '프론트엔드', '백엔드', 'html', 'css', '홈페이지만들기'] },
    { id: 'iot', pc: 2, name: '임베디드 & IoT',
      goal: '소프트웨어 코드가 하드웨어를 어떻게 움직이는지 보기',
      how: '화면 속 대시보드에서 온도, 조명, 팬 속도를 조작하면 연결된 (가상) 기기의 LED와 모터가 바로 반응해요.',
      aliases: ['임베디드', 'iot', '아이오티', '사물인터넷', '아두이노', '스마트홈'] },
    { id: 'aisec', pc: 3, name: 'AI 보안',
      goal: '인공지능을 노리는 해킹(프롬프트 인젝션)과 이를 막는 AI 보안의 원리를 게임으로 이해하기',
      how: '1인용(AI와 대결)이나 2인용(옆 친구와 대결)을 고르고, 공격자는 해킹 문장 카드를, 방어자는 보안 필터를 골라 겨뤄요.',
      aliases: ['ai보안', '에이아이보안', '인공지능보안', '프롬프트인젝션', '프롬프트', '해킹게임'] },
    { id: 'app', pc: 4, name: '앱 개발',
      goal: '스마트폰 환경과 모바일에 맞춘 앱 기술 이해하기',
      how: '화면 속 스마트폰을 클릭하고 스크롤하면서 급식 만족도 조사 같은 미니 앱을 써 보고, 옆에서 앱 제작 기술 설명을 읽어요.',
      aliases: ['앱개발', '어플개발', '모바일앱', '앱만들기', '앱시뮬레이터'] }
  ];

  /* 주제 묶음: "게임 있어?" 같은 질문에서 쓰는 말 → 태그 */
  var tagWords = {
    '게임': '게임',
    '로봇': '로봇',
    '보안': '보안', '해킹': '보안', '해커': '보안',
    'ai': 'ai', '인공지능': 'ai', '에이아이': 'ai',
    '앱': '앱', '어플': '앱', '애플리케이션': '앱',
    '하드웨어': '하드웨어',
    '데이터': '데이터'
  };

  /* 포토부스에서 쓰는 사진 틀 (assets/photo 폴더의 그림). 틀을 바꾸려면 그림 파일을 바꾸거나 여기에 줄을 추가하세요. */
  var photoFrames = [
    { id: 'xmas1',  name: '크리스마스 테마 1', file: 'assets/photo/xmas1.jpg' },
    { id: 'xmas2',  name: '크리스마스 테마 2', file: 'assets/photo/xmas2.jpg' },
    { id: 'codeon', name: '코드온 테마',       file: 'assets/photo/codeon.jpg' }
  ];

  var stamp = {
    slots: 5,
    rules: [
      '도장판은 입구에서 1인당 1장 받아요.',
      '① ~ ④번 칸: 체험형 부스를 체험하면 그 부스 담당자가 찍어 줘요.',
      '⑤번 칸: 진로 전시에서 PC 4대 중 3가지 이상 체험하면 찍어 줘요.',
      '전시형 부스와 포토부스에서는 도장을 찍지 않아요.'
    ],
    reward: '도장을 모두 모아 출구로 가면 학교 동아리 도장을 찍어 주고, 포토부스 티켓과 간식 중 하나를 고를 수 있어요.',
    snackNote: '간식은 컴퓨터실 밖에서 먹어 주세요.',
    playTime: '체험은 1인당 2~3분 정도예요.'
  };

  return {
    event: event, parts: parts, zones: zones, teams: teams,
    assignment: assignment, career: career, tagWords: tagWords, stamp: stamp,
    settings: settings, saved: saved, congestion: congestion, photoFrames: photoFrames
  };
});
