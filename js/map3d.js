/*
 * map3d.js — 3D 컴퓨터실 지도 (three.js)
 * ------------------------------------------------------------
 * 좌표: x = 왼쪽(-) ~ 오른쪽(+), z = 칠판 쪽(-) ~ 뒷벽 쪽(+), y = 높이.  단위는 대략 미터.
 * 배치도(계획서)와 같은 방향입니다: 칠판이 위쪽, 입구가 왼쪽 앞, 출구가 왼쪽 뒤.
 *
 * 밖에서 쓰는 기능 (app.js 가 호출)
 *   setPart(n)        1부/2부 배치로 바꾸기
 *   focus(ids)        그 구역으로 카메라를 옮기고 강조
 *   highlight(ids)    카메라는 그대로 두고 강조만
 *   overview()        전체 보기 / topView() 위에서 보기 / entranceView() 입구에서 보기
 *   showRoute(on)     관람 동선 표시
 */
(function (root) {
  'use strict';
  var THREE = root.THREE;

  var COLORS = {
    info:   { top: 0xF6C9C4, accent: 0xE0605A, css: '#E0605A' },
    exp:    { top: 0xD3E9CC, accent: 0x4FA04A, css: '#3F8F3A' },
    career: { top: 0xFFE9A6, accent: 0xE0A800, css: '#B88600' },
    check:  { top: 0xDAD0EA, accent: 0x7E5BB5, css: '#7E5BB5' },
    photo:  { top: 0xFDD9BC, accent: 0xF2811D, css: '#E26F0A' },
    wall:   { top: 0xC8DCF3, accent: 0x3F7FCB, css: '#3F7FCB' },
    none:   { top: 0xF1F3F6, accent: 0x9AA3AF, css: '#9AA3AF' }
  };

  // 방 크기와 책상 배치
  var ROOM = { x0: -6.7, x1: 6.7, z0: -6.9, z1: 7.2, h: 2.9 };
  var COL_X = [-3.9, 0, 3.9];
  var ROW_Z0 = -3.9, ROW_GAP = 1.7;
  var DESK = { w: 2.5, d: 0.8, h: 0.74 };
  var WALL_X = { 4: -4.55, 3: -3.25, 2: -0.65, 1: 0.65 };   // 뒷벽 전시 1~4의 x 위치 (배치도: 왼쪽부터 4,3,2,1)

  function seatPos(seat) {
    var i = seat - 1, row = Math.floor(i / 6), col = Math.floor((i % 6) / 2), side = i % 2;
    return { row: row, col: col, x: COL_X[col] + (side ? 0.62 : -0.62), z: ROW_Z0 + row * ROW_GAP, deskKey: row + '-' + col };
  }

  function roundedRect(w, d, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  function canvasTexture(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function create(container, DATA, handlers) {
    handlers = handlers || {};
    var A = DATA.assignment;
    var teamById = {};
    DATA.teams.forEach(function (t) { teamById[t.id] = t; });
    var careerById = {};
    DATA.career.forEach(function (c) { careerById[c.id] = c; });
    var part = 1;

    // ---------- 기본 장면 ----------
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '컴퓨터실 3D 지도');

    var scene = new THREE.Scene();
    // near/far 범위를 좁혀야 깊이 계산이 정밀해져서, 가까이 붙은 면이 깜빡이지 않는다
    var camera = new THREE.PerspectiveCamera(32, 1, 0.6, 120);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8e6, 1.15));
    var sun = new THREE.DirectionalLight(0xfff4e2, 1.6);
    sun.position.set(-7, 15, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -11; sun.shadow.camera.right = 11;
    sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 5;
    scene.add(sun);

    function mat(color, opts) {
      var o = { color: color, roughness: 0.85, metalness: 0 };
      if (opts) for (var k in opts) o[k] = opts[k];
      return new THREE.MeshStandardMaterial(o);
    }
    // 다른 면 위에 딱 붙여 그리는 얇은 면(바닥 표시, 화면, 포스터)에 쓰는 설정
    function decal(material) {
      material.polygonOffset = true; material.polygonOffsetFactor = -4; material.polygonOffsetUnits = -4;
      return material;
    }
    function box(w, h, d, material, x, y, z, parent, shadow) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.set(x, y, z);
      if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
      (parent || scene).add(m);
      return m;
    }

    // ---------- 바닥과 벽 ----------
    var roomW = ROOM.x1 - ROOM.x0, roomD = ROOM.z1 - ROOM.z0, cx = (ROOM.x0 + ROOM.x1) / 2, cz = (ROOM.z0 + ROOM.z1) / 2;
    var floorTex = canvasTexture(512, 512, function (g, w, h) {
      g.fillStyle = '#EEF1F6'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(31,42,68,0.07)'; g.lineWidth = 2;
      for (var i = 0; i <= 8; i++) {
        g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
        g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(roomW / 4.8, roomD / 4.8);
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), mat(0xffffff, { map: floorTex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); floor.receiveShadow = true;
    scene.add(floor);
    // 바닥 두께 (옆에서 봤을 때 판처럼 보이게)
    box(roomW + 0.3, 0.3, roomD + 0.3, mat(0xCBD5E3), cx, -0.18, cz, scene, false);   // 윗면이 바닥(y=0)과 겹치지 않게 살짝 내림

    // 벽: 안쪽 면만 그려서, 카메라가 벽 뒤에 있으면 벽이 투명해 보인다 (인형의 집 방식)
    var wallMat = mat(0xFFFFFF, { side: THREE.FrontSide, roughness: 1, emissive: 0x9AA6B8, emissiveIntensity: 0.55 });
    function wall(w, x, z, ry) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), wallMat);
      m.position.set(x, ROOM.h / 2, z); m.rotation.y = ry; m.receiveShadow = true;
      scene.add(m);
    }
    wall(roomW, cx, ROOM.z0, 0);              // 앞벽 (칠판)
    wall(roomW, cx, ROOM.z1, Math.PI);        // 뒷벽
    wall(roomD, ROOM.x0, cz, Math.PI / 2);    // 왼쪽 벽
    wall(roomD, ROOM.x1, cz, -Math.PI / 2);   // 오른쪽 벽
    // 걸레받이: 벽이 투명해져도 방의 테두리가 보이도록
    var skirt = mat(0xB9C4D4);
    // 벽면과 같은 평면에 놓이면 두 면이 번갈아 보이며 깜빡이므로, 벽 바깥으로 2cm 띄운다
    var GAP = 0.02;
    box(roomW + 0.34, 0.22, 0.15, skirt, cx, 0.11, ROOM.z0 - 0.075 - GAP, scene, false);
    box(roomW + 0.34, 0.22, 0.15, skirt, cx, 0.11, ROOM.z1 + 0.075 + GAP, scene, false);
    box(0.15, 0.22, roomD, skirt, ROOM.x0 - 0.075 - GAP, 0.11, cz, scene, false);
    box(0.15, 0.22, roomD, skirt, ROOM.x1 + 0.075 + GAP, 0.11, cz, scene, false);

    // ---------- 문 ----------
    function door(x, z, ry, color, label, arrowDir) {
      var g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = ry;
      var frame = mat(color);
      box(0.12, 2.15, 0.14, frame, -0.62, 1.075, 0, g);
      box(0.12, 2.15, 0.14, frame, 0.62, 1.075, 0, g);
      box(1.36, 0.12, 0.14, frame, 0, 2.2, 0, g);
      var leaf = box(1.12, 2.1, 0.05, mat(0xE9EEF5), 0.5, 1.05, 0.52, g);
      leaf.rotation.y = Math.PI / 2.4;
      // 바닥 화살표 매트 (걸어가는 방향)
      var tex = canvasTexture(256, 256, function (c, w, h) {
        c.fillStyle = '#' + new THREE.Color(color).getHexString(); c.globalAlpha = 0.92;
        c.beginPath(); c.roundRect(10, 10, w - 20, h - 20, 40); c.fill();
        c.globalAlpha = 1; c.fillStyle = '#fff';
        c.translate(w / 2, h / 2);
        c.beginPath(); c.moveTo(-22, 78); c.lineTo(-22, -10); c.lineTo(-62, -10); c.lineTo(0, -82); c.lineTo(62, -10); c.lineTo(22, -10); c.lineTo(22, 78); c.closePath(); c.fill();
      });
      var matPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), decal(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
      matPlane.rotation.set(-Math.PI / 2, 0, arrowDir);
      matPlane.position.set(x + 1.0, 0.03, z);
      scene.add(matPlane);
      scene.add(g);
      return g;
    }
    // 왼쪽 벽의 문은 방 안쪽(+x)을 향하도록 돌린다
    door(ROOM.x0 + 0.08, -5.75, Math.PI / 2, 0x2FA36B, '입구', -Math.PI / 2);   // 방 안쪽(+x)으로
    door(ROOM.x0 + 0.08, 6.1, Math.PI / 2, 0xD9534F, '출구', Math.PI / 2);     // 방 바깥(-x)으로
    // 준비실 문 (뒷벽 오른쪽)
    (function () {
      var g = new THREE.Group(); g.position.set(5.5, 0, ROOM.z1 - 0.08); g.rotation.y = Math.PI;
      var f = mat(0x8E9BB0);
      box(0.12, 2.15, 0.14, f, -0.62, 1.075, 0, g); box(0.12, 2.15, 0.14, f, 0.62, 1.075, 0, g); box(1.36, 0.12, 0.14, f, 0, 2.2, 0, g);
      box(1.12, 2.1, 0.05, mat(0xDDE3EC), 0, 1.05, 0, g);
      scene.add(g);
    })();

    // ---------- 칠판과 교사 자리 ----------
    (function () {
      var boardTex = canvasTexture(1024, 384, function (g, w, h) {
        g.fillStyle = '#24543F'; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.04)';
        for (var i = 0; i < 60; i++) g.fillRect(Math.random() * w, Math.random() * h, 60 + Math.random() * 160, 2);
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillStyle = '#F5F2E6';
        g.font = '400 92px Jua, Pretendard, "Malgun Gothic", sans-serif';
        g.fillText(DATA.event.title, 300, 140);
        g.fillStyle = '#FFC98A';
        g.font = '400 64px Jua, Pretendard, "Malgun Gothic", sans-serif';
        g.fillText(DATA.event.clubEn + ' 부스 안내', 300, 250);
      });
      var board = box(6.4, 1.5, 0.08, mat(0xffffff, { map: boardTex }), -0.6, 1.75, ROOM.z0 + 0.06, scene, false);
      board.receiveShadow = true;
      box(6.6, 0.1, 0.14, mat(0x8A6B4A), -0.6, 0.96, ROOM.z0 + 0.1, scene, false);
      if (root.CODEON_LOGO) {
        new THREE.TextureLoader().load(root.CODEON_LOGO, function (tex) {
          tex.colorSpace = THREE.SRGBColorSpace;
          var logo = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), decal(new THREE.MeshBasicMaterial({ map: tex, transparent: true })));
          logo.position.set(-3.0, 1.75, ROOM.z0 + 0.12);
          scene.add(logo);
        });
      }
      // 교사 자리
      var wood = mat(0xD9C3A5);
      box(2.6, 0.06, 0.9, wood, 4.4, 0.76, -5.7);
      box(2.5, 0.72, 0.06, wood, 4.4, 0.37, -5.35);
      box(0.06, 0.72, 0.8, wood, 3.15, 0.37, -5.7); box(0.06, 0.72, 0.8, wood, 5.65, 0.37, -5.7);
      box(0.7, 0.42, 0.04, mat(0x2A3140), 4.4, 1.08, -5.75);
      box(0.08, 0.14, 0.08, mat(0x2A3140), 4.4, 0.84, -5.78);
    })();

    // ---------- 구역 만들기 ----------
    var zones = {};        // id → { def, kind, color, group, pad, center, hit[], screens[], desks[] }
    var hitMeshes = [];
    var deskZone = {};     // "row-col" → zone id
    DATA.zones.forEach(function (z) {
      if (z.seats) z.seats.forEach(function (s) { deskZone[seatPos(s).deskKey] = z.id; });
    });

    var legMat = mat(0xAEB8C6), chairMat = mat(0x56627A), darkMat = mat(0x252B38, { roughness: 0.5 });
    var keyMat = mat(0xE6EAF0);
    var hitMat = new THREE.MeshBasicMaterial({ visible: false });

    function ensureZone(def) {
      if (zones[def.id]) return zones[def.id];
      var z = { def: def, kind: def.kind, color: COLORS[def.kind], group: new THREE.Group(), desks: [], screens: [], tops: [], bounds: null, lift: 0 };
      scene.add(z.group);
      zones[def.id] = z;
      return z;
    }
    function grow(z, x0, x1, z0, z1) {
      var b = z.bounds;
      if (!b) z.bounds = { x0: x0, x1: x1, z0: z0, z1: z1 };
      else { b.x0 = Math.min(b.x0, x0); b.x1 = Math.max(b.x1, x1); b.z0 = Math.min(b.z0, z0); b.z1 = Math.max(b.z1, z1); }
    }

    // 책상 18개
    var freeDesks = new THREE.Group(); scene.add(freeDesks);
    for (var row = 0; row < 6; row++) {
      for (var col = 0; col < 3; col++) {
        (function (row, col) {
          var key = row + '-' + col, zid = deskZone[key];
          var def = zid ? DATA.zones.filter(function (q) { return q.id === zid; })[0] : null;
          var z = def ? ensureZone(def) : null;
          var color = z ? z.color : COLORS.none;
          var parent = z ? z.group : freeDesks;
          var x = COL_X[col], zz = ROW_Z0 + row * ROW_GAP;
          var seatA = row * 6 + col * 2 + 1;

          // 상판 (구역 색)
          var topMat = mat(color.top, { roughness: 0.7 });
          var top = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(DESK.w, DESK.d, 0.06), { depth: 0.06, bevelEnabled: false }), topMat);
          top.rotation.x = -Math.PI / 2; top.position.set(x, DESK.h - 0.06, zz);
          top.castShadow = true; top.receiveShadow = true; parent.add(top);
          if (z) z.tops.push(top);
          // 다리와 앞 가림판
          box(0.05, DESK.h - 0.07, DESK.d - 0.1, legMat, x - DESK.w / 2 + 0.06, (DESK.h - 0.07) / 2, zz, parent);
          box(0.05, DESK.h - 0.07, DESK.d - 0.1, legMat, x + DESK.w / 2 - 0.06, (DESK.h - 0.07) / 2, zz, parent);
          box(DESK.w - 0.14, 0.42, 0.03, legMat, x, 0.45, zz - DESK.d / 2 + 0.08, parent);

          // 좌석 번호 (상판 앞쪽 가장자리)
          var numTex = canvasTexture(512, 64, function (g, w, h) {
            g.clearRect(0, 0, w, h);
            g.fillStyle = 'rgba(31,42,68,0.62)';
            g.font = '700 44px Pretendard, "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(String(seatA), w * 0.25, h / 2 + 2); g.fillText(String(seatA + 1), w * 0.75, h / 2 + 2);
          });
          var num = new THREE.Mesh(new THREE.PlaneGeometry(DESK.w - 0.1, 0.3), decal(new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false })));
          num.rotation.x = -Math.PI / 2; num.position.set(x, DESK.h + 0.008, zz + DESK.d / 2 - 0.17);
          parent.add(num);

          // 자리 2개: 모니터, 키보드, 의자
          [-0.62, 0.62].forEach(function (dx) {
            var sx = x + dx;
            box(0.2, 0.02, 0.14, darkMat, sx, DESK.h + 0.01, zz - 0.2, parent);
            box(0.04, 0.16, 0.04, darkMat, sx, DESK.h + 0.09, zz - 0.2, parent);
            box(0.66, 0.4, 0.035, darkMat, sx, DESK.h + 0.36, zz - 0.19, parent);
            var screenMat = decal(new THREE.MeshBasicMaterial({ color: z ? color.accent : 0x3A4252 }));
            var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.34), screenMat);
            screen.position.set(sx, DESK.h + 0.36, zz - 0.164); parent.add(screen);
            if (z) z.screens.push(screen);
            box(0.42, 0.018, 0.14, keyMat, sx, DESK.h + 0.009, zz + 0.05, parent);
            // 의자 (27·28번 자리는 뒤쪽을 복도로 쓰기 때문에 의자를 두지 않는다)
            if (key !== '4-1') {
              var cz2 = zz + 0.78;
              box(0.44, 0.05, 0.42, chairMat, sx, 0.45, cz2, parent);
              box(0.44, 0.4, 0.05, chairMat, sx, 0.72, cz2 + 0.2, parent);
              box(0.05, 0.43, 0.05, legMat, sx, 0.215, cz2, parent);
            }
          });

          if (z) {
            grow(z, x - DESK.w / 2, x + DESK.w / 2, zz - DESK.d / 2, zz + 1.05);
            z.desks.push({ x: x, z: zz });
            var hit = box(DESK.w, 1.3, DESK.d + 0.75, hitMat, x, 0.65, zz + 0.32, scene, false);
            hit.userData.zoneId = def.id; hitMeshes.push(hit);
          }
        })(row, col);
      }
    }

    // 뒷벽 전시 4칸: 양면 게시판
    function posterTexture(n, team, color) {
      return canvasTexture(384, 512, function (g, w, h) {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = color.css; g.fillRect(0, 0, w, 120);
        g.fillStyle = '#fff'; g.font = '400 72px Jua, Pretendard, "Malgun Gothic", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('전시 ' + n, w / 2, 64);
        g.fillStyle = '#1F2A44'; g.font = '700 46px Pretendard, "Malgun Gothic", sans-serif';
        var name = team ? team.name : '';
        var lines = name.length > 7 ? [name.slice(0, Math.ceil(name.length / 2)), name.slice(Math.ceil(name.length / 2))] : [name];
        lines.forEach(function (ln, i) { g.fillText(ln, w / 2, 200 + i * 56); });
        g.fillStyle = 'rgba(31,42,68,0.12)';
        for (var i = 0; i < 5; i++) g.fillRect(48, 320 + i * 34, w - 96 - (i % 2) * 70, 14);
      });
    }
    DATA.zones.filter(function (q) { return q.kind === 'wall'; }).forEach(function (def) {
      var z = ensureZone(def), x = WALL_X[def.wall], zz = ROOM.z1 - 0.35;
      var team = teamById[A.exhibit[def.wall]];
      var tex = posterTexture(def.wall, team, z.color);
      var frame = box(1.18, 1.56, 0.07, mat(z.color.accent), x, 1.5, zz, z.group);
      var faceGeo = new THREE.PlaneGeometry(1.06, 1.44);
      var f1 = new THREE.Mesh(faceGeo, decal(new THREE.MeshBasicMaterial({ map: tex }))); f1.position.set(x, 1.5, zz - 0.045); f1.rotation.y = Math.PI; z.group.add(f1);
      var f2 = new THREE.Mesh(faceGeo, decal(new THREE.MeshBasicMaterial({ map: tex }))); f2.position.set(x, 1.5, zz + 0.045); z.group.add(f2);
      z.posterFaces = [f1, f2];
      box(0.06, 0.74, 0.06, legMat, x - 0.45, 0.37, zz, z.group); box(0.06, 0.74, 0.06, legMat, x + 0.45, 0.37, zz, z.group);
      z.tops.push(frame);
      grow(z, x - 0.62, x + 0.62, zz - 0.75, zz + 0.2);
      z.desks.push({ x: x, z: zz - 0.3 });
      z.isWall = true;
      var hit = box(1.24, 2.3, 0.9, hitMat, x, 1.15, zz - 0.25, scene, false);
      hit.userData.zoneId = def.id; hitMeshes.push(hit);
    });

    // 포토부스 꾸미기: 배경막, 삼각대 카메라
    (function () {
      var z = zones.photo; if (!z) return;
      var px = COL_X[2], pz = 6.25;
      var curtain = canvasTexture(256, 256, function (g, w, h) {
        g.fillStyle = '#FBE3CF'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#F7B780';
        for (var i = 0; i < 8; i++) g.fillRect(i * 32, 0, 16, h);
      });
      box(2.5, 2.1, 0.06, mat(0xffffff, { map: curtain }), px, 1.05, pz + 0.35, z.group);
      box(0.08, 2.2, 0.08, mat(0xF2811D), px - 1.27, 1.1, pz + 0.35, z.group); box(0.08, 2.2, 0.08, mat(0xF2811D), px + 1.27, 1.1, pz + 0.35, z.group);
      box(2.62, 0.08, 0.08, mat(0xF2811D), px, 2.22, pz + 0.35, z.group);
      // 삼각대와 카메라
      var tx = px + 0.1, tz = pz - 0.55;
      box(0.04, 1.2, 0.04, darkMat, tx, 0.6, tz, z.group);
      box(0.26, 0.17, 0.14, darkMat, tx, 1.28, tz, z.group);
      var lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16), mat(0x7C8AA0));
      lens.rotation.x = Math.PI / 2; lens.position.set(tx, 1.28, tz + 0.1); z.group.add(lens);
      grow(z, px - DESK.w / 2, px + DESK.w / 2, 4.2, pz + 0.5);
    })();

    // 구역 바닥 패드와 표식
    var beaconGeo = new THREE.ConeGeometry(0.2, 0.42, 4);
    Object.keys(zones).forEach(function (id) {
      var z = zones[id], b = z.bounds, pad = 0.14;
      var w = b.x1 - b.x0 + pad * 2, d = b.z1 - b.z0 + pad * 2;
      z.center = new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      var padMat = decal(new THREE.MeshBasicMaterial({ color: z.color.accent, transparent: true, opacity: 0.13, depthWrite: false }));
      var padMesh = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(w, d, 0.22)), padMat);
      padMesh.renderOrder = 1; padMesh.rotation.x = -Math.PI / 2; padMesh.position.set(z.center.x, 0.015, z.center.z);
      scene.add(padMesh);
      z.pad = padMesh;
      // 강조용 테두리
      var ringShape = roundedRect(w + 0.16, d + 0.16, 0.3);
      ringShape.holes.push(roundedRect(w - 0.02, d - 0.02, 0.2));
      var ring = new THREE.Mesh(new THREE.ShapeGeometry(ringShape), decal(new THREE.MeshBasicMaterial({ color: z.color.accent, transparent: true, opacity: 0, depthWrite: false })));
      ring.renderOrder = 2; ring.rotation.x = -Math.PI / 2; ring.position.set(z.center.x, 0.026, z.center.z);
      scene.add(ring);
      z.ring = ring;
      // 위에서 통통 튀는 표식
      var beacon = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: z.color.accent }));
      beacon.rotation.x = Math.PI; beacon.visible = false;
      scene.add(beacon);
      z.beacon = beacon;
      z.labelY = z.isWall ? (z.def.wall % 2 ? 2.5 : 3.0) : 1.55;
      z.active = 0; z.target = 0;
    });

    // ---------- 운영자 인형 ----------
    var people = [];
    var skin = mat(0xF3D2B3);
    function person(x, zz, color, parent, standing) {
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 10), mat(color));
      body.position.y = standing ? 0.95 : 0.78; body.castShadow = true; g.add(body);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), skin);
      head.position.y = standing ? 1.4 : 1.22; head.castShadow = true; g.add(head);
      g.position.set(x, 0, zz);
      (parent || scene).add(g);
      people.push({ g: g, phase: Math.random() * 6.28 });
      return g;
    }
    Object.keys(zones).forEach(function (id) {
      var z = zones[id];
      if (z.isWall) return;
      if (z.kind === 'exp') {
        z.desks.forEach(function (d, i) { person(d.x + (i ? 0.62 : -0.62), d.z + 0.78, z.color.accent, z.group); });
      } else if (z.kind === 'photo') {
        person(COL_X[2] - 0.8, 5.65, z.color.accent, z.group, true);
      } else {
        person(z.desks[0].x - 0.62, z.desks[0].z + 0.78, z.color.accent, z.group);
      }
    });

    // ---------- 여우 마스코트 ----------
    var fox = new THREE.Group();
    (function () {
      var orange = mat(0xF2811D), cream = mat(0xFFF1DC), brown = mat(0x6B3A1E);
      function part(geo, m, x, y, z, sx, sy, sz) {
        var o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx || 1, sy || 1, sz || 1); o.castShadow = true; fox.add(o); return o;
      }
      var sph = new THREE.SphereGeometry(1, 20, 16), cone = new THREE.ConeGeometry(1, 1, 12);
      part(sph, orange, 0, 0.36, 0, 0.26, 0.32, 0.24);                 // 몸
      part(sph, cream, 0, 0.32, 0.14, 0.16, 0.2, 0.12);                // 배
      part(sph, orange, 0, 0.82, 0.03, 0.27, 0.24, 0.24);              // 머리
      part(sph, cream, 0, 0.75, 0.2, 0.15, 0.11, 0.1);                 // 주둥이
      part(sph, brown, 0, 0.78, 0.3, 0.035, 0.03, 0.03);               // 코
      var eyeMat = new THREE.MeshBasicMaterial({ color: 0x6B3A1E });   // 화나면 빨갛게 빛남
      var eyeL = part(sph, eyeMat, -0.1, 0.87, 0.24, 0.025, 0.035, 0.02);   // 눈
      var eyeR = part(sph, eyeMat, 0.1, 0.87, 0.24, 0.025, 0.035, 0.02);
      // 화난 눈썹과 이빨 (평소에는 숨김)
      var angry = new THREE.Group();
      var browGeo = new THREE.BoxGeometry(0.13, 0.03, 0.03), dark = new THREE.MeshBasicMaterial({ color: 0x2A150C });
      var b1 = new THREE.Mesh(browGeo, dark); b1.position.set(-0.11, 0.945, 0.245); b1.rotation.z = -0.55; angry.add(b1);
      var b2 = new THREE.Mesh(browGeo, dark); b2.position.set(0.11, 0.945, 0.245); b2.rotation.z = 0.55; angry.add(b2);
      var mouth = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.02), new THREE.MeshBasicMaterial({ color: 0x3A0D12 })); mouth.position.set(0, 0.705, 0.292); angry.add(mouth);
      var toothGeo = new THREE.ConeGeometry(0.014, 0.036, 4), white = new THREE.MeshBasicMaterial({ color: 0xffffff });
      [-0.06, -0.03, 0, 0.03, 0.06].forEach(function (tx) { var tooth = new THREE.Mesh(toothGeo, white); tooth.position.set(tx, 0.712, 0.305); tooth.rotation.x = Math.PI; angry.add(tooth); });
      angry.visible = false; fox.add(angry);
      fox.userData.eyeMat = eyeMat; fox.userData.eyes = [eyeL, eyeR]; fox.userData.angry = angry;
      part(cone, orange, -0.16, 1.08, 0.02, 0.09, 0.22, 0.07);         // 귀
      part(cone, orange, 0.16, 1.08, 0.02, 0.09, 0.22, 0.07);
      var tail = part(sph, orange, 0.26, 0.3, -0.2, 0.12, 0.26, 0.12); tail.rotation.z = -0.9; tail.rotation.x = -0.5;
      var tip = part(sph, cream, 0.4, 0.44, -0.29, 0.08, 0.11, 0.08); tip.rotation.z = -0.9;
      fox.userData.tail = tail;
    })();
    fox.position.set(-6.25, 0, -4.45); fox.rotation.y = 1.2; fox.scale.setScalar(1.25);
    scene.add(fox);
    var foxHit = box(0.8, 1.5, 0.8, hitMat, -6.25, 0.75, -4.45, scene, false);
    foxHit.userData.fox = true; hitMeshes.push(foxHit);

    // ---------- 관람 동선 ----------
    // 들를 곳 목록(stops)을 받으면, 통로와 복도를 따라가는 길을 만들어 점으로 표시한다. (만드는 함수는 아래 방문자 모형 부분)
    var routeCurve = null, routeLabels = [], routeLine = null;
    var ROUTE_N = 150;
    var routeDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xF2811D }), ROUTE_N);
    routeDots.visible = false; routeDots.frustumCulled = false;
    scene.add(routeDots);
    // 동선을 따라 걷는 아바타: 다른 모형보다 크고, 머리 위 화살표와 발밑 원으로 눈에 띄게 한다
    var walker = person(0, 0, 0x2563EB, scene, true); walker.visible = false;
    walker.scale.setScalar(1.9);
    var walkerArrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), new THREE.MeshBasicMaterial({ color: 0xFFD21F }));
    walkerArrow.rotation.x = Math.PI; walkerArrow.position.y = 1.95; walker.add(walkerArrow);
    var walkerRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 28), new THREE.MeshBasicMaterial({ color: 0x2563EB, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    walkerRing.rotation.x = -Math.PI / 2; walkerRing.position.y = 0.03; walker.add(walkerRing);
    var routeOn = false, routeT = 0, routeLen = 1;
    var dummy = new THREE.Object3D();

    // ---------- 방문자 모형 ----------
    // 입구로 들어와 도장판을 받고, 인기도가 높은 부스일수록 자주 들렀다가, 출구로 나간다.
    // 한 번에 그리는 방식(InstancedMesh)이라 수십 명이어도 가볍다.
    var CROWD_MAX = 80, FRONT_Z = -4.85, BACK_Z = 5.95, AISLES = [-5.9, -1.95, 1.95, 5.9];
    var MID_Z = 3.75;   // 27·28번 책상과 33·34번 책상 사이 공간. 안쪽 두 통로를 잇는 복도로 쓴다.
    var SHIRTS = [0x5B8DEF, 0xEF6F6C, 0x59C3A6, 0xF4B942, 0x9B7EDE, 0x4FB0C6, 0xF28C6A, 0x7A8BA6, 0x6CCF7F, 0xE884B6];
    var crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, transparent: true });
    var crowdHeadMat = new THREE.MeshStandardMaterial({ color: 0xF3D2B3, roughness: 0.8, transparent: true });
    var crowdBody = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.15, 0.42, 4, 10), crowdMat, CROWD_MAX);
    var crowdHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 14, 12), crowdHeadMat, CROWD_MAX);
    crowdBody.frustumCulled = crowdHead.frustumCulled = false;
    crowdBody.castShadow = crowdHead.castShadow = true;
    crowdBody.count = crowdHead.count = 0;
    scene.add(crowdBody); scene.add(crowdHead);
    var agents = [], crowdCount = 0, crowdWeights = {}, crowdOpacity = 1, lastPoke = -1e9;
    var crowdMode = { visits: [2, 4], wait: [5, 14], spread: false };
    var DOOR_IN = { x: -6.5, z: -5.75, lane: 'front' }, DOOR_OUT = { x: -6.5, z: 6.1, lane: 'back', exit: true };
    function rand(a, b) { return a + Math.random() * (b - a); }

    // 그 구역을 구경할 때 서 있을 자리
    function spotFor(id) {
      var z = zones[id];
      if (!z) return null;
      if (id === 'info') return { x: z.desks[0].x + rand(-1.0, 1.0), z: -4.72, lane: 'front' };
      if (id === 'check') return { x: z.desks[0].x + rand(-1.0, 1.0), z: 5.82, lane: 'back' };
      if (id === 'photo') return { x: rand(3.0, 4.6), z: 5.72, lane: 'back', view: true };
      if (z.isWall) return { x: WALL_X[z.def.wall] + rand(-0.4, 0.4), z: rand(6.05, 6.3), lane: 'back', view: true };
      // 책상 구역: 양옆 통로 중 한쪽에 서서 구경
      var col = COL_X.indexOf(z.desks[0].x), ax = AISLES[col + (Math.random() < 0.5 ? 0 : 1)];
      var toward = ax < z.desks[0].x ? 1 : -1;
      return { x: ax + toward * rand(0.12, 0.5), z: rand(z.bounds.z0 + 0.15, z.bounds.z1 - 0.3), ax: ax };
    }
    // 동선 표시용: 흔들림 없이 항상 같은 자리. ax 를 주면 그쪽 통로에 선다.
    function fixedSpot(stop) {
      if (stop.id === undefined) return stop;                       // 경유 지점 { x, z, lane | ax }
      var z = zones[stop.id];
      if (!z) return null;
      if (stop.id === 'info') return { x: z.desks[0].x, z: -4.72, lane: 'front' };
      if (stop.id === 'check') return { x: z.desks[0].x, z: 5.82, lane: 'back' };
      if (stop.id === 'photo') return { x: 3.8, z: 5.72, lane: 'back', view: true };
      if (z.isWall) return { x: WALL_X[z.def.wall], z: 6.15, lane: 'back', view: true };
      var col = COL_X.indexOf(z.desks[0].x);
      var ax = stop.ax !== undefined ? stop.ax : AISLES[col + 1];
      var toward = ax < z.desks[0].x ? 1 : -1;
      return { x: ax + toward * 0.32, z: (z.bounds.z0 + z.bounds.z1) / 2 - 0.1, ax: ax };
    }
    function buildRoute(stops) {
      var pts = [[DOOR_IN.x, DOOR_IN.z]], cur = DOOR_IN, marks = [];
      stops.forEach(function (st) {
        var to = fixedSpot(st);
        if (!to) return;
        pathBetween(cur, to).forEach(function (p) { pts.push(p); });
        if (st.id !== undefined) marks.push({ x: to.x, z: to.z });
        cur = to;
      });
      pathBetween(cur, DOOR_OUT).forEach(function (p) { pts.push(p); });
      // 같은 점이 연달아 나오면 곡선 계산이 깨지므로 걸러 낸다
      var clean = [], len = 0;
      pts.forEach(function (p) {
        var last = clean[clean.length - 1];
        if (last) { var d = Math.hypot(p[0] - last.x, p[1] - last.z); if (d < 0.05) return; len += d; }
        clean.push(new THREE.Vector3(p[0], 0.08, p[1]));
      });
      routeLen = Math.max(1, len);
      routeCurve = new THREE.CatmullRomCurve3(clean, false, 'catmullrom', 0.06);
      // 길 전체를 이어 주는 선 (점만 있으면 어디가 길인지 알아보기 어려워서)
      if (routeLine) { scene.remove(routeLine); routeLine.geometry.dispose(); }
      routeLine = new THREE.Mesh(
        new THREE.TubeGeometry(routeCurve, Math.max(60, Math.ceil(routeLen * 5)), 0.045, 6, false),
        new THREE.MeshBasicMaterial({ color: 0xF2811D, transparent: true, opacity: 0.42, depthWrite: false }));
      scene.add(routeLine);
      // 들르는 순서 번호표
      routeLabels.forEach(function (l) { l.el.remove(); labels.splice(labels.indexOf(l), 1); });
      routeLabels = marks.map(function (m, i) {
        var l = addLabel(new THREE.Vector3(m.x, 0.5, m.z), 'step');
        l.el.textContent = String(i + 1);
        return l;
      });
    }

    // 통로(세로)와 앞·뒤 복도(가로)만 따라 걷는 길
    function pathBetween(from, to) {
      var pts = [];
      function laneZ(n) { return n === 'front' ? FRONT_Z : BACK_Z; }
      if (from.ax !== undefined) pts.push([from.ax, from.z]);
      // 33·34번 뒤쪽(뒤 복도 가운데)은 포토부스나 전시를 볼 때만 지나간다.
      // 그 밖의 경우(출구로 갈 때 등)에는 27·28번과 33·34번 사이 복도를 건너 왼쪽 안쪽 통로로 내려간다.
      if (!from.view && !to.view && to.lane === 'back' && to.x < -1.95 && from.ax !== undefined && from.ax > -1.95) {
        if (from.ax > 1.95) { pts.push([from.ax, BACK_Z]); pts.push([1.95, BACK_Z]); }
        pts.push([1.95, MID_Z]); pts.push([-1.95, MID_Z]); pts.push([-1.95, BACK_Z]);
        pts.push([to.x, to.z]);
        return pts;
      }
      if (from.ax !== undefined && from.ax === to.ax) {
        // 같은 통로 안에서 이동
      } else if (from.lane && to.lane && from.lane !== to.lane) {
        var mid = Math.abs(to.x + 1.95) < Math.abs(to.x - 1.95) ? -1.95 : 1.95;
        pts.push([mid, laneZ(from.lane)]); pts.push([mid, laneZ(to.lane)]);
      } else {
        var lz;
        if (to.lane) lz = laneZ(to.lane);
        else if (from.lane) lz = laneZ(from.lane);
        else {
          var cost = function (L) { return Math.abs(from.z - L) + Math.abs(to.z - L); };
          lz = cost(FRONT_Z) < cost(BACK_Z) ? FRONT_Z : BACK_Z;
          // 안쪽 두 통로 사이를 건널 때는 가운데 복도(27·28번과 33·34번 사이)가 더 가까우면 그쪽으로 간다
          if (Math.abs(from.ax) === 1.95 && Math.abs(to.ax) === 1.95 && cost(MID_Z) < cost(lz)) lz = MID_Z;
        }
        if (from.ax !== undefined) pts.push([from.ax, lz]);
        if (to.ax !== undefined) pts.push([to.ax, lz]);
      }
      if (to.ax !== undefined) pts.push([to.ax, to.z]);
      pts.push([to.x, to.z]);
      return pts;
    }
    // 들를 곳 정하기: 인기도(가중치)가 높은 구역이 더 자주 뽑힌다
    function makePlan() {
      var pool = Object.keys(zones).filter(function (id) { return id !== 'info' && id !== 'check' && id !== 'photo'; })
        .map(function (id) { var w = crowdWeights[id] !== undefined ? crowdWeights[id] : 1; return { id: id, w: crowdMode.spread ? Math.sqrt(w) : w }; });   // 혼잡할 때는 한곳에 덜 몰리게
      // 혼잡할수록 적게 들르고(빨리 빠져나감), 여유로울수록 많이 들른다
      var plan = ['info'], n = crowdMode.visits[0] + Math.floor(Math.random() * (crowdMode.visits[1] - crowdMode.visits[0] + 1));
      for (var i = 0; i < n && pool.length; i++) {
        var total = 0, r, k;
        pool.forEach(function (p) { total += p.w; });
        r = Math.random() * total;
        for (k = 0; k < pool.length - 1; k++) { r -= pool[k].w; if (r <= 0) break; }
        plan.push(pool.splice(k, 1)[0].id);
      }
      plan.push('check');
      if (Math.random() < 0.3) plan.push('photo');
      plan.push('exit');
      return plan;
    }
    function goNext(a) {
      a.step++;
      var id = a.plan[a.step];
      var to = id === 'exit' || !id ? DOOR_OUT : spotFor(id);
      if (!to) to = DOOR_OUT;
      a.path = pathBetween(a.cur, to);
      a.cur = to;
    }
    function spawn(a, inside) {
      a.plan = makePlan(); a.hidden = 0; a.wait = 0; a.path = [];
      if (inside) {
        // 처음 켰을 때는 방 안 여기저기에 이미 와 있는 것처럼 놓는다
        a.step = 1 + Math.floor(Math.random() * (a.plan.length - 2));
        a.cur = spotFor(a.plan[a.step]) || DOOR_IN;
        a.x = a.cur.x; a.z = a.cur.z; a.wait = rand(0.5, 12);
      } else {
        a.step = -1; a.cur = DOOR_IN; a.x = DOOR_IN.x; a.z = DOOR_IN.z;
        goNext(a);
      }
    }
    function setCrowd(count, weights, mode) {
      crowdWeights = weights || {};
      if (mode) crowdMode = mode;
      crowdCount = Math.max(0, Math.min(CROWD_MAX, Math.round(count || 0)));
      while (agents.length < crowdCount) {
        var a = { speed: rand(0.85, 1.35), phase: rand(0, 6.28), sway: rand(-0.16, 0.16) };
        var i = agents.length;
        crowdBody.setColorAt(i, new THREE.Color(SHIRTS[i % SHIRTS.length]));
        spawn(a, true);
        agents.push(a);
      }
      if (crowdBody.instanceColor) crowdBody.instanceColor.needsUpdate = true;
      crowdBody.count = crowdHead.count = crowdCount;
    }
    function updateCrowd(dt, t) {
      // 사용자가 지도를 만지는 동안에는 흐리게 해서 가리지 않게 한다
      var target = (performance.now() - lastPoke < 3500) ? 0.14 : 1;
      crowdOpacity += (target - crowdOpacity) * Math.min(1, dt * 6);
      crowdMat.opacity = crowdHeadMat.opacity = crowdOpacity;
      var solid = crowdOpacity > 0.97;
      if (crowdMat.transparent === solid) { crowdMat.transparent = crowdHeadMat.transparent = !solid; crowdMat.needsUpdate = crowdHeadMat.needsUpdate = true; }
      crowdMat.depthWrite = crowdHeadMat.depthWrite = crowdOpacity > 0.5;
      crowdBody.castShadow = crowdHead.castShadow = crowdOpacity > 0.6;

      for (var i = 0; i < crowdCount; i++) {
        var a = agents[i], bob = 0;
        if (a.hidden > 0) {
          a.hidden -= dt;
          if (a.hidden <= 0) spawn(a, false);
        } else if (a.path.length) {
          var p = a.path[0], dx = p[0] - a.x, dz = p[1] - a.z, dist = Math.hypot(dx, dz), stepLen = a.speed * dt;
          if (dist <= stepLen) {
            a.x = p[0]; a.z = p[1]; a.path.shift();
            if (!a.path.length) { if (a.cur.exit) a.hidden = rand(1, 6); else a.wait = rand(crowdMode.wait[0], crowdMode.wait[1]); }
          } else { a.x += dx / dist * stepLen; a.z += dz / dist * stepLen; }
          bob = Math.abs(Math.sin(t * 8 + a.phase)) * 0.045;
        } else {
          a.wait -= dt;
          if (a.wait <= 0) goNext(a);
        }
        var s = a.hidden > 0 ? 0.0001 : 1;
        // 통로에서 사람끼리 완전히 겹치지 않도록 조금씩 옆으로 비켜 선다
        dummy.position.set(a.x + a.sway, 0.6 + bob, a.z + a.sway * 0.5); dummy.scale.setScalar(s); dummy.updateMatrix();
        crowdBody.setMatrixAt(i, dummy.matrix);
        dummy.position.y = 1.14 + bob; dummy.updateMatrix();
        crowdHead.setMatrixAt(i, dummy.matrix);
      }
      crowdBody.instanceMatrix.needsUpdate = true; crowdHead.instanceMatrix.needsUpdate = true;
    }

    // ---------- 이름표 (HTML) ----------
    var labelLayer = document.createElement('div');
    labelLayer.className = 'map-labels';
    container.appendChild(labelLayer);
    var labels = [];
    function addLabel(pos, cls, zoneId) {
      var el = document.createElement(zoneId ? 'button' : 'div');
      el.className = 'map-label ' + cls;
      if (zoneId) {
        el.type = 'button';
        el.addEventListener('click', function (e) { e.stopPropagation(); if (handlers.onSelect) handlers.onSelect(zoneId); });
      }
      labelLayer.appendChild(el);
      var l = { el: el, pos: pos, zoneId: zoneId };
      labels.push(l);
      return l;
    }
    Object.keys(zones).forEach(function (id) {
      var z = zones[id];
      z.label = addLabel(new THREE.Vector3(z.center.x, z.labelY, z.isWall ? ROOM.z1 - 0.35 : z.center.z - 0.3), 'zone kind-' + z.kind, id);
    });
    var fixed = [
      [new THREE.Vector3(-0.6, 2.75, ROOM.z0 + 0.1), '칠판'],
      [new THREE.Vector3(4.4, 1.5, -5.7), '선생님 자리'],
      [new THREE.Vector3(ROOM.x0 + 0.2, 2.55, -5.75), '입구'],
      [new THREE.Vector3(ROOM.x0 + 0.2, 2.55, 6.1), '출구'],
      [new THREE.Vector3(5.5, 2.55, ROOM.z1 - 0.1), '준비실']
    ];
    fixed.forEach(function (f) { addLabel(f[0], 'place').el.textContent = f[1]; });

    function zoneTitle(id) {
      var z = zones[id], def = z.def;
      if (z.kind === 'exp') { var t = teamById[A['part' + part][id]]; return t ? t.name : def.name; }
      if (z.kind === 'wall') { var w = teamById[A.exhibit[def.wall]]; return w ? w.name : def.name; }
      if (z.kind === 'career') { var c = careerById[def.field]; return 'PC ' + c.pc + ' ' + c.name; }
      return def.name;
    }
    var hotZones = {};
    function refreshLabels() {
      Object.keys(zones).forEach(function (id) {
        var z = zones[id];
        z.label.el.innerHTML = '<i style="background:' + z.color.css + '"></i><span></span>' + (hotZones[id] ? '<em>인기</em>' : '');
        z.label.el.querySelector('span').textContent = zoneTitle(id);
      });
    }
    refreshLabels();

    // 자리 배정이 바뀌었을 때: 이름표와 뒷벽 게시판 그림을 새로 그린다
    function refresh() {
      refreshLabels();
      Object.keys(zones).forEach(function (id) {
        var z = zones[id];
        if (!z.posterFaces) return;
        var tex = posterTexture(z.def.wall, teamById[A.exhibit[z.def.wall]], z.color);
        var old = z.posterFaces[0].material.map;
        z.posterFaces.forEach(function (f) { f.material.map = tex; f.material.needsUpdate = true; });
        if (old) old.dispose();
        z.lift = 1;
      });
      ['A', 'B', 'C', 'D'].forEach(function (id, i) { if (zones[id]) zones[id].lift = 1 + i * 0.1; });
    }

    // ---------- 카메라 조작 ----------
    var cam = { target: new THREE.Vector3(0, 0.6, 0.2), theta: 0, phi: 0.82, radius: 30 };
    var goal = { target: cam.target.clone(), theta: 0, phi: 0.82, radius: 30 };
    var autoRotate = false, userTouchedAt = 0;

    function fitRadius() {
      // 화면이 세로로 길수록 더 멀리서 봐야 방 전체가 들어온다
      var aspect = camera.aspect || 1.6;
      return aspect > 1.5 ? 27 : (aspect > 1.05 ? 31 : 40);
    }
    function setGoal(g) {
      if (g.target) goal.target.copy(g.target);
      if (g.theta !== undefined) {
        var d = g.theta - cam.theta;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        goal.theta = cam.theta + d;
      }
      if (g.phi !== undefined) goal.phi = g.phi;
      if (g.radius !== undefined) goal.radius = g.radius;
    }
    function clampGoal() {
      goal.phi = Math.max(0.06, Math.min(1.5, goal.phi));
      goal.radius = Math.max(4.5, Math.min(48, goal.radius));
      goal.target.x = Math.max(ROOM.x0, Math.min(ROOM.x1, goal.target.x));
      goal.target.z = Math.max(ROOM.z0, Math.min(ROOM.z1, goal.target.z));
    }
    function applyCamera() {
      var s = Math.sin(cam.phi), c = Math.cos(cam.phi);
      camera.position.set(cam.target.x + cam.radius * s * Math.sin(cam.theta), cam.target.y + cam.radius * c, cam.target.z + cam.radius * s * Math.cos(cam.theta));
      camera.lookAt(cam.target);
    }

    var dom = renderer.domElement, pointers = {}, dragMoved = 0, lastPinch = 0, downAt = null;
    dom.style.touchAction = 'none';
    function touched() { userTouchedAt = performance.now(); lastPoke = userTouchedAt; if (handlers.onUserMove) handlers.onUserMove(); }
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('pointerdown', function (e) {
      dom.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey };
      dragMoved = 0; downAt = { x: e.clientX, y: e.clientY }; lastPoke = performance.now();
      lastPinch = 0;
    });
    dom.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) { hover(e); return; }
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      var ids = Object.keys(pointers);
      if (ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) goal.radius *= lastPinch / dist;
        lastPinch = dist;
        pan(dx * 0.5, dy * 0.5);
      } else if (p.button === 2 || p.button === 1 || p.shift) {
        pan(dx, dy);
      } else {
        goal.theta -= dx * 0.006;
        goal.phi -= dy * 0.005;
      }
      if (dragMoved > 4) touched();
      clampGoal();
    });
    function pan(dx, dy) {
      var k = cam.radius * 0.0012;
      var cosT = Math.cos(cam.theta), sinT = Math.sin(cam.theta);
      goal.target.x += (-dx * cosT - dy * sinT) * k;
      goal.target.z += (dx * sinT - dy * cosT) * k;
    }
    function up(e) {
      var p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (p && dragMoved < 6 && downAt) click(e);
    }
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; });
    dom.addEventListener('pointerleave', function () { setHover(null); });
    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      goal.radius *= Math.exp(e.deltaY * 0.0011);
      clampGoal(); touched();
    }, { passive: false });

    var raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function pick(e) {
      var r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      var hits = raycaster.intersectObjects(hitMeshes, false);
      return hits.length ? hits[0].object.userData : null;
    }
    var hovered = null;
    function setHover(id) {
      if (hovered === id) return;
      hovered = id;
      dom.style.cursor = id ? 'pointer' : 'grab';
      if (handlers.onHover) handlers.onHover(id && id !== 'fox' ? id : null);
    }
    function hover(e) {
      var u = pick(e);
      setHover(u ? (u.fox ? 'fox' : u.zoneId) : null);
      if (handlers.onPointer) handlers.onPointer(e.clientX, e.clientY);
    }
    function click(e) {
      var u = pick(e);
      if (!u) { if (handlers.onSelect) handlers.onSelect(null); return; }
      if (u.fox) { foxJump = 1; if (handlers.onFox) handlers.onFox(); return; }
      if (handlers.onSelect) handlers.onSelect(u.zoneId);
    }
    var foxJump = 0, foxRage = 0, rageBack = null;   // foxRage: 여우가 커져서 카메라를 노려보는 남은 시간(초)

    // ---------- 강조 ----------
    var selected = [];
    function setActive(ids, strong) {
      selected = ids || [];
      Object.keys(zones).forEach(function (id) {
        var on = selected.indexOf(id) !== -1;
        zones[id].target = on ? 1 : 0;
        zones[id].beacon.visible = on;
        zones[id].label.el.classList.toggle('on', on);
        zones[id].label.el.classList.toggle('dim', selected.length > 0 && !on);
      });
    }
    function centerOf(ids) {
      var c = new THREE.Vector3(), n = 0, minX = 99, maxX = -99, minZ = 99, maxZ = -99, wallCount = 0;
      ids.forEach(function (id) {
        var z = zones[id]; if (!z) return;
        c.add(z.center); n++;
        minX = Math.min(minX, z.bounds.x0); maxX = Math.max(maxX, z.bounds.x1);
        minZ = Math.min(minZ, z.bounds.z0); maxZ = Math.max(maxZ, z.bounds.z1);
        if (z.isWall) wallCount++;
      });
      if (!n) return null;
      c.multiplyScalar(1 / n);
      return { c: c, span: Math.max(maxX - minX, maxZ - minZ), allWall: wallCount === n };
    }
    function focus(ids) {
      ids = (ids || []).filter(function (id) { return zones[id]; });
      if (!ids.length) return;
      setActive(ids);
      var info = centerOf(ids);
      if (info.allWall) {
        // 뒷벽 전시는 칠판 쪽에서 뒤를 돌아보는 방향으로
        setGoal({ target: new THREE.Vector3(info.c.x, 1.2, info.c.z - 0.4), theta: Math.PI, phi: 1.2, radius: 7.5 + info.span * 1.1 });
      } else {
        setGoal({ target: new THREE.Vector3(info.c.x, 0.7, info.c.z), theta: -info.c.x * 0.07, phi: 0.9, radius: 12.5 + info.span * 1.3 });
      }
      clampGoal();
    }
    function highlight(ids) {
      ids = (ids || []).filter(function (id) { return zones[id]; });
      setActive(ids);
      if (ids.length) {
        var info = centerOf(ids);
        setGoal({ target: new THREE.Vector3(info.c.x * 0.5, 0.6, info.c.z * 0.5 + 0.1), theta: 0, phi: 0.82, radius: fitRadius() * 0.9 });
      }
    }
    function overview() { setActive([]); setGoal({ target: new THREE.Vector3(0, 0.6, 0.2), theta: 0, phi: 0.82, radius: fitRadius() }); }
    function topView() { setGoal({ target: new THREE.Vector3(0, 0, 0.15), theta: 0, phi: 0.06, radius: fitRadius() * 1.02 }); }
    function entranceView() { setGoal({ target: new THREE.Vector3(-0.5, 1.0, 0.6), theta: -2.35, phi: 1.36, radius: 9.2 }); }

    function setPart(n) {
      if (n === part) return;
      part = n;
      refreshLabels();
      ['A', 'B', 'C', 'D'].forEach(function (id, i) { if (zones[id]) zones[id].lift = 1 + i * 0.12; });
    }

    function showRoute(on, stops) {
      routeOn = !!on;
      if (routeOn) buildRoute(stops || [{ id: 'info' }, { id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'check' }]);
      routeDots.visible = routeOn; walker.visible = routeOn;
      if (routeLine) routeLine.visible = routeOn;
      routeLabels.forEach(function (l) { l.el.hidden = !routeOn; });
      if (routeOn) { routeT = 0; setActive([]); setGoal({ target: new THREE.Vector3(0, 0.4, -2.3), theta: 0, phi: 0.3, radius: fitRadius() * 1.34 }); }   // 위쪽 안내 창에 가리지 않게 조금 아래로
    }

    // ---------- 그리기 ----------
    var clock = new THREE.Clock(), v = new THREE.Vector3(), frames = 0, slowFrames = 0, lowQuality = false;
    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      dom.style.width = w + 'px'; dom.style.height = h + 'px';
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    var firstFit = true;
    function frame() {
      requestAnimationFrame(frame);
      var dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

      // 느린 기기에서는 그림자를 끄고 해상도를 낮춘다
      frames++;
      if (!lowQuality && frames > 30 && frames < 240) {
        if (dt > 0.03) slowFrames++;
        if (slowFrames > 45) { lowQuality = true; renderer.shadowMap.enabled = false; sun.castShadow = false; renderer.setPixelRatio(1); resize(); }
      }

      if (autoRotate && !Object.keys(pointers).length) goal.theta += dt * 0.05;
      var k = 1 - Math.exp(-dt * 4.2);
      cam.target.lerp(goal.target, k);
      cam.theta += (goal.theta - cam.theta) * k;
      cam.phi += (goal.phi - cam.phi) * k;
      cam.radius += (goal.radius - cam.radius) * k;
      applyCamera();

      Object.keys(zones).forEach(function (id) {
        var z = zones[id];
        z.active += (z.target - z.active) * Math.min(1, dt * 8);
        var hov = hovered === id ? 1 : 0;
        z.pad.material.opacity = 0.13 + 0.2 * z.active + 0.1 * hov;
        z.ring.material.opacity = z.active * (0.65 + 0.35 * Math.sin(t * 4));
        if (z.beacon.visible) {
          z.beacon.position.set(z.center.x, z.labelY + 0.75 + Math.sin(t * 3.2) * 0.12, z.label.pos.z);
          z.beacon.rotation.y = t * 1.5;
        }
        // 부가 바뀔 때 책상이 살짝 들썩인다
        if (z.lift > 0) {
          z.lift = Math.max(0, z.lift - dt * 1.6);
          var ph = Math.min(1, z.lift);
          z.group.position.y = Math.sin(ph * Math.PI) * 0.28;
        } else if (!z.isWall) {
          z.group.position.y = (z.active * 0.05 + hov * 0.03);
        }
      });
      if (crowdCount) updateCrowd(dt, t);
      people.forEach(function (p) { p.g.position.y = Math.abs(Math.sin(t * 1.4 + p.phase)) * 0.025; });
      fox.userData.tail.rotation.x = -0.5 + Math.sin(t * 3) * 0.25;
      if (foxJump > 0) { foxJump = Math.max(0, foxJump - dt * 1.8); fox.position.y = Math.sin((1 - foxJump) * Math.PI) * 0.5; }
      // 숨은 기능: 여우가 커지면서 카메라 쪽을 노려본다. 끝나면 원래 크기와 원래 화면으로 돌아간다.
      if (foxRage > 0) {
        foxRage = Math.max(0, foxRage - dt);
        if (foxRage === 0) {
          fox.userData.angry.visible = false;
          fox.userData.eyeMat.color.set(0x6B3A1E);
          fox.userData.eyes.forEach(function (e) { e.scale.set(0.025, 0.035, 0.02); });
          if (rageBack) { setGoal(rageBack); rageBack = null; }
        }
      }
      var raging = foxRage > 0;
      var foxScale = raging ? 4.2 : 1.25;
      var foxTurn = raging ? Math.atan2(camera.position.x - fox.position.x, camera.position.z - fox.position.z) : 1.2;
      fox.scale.setScalar(fox.scale.x + (foxScale - fox.scale.x) * Math.min(1, dt * 6));
      fox.rotation.y += (foxTurn - fox.rotation.y) * Math.min(1, dt * 7);
      if (raging) fox.userData.eyeMat.color.setHSL(0, 1, 0.45 + 0.12 * Math.sin(t * 9));   // 빨간 눈이 두근거리듯 빛남

      if (routeOn && routeCurve) {
        routeT += dt;
        for (var i = 0; i < ROUTE_N; i++) {
          var u = ((i / ROUTE_N) + routeT * 1.1 / routeLen) % 1;
          routeCurve.getPointAt(u, v);
          dummy.position.copy(v);
          var s = 0.7 + 0.5 * Math.sin((u * routeLen * 0.9 - routeT * 3));
          dummy.scale.setScalar(Math.max(0.6, s));
          dummy.updateMatrix();
          routeDots.setMatrixAt(i, dummy.matrix);
        }
        routeDots.instanceMatrix.needsUpdate = true;
        var wu = (routeT * 1.3 / routeLen) % 1;
        routeCurve.getPointAt(wu, v);
        walker.position.set(v.x, Math.abs(Math.sin(routeT * 7)) * 0.05, v.z);
        walkerArrow.position.y = 1.95 + Math.sin(routeT * 4) * 0.08; walkerArrow.rotation.y = routeT * 2;
        walkerRing.scale.setScalar(1 + 0.25 * Math.sin(routeT * 4));
      }

      renderer.render(scene, camera);

      // 이름표 위치
      var w = container.clientWidth, h = container.clientHeight;
      for (var j = 0; j < labels.length; j++) {
        var l = labels[j];
        v.copy(l.pos).project(camera);
        if (v.z > 1 || v.z < -1) { l.el.style.display = 'none'; continue; }
        l.el.style.display = '';
        l.el.style.transform = 'translate(-50%,-50%) translate(' + ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px,' + ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px)';
      }
    }

    resize();
    goal.radius = cam.radius = fitRadius() * 1.5;   // 처음에 멀리서 다가오는 연출
    goal.radius = fitRadius();
    cam.theta = -0.9; cam.phi = 0.5;
    applyCamera();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { resize(); if (!selected.length && !routeOn) goal.radius = fitRadius(); }).observe(container);
    else root.addEventListener('resize', resize);
    frame();

    return {
      setPart: setPart, focus: focus, highlight: highlight, overview: overview, topView: topView, entranceView: entranceView,
      refresh: refresh, setCrowd: setCrowd, poke: function () { lastPoke = performance.now(); },
      setHot: function (ids) { hotZones = {}; (ids || []).forEach(function (id) { hotZones[id] = true; }); refreshLabels(); },
      foxRage: function (seconds) {
        if (foxRage > 0) return;
        foxRage = seconds;
        fox.userData.angry.visible = true;
        fox.userData.eyes.forEach(function (e) { e.scale.set(0.034, 0.03, 0.02); });
        // 지금 화면을 기억해 두고, 여우 얼굴 바로 앞으로 다가간다
        rageBack = { target: goal.target.clone(), theta: goal.theta, phi: goal.phi, radius: goal.radius };
        setActive([]);
        setGoal({ target: new THREE.Vector3(fox.position.x + 0.6, 3.1, fox.position.z + 0.4), theta: 0.95, phi: 1.33, radius: 6.2 });
      },
      crowdInfo: function () { return { count: crowdCount, opacity: crowdOpacity }; },
      showRoute: showRoute, isRouteOn: function () { return routeOn; },
      clear: function () { setActive([]); },
      setAutoRotate: function (on) { autoRotate = !!on; },
      setLabels: function (on) { labelLayer.style.display = on ? '' : 'none'; },
      zoneTitle: zoneTitle, zoneIds: function () { return Object.keys(zones); },
      colorOf: function (id) { return zones[id] ? zones[id].color.css : '#999'; },
      resize: resize,
      debug: { renderer: renderer, scene: scene, camera: camera, isLowQuality: function () { return lowQuality; } }
    };
  }

  root.CODEON_MAP = { create: create, COLORS: COLORS, seatPos: seatPos };
})(typeof self !== 'undefined' ? self : this);
