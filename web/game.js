/* ============================================================================
   Wigglitz 3D - web edition (HTML5 Canvas). Phase 4.

   A heightmap voxel raycaster: explore an open world, build towers, dig holes,
   and collect the Wigglitz. The world generator is a 1:1 port of the original
   hand-written .NET IL, verified to produce an identical map. Mouse-look uses
   the Pointer Lock API. Pure static file - no build step, no dependencies.
   ========================================================================== */
(function () {
  "use strict";

  // ---- constants ----------------------------------------------------------
  const IW = 480, IH = 270, SX = 2, SY = 2, TW = 48, TH = 60;
  const WALL_H = 3, FAR = 24, MAXSTEPS = 64, MAXTOP = 12, MINTOP = -8, EYE = 0.6, SEED = 1337;

  // ---- canvas / scaling ---------------------------------------------------
  const canvas = document.getElementById("screen");
  const ctx = canvas.getContext("2d");
  const low = document.createElement("canvas");
  low.width = IW; low.height = IH;
  const lowCtx = low.getContext("2d");
  const worldImg = lowCtx.createImageData(IW, IH);
  const buf = new Uint32Array(worldImg.data.buffer);   // ABGR (little-endian)
  const zbuf = new Float64Array(IW);
  let S = 2;

  function resize() {
    S = Math.max(1, Math.floor(Math.min(window.innerWidth / IW, window.innerHeight / IH)));
    canvas.width = IW * S; canvas.height = IH * S;
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", resize);

  // On-screen error display so a runtime fault is visible instead of a dead screen.
  let fatal = null;
  function showFatal(msg) {
    fatal = String(msg);
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#3a0d0d"; ctx.fillRect(0, 0, canvas.width || 480, canvas.height || 270);
      ctx.fillStyle = "#fff"; ctx.font = "13px monospace"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText("Wigglitz error (please send this to the dev):", 12, 12);
      ctx.fillText(fatal.substring(0, 110), 12, 34);
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("error", function (ev) {
    showFatal((ev.message || "error") + (ev.lineno ? (" : line " + ev.lineno) : ""));
  });

  // ---- color helpers (packed ABGR) ----------------------------------------
  function rgb(r, g, b) {
    r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  function scaleC(p, f) {
    return rgb((p & 255) * f, ((p >>> 8) & 255) * f, ((p >>> 16) & 255) * f);
  }
  function lerpC(a, b, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
    const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
    return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  }

  const WR = [0, 40, 150, 230, 90];
  const WG = [0, 180, 80, 200, 190];
  const WB = [0, 170, 200, 60, 90];
  const WALLP = WR.map((_, i) => rgb(WR[i], WG[i], WB[i]));
  const GRASS = rgb(70, 130, 70), DIRT = rgb(120, 85, 55);
  const FOG = rgb(120, 138, 170);           // atmospheric far color (matches horizon)
  const SKY_TOP = rgb(28, 22, 60), SKY_HOR = rgb(120, 138, 170);

  // ---- roster -------------------------------------------------------------
  const roster = [
    { name: "Winky",       a: [150, 80, 200], b: [40, 180, 170], eyes: 1 },
    { name: "Speckles",    a: [90, 190, 90],  b: [40, 180, 170], eyes: 2 },
    { name: "Scuba Steve", a: [60, 120, 210], b: [230, 200, 60], eyes: 2 },
    { name: "Miley",       a: [40, 180, 170], b: [150, 80, 200], eyes: 2 },
    { name: "Blooper",     a: [235, 140, 50], b: [245, 245, 245], eyes: 2 },
    { name: "Starshine",   a: [170, 90, 210], b: [240, 210, 80], eyes: 2 },
    { name: "Jett",        a: [130, 140, 150], b: [90, 190, 90], eyes: 2 },
    { name: "Melly",       a: [70, 170, 80],  b: [220, 70, 80], eyes: 2 }
  ];
  const cstr = (c, alpha) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (alpha === undefined ? 1 : alpha) + ")";
  const darken = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

  // ---- world generator: 1:1 port of WorldGen.il ---------------------------
  function cell(x, y, seed) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 0x9E3779B1)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
    h = (h ^ (h >>> 16)) | 0;
    const hu = h >>> 0;
    if (hu % 100 < 78) return 0;
    return ((hu >>> 7) % 4) + 1;
  }
  function hash2(x, y, s) {
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(s, 83492791)) | 0;
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) | 0; h ^= h >>> 15;
    return h >>> 0;
  }

  // ---- in-memory world state ----------------------------------------------
  const edits = new Map();
  const nkey = (x, y) => (x + 32768) * 65536 + (y + 32768);

  function baseTop(x, y) {
    if (Math.abs(x - SX) <= 2 && Math.abs(y - SY) <= 2) return 0;
    return cell(x, y, SEED) === 0 ? 0 : WALL_H;
  }
  function topAt(x, y) {
    const e = edits.get(nkey(x, y));
    return e !== undefined ? e.top : baseTop(x, y);
  }
  function colorAt(x, y) {
    const e = edits.get(nkey(x, y));
    let top, mat;
    if (e !== undefined) { top = e.top; mat = e.mat; }
    else if (Math.abs(x - SX) <= 2 && Math.abs(y - SY) <= 2) { top = 0; mat = 0; }
    else { const t = cell(x, y, SEED); if (t === 0) { top = 0; mat = 0; } else { top = WALL_H; mat = t; } }
    if (top < 0) return DIRT;
    if (top === 0 && mat === 0) return GRASS;
    const m = mat < 1 ? 1 : mat > 4 ? 4 : mat;
    return WALLP[m];
  }
  function setCell(x, y, top, mat) { edits.set(nkey(x, y), { top: top, mat: mat }); }

  // ---- collectibles -------------------------------------------------------
  const collectibles = [];
  function buildCollectibles() {
    for (let gy = -50; gy <= 50; gy++)
      for (let gx = -50; gx <= 50; gx++) {
        if (Math.abs(gx - SX) < 3 && Math.abs(gy - SY) < 3) continue;
        if (baseTop(gx, gy) !== 0) continue;
        const h = hash2(gx, gy, SEED ^ 0x55);
        if (h % 100 === 0) collectibles.push({ x: gx + 0.5, y: gy + 0.5, c: (h >>> 7) % roster.length, got: false, ty: 0, tx: 0 });
      }
  }

  // ---- achievements -------------------------------------------------------
  const ACH = [
    { id: "first", name: "First Friend" },
    { id: "half",  name: "Halfway There" },
    { id: "tower", name: "Architect" },
    { id: "dig",   name: "Spelunker" },
    { id: "all",   name: "Gotta Find 'Em All" }
  ];
  const unlocked = new Set();
  function unlock(id) {
    if (unlocked.has(id)) return;
    unlocked.add(id);
    const a = ACH.find(x => x.id === id);
    if (a) { toast("Achievement: " + a.name); beep(1400, 0.07); setTimeout(() => beep(1900, 0.09), 90); }
  }

  // ---- player / camera ----------------------------------------------------
  let posX = SX + 0.5, posY = SY + 0.5;
  let dirX = -1, dirY = 0, planeX = 0, planeY = 0.66;
  let pitch = 0, eyeZsmooth = EYE;
  let footZ = 0, vz = 0, onGround = true;
  const GRAV = 20, JUMP = 7.5, STEP = 1.1;
  let sel = 0, selBlock = 1;
  const owned = new Array(roster.length).fill(false);
  let totalFound = 0, completeShown = false;

  let state = "title";       // title | select | play
  let showCollection = false, showHelp = false;
  let locked = false;
  let sens = 1.0;
  const keys = new Set();
  let now = 0, lastT = 0, stepPhase = 0;
  let toastText = "", toastUntil = 0;
  const particles = [];

  function rotate(a) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const ox = dirX; dirX = dirX * ca - dirY * sa; dirY = ox * sa + dirY * ca;
    const opx = planeX; planeX = planeX * ca - planeY * sa; planeY = opx * sa + planeY * ca;
  }
  function startWorld() {
    state = "play"; showCollection = false; showHelp = false;
    posX = SX + 0.5; posY = SY + 0.5; dirX = -1; dirY = 0; planeX = 0; planeY = 0.66;
    pitch = 0; footZ = topAt(SX, SY); vz = 0; onGround = true; eyeZsmooth = footZ + EYE;
  }
  function toast(t) {
    if (completeShown && now < toastUntil) return;
    toastText = t; toastUntil = now + 2.2;
  }

  // ---- update -------------------------------------------------------------
  function tryMove(nx, ny) {
    const cy = Math.floor(posY);
    if (topAt(Math.floor(nx), cy) <= footZ + STEP) posX = nx;   // walk up small steps; jump clears taller
    const cx2 = Math.floor(posX);
    if (topAt(cx2, Math.floor(ny)) <= footZ + STEP) posY = ny;
  }
  function update(dt) {
    const ms = 3.4 * dt;
    const fwd = keys.has("KeyW") || keys.has("ArrowUp");
    const back = keys.has("KeyS") || keys.has("ArrowDown");
    const sl = keys.has("KeyA") || keys.has("ArrowLeft");
    const sr = keys.has("KeyD") || keys.has("ArrowRight");
    const px0 = posX, py0 = posY;
    if (fwd) tryMove(posX + dirX * ms, posY + dirY * ms);
    if (back) tryMove(posX - dirX * ms, posY - dirY * ms);
    if (sr) tryMove(posX + dirY * ms, posY - dirX * ms);
    if (sl) tryMove(posX - dirY * ms, posY + dirX * ms);

    // footstep ticks while actually moving
    const moved = Math.abs(posX - px0) + Math.abs(posY - py0);
    if (moved > 0.0005) { stepPhase += moved; if (stepPhase > 1.6) { stepPhase = 0; beep(140, 0.035); } }

    // vertical physics: jump + gravity, so you can hop, fall off ledges, and sink into holes
    if (keys.has("Space") && onGround) { vz = JUMP; onGround = false; beep(300, 0.04); }
    vz -= GRAV * dt; footZ += vz * dt;
    const gl = topAt(Math.floor(posX), Math.floor(posY));
    if (footZ <= gl) { footZ = gl; vz = 0; onGround = true; } else { onGround = false; }
    let k = dt * 18; if (k > 1) k = 1;
    eyeZsmooth += (footZ + EYE - eyeZsmooth) * k;

    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i];
      if (c.got) continue;
      const dx = c.x - posX, dy = c.y - posY;
      if (dx * dx + dy * dy < 0.30) {
        c.got = true; totalFound++;
        const isNew = !owned[c.c]; owned[c.c] = true;
        toast(isNew ? "NEW!  Collected " + roster[c.c].name + "!" : "Collected another " + roster[c.c].name);
        beep(880, 0.08); setTimeout(() => beep(1320, 0.10), 70);
        spawnSparkle(roster[c.c].a, roster[c.c].b);
        if (totalFound === 1) unlock("first");
        if (countOwned() >= 4) unlock("half");
        checkComplete();
      }
    }
  }
  function checkComplete() {
    for (let i = 0; i < owned.length; i++) if (!owned[i]) return;
    if (!completeShown) {
      completeShown = true; unlocked.add("all");
      toastText = "COLLECTION COMPLETE!  You found every Wigglitz!";
      toastUntil = now + 5.0;
      beep(660, 0.1); setTimeout(() => beep(990, 0.12), 110); setTimeout(() => beep(1320, 0.16), 240);
    }
  }

  // ---- build / dig --------------------------------------------------------
  function findTarget() {
    if (pitch < -50) return { tx: Math.floor(posX), ty: Math.floor(posY), on: true };  // look down -> dig down / pillar up
    const rdx = dirX, rdy = dirY;
    const pcx = Math.floor(posX), pcy = Math.floor(posY);
    const surface = topAt(pcx, pcy);
    let mapX = pcx, mapY = pcy;
    const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
    const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
    let stepX, stepY, sdx, sdy;
    if (rdx < 0) { stepX = -1; sdx = (posX - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - posX) * ddx; }
    if (rdy < 0) { stepY = -1; sdy = (posY - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - posY) * ddy; }
    let d = 0;
    for (let i = 0; i < 24; i++) {
      if (sdx < sdy) { d = sdx; sdx += ddx; mapX += stepX; } else { d = sdy; sdy += ddy; mapY += stepY; }
      if (d > 4.5) break;
      if (topAt(mapX, mapY) > surface) return { tx: mapX, ty: mapY, on: true };
    }
    return { tx: Math.floor(posX + dirX * 1.2), ty: Math.floor(posY + dirY * 1.2), on: false };
  }
  function doMine() {
    const t = findTarget();
    let top, mat;
    const e = edits.get(nkey(t.tx, t.ty));
    if (e) { top = e.top; mat = e.mat; } else { top = baseTop(t.tx, t.ty); mat = top > 0 ? cell(t.tx, t.ty, SEED) : 0; }
    let nt = top - 1; if (nt < MINTOP) nt = MINTOP;
    setCell(t.tx, t.ty, nt, mat);
    spawnBurst(colorAt(t.tx, t.ty), 14);
    beep(200, 0.05);
    if (nt <= -3) unlock("dig");
  }
  function doPlace() {
    const t = findTarget();   // looking down places under you (pillar up); gravity rides you up
    let top;
    const e = edits.get(nkey(t.tx, t.ty));
    top = e ? e.top : baseTop(t.tx, t.ty);
    let nt = top + 1; if (nt > MAXTOP) nt = MAXTOP;
    setCell(t.tx, t.ty, nt, selBlock);
    spawnBurst(WALLP[selBlock], 8);
    beep(420, 0.05);
    if (nt >= 5) unlock("tower");
  }

  // ---- particles ----------------------------------------------------------
  function spawnBurst(col, n) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, spd = 30 + Math.random() * 70;
      particles.push({ x: IW / 2, y: IH / 2, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 40, life: 0.45 + Math.random() * 0.3, max: 0.75, col: col });
    }
  }
  function spawnSparkle(a, b) {
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2, spd = 40 + Math.random() * 110;
      const c = i % 3 === 0 ? rgb(255, 240, 120) : i % 3 === 1 ? rgb(a[0], a[1], a[2]) : rgb(b[0], b[1], b[2]);
      particles.push({ x: IW / 2, y: IH * 0.62, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 60, life: 0.6 + Math.random() * 0.5, max: 1.1, col: c });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---- audio --------------------------------------------------------------
  let actx = null;
  function ensureAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
    } catch (e) { /* ignore */ }
  }
  function beep(freq, dur) {
    try {
      if (!actx) return;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.value = freq; g.gain.value = 0.045;
      o.connect(g); g.connect(actx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.stop(actx.currentTime + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  // ---- renderer (heightmap voxel) -----------------------------------------
  function shadeDist(col, d, side, checker) {
    let f = 1.9 / (d + 0.9); if (f > 1) f = 1; else if (f < 0.32) f = 0.32;
    if (side === 1) f *= 0.82;
    f *= checker;
    let out = scaleC(col, f);
    let fogT = (d - 3) / (FAR - 3); if (fogT < 0) fogT = 0; else if (fogT > 0.72) fogT = 0.72;
    return lerpC(out, FOG, fogT);
  }
  function shadeFactor(d) { let f = 1.9 / (d + 0.9); return f > 1 ? 1 : f < 0.4 ? 0.4 : f; }
  function skyAt(y, horizon) { return lerpC(SKY_TOP, SKY_HOR, horizon <= 1 ? 0 : y / horizon); }

  function renderWorld() {
    const horizon = IH / 2 + pitch, eyeZ = eyeZsmooth;
    const pcx = Math.floor(posX), pcy = Math.floor(posY);
    for (let x = 0; x < IW; x++) {
      const cameraX = 2 * x / IW - 1;
      const rdx = dirX + planeX * cameraX, rdy = dirY + planeY * cameraX;
      let mapX = pcx, mapY = pcy;
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      let stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (posX - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - posX) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (posY - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - posY) * ddy; }
      let currentTopY = IH, side = 0, d = 0, zb = FAR, zbset = false;
      for (let s = 0; s < MAXSTEPS; s++) {
        if (sdx < sdy) { d = sdx; sdx += ddx; mapX += stepX; side = 0; }
        else { d = sdy; sdy += ddy; mapY += stepY; side = 1; }
        if (d > FAR) break;
        if (d < 0.05) continue;
        const top = topAt(mapX, mapY);
        if (!zbset && top >= eyeZ) { zb = d; zbset = true; }
        let iyT = (horizon - (top - eyeZ) * (IH / d)) | 0;
        if (iyT < currentTopY) {
          if (iyT < 0) iyT = 0;
          const checker = ((mapX + mapY) & 1) === 0 ? 1.0 : 0.84;   // grid texture
          const col = shadeDist(colorAt(mapX, mapY), d, side, checker);
          let bot = currentTopY | 0; if (bot > IH) bot = IH;
          for (let y = iyT; y < bot; y++) buf[y * IW + x] = col;
          buf[iyT * IW + x] = scaleC(col, 1.25);     // bright top edge -> blocky definition + floor grid lines
          currentTopY = iyT;
          if (currentTopY <= 0) break;
        }
      }
      zbuf[x] = zb;
      let ct = currentTopY | 0; if (ct > IH) ct = IH;
      for (let y = 0; y < ct; y++) buf[y * IW + x] = skyAt(y, horizon);
    }
  }

  // ---- sprites (pre-rendered Wigglitz, billboarded with depth test) -------
  let sprTex = [];
  function buildSprites() {
    sprTex = roster.map(function (w) {
      const c = document.createElement("canvas"); c.width = TW; c.height = TH;
      const g = c.getContext("2d");
      drawWig(g, TW / 2, TH * 0.56, 34, w, 0, false);
      return new Uint32Array(g.getImageData(0, 0, TW, TH).data.buffer);
    });
  }
  function drawSprites() {
    const horizon = IH / 2 + pitch, eyeZ = eyeZsmooth;
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i];
      if (c.got) { c.ty = -1; continue; }
      const sx = c.x - posX, sy = c.y - posY;
      c.tx = invDet * (dirY * sx - dirX * sy);
      c.ty = invDet * (-planeY * sx + planeX * sy);
    }
    collectibles.sort((a, b) => b.ty - a.ty);
    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i];
      if (c.got || c.ty < 0.15) continue;
      const tex = sprTex[c.c];
      const cellTop = topAt(Math.floor(c.x), Math.floor(c.y));
      const screenX = ((IW / 2) * (1 + c.tx / c.ty)) | 0;
      const fullH = (IH / c.ty) | 0;
      const sprH = (fullH * 0.8) | 0;
      const sprW = (sprH * TW / TH) | 0;
      const hover = (Math.sin(now * 2 + i) * fullH * 0.04) | 0;
      const feetY = ((horizon - (cellTop - eyeZ) * (IH / c.ty)) | 0) + hover;
      const endY = feetY, startY = endY - sprH, startX = screenX - (sprW >> 1);
      if (startX + sprW < 0 || startX >= IW || sprW <= 0 || sprH <= 0) continue;
      const f = shadeFactor(c.ty);
      for (let x = startX; x < startX + sprW; x++) {
        if (x < 0 || x >= IW) continue;
        if (!(c.ty < zbuf[x])) continue;
        const texX = ((x - startX) * TW / sprW) | 0;
        if (texX < 0 || texX >= TW) continue;
        for (let y = startY < 0 ? 0 : startY; y < endY; y++) {
          if (y >= IH) break;
          const texY = ((y - startY) * TH / sprH) | 0;
          if (texY < 0 || texY >= TH) continue;
          const px = tex[texY * TW + texX];
          if ((px >>> 24) < 128) continue;
          buf[y * IW + x] = scaleC(px, f);
        }
      }
    }
  }

  // ---- Wigglitz sprite (vector; used for HUD, menus, and pre-render) ------
  function ell(g, x, y, w, h, style) { g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); g.fillStyle = style; g.fill(); }
  function drawWig(g, cx, cy, s, w, t, bobBig) {
    const bob = Math.sin(t * 4) * s * (bobBig ? 0.05 : 0.08);
    const wg = Math.sin(t * 3) * s * 0.04;
    cy += bob;
    const bw = s, bh = s * 1.12;
    ell(g, cx - bw * 0.45 + wg, cy + bh * 0.5, bw * 0.9, bh * 0.18, "rgba(0,0,0,0.24)");
    ell(g, cx - bw * 0.32 + wg, cy + bh * 0.34, bw * 0.26, bh * 0.18, cstr(darken(w.a, 0.7)));
    ell(g, cx + bw * 0.06 + wg, cy + bh * 0.34, bw * 0.26, bh * 0.18, cstr(darken(w.a, 0.7)));
    ell(g, cx - bw / 2 + wg, cy - bh / 2, bw, bh, cstr(w.a));
    ell(g, cx - bw * 0.28 + wg, cy - bh * 0.10, bw * 0.56, bh * 0.5, cstr(w.b));
    const ex = cx + wg, ey = cy - bh * 0.18, look = Math.sin(t * 1.5) * s * 0.04;
    if (w.eyes === 1) {
      const er = s * 0.26; ell(g, ex - er, ey - er, er * 2, er * 2, "#fff");
      const pr = er * 0.5; ell(g, ex - pr + look, ey - pr, pr * 2, pr * 2, "rgb(30,30,40)");
    } else {
      const er = s * 0.15, off = s * 0.18;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const exx = ex + sgn * off;
        ell(g, exx - er, ey - er, er * 2, er * 2, "#fff");
        const pr = er * 0.5; ell(g, exx - pr + look, ey - pr, pr * 2, pr * 2, "rgb(30,30,40)");
      }
    }
    g.strokeStyle = cstr(darken(w.a, 0.6)); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx + wg, cy - bh * 0.5); g.lineTo(cx + wg, cy - bh * 0.66); g.stroke();
    ell(g, cx + wg - s * 0.05, cy - bh * 0.72, s * 0.1, s * 0.1, cstr(w.b));
  }

  // ---- HUD / menus --------------------------------------------------------
  function centerText(g, s, font, color, cx, cy) {
    g.font = font; g.textBaseline = "middle"; g.textAlign = "center";
    g.fillStyle = color; g.fillText(s, cx, cy);
    g.textAlign = "left";
  }
  function countOwned() { let n = 0; for (let i = 0; i < owned.length; i++) if (owned[i]) n++; return n; }

  function drawParticles(g) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let a = p.life / p.max; if (a < 0) a = 0; if (a > 1) a = 1;
      g.fillStyle = "rgba(" + (p.col & 255) + "," + ((p.col >>> 8) & 255) + "," + ((p.col >>> 16) & 255) + "," + a + ")";
      g.fillRect(p.x, p.y, 2.4, 2.4);
    }
  }

  function drawHotbar(g) {
    const n = 4, cs = 26, gap = 4, total = n * cs + (n - 1) * gap;
    const ox = IW / 2 - total / 2, oy = IH - 42;
    for (let i = 1; i <= n; i++) {
      const x = ox + (i - 1) * (cs + gap);
      g.fillStyle = "rgb(" + WR[i] + "," + WG[i] + "," + WB[i] + ")";
      g.fillRect(x, oy, cs, cs);
      g.strokeStyle = i === selBlock ? "rgb(255,240,90)" : "rgba(0,0,0,0.6)";
      g.lineWidth = i === selBlock ? 2.5 : 1; g.strokeRect(x, oy, cs, cs);
      g.fillStyle = "#fff"; g.font = "bold 9px Segoe UI"; g.fillText("" + i, x + 3, oy + 10);
    }
  }

  function drawMiniMap(g) {
    const R = 7, cs = 5, size = (2 * R + 1) * cs, ox = IW - size - 6, oy = 22;
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(ox - 2, oy - 2, size + 4, size + 4);
    const pcx = Math.floor(posX), pcy = Math.floor(posY);
    for (let yy = -R; yy <= R; yy++)
      for (let xx = -R; xx <= R; xx++) {
        const e = edits.get(nkey(pcx + xx, pcy + yy));
        let top, mat;
        if (e) { top = e.top; mat = e.mat; } else { top = baseTop(pcx + xx, pcy + yy); mat = top > 0 ? cell(pcx + xx, pcy + yy, SEED) : 0; }
        if (top > 0) { const m = mat < 1 ? 1 : mat > 4 ? 4 : mat, br = 0.5 + 0.5 * Math.min(1, top / 4); g.fillStyle = "rgb(" + (WR[m] * br | 0) + "," + (WG[m] * br | 0) + "," + (WB[m] * br | 0) + ")"; }
        else if (top < 0) g.fillStyle = "rgb(90,65,45)";
        else g.fillStyle = "rgb(55,75,55)";
        g.fillRect(ox + (xx + R) * cs, oy + (yy + R) * cs, cs - 1, cs - 1);
      }
    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i]; if (c.got) continue;
      const rx = Math.floor(c.x) - pcx, ry = Math.floor(c.y) - pcy;
      if (rx < -R || rx > R || ry < -R || ry > R) continue;
      ell(g, ox + (rx + R) * cs, oy + (ry + R) * cs, cs - 1, cs - 1, "rgb(255,245,120)");
    }
    // player + facing arrow
    const pcxv = ox + R * cs + cs / 2, pcyv = oy + R * cs + cs / 2;
    g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(pcxv, pcyv); g.lineTo(pcxv + dirX * cs * 1.8, pcyv + dirY * cs * 1.8); g.stroke();
    ell(g, pcxv - 1.5, pcyv - 1.5, 3, 3, "#fff");
  }

  function drawToast(g) {
    if (now >= toastUntil || !toastText) return;
    let a = Math.min(1, (toastUntil - now) / 0.5);
    g.font = "bold 12px Segoe UI"; g.textAlign = "center";
    const w = g.measureText(toastText).width;
    g.fillStyle = "rgba(0,0,0," + (0.6 * a) + ")"; g.fillRect(IW / 2 - w / 2 - 8, 64, w + 16, 20);
    g.fillStyle = "rgba(255,235,120," + a + ")"; g.textBaseline = "middle"; g.fillText(toastText, IW / 2, 76);
    g.textAlign = "left";
  }

  function drawHud(g) {
    const t = findTarget();
    g.strokeStyle = t.on ? "rgba(255,230,90,1)" : "rgba(255,255,255,0.7)";
    g.lineWidth = t.on ? 1.8 : 1;
    g.beginPath(); g.moveTo(IW / 2 - 5, IH / 2); g.lineTo(IW / 2 + 5, IH / 2);
    g.moveTo(IW / 2, IH / 2 - 5); g.lineTo(IW / 2, IH / 2 + 5); g.stroke();

    drawHotbar(g); drawMiniMap(g);

    const s = "Wigglitz  " + countOwned() + " / " + roster.length;
    g.font = "bold 10px Segoe UI"; g.textAlign = "center";
    const w = g.measureText(s).width;
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect(IW / 2 - w / 2 - 6, 4, w + 12, 15);
    g.fillStyle = "#ffe85a"; g.textBaseline = "middle"; g.fillText(s, IW / 2, 12); g.textAlign = "left";

    g.font = "7px Segoe UI"; g.textBaseline = "alphabetic"; g.fillStyle = "rgba(255,255,255,0.88)";
    g.fillText("LMB dig   RMB build   Space jump   1-4 block   H help", 6, IH - 6);
    g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,0.7)";
    g.fillText("Achievements " + unlocked.size + "/" + ACH.length, IW - 6, IH - 6); g.textAlign = "left";

    if (!locked) {
      g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, IH / 2 - 18, IW, 26);
      centerText(g, "Click to look, build & dig", "bold 11px Segoe UI", "#fff", IW / 2, IH / 2 - 5);
    }
    drawToast(g);
  }

  // ---- menus --------------------------------------------------------------
  function drawMenuBg(g) {
    const grad = g.createLinearGradient(0, 0, 0, IH);
    grad.addColorStop(0, "rgb(35,25,70)"); grad.addColorStop(1, "rgb(20,60,75)");
    g.fillStyle = grad; g.fillRect(0, 0, IW, IH);
    for (let i = 0; i < 26; i++) {
      const ph = now * 0.4 + i * 1.7;
      const dx = (Math.sin(ph) * 0.5 + 0.5) * IW;
      const dy = ((i * 53) % IH) + Math.sin(now + i) * 6;
      g.fillStyle = "rgba(255,255,255,0.14)"; g.beginPath(); g.arc(dx, dy, 1.5, 0, Math.PI * 2); g.fill();
    }
  }
  function drawTitle(g) {
    centerText(g, "WIGGLITZ", "bold 34px Segoe UI", "rgb(255,230,90)", IW / 2, 56);
    centerText(g, "3D  SANDBOX", "bold 10px Segoe UI", "rgb(120,220,210)", IW / 2, 88);
    drawWig(g, IW / 2, 138, 44, roster[0], now, false);
    const n = roster.length, sp = IW / (n + 1);
    for (let i = 0; i < n; i++) drawWig(g, sp * (i + 1), 208, 15, roster[i], now * 1.2 + i * 0.6, false);
    if (((now * 2) | 0) % 2 === 0) centerText(g, "Click or press ENTER to start", "9px Segoe UI", "#fff", IW / 2, 176);
    centerText(g, "explore  -  build towers  -  dig holes  -  collect them all", "8px Segoe UI", "rgb(180,200,210)", IW / 2, 236);
    g.font = "7px Segoe UI"; g.fillStyle = "rgba(255,255,255,0.4)"; g.textAlign = "right";
    g.fillText("v4", IW - 6, IH - 6); g.textAlign = "left";
  }
  function startBtn() { return { x: IW / 2 - 52, y: 244, w: 104, h: 20 }; }
  function drawSelect(g) {
    centerText(g, "CHOOSE YOUR WIGGLITZ", "bold 16px Segoe UI", "rgb(255,230,90)", IW / 2, 22);
    const n = roster.length, spacing = IW / (n + 1), rowY = 108;
    for (let i = 0; i < n; i++) {
      const cx = spacing * (i + 1), scale = i === sel ? 38 : 26;
      if (i === sel) { g.strokeStyle = "rgb(255,230,90)"; g.lineWidth = 2; g.strokeRect(cx - 26, rowY - 42, 52, 86); }
      drawWig(g, cx, rowY, scale, roster[i], now + i, false);
      centerText(g, roster[i].name, i === sel ? "bold 8px Segoe UI" : "7px Segoe UI", i === sel ? "#fff" : "rgb(150,160,175)", cx, rowY + 36);
    }
    centerText(g, "You picked:  " + roster[sel].name, "bold 12px Segoe UI", "#fff", IW / 2, 182);
    const b = startBtn();
    g.fillStyle = "rgb(90,200,120)"; g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 1.5; g.strokeRect(b.x, b.y, b.w, b.h);
    centerText(g, "START", "bold 11px Segoe UI", "rgb(6,33,15)", IW / 2, b.y + b.h / 2 + 1);
    centerText(g, "click a Wigglitz to choose, then START   (or press ENTER)", "7px Segoe UI", "rgb(205,220,230)", IW / 2, b.y + b.h + 9);
  }
  function drawCollection(g) {
    g.fillStyle = "rgba(12,10,26,0.85)"; g.fillRect(0, 0, IW, IH);
    centerText(g, "YOUR WIGGLITZ COLLECTION", "bold 18px Segoe UI", "rgb(255,230,90)", IW / 2, 24);
    centerText(g, "Found " + countOwned() + " of " + roster.length, "bold 9px Segoe UI", "#fff", IW / 2, 46);
    const pw = 200, px = IW / 2 - pw / 2, py = 54;
    g.fillStyle = "rgba(255,255,255,0.15)"; g.fillRect(px, py, pw, 6);
    g.fillStyle = "rgb(255,230,90)"; g.fillRect(px, py, pw * countOwned() / roster.length, 6);
    const cols = 4, cw = 100, chh = 76, ox = IW / 2 - (cols * cw) / 2, oy = 72;
    for (let i = 0; i < roster.length; i++) {
      const cxi = i % cols, cyi = (i / cols) | 0;
      const cx = ox + cxi * cw + cw / 2, cy = oy + cyi * chh + 28;
      if (owned[i]) { drawWig(g, cx, cy, 28, roster[i], now + i, false); centerText(g, roster[i].name, "8px Segoe UI", "#fff", cx, cy + 32); }
      else { ell(g, cx - 14, cy - 17, 28, 34, "rgb(60,60,70)"); centerText(g, "? ? ?", "8px Segoe UI", "rgb(120,120,130)", cx, cy + 32); }
    }
    centerText(g, completeShown ? "COMPLETE!   Press C to return" : "Explore to find them all.   Press C to return", "8px Segoe UI", "rgb(205,220,230)", IW / 2, IH - 12);
  }
  function drawHelp(g) {
    g.fillStyle = "rgba(12,10,26,0.9)"; g.fillRect(0, 0, IW, IH);
    centerText(g, "HOW TO PLAY", "bold 18px Segoe UI", "rgb(255,230,90)", IW / 2, 28);
    const lines = [
      "Mouse  -  look around  (click the screen to capture it)",
      "W A S D  -  move          Space  -  jump",
      "Left click  -  DIG    (look down to dig straight down)",
      "Right click  -  BUILD    (look down to pillar straight up)",
      "1 - 4  -  block color      - / +  -  mouse sensitivity",
      "C  -  collection     H  -  help     Esc  -  back to menu"
    ];
    g.font = "9px Segoe UI"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#e8e8f0";
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], IW / 2, 62 + i * 22);
    g.textAlign = "left";
    centerText(g, "Goal: find all " + roster.length + " Wigglitz hidden across the world!", "bold 9px Segoe UI", "rgb(150,220,180)", IW / 2, IH - 36);
    centerText(g, "Press H or Esc to return", "8px Segoe UI", "rgb(205,220,230)", IW / 2, IH - 14);
  }

  // ---- frame --------------------------------------------------------------
  function render() {
    if (fatal) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (state === "play") {
      renderWorld(); drawSprites();
      lowCtx.putImageData(worldImg, 0, 0);
      ctx.drawImage(low, 0, 0);
      drawParticles(ctx); drawHud(ctx);
      if (showCollection) drawCollection(ctx);
      if (showHelp) drawHelp(ctx);
    } else {
      drawMenuBg(ctx);
      if (state === "title") drawTitle(ctx); else drawSelect(ctx);
    }
  }
  function loop(ts) {
    try {
      now = ts / 1000;
      let dt = now - lastT; lastT = now; if (dt > 0.05) dt = 0.05;
      if (state === "play" && !showCollection && !showHelp) update(dt);
      if (state === "play") updateParticles(dt);
      render();
    } catch (err) {
      showFatal((err && err.message) ? err.message : String(err));
    }
    requestAnimationFrame(loop);
  }

  // ---- input --------------------------------------------------------------
  window.addEventListener("keydown", function (e) {
    keys.add(e.code); ensureAudio();
    if (state === "title") { if (e.code === "Enter") state = "select"; }
    else if (state === "select") {
      if (e.code === "ArrowLeft") sel = (sel - 1 + roster.length) % roster.length;
      else if (e.code === "ArrowRight") sel = (sel + 1) % roster.length;
      else if (e.code === "Enter") startWorld();
    } else {
      if (e.code === "KeyC" || e.code === "Tab") { showCollection = !showCollection; showHelp = false; if (showCollection && document.pointerLockElement) document.exitPointerLock(); }
      else if (e.code === "KeyH") { showHelp = !showHelp; showCollection = false; if (showHelp && document.pointerLockElement) document.exitPointerLock(); }
      else if (e.code === "Digit1") selBlock = 1;
      else if (e.code === "Digit2") selBlock = 2;
      else if (e.code === "Digit3") selBlock = 3;
      else if (e.code === "Digit4") selBlock = 4;
      else if (e.code === "Minus") { sens = Math.max(0.2, sens / 1.25); toast("Mouse sensitivity " + Math.round(sens * 100) + "%"); }
      else if (e.code === "Equal") { sens = Math.min(4, sens * 1.25); toast("Mouse sensitivity " + Math.round(sens * 100) + "%"); }
      else if (e.code === "Escape") { if (showCollection) showCollection = false; else if (showHelp) showHelp = false; else state = "select"; }
    }
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].indexOf(e.code) >= 0) e.preventDefault();
  });
  window.addEventListener("keyup", function (e) { keys.delete(e.code); });

  canvas.addEventListener("click", function (e) {
    canvas.focus(); ensureAudio();
    if (state === "title") { state = "select"; return; }
    if (state === "select") {
      const ix = e.offsetX / S, iy = e.offsetY / S, b = startBtn();
      if (ix >= b.x && ix <= b.x + b.w && iy >= b.y && iy <= b.y + b.h) { startWorld(); return; }
      const n = roster.length, spacing = IW / (n + 1);
      let i = Math.round(ix / spacing) - 1;
      if (i < 0) i = 0; else if (i >= n) i = n - 1;
      sel = i; return;                       // choose only; START begins the game
    }
    if (showCollection || showHelp) return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", function () { locked = document.pointerLockElement === canvas; });
  document.addEventListener("mousemove", function (e) {
    if (!locked) return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    if (mx) rotate(mx * 0.0019 * sens);
    if (my) { pitch -= my * 0.45 * sens; if (pitch < -120) pitch = -120; else if (pitch > 120) pitch = 120; }
  });
  canvas.addEventListener("mousedown", function (e) {
    if (state === "play" && !showCollection && !showHelp && locked) { if (e.button === 0) doMine(); else if (e.button === 2) doPlace(); }
  });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // ---- boot ---------------------------------------------------------------
  resize();
  buildSprites();
  buildCollectibles();
  try { canvas.focus(); } catch (e) { /* ignore */ }
  window.addEventListener("load", function () { try { canvas.focus(); } catch (e) { } });
  requestAnimationFrame(loop);
})();
