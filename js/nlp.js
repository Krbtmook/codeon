/*
 * nlp.js — 자연어 처리(NLP) 부분
 * ------------------------------------------------------------
 * 브라우저(챗봇)와 Node(train.js 학습)에서 똑같이 쓰는 코드입니다.
 *
 * 하는 일
 *  1) 문장 다듬기: 소문자로 바꾸고 기호를 지움
 *  2) 개체 찾기: 팀 이름 / 진로 분야 / 주제어를 찾아 기호 하나로 바꿈
 *       "로봇 축구 어디야?"  →  "Ⓣ어디야"   (Ⓣ = 팀, Ⓕ = 진로 분야, Ⓖ = 주제)
 *     이렇게 하면 신경망은 "어느 팀이냐"가 아니라 "무엇을 묻느냐"만 배우면 됩니다.
 *  3) 특징 추출: 글자를 1~3개씩 묶은 조각(n-gram)으로 쪼개 숫자 벡터로 만듦
 *  4) 신경망 계산(순전파): 벡터 → 은닉층 2개 → 의도별 확률
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CODEON_NLP = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var PH = { T: 'Ⓣ', F: 'Ⓕ', G: 'Ⓖ' }; // Ⓣ Ⓕ Ⓖ

  // ---------- 1) 문장 다듬기 ----------
  function clean(text) {
    return String(text || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[^가-힣ㄱ-ㆎa-z0-9+ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- 한글 자모 분해 (오타 허용 비교에 사용) ----------
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  var JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  var JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  function toJamo(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) {
        var k = c - 0xAC00;
        out += CHO[Math.floor(k / 588)] + JUNG[Math.floor((k % 588) / 28)];
        if (k % 28) out += JONG[k % 28];
      } else out += str[i];
    }
    return out;
  }
  function editDistance(a, b) {
    var m = a.length, n = b.length, prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // ---------- 2) 개체 사전 만들기 ----------
  function buildLexicon(data) {
    var entries = [];
    function add(alias, type, id) {
      var a = clean(alias).replace(/ /g, '');
      if (a) entries.push({ alias: a, type: type, id: id, jamo: toJamo(a) });
    }
    data.teams.forEach(function (t) {
      add(t.name, 'T', t.id);
      (t.aliases || []).forEach(function (a) { add(a, 'T', t.id); });
    });
    data.career.forEach(function (c) {
      add(c.name, 'F', c.id);
      (c.aliases || []).forEach(function (a) { add(a, 'F', c.id); });
    });
    Object.keys(data.tagWords || {}).forEach(function (w) { add(w, 'G', data.tagWords[w]); });
    // 긴 것부터 먼저 맞춰 봄 ("로봇축구"가 "로봇"보다 먼저)
    entries.sort(function (a, b) { return b.alias.length - a.alias.length; });
    var seen = {};
    return entries.filter(function (e) {
      var k = e.type + '|' + e.alias;
      if (seen[k]) return false;
      seen[k] = 1; return true;
    });
  }

  var PARTICLES = '은는이가을를도의에로랑과와만야요임인좀쪽팀부';

  // 문장에서 개체를 찾아 기호로 바꾼다.
  function analyze(text, lexicon) {
    var cleaned = clean(text);
    var tokens = cleaned ? cleaned.split(' ') : [];
    var s = tokens.join('');
    var starts = {}, tokenOf = [], pos = 0;
    tokens.forEach(function (tk, ti) {
      starts[pos] = true;
      for (var k = 0; k < tk.length; k++) tokenOf[pos + k] = ti;
      pos += tk.length;
    });

    var taken = new Array(s.length).fill(false);
    var found = [];
    function free(p, len) {
      for (var k = p; k < p + len; k++) if (taken[k]) return false;
      return true;
    }
    function take(p, len, e, fuzzy) {
      for (var k = p; k < p + len; k++) taken[k] = true;
      found.push({ pos: p, len: len, type: e.type, id: e.id, text: s.substr(p, len), fuzzy: !!fuzzy });
    }

    lexicon.forEach(function (e) {
      var L = e.alias.length, from = 0, p;
      while ((p = s.indexOf(e.alias, from)) !== -1) {
        from = p + 1;
        if (!free(p, L)) continue;
        if (L <= 2) {
          // 짧은 말은 낱말의 첫머리에 있을 때만 인정 ("컨트롤" 속의 "롤"은 무시)
          if (!starts[p]) continue;
          if (L === 1) {
            var next = s[p + 1];
            var endOfToken = next === undefined || tokenOf[p + 1] !== tokenOf[p];
            if (!endOfToken && PARTICLES.indexOf(next) === -1) continue;
          }
        }
        take(p, L, e, false);
      }
    });

    // 오타 허용: 아직 아무것도 못 찾은 낱말을 팀 이름과 자모 단위로 비교
    var p0 = 0;
    tokens.forEach(function (tk) {
      var start = p0; p0 += tk.length;
      if (!free(start, tk.length)) return;
      var core = tk;
      while (core.length > 2 && PARTICLES.indexOf(core[core.length - 1]) !== -1) core = core.slice(0, -1);
      if (core.length < 3 || !/[가-힣]/.test(core)) return;
      var cj = toJamo(core), best = null, bestD = 99;
      lexicon.forEach(function (e) {
        if (e.type !== 'T' || e.alias.length < 3) return;
        if (Math.abs(e.jamo.length - cj.length) > 2) return;
        var d = editDistance(cj, e.jamo);
        if (d < bestD) { bestD = d; best = e; }
      });
      if (best && bestD <= 2 && bestD / best.jamo.length <= 0.25) take(start, core.length, best, true);
    });

    found.sort(function (a, b) { return a.pos - b.pos; });
    var masked = '', i = 0;
    found.forEach(function (f) {
      masked += s.slice(i, f.pos) + PH[f.type];
      i = f.pos + f.len;
    });
    masked += s.slice(i);

    return { cleaned: cleaned, nospace: s, masked: masked, entities: found };
  }

  // ---------- 3) 특징 추출 ----------
  function ngrams(masked) {
    var s = '^' + masked + '$', out = [], i, n;
    for (n = 1; n <= 3; n++) {
      for (i = 0; i + n <= s.length; i++) {
        var g = s.substr(i, n);
        if (n === 1 && (g === '^' || g === '$')) continue;
        out.push(g);
      }
    }
    return out;
  }

  // 조각 목록 → (어휘 번호, 값) 목록. 길이가 1이 되도록 정규화한다.
  function featurize(masked, vocabIndex) {
    var grams = ngrams(masked), seen = {}, idx = [], known = 0;
    grams.forEach(function (g) {
      var j = vocabIndex[g];
      if (j !== undefined) {
        known++;
        if (!seen[j]) { seen[j] = 1; idx.push(j); }
      }
    });
    var v = idx.length ? 1 / Math.sqrt(idx.length) : 0;
    return { idx: idx, val: v, grams: grams, coverage: grams.length ? known / grams.length : 0 };
  }

  // ---------- 4) 신경망 순전파 ----------
  // 구조: 입력(V) → 은닉1(H1, ReLU) → 은닉2(H2, ReLU) → 출력(K, softmax)
  function forward(model, feat) {
    var H1 = model.H1, H2 = model.H2, K = model.K;
    var W1 = model.W1, W2 = model.W2, W3 = model.W3;
    var h1 = new Float32Array(H1), h2 = new Float32Array(H2), z = new Float32Array(K);
    var i, j, k;
    for (j = 0; j < H1; j++) h1[j] = model.b1[j];
    for (i = 0; i < feat.idx.length; i++) {
      var base = feat.idx[i] * H1;
      for (j = 0; j < H1; j++) h1[j] += W1[base + j] * feat.val;
    }
    for (j = 0; j < H1; j++) if (h1[j] < 0) h1[j] = 0;
    for (k = 0; k < H2; k++) {
      var a = model.b2[k];
      for (j = 0; j < H1; j++) a += W2[j * H2 + k] * h1[j];
      h2[k] = a > 0 ? a : 0;
    }
    var max = -Infinity;
    for (k = 0; k < K; k++) {
      var b = model.b3[k];
      for (j = 0; j < H2; j++) b += W3[j * K + k] * h2[j];
      z[k] = b; if (b > max) max = b;
    }
    var sum = 0, p = new Float32Array(K);
    for (k = 0; k < K; k++) { p[k] = Math.exp(z[k] - max); sum += p[k]; }
    for (k = 0; k < K; k++) p[k] /= sum;
    return { probs: p, h1: h1, h2: h2 };
  }

  // ---------- 저장된 모델 읽기 ----------
  // 가장 큰 가중치(W1)는 파일 크기를 줄이려고 -127~127 정수로 줄여서(양자화) 글자로 저장해 둔다.
  // 여기서 원래 크기의 실수로 되돌린다.
  function loadModel(saved) {
    if (saved.W1 && !saved.W1.q) return saved;
    var bin;
    if (typeof atob === 'function') {
      var str = atob(saved.W1.q);
      bin = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) bin[i] = str.charCodeAt(i);
    } else {
      bin = new Uint8Array(Buffer.from(saved.W1.q, 'base64'));
    }
    var q = new Int8Array(bin.buffer, bin.byteOffset, bin.length);
    var W1 = new Float32Array(q.length), H1 = saved.H1, scales = saved.W1.scale;
    for (var k = 0; k < q.length; k++) W1[k] = q[k] * scales[Math.floor(k / H1)];
    var m = {};
    Object.keys(saved).forEach(function (key) { m[key] = saved[key]; });
    m.W1 = W1;
    return m;
  }

  function makeVocabIndex(vocab) {
    var m = Object.create(null);
    for (var i = 0; i < vocab.length; i++) m[vocab[i]] = i;
    return m;
  }

  // ---------- 5) 개체 보정 ----------
  // 신경망이 낸 확률을, 문장에서 찾은 개체와 맞춰 본다.
  //   팀 이름이 없는데 "팀 위치" 의도가 높게 나오면 낮추고, 팀 이름이 있으면 팀 관련 의도를 높인다.
  var NEEDS = {
    team_info: 'T', team_where: 'T', team_when: 'T',
    field_info: 'F', topic_search: 'G'
  };
  function gate(list, entities, opts) {
    var has = { T: false, F: false, G: false };
    entities.forEach(function (e) { has[e.type] = true; });
    if (opts && opts.contextTeam) has.T = has.T || 'ctx';
    var sum = 0;
    var out = list.map(function (r) {
      var need = NEEDS[r.intent], w = 1;
      if (need) w = has[need] === true ? 2 : (has[need] === 'ctx' ? 1 : 0.1);
      var p = r.p * w;
      sum += p;
      return { intent: r.intent, p: p };
    });
    out.forEach(function (r) { r.p /= sum; });
    out.sort(function (a, b) { return b.p - a.p; });
    return out;
  }

  // 문장 하나를 끝까지 분류한다.
  function classify(text, model, lexicon, vocabIndex, opts) {
    var an = analyze(text, lexicon);
    var feat = featurize(an.masked, vocabIndex);
    var out = forward(model, feat);
    var raw = [];
    for (var k = 0; k < model.K; k++) raw.push({ intent: model.intents[k], p: out.probs[k] });
    var ranked = gate(raw, an.entities, opts);
    raw.sort(function (a, b) { return b.p - a.p; });
    return { analysis: an, feat: feat, ranked: ranked, raw: raw, hidden1: out.h1, hidden2: out.h2 };
  }

  return {
    PH: PH, clean: clean, toJamo: toJamo, editDistance: editDistance,
    buildLexicon: buildLexicon, analyze: analyze, ngrams: ngrams,
    featurize: featurize, forward: forward, gate: gate, loadModel: loadModel, makeVocabIndex: makeVocabIndex, classify: classify
  };
});
