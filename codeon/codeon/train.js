/*
 * train.js — 챗봇 신경망 학습 스크립트
 * ------------------------------------------------------------
 * 실행:  node train.js
 * 결과:  js/model.js (학습된 가중치) 가 새로 만들어집니다.
 *
 * 외부 라이브러리 없이 Node.js 기본 기능만 씁니다. (npm install 필요 없음)
 *
 * 신경망 구조
 *   입력: 글자 조각(n-gram) 벡터  →  은닉층 1 (ReLU)  →  은닉층 2 (ReLU)  →  출력: 의도별 확률(softmax)
 * 학습 방법
 *   손실 함수: 교차 엔트로피 / 최적화: Adam / 과적합 방지: 드롭아웃, 가중치 감쇠
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DATA = require('./js/data.js');
const INTENTS = require('./js/intents.js');
const NLP = require('./js/nlp.js');

// ---------- 설정 (바꿔 가며 실험해 볼 수 있는 값) ----------
const CONFIG = {
  H1: 64,            // 은닉층 1의 뉴런 수
  H2: 32,            // 은닉층 2의 뉴런 수
  epochs: 30,        // 전체 자료를 몇 번 반복해서 볼지
  batch: 16,         // 한 번에 묶어 계산하는 문장 수
  lr: 0.004,         // 학습률
  dropIn: 0.15,      // 입력 조각을 일부러 빼먹는 비율 (오타에 강해짐)
  dropH: 0.25,       // 은닉층 드롭아웃 비율
  decay: 1e-5,       // 가중치 감쇠
  smooth: 0.05,      // 라벨 스무딩
  holdout: 0.15,     // 검증용으로 떼어 두는 예시 비율
  maxExpand: 40,     // 예시 틀 한 줄을 최대 몇 문장으로 펼칠지
  seed: 20261224
};

// ---------- 재현 가능한 난수 ----------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- 1. 학습 자료 준비 ----------
const lexicon = NLP.buildLexicon(DATA);
const intentNames = Object.keys(INTENTS);
const K = intentNames.length;
const NO_SUFFIX = { greet: 1, thanks: 1, bye: 1, chitchat: 1, oos: 1 };
const PREFIX = ['혹시 ', '저기 ', '근데 ', '아 ', '그럼 ', '음 '];

// [a|b|c] 를 가능한 조합으로 펼친다. 너무 많으면 무작위로 max개만 고른다.
function expand(template, rng, max) {
  const parts = [];
  let rest = template, m;
  while ((m = rest.match(/\[([^\]]*)\]/))) {
    if (m.index > 0) parts.push([rest.slice(0, m.index)]);
    parts.push(m[1].split('|'));
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) parts.push([rest]);
  let total = 1;
  parts.forEach(function (p) { total *= p.length; });
  const out = new Set();
  if (total <= max) {
    (function walk(i, acc) {
      if (i === parts.length) { out.add(acc.replace(/\s+/g, ' ').trim()); return; }
      parts[i].forEach(function (c) { walk(i + 1, acc + c); });
    })(0, '');
  } else {
    let guard = 0;
    while (out.size < max && guard++ < max * 20) {
      out.add(parts.map(function (p) { return p[Math.floor(rng() * p.length)]; }).join('').replace(/\s+/g, ' ').trim());
    }
  }
  return Array.from(out).filter(Boolean);
}

// 예시 문장 하나를 여러 말투로 불려서 자료를 늘린다 (데이터 증강)
function augment(phrase, intent, rng) {
  const out = [phrase];
  if (rng() < 0.4) out.push(PREFIX[Math.floor(rng() * PREFIX.length)] + phrase);
  if (!NO_SUFFIX[intent]) {
    const r = rng();
    if (r < 0.2) out.push(phrase + ' 알려줘');
    else if (r < 0.35) out.push(phrase + ' 좀');
    else if (r < 0.6 && /[아어야해돼줘래와가나지]$/.test(phrase)) out.push(phrase + '요');
    else if (r < 0.8 && /야$/.test(phrase)) out.push(phrase.replace(/야$/, '예요'));
    else if (/어$/.test(phrase)) out.push(phrase.replace(/어$/, '나요'));
  }
  return out;
}
// 오타 흉내: 글자 하나를 빼거나 이웃 글자와 바꾼다
function typo(masked, rng) {
  if (masked.length < 5) return null;
  const i = 1 + Math.floor(rng() * (masked.length - 2));
  if (/[ⓉⒻⒼ]/.test(masked[i])) return null;
  if (rng() < 0.5) return masked.slice(0, i) + masked.slice(i + 1);
  return masked.slice(0, i) + masked[i + 1] + masked[i] + masked.slice(i + 2);
}

function buildSamples(basePhrases, rng, withAug) {
  const seen = new Set(), samples = [];
  basePhrases.forEach(function (b) {
    const variants = withAug ? augment(b.text, b.intent, rng) : [b.text];
    variants.forEach(function (v) {
      const masked = NLP.analyze(v, lexicon).masked;
      if (!masked) return;
      const list = [masked];
      if (withAug && rng() < 0.5) { const t = typo(masked, rng); if (t) list.push(t); }
      list.forEach(function (m) {
        const key = b.label + '|' + m;
        if (seen.has(key)) return;
        seen.add(key);
        samples.push({ masked: m, label: b.label });
      });
    });
  });
  return samples;
}

function buildVocab(samples) {
  const count = new Map();
  samples.forEach(function (s) {
    new Set(NLP.ngrams(s.masked)).forEach(function (g) { count.set(g, (count.get(g) || 0) + 1); });
  });
  const vocab = [];
  count.forEach(function (c, g) {
    if (g.length === 1 || c >= 2) vocab.push(g);
  });
  vocab.sort();
  return vocab;
}

// ---------- 2. 신경망 ----------
function createModel(V, rng) {
  const { H1, H2 } = CONFIG;
  function init(n, fanIn) {
    const a = new Float32Array(n), s = Math.sqrt(2 / fanIn);
    for (let i = 0; i < n; i++) a[i] = gauss(rng) * s;
    return a;
  }
  return {
    V: V, H1: H1, H2: H2, K: K,
    W1: init(V * H1, 12), b1: new Float32Array(H1),   // 입력은 한 문장에 조각 십여 개만 켜지므로 fanIn을 작게 잡음
    W2: init(H1 * H2, H1), b2: new Float32Array(H2),
    W3: init(H2 * K, H2), b3: new Float32Array(K)
  };
}

function train(samples, vocab, rng, log) {
  const vocabIndex = NLP.makeVocabIndex(vocab);
  const V = vocab.length, { H1, H2 } = CONFIG;
  const model = createModel(V, rng);
  const feats = samples.map(function (s) { return NLP.featurize(s.masked, vocabIndex); });

  // Adam 상태값
  const names = ['W1', 'b1', 'W2', 'b2', 'W3', 'b3'];
  const m = {}, v = {}, g = {};
  names.forEach(function (n) {
    m[n] = new Float32Array(model[n].length);
    v[n] = new Float32Array(model[n].length);
    g[n] = new Float32Array(model[n].length);
  });
  const B1 = 0.9, B2 = 0.999, EPS = 1e-8;
  let step = 0;

  const h1 = new Float32Array(H1), h2 = new Float32Array(H2), z = new Float32Array(K), p = new Float32Array(K);
  const mask1 = new Float32Array(H1), d1 = new Float32Array(H1), d2 = new Float32Array(H2);
  const order = samples.map(function (_, i) { return i; });

  for (let epoch = 1; epoch <= CONFIG.epochs; epoch++) {
    shuffle(order, rng);
    let loss = 0, correct = 0;
    const lr = CONFIG.lr * (1 - 0.7 * (epoch - 1) / CONFIG.epochs);   // 뒤로 갈수록 학습률을 줄임

    for (let start = 0; start < order.length; start += CONFIG.batch) {
      const end = Math.min(order.length, start + CONFIG.batch), bs = end - start;
      const touched = new Set();
      g.b1.fill(0); g.W2.fill(0); g.b2.fill(0); g.W3.fill(0); g.b3.fill(0);

      for (let q = start; q < end; q++) {
        const f = feats[order[q]], y = samples[order[q]].label;
        // 입력 드롭아웃
        const idx = f.idx.filter(function () { return rng() >= CONFIG.dropIn; });
        const val = idx.length ? 1 / Math.sqrt(idx.length) : 0;

        // --- 순전파 ---
        let i, j, k;
        for (j = 0; j < H1; j++) h1[j] = model.b1[j];
        for (i = 0; i < idx.length; i++) {
          const base = idx[i] * H1;
          for (j = 0; j < H1; j++) h1[j] += model.W1[base + j] * val;
        }
        for (j = 0; j < H1; j++) {
          mask1[j] = rng() >= CONFIG.dropH ? 1 / (1 - CONFIG.dropH) : 0;
          h1[j] = h1[j] > 0 ? h1[j] * mask1[j] : 0;
        }
        for (k = 0; k < H2; k++) {
          let a = model.b2[k];
          for (j = 0; j < H1; j++) a += model.W2[j * H2 + k] * h1[j];
          h2[k] = a > 0 ? a : 0;
        }
        let max = -Infinity;
        for (k = 0; k < K; k++) {
          let a = model.b3[k];
          for (j = 0; j < H2; j++) a += model.W3[j * K + k] * h2[j];
          z[k] = a; if (a > max) max = a;
        }
        let sum = 0;
        for (k = 0; k < K; k++) { p[k] = Math.exp(z[k] - max); sum += p[k]; }
        let best = 0;
        for (k = 0; k < K; k++) { p[k] /= sum; if (p[k] > p[best]) best = k; }
        loss += -Math.log(p[y] + 1e-9);
        if (best === y) correct++;

        // --- 역전파 ---
        for (k = 0; k < K; k++) {
          const target = (k === y ? 1 - CONFIG.smooth : 0) + CONFIG.smooth / K;
          z[k] = p[k] - target;                       // dLoss/dz3
          g.b3[k] += z[k];
        }
        for (j = 0; j < H2; j++) {
          let a = 0;
          for (k = 0; k < K; k++) { g.W3[j * K + k] += h2[j] * z[k]; a += model.W3[j * K + k] * z[k]; }
          d2[j] = h2[j] > 0 ? a : 0;
          g.b2[j] += d2[j];
        }
        for (j = 0; j < H1; j++) {
          let a = 0;
          for (k = 0; k < H2; k++) { g.W2[j * H2 + k] += h1[j] * d2[k]; a += model.W2[j * H2 + k] * d2[k]; }
          d1[j] = h1[j] > 0 ? a * mask1[j] : 0;
          g.b1[j] += d1[j];
        }
        for (i = 0; i < idx.length; i++) {
          const base = idx[i] * H1;
          if (!touched.has(idx[i])) { touched.add(idx[i]); for (j = 0; j < H1; j++) g.W1[base + j] = 0; }
          for (j = 0; j < H1; j++) g.W1[base + j] += d1[j] * val;
        }
      }

      // --- Adam 갱신 ---
      step++;
      const c1 = 1 - Math.pow(B1, step), c2 = 1 - Math.pow(B2, step);
      function update(name, from, to) {
        const W = model[name], G = g[name], M = m[name], Vv = v[name];
        for (let i = from; i < to; i++) {
          const gr = G[i] / bs + CONFIG.decay * W[i];
          M[i] = B1 * M[i] + (1 - B1) * gr;
          Vv[i] = B2 * Vv[i] + (1 - B2) * gr * gr;
          W[i] -= lr * (M[i] / c1) / (Math.sqrt(Vv[i] / c2) + EPS);
        }
      }
      ['b1', 'W2', 'b2', 'W3', 'b3'].forEach(function (n) { update(n, 0, model[n].length); });
      touched.forEach(function (row) { update('W1', row * H1, row * H1 + H1); });
    }
    if (log && (epoch % 5 === 0 || epoch === 1)) {
      console.log('  epoch ' + String(epoch).padStart(3) + '  손실 ' + (loss / samples.length).toFixed(4) +
        '  학습 정확도 ' + (100 * correct / samples.length).toFixed(1) + '%');
    }
  }
  model.vocab = vocab;
  model.intents = intentNames;
  return model;
}

function evaluate(model, items) {
  const vocabIndex = NLP.makeVocabIndex(model.vocab);
  let ok = 0; const wrong = [];
  items.forEach(function (it) {
    const r = NLP.classify(it.text, model, lexicon, vocabIndex);
    if (r.ranked[0].intent === it.intent) ok++;
    else wrong.push(it.text + '  → ' + r.ranked[0].intent + ' (' + (r.ranked[0].p * 100).toFixed(0) + '%), 정답 ' + it.intent);
  });
  return { acc: items.length ? ok / items.length : 0, wrong: wrong, n: items.length };
}

// ---------- 3. 실행 ----------
const rng = makeRng(CONFIG.seed);
const base = [];
let templateCount = 0;
intentNames.forEach(function (name, label) {
  const seen = new Set();
  INTENTS[name].forEach(function (template) {
    templateCount++;
    expand(template, rng, CONFIG.maxExpand).forEach(function (text) {
      if (seen.has(text)) return;
      seen.add(text);
      base.push({ text: text, intent: name, label: label });
    });
  });
});
console.log('의도 ' + K + '개, 예시 틀 ' + templateCount + '줄 → 펼친 문장 ' + base.length + '개');

// (1) 일부 예시를 떼어 놓고 학습해서, 처음 보는 문장을 얼마나 맞히는지 확인
const shuffled = shuffle(base.slice(), makeRng(CONFIG.seed + 1));
const nVal = Math.round(shuffled.length * CONFIG.holdout);
const valSet = shuffled.slice(0, nVal), trainSet = shuffled.slice(nVal);
console.log('\n[1단계] 검증용 ' + valSet.length + '문장을 빼고 학습');
const s1 = buildSamples(trainSet, rng, true);
const m1 = train(s1, buildVocab(s1), rng, false);
const valResult = evaluate(m1, valSet);
console.log('  검증 정확도(학습에서 뺀 문장): ' + (valResult.acc * 100).toFixed(1) + '%  (' + valSet.length + '문장)');
if (process.env.SHOW_VAL) valResult.wrong.forEach(function (w) { console.log('  틀림: ' + w); });
if (process.env.VAL_ONLY) process.exit(0);

// (2) 모든 예시로 최종 모델 학습
console.log('\n[2단계] 전체 예시로 최종 학습');
const samples = buildSamples(base, rng, true);
const vocab = buildVocab(samples);
console.log('  학습 문장(증강 포함) ' + samples.length + '개, 글자 조각 어휘 ' + vocab.length + '개');
const model = train(samples, vocab, rng, true);

// 저장할 내용
// W1 을 어휘 한 줄(조각 하나)마다 -127~127 정수로 줄여 저장한다 (파일 크기 약 1/5)
function quantize(W, rows, cols) {
  const q = new Int8Array(W.length), scale = [];
  for (let r = 0; r < rows; r++) {
    let max = 1e-8;
    for (let c = 0; c < cols; c++) max = Math.max(max, Math.abs(W[r * cols + c]));
    const sc = max / 127;
    scale.push(Math.round(sc * 1e6) / 1e6);
    for (let c = 0; c < cols; c++) q[r * cols + c] = Math.round(W[r * cols + c] / scale[r]);
  }
  return { q: Buffer.from(q.buffer).toString('base64'), scale: scale };
}
function round(arr) { return Array.from(arr, function (x) { return Math.round(x * 10000) / 10000; }); }
const out = {
  meta: {
    trainedAt: new Date().toISOString(),
    intents: K, basePhrases: base.length, samples: samples.length, vocab: vocab.length,
    valAccuracy: Math.round(valResult.acc * 1000) / 10,
    testAccuracy: null, testCount: 0,
    config: CONFIG
  },
  V: vocab.length, H1: CONFIG.H1, H2: CONFIG.H2, K: K,
  intents: intentNames, vocab: vocab,
  W1: quantize(model.W1, vocab.length, CONFIG.H1), b1: round(model.b1),
  W2: round(model.W2), b2: round(model.b2),
  W3: round(model.W3), b3: round(model.b3)
};
function writeModel() {
  const js = '/* 자동 생성 파일입니다. 직접 고치지 말고 node train.js 로 다시 만드세요. */\n' +
    '(function (root) { var m = ' + JSON.stringify(out) + ';\n' +
    "if (typeof module !== 'undefined' && module.exports) module.exports = m; else root.CODEON_MODEL = m;\n" +
    "})(typeof self !== 'undefined' ? self : this);\n";
  fs.writeFileSync(path.join(__dirname, 'js', 'model.js'), js);
  return js.length;
}

// (3) 저장된 모델(브라우저가 실제로 쓰는 것)을 다시 읽어 시험 문제로 점검
const saved = NLP.loadModel(JSON.parse(JSON.stringify(out)));
const testPath = path.join(__dirname, 'tests', 'questions.js');
if (fs.existsSync(testPath)) {
  const testResult = evaluate(saved, require(testPath));
  console.log('\n[3단계] 시험 문제(tests/questions.js) 정확도: ' + (testResult.acc * 100).toFixed(1) + '%  (' + testResult.n + '문장)');
  testResult.wrong.forEach(function (w) { console.log('  틀림: ' + w); });
  out.meta.testAccuracy = Math.round(testResult.acc * 1000) / 10;
  out.meta.testCount = testResult.n;
}
const size = writeModel();
console.log('\n저장 완료: js/model.js (' + (size / 1024).toFixed(0) + ' KB)');
