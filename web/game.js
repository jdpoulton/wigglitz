/* ============================================================================
   Wigglitz Craft - v7.  A true voxel sandbox (Minecraft-style) in one file.

   - Real 3D block grid (Uint8 voxels), per-pixel DDA raycaster: free look in
     any direction, dig caves, build in any direction, textured & shaded blocks,
     translucent water/glass, distance fog, day/night sky.
   - Minecraft-style physics: AABB collision, walk / jump / gravity, plus a
     creative FLY toggle.
   - Pick a Wigglitz collection (themed WORLD) -> pick a Wigglitz avatar ->
     explore a generated island and collect the other Wigglitz (real art,
     wiggling billboards). Achievements, sound, polished menus & HUD.

   Pure static file. No build step, no dependencies.
   ========================================================================== */
(function () {
  "use strict";

  // =====================================================================
  //  Canvas: 3D renders to an internal buffer (adaptive res), UI overlays
  //  in a virtual 480x270 space. Everything stretches to fill the window.
  // =====================================================================
  const UIW = 480, UIH = 270;
  const canvas = document.getElementById("screen");
  const vctx = canvas.getContext("2d");
  const low = document.createElement("canvas");
  let lctx, frame, fbuf, depth, RW = 320, RH = 180;
  const RES = [[256, 144], [320, 180], [384, 216], [448, 252]];
  let resLevel = 1;
  function setRes(w, h) {
    RW = w; RH = h; low.width = w; low.height = h;
    lctx = low.getContext("2d");
    frame = lctx.createImageData(w, h);
    fbuf = new Uint32Array(frame.data.buffer);
    depth = new Float32Array(w * h);
  }
  function resize() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);

  // ---- crash-visible error overlay ----
  let fatal = null;
  function showFatal(msg) {
    fatal = String(msg);
    try {
      vctx.setTransform(1, 0, 0, 1, 0, 0);
      vctx.fillStyle = "#3a0d0d"; vctx.fillRect(0, 0, canvas.width || 800, canvas.height || 400);
      vctx.fillStyle = "#fff"; vctx.font = "16px monospace"; vctx.textAlign = "left"; vctx.textBaseline = "top";
      vctx.fillText("Wigglitz error (send this to the dev):", 16, 16);
      vctx.fillText(fatal.substring(0, 140), 16, 42);
    } catch (e) { }
  }
  window.addEventListener("error", function (ev) { showFatal((ev.message || "error") + (ev.lineno ? (" : line " + ev.lineno) : "")); });

  // =====================================================================
  //  Color helpers (packed ABGR, little-endian for ImageData)
  // =====================================================================
  function rgb(r, g, b) {
    r = r < 0 ? 0 : r > 255 ? 255 : r | 0; g = g < 0 ? 0 : g > 255 ? 255 : g | 0; b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  function shade(p, f) { return rgb((p & 255) * f, ((p >>> 8) & 255) * f, ((p >>> 16) & 255) * f); }
  function mix(a, b, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255, br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
    return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  }
  const cstr = (c, al) => "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (al === undefined ? 1 : al) + ")";

  function hash2(x, y, s) {
    let h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(s | 0, 83492791)) | 0;
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) | 0; h ^= h >>> 15; return h >>> 0;
  }
  const rnd01 = (x, y, s) => (hash2(x, y, s) >>> 8) / 16777216;

  // =====================================================================
  //  Worlds (Wigglitz collections) - theme + real-art rosters
  // =====================================================================
  const WORLDS = [
    {
      name: "Stars & Stripes", seed: 1337,
      grass: [86, 140, 70], dirt: [122, 92, 60], stone: [128, 128, 134], sand: [222, 210, 160],
      blocks: [[200, 60, 60], [235, 235, 245], [60, 90, 200], [210, 170, 70]],
      sky: [120, 165, 235], fog: [180, 205, 240], sea: 22,
      roster: [{ name: "Abraham", file: "ss1.png" }, { name: "Archie", file: "ss2.png" }, { name: "Atlas", file: "ss3.png" }, { name: "Banner", file: "ss4.png" }, { name: "Betsy", file: "ss5.png" }]
    },
    {
      name: "Ocean", seed: 52021,
      grass: [70, 170, 120], dirt: [90, 110, 120], stone: [110, 120, 135], sand: [225, 215, 165],
      blocks: [[40, 140, 210], [60, 200, 200], [205, 230, 245], [120, 90, 200]],
      sky: [110, 175, 225], fog: [150, 200, 230], sea: 26,
      roster: [{ name: "Anchor", file: "oc1.png" }, { name: "Aqua", file: "oc2.png" }, { name: "Arrnold", file: "oc3.png" }, { name: "Blooper", file: "oc4.png" }, { name: "Bonkus", file: "oc5.png" }]
    },
    {
      name: "Foodz", seed: 61453,
      grass: [120, 175, 80], dirt: [132, 96, 60], stone: [140, 130, 120], sand: [230, 205, 150],
      blocks: [[220, 70, 70], [240, 200, 70], [120, 190, 80], [210, 140, 60]],
      sky: [240, 200, 170], fog: [240, 210, 180], sea: 20,
      roster: [{ name: "Appy", file: "fz1.png" }, { name: "Berry", file: "fz2.png" }, { name: "Broc", file: "fz3.png" }, { name: "Clementine", file: "fz4.png" }, { name: "Colada", file: "fz5.png" }]
    },
    {
      name: "Kid's Monsters", seed: 9001,
      grass: [96, 130, 110], dirt: [92, 72, 112], stone: [96, 96, 120], sand: [180, 170, 200],
      blocks: [[170, 80, 210], [80, 210, 130], [240, 120, 60], [60, 200, 220]],
      sky: [120, 95, 175], fog: [150, 120, 190], sea: 22,
      roster: [{ name: "Aqua", file: "km1.png" }, { name: "Bernadette", file: "km2.png" }, { name: "Flamo", file: "km3.png" }, { name: "Fuzzby", file: "km4.png" }, { name: "Lookey", file: "km5.png" }]
    }
  ];

  // =====================================================================
  //  Block types
  // =====================================================================
  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, LOG = 4, LEAVES = 5, SAND = 6, PLANK = 7, GLASS = 8, WATER = 9, BEDROCK = 10, T1 = 11, T2 = 12, T3 = 13, T4 = 14;
  const NTYPES = 15;
  function isSolid(t) { return t !== AIR && t !== WATER; }       // glass is solid
  function isOpaque(t) { return t !== AIR && t !== WATER && t !== GLASS; }
  // hotbar palette (creative): block types you can place
  const HOTBAR = [GRASS, DIRT, STONE, LOG, PLANK, LEAVES, SAND, T1, T2];

  // ---- per-world textures (16x16 tiles) ----
  const TS = 16;
  let tex = [];                 // tex[type] = {top, side, bottom} each Uint32Array(256)
  function tileFill(base, vr, seedoff) {
    const t = new Uint32Array(TS * TS);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const n = 1 + (rnd01(x, y, 9173 + seedoff) - 0.5) * vr;
      t[y * TS + x] = rgb(base[0] * n, base[1] * n, base[2] * n);
    }
    return t;
  }
  function buildTextures(w) {
    tex = new Array(NTYPES);
    const grass = w.grass, dirt = w.dirt, stone = w.stone, sand = w.sand;
    const grassTop = tileFill(grass, 0.22, 1);
    const dirtTile = tileFill(dirt, 0.30, 2);
    // grass side = dirt with a green top strip + a few hanging blades
    const grassSide = dirtTile.slice();
    for (let x = 0; x < TS; x++) {
      const lip = 3 + ((hash2(x, 0, 7) % 3));
      for (let y = 0; y < lip; y++) { const n = 1 + (rnd01(x, y, 5) - 0.5) * 0.22; grassSide[y * TS + x] = rgb(grass[0] * n, grass[1] * n, grass[2] * n); }
    }
    const stoneTile = tileFill(stone, 0.26, 3);
    const sandTile = tileFill(sand, 0.18, 4);
    // logs
    const logSide = tileFill([110, 78, 48], 0.18, 5);
    for (let x = 0; x < TS; x++) if (x % 5 === 0) for (let y = 0; y < TS; y++) logSide[y * TS + x] = shade(logSide[y * TS + x], 0.78);
    const logTop = tileFill([150, 112, 72], 0.12, 6);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const dx = x - 7.5, dy = y - 7.5, r = Math.sqrt(dx * dx + dy * dy); if ((r | 0) % 2 === 0) logTop[y * TS + x] = shade(logTop[y * TS + x], 0.85); }
    // leaves (themed-ish green) with dark speckle
    const leaves = tileFill([54, 124, 56], 0.34, 7);
    // planks (horizontal lines)
    const plank = tileFill([176, 140, 90], 0.14, 8);
    for (let y = 0; y < TS; y++) if (y % 4 === 0) for (let x = 0; x < TS; x++) plank[y * TS + x] = shade(plank[y * TS + x], 0.7);
    // glass (light, with frame) - rendered translucent
    const glass = new Uint32Array(TS * TS);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const edge = (x === 0 || y === 0 || x === TS - 1 || y === TS - 1); glass[y * TS + x] = edge ? rgb(210, 235, 245) : rgb(180, 220, 235); }
    const bedrock = tileFill([60, 60, 66], 0.5, 9);
    const water = tileFill([40, 90, 180], 0.12, 10);
    function uni(t) { return { top: t, side: t, bottom: t }; }
    tex[GRASS] = { top: grassTop, side: grassSide, bottom: dirtTile };
    tex[DIRT] = uni(dirtTile);
    tex[STONE] = uni(stoneTile);
    tex[LOG] = { top: logTop, side: logSide, bottom: logTop };
    tex[LEAVES] = uni(leaves);
    tex[SAND] = uni(sandTile);
    tex[PLANK] = uni(plank);
    tex[GLASS] = uni(glass);
    tex[WATER] = uni(water);
    tex[BEDROCK] = uni(bedrock);
    tex[T1] = uni(tileFill(w.blocks[0], 0.14, 11));
    tex[T2] = uni(tileFill(w.blocks[1], 0.14, 12));
    tex[T3] = uni(tileFill(w.blocks[2], 0.14, 13));
    tex[T4] = uni(tileFill(w.blocks[3], 0.14, 14));
  }

  // =====================================================================
  //  Voxel world
  // =====================================================================
  const WX = 96, WY = 64, WZ = 96;
  let world = new Uint8Array(WX * WY * WZ);
  const vidx = (x, y, z) => (y * WZ + z) * WX + x;
  function getBlock(x, y, z) {
    x |= 0; y |= 0; z |= 0;
    if (y < 0) return BEDROCK;
    if (x < 0 || z < 0 || x >= WX || z >= WZ || y >= WY) return AIR;
    return world[(y * WZ + z) * WX + x];
  }
  function setBlock(x, y, z, t) {
    if (x < 0 || y < 0 || z < 0 || x >= WX || y >= WY || z >= WZ) return;
    world[(y * WZ + z) * WX + x] = t;
  }
  function solidAt(x, y, z) { return isSolid(getBlock(x, y, z)); }

  // value noise for terrain
  function vnoise(x, z, s) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = rnd01(xi, zi, s), b = rnd01(xi + 1, zi, s), c = rnd01(xi, zi + 1, s), d = rnd01(xi + 1, zi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function terrainH(x, z, seed) {
    let h = 0, amp = 1, f = 0.045, tot = 0;
    for (let o = 0; o < 4; o++) { h += vnoise(x * f, z * f, seed + o * 131) * amp; tot += amp; amp *= 0.5; f *= 2.05; }
    return h / tot; // 0..1
  }
  let SEA = 22;
  function genWorld(w) {
    world.fill(AIR);
    SEA = w.sea;
    const seed = w.seed;
    for (let x = 0; x < WX; x++) for (let z = 0; z < WZ; z++) {
      // island falloff so edges drop into ocean
      const dx = (x - WX / 2) / (WX / 2), dz = (z - WZ / 2) / (WZ / 2);
      const edge = Math.max(0, 1 - (dx * dx + dz * dz) * 0.85);
      const n = terrainH(x, z, seed) * edge;
      let h = Math.floor(8 + n * 34); if (h < 1) h = 1; if (h >= WY - 6) h = WY - 7;
      for (let y = 0; y <= h; y++) {
        let t;
        if (y === 0) t = BEDROCK;
        else if (y === h) t = (h < SEA + 1) ? SAND : GRASS;
        else if (y >= h - 3) t = (h < SEA + 1) ? SAND : DIRT;
        else t = STONE;
        setBlock(x, y, z, t);
      }
      // water fill up to sea level
      for (let y = h + 1; y <= SEA; y++) setBlock(x, y, z, WATER);
      // scattered themed "ore" blocks underground
      if (h > SEA + 2) for (let y = 2; y < h - 3; y++) { if (rnd01(x * 7 + y, z * 13, seed + 700) > 0.985) setBlock(x, y, z, T1 + (hash2(x, y, z) % 4)); }
    }
    // trees on grass
    for (let x = 3; x < WX - 3; x++) for (let z = 3; z < WZ - 3; z++) {
      if (rnd01(x, z, seed + 9999) > 0.985) {
        let gy = -1; for (let y = WY - 1; y > SEA; y--) { if (getBlock(x, y, z) === GRASS) { gy = y; break; } }
        if (gy > 0) {
          const th = 4 + (hash2(x, z, 3) % 3);
          for (let i = 1; i <= th; i++) setBlock(x, gy + i, z, LOG);
          const ty = gy + th;
          for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) for (let oy = -1; oy <= 2; oy++) {
            if (Math.abs(ox) + Math.abs(oz) + Math.abs(oy) > 4) continue;
            if (getBlock(x + ox, ty + oy, z + oz) === AIR) setBlock(x + ox, ty + oy, z + oz, LEAVES);
          }
        }
      }
    }
  }
  function surfaceY(x, z) { for (let y = WY - 1; y >= 0; y--) { const b = getBlock(x, y, z); if (b !== AIR && b !== WATER) return y; } return 0; }

  // =====================================================================
  //  Player / camera
  // =====================================================================
  let px = WX / 2, py = 40, pz = WZ / 2;     // feet position
  let vx = 0, vy = 0, vz = 0;
  let yaw = 0, pitch = 0;                      // radians; pitch clamped
  let onGround = false, flying = false;
  const PW = 0.3, PH = 1.8, EYE = 1.62;       // half-width, height, eye height
  // camera basis (recomputed each frame)
  let fwdx = 0, fwdy = 0, fwdz = 1, rgtx = 1, rgty = 0, rgtz = 0, upx = 0, upy = 1, upz = 0;
  function camBasis() {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    fwdx = cp * sy; fwdy = sp; fwdz = cp * cy;
    rgtx = cy; rgty = 0; rgtz = -sy;
    // up = forward x right
    upx = fwdy * rgtz - fwdz * rgty; upy = fwdz * rgtx - fwdx * rgtz; upz = fwdx * rgty - fwdy * rgtx;
  }
  const FOV = 70 * Math.PI / 180;
  let tanY = Math.tan(FOV / 2), tanX = tanY * (RW / RH);

  // =====================================================================
  //  Voxel raycaster (per pixel, 3D DDA) with textures, fog, water/glass
  // =====================================================================
  const MAXD = 60, MAXSTEPS = 120;
  function faceShade(axis, sgn) {
    if (axis === 1) return sgn > 0 ? 1.0 : 0.55;   // top bright, bottom dark
    if (axis === 0) return 0.82;                     // x faces
    return 0.66;                                      // z faces
  }
  function renderWorld(skyTop, skyHor, fog, sunAmt) {
    const ex = px, ey = py + EYE, ez = pz;
    tanX = tanY * (RW / RH);
    const halfW = RW / 2, halfH = RH / 2;
    for (let sy = 0; sy < RH; sy++) {
      const ndy = (1 - 2 * (sy + 0.5) / RH) * tanY;
      for (let sx = 0; sx < RW; sx++) {
        const ndx = (2 * (sx + 0.5) / RW - 1) * tanX;
        // ray dir = forward + right*ndx + up*ndy, normalized
        let dx = fwdx + rgtx * ndx + upx * ndy;
        let dy = fwdy + rgty * ndx + upy * ndy;
        let dz = fwdz + rgtz * ndx + upz * ndy;
        const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz); dx *= il; dy *= il; dz *= il;

        let vxx = Math.floor(ex), vyy = Math.floor(ey), vzz = Math.floor(ez);
        const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
        const tdx = dx === 0 ? 1e30 : Math.abs(1 / dx), tdy = dy === 0 ? 1e30 : Math.abs(1 / dy), tdz = dz === 0 ? 1e30 : Math.abs(1 / dz);
        let tmx = dx === 0 ? 1e30 : ((dx > 0 ? (vxx + 1 - ex) : (ex - vxx)) * tdx);
        let tmy = dy === 0 ? 1e30 : ((dy > 0 ? (vyy + 1 - ey) : (ey - vyy)) * tdy);
        let tmz = dz === 0 ? 1e30 : ((dz > 0 ? (vzz + 1 - ez) : (ez - vzz)) * tdz);

        let t = 0, axis = 1, sgn = 1, hitType = AIR, hitt = MAXD;
        // translucent accumulation
        let accCov = 0, accR = 0, accG = 0, accB = 0; let lastWater = -999;
        let opaque = false;
        for (let s = 0; s < MAXSTEPS; s++) {
          // step to next voxel boundary
          if (tmx < tmy && tmx < tmz) { t = tmx; tmx += tdx; vxx += stx; axis = 0; sgn = -stx; }
          else if (tmy < tmz) { t = tmy; tmy += tdy; vyy += sty; axis = 1; sgn = -sty; }
          else { t = tmz; tmz += tdz; vzz += stz; axis = 2; sgn = -stz; }
          if (t > MAXD) break;
          const b = getBlock(vxx, vyy, vzz);
          if (b === AIR) continue;
          if (b === WATER || b === GLASS) {
            // translucent: accumulate tint, keep going
            const al = b === WATER ? 0.16 : 0.30;
            let col;
            if (b === WATER) { const wob = 0.9 + 0.1 * Math.sin((vxx + vzz) * 0.7 + now * 1.5); col = shade(rgb(40, 95, 185), wob); }
            else col = rgb(190, 225, 238);
            const k = (1 - accCov) * al;
            accR += k * (col & 255); accG += k * ((col >>> 8) & 255); accB += k * ((col >>> 16) & 255); accCov += k;
            if (accCov > 0.92) { fbuf[sy * RW + sx] = rgb(accR / accCov, accG / accCov, accB / accCov); depth[sy * RW + sx] = t; opaque = true; hitType = b; break; }
            continue;
          }
          // opaque solid hit
          hitType = b; hitt = t; opaque = true;
          // hit point + uv
          const hx = ex + dx * t, hy = ey + dy * t, hz = ez + dz * t;
          let u, v;
          if (axis === 0) { u = hz - Math.floor(hz); v = 1 - (hy - Math.floor(hy)); }
          else if (axis === 1) { u = hx - Math.floor(hx); v = hz - Math.floor(hz); }
          else { u = hx - Math.floor(hx); v = 1 - (hy - Math.floor(hy)); }
          const ti = tex[b] || tex[STONE];
          const tile = axis === 1 ? (sgn > 0 ? ti.top : ti.bottom) : ti.side;
          let tu = (u * TS) | 0; if (tu < 0) tu = 0; else if (tu >= TS) tu = TS - 1;
          let tv = (v * TS) | 0; if (tv < 0) tv = 0; else if (tv >= TS) tv = TS - 1;
          let col = tile[tv * TS + tu];
          col = shade(col, faceShade(axis, sgn) * sunAmt);
          // fog
          let fg = t / MAXD; if (fg > 1) fg = 1; fg = fg * fg;
          col = mix(col, fog, fg * 0.85);
          // composite translucent over it
          if (accCov > 0) { const inv = 1 - accCov; col = rgb((col & 255) * inv + accR, ((col >>> 8) & 255) * inv + accG, ((col >>> 16) & 255) * inv + accB); }
          fbuf[sy * RW + sx] = col; depth[sy * RW + sx] = t;
          break;
        }
        if (!opaque || hitType === AIR) {
          // sky gradient + translucent water/glass tint over it
          let sky = mix(skyHor, skyTop, ndy < 0 ? 0 : Math.min(1, ndy * 1.4));
          if (accCov > 0) { const inv = 1 - accCov; sky = rgb((sky & 255) * inv + accR, ((sky >>> 8) & 255) * inv + accG, ((sky >>> 16) & 255) * inv + accB); }
          fbuf[sy * RW + sx] = sky; depth[sy * RW + sx] = MAXD;
        }
      }
    }
  }

  // =====================================================================
  //  Targeting (which block the crosshair points at) -> break/place
  // =====================================================================
  function raycastVoxel() {
    camBasis();
    const ex = px, ey = py + EYE, ez = pz;
    let dx = fwdx, dy = fwdy, dz = fwdz;
    let vxx = Math.floor(ex), vyy = Math.floor(ey), vzz = Math.floor(ez);
    const stx = dx > 0 ? 1 : -1, sty = dy > 0 ? 1 : -1, stz = dz > 0 ? 1 : -1;
    const tdx = dx === 0 ? 1e30 : Math.abs(1 / dx), tdy = dy === 0 ? 1e30 : Math.abs(1 / dy), tdz = dz === 0 ? 1e30 : Math.abs(1 / dz);
    let tmx = dx === 0 ? 1e30 : ((dx > 0 ? (vxx + 1 - ex) : (ex - vxx)) * tdx);
    let tmy = dy === 0 ? 1e30 : ((dy > 0 ? (vyy + 1 - ey) : (ey - vyy)) * tdy);
    let tmz = dz === 0 ? 1e30 : ((dz > 0 ? (vzz + 1 - ez) : (ez - vzz)) * tdz);
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let s = 0; s < 64; s++) {
      if (tmx < tmy && tmx < tmz) { t = tmx; tmx += tdx; vxx += stx; nx = -stx; ny = 0; nz = 0; }
      else if (tmy < tmz) { t = tmy; tmy += tdy; vyy += sty; nx = 0; ny = -sty; nz = 0; }
      else { t = tmz; tmz += tdz; vzz += stz; nx = 0; ny = 0; nz = -stz; }
      if (t > 6) return null;
      const b = getBlock(vxx, vyy, vzz);
      if (b !== AIR && b !== WATER) return { x: vxx, y: vyy, z: vzz, nx: nx, ny: ny, nz: nz };
    }
    return null;
  }
  function doBreak() {
    const h = raycastVoxel(); if (!h) return;
    const b = getBlock(h.x, h.y, h.z); if (b === BEDROCK) return;
    setBlock(h.x, h.y, h.z, AIR);
    spawnBurst(blockColor(b), 14); beep(180, 0.05);
    dug++; if (dug >= 12) unlock("dig");
  }
  function doPlace() {
    const h = raycastVoxel(); if (!h) return;
    const tx = h.x + h.nx, ty = h.y + h.ny, tz = h.z + h.nz;
    if (getBlock(tx, ty, tz) !== AIR && getBlock(tx, ty, tz) !== WATER) return;
    // don't place inside the player
    const minx = px - PW, maxx = px + PW, miny = py, maxy = py + PH, minz = pz - PW, maxz = pz + PW;
    if (tx + 1 > minx && tx < maxx && ty + 1 > miny && ty < maxy && tz + 1 > minz && tz < maxz) return;
    const bt = HOTBAR[hotbarSel];
    setBlock(tx, ty, tz, bt);
    spawnBurst(blockColor(bt), 8); beep(420, 0.05);
    built++; if (built >= 10) unlock("build");
  }
  function blockColor(b) {
    const ti = tex[b]; if (ti && ti.side) return ti.side[8 * TS + 8];
    return rgb(150, 150, 150);
  }

  // =====================================================================
  //  Physics (AABB collision, walk / jump / gravity / fly)
  // =====================================================================
  const GRAV = 26, JUMP_V = 8.4, WALK = 4.6, FLY = 9.0;
  function aabbBlocked(nx, ny, nz) {
    const x0 = Math.floor(nx - PW), x1 = Math.floor(nx + PW), z0 = Math.floor(nz - PW), z1 = Math.floor(nz + PW), y0 = Math.floor(ny), y1 = Math.floor(ny + PH - 0.001);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (solidAt(x, y, z)) return true;
    return false;
  }
  function moveAxis(ax, d) {
    if (d === 0) return;
    if (ax === 0) {
      if (!aabbBlocked(px + d, py, pz)) px += d;
      else { vx = 0; px = d > 0 ? (Math.floor(px + PW + d) - PW - 1e-3) : (Math.floor(px - PW + d) + 1 + PW + 1e-3); }
    } else if (ax === 1) {
      if (!aabbBlocked(px, py + d, pz)) py += d;
      else { vy = 0; if (d < 0) { py = Math.floor(py + d) + 1 + 1e-3; onGround = true; } else { py = Math.floor(py + PH + d) - PH - 1e-3; } }
    } else {
      if (!aabbBlocked(px, py, pz + d)) pz += d;
      else { vz = 0; pz = d > 0 ? (Math.floor(pz + PW + d) - PW - 1e-3) : (Math.floor(pz - PW + d) + 1 + PW + 1e-3); }
    }
  }
  function physics(dt) {
    // wish direction (horizontal, from yaw)
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    let wx = 0, wz = 0;
    if (keys.has("KeyW")) { wx += sy; wz += cy; }
    if (keys.has("KeyS")) { wx -= sy; wz -= cy; }
    if (keys.has("KeyD")) { wx += cy; wz -= sy; }
    if (keys.has("KeyA")) { wx -= cy; wz += sy; }
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    const sp = flying ? FLY : WALK;
    vx = wx * sp; vz = wz * sp;

    if (flying) {
      vy = 0;
      if (keys.has("Space")) vy = FLY * 0.8;
      if (keys.has("ShiftLeft") || keys.has("ShiftRight")) vy = -FLY * 0.8;
    } else {
      if (keys.has("Space") && onGround) { vy = JUMP_V; onGround = false; beep(300, 0.04); }
      vy -= GRAV * dt; if (vy < -50) vy = -50;
    }
    onGround = false;
    // integrate with per-axis collision (substep for fast vertical)
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(vy * dt), Math.abs(vx * dt), Math.abs(vz * dt)) / 0.4));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) { moveAxis(1, vy * sdt); moveAxis(0, vx * sdt); moveAxis(2, vz * sdt); }
    // out-of-world guard
    if (py < -30) { py = 50; vy = 0; }
    if (px < 0) px = 0; if (px > WX) px = WX; if (pz < 0) pz = 0; if (pz > WZ) pz = WZ;
  }

  // =====================================================================
  //  Collectible Wigglitz (billboards)
  // =====================================================================
  const ents = [];
  function placeCollectibles(w) {
    ents.length = 0;
    let placed = 0, tries = 0;
    while (placed < 14 && tries < 4000) {
      tries++;
      const x = 6 + (hash2(tries, 11, w.seed) % (WX - 12));
      const z = 6 + (hash2(tries, 22, w.seed + 5) % (WZ - 12));
      const y = surfaceY(x, z);
      if (getBlock(x, y, z) !== GRASS && getBlock(x, y, z) !== SAND) continue;
      ents.push({ x: x + 0.5, y: y + 1, z: z + 0.5, c: placed % w.roster.length, got: false, ph: tries * 0.7 });
      placed++;
    }
  }
  function drawEntities() {
    camBasis();
    const ex = px, ey = py + EYE, ez = pz;
    const list = [];
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]; if (e.got) continue;
      const rx = e.x - ex, ry = (e.y + 0.08 + Math.sin(now * 2 + e.ph) * 0.1) - ey, rz = e.z - ez;
      const cz = rx * fwdx + ry * fwdy + rz * fwdz;
      if (cz < 0.2) continue;
      const cx = rx * rgtx + ry * rgty + rz * rgtz;
      const cyv = rx * upx + ry * upy + rz * upz;
      list.push({ e: e, cx: cx, cy: cyv, cz: cz, dist: Math.sqrt(rx * rx + ry * ry + rz * rz) });
    }
    list.sort((a, b) => b.cz - a.cz);
    const halfW = RW / 2, halfH = RH / 2;
    for (let k = 0; k < list.length; k++) {
      const o = list[k], e = o.e;
      const rec = imgCache[roster[e.c].file]; if (!rec || !rec.ready) continue;
      const sp = rec.sprite;
      const scrX = halfW + (o.cx / o.cz) / tanX * halfW;
      const scrY = halfH - (o.cy / o.cz) / tanY * halfH;
      const sprH = (1.1 / o.cz) / tanY * halfH * 1.0;   // world height ~1.1
      const sprW = sprH * (TWs / THs);
      if (sprH < 2) continue;
      const x0 = Math.round(scrX - sprW / 2), x1 = Math.round(scrX + sprW / 2);
      const y0 = Math.round(scrY - sprH), y1 = Math.round(scrY);
      const swayB = Math.sin(now * 5 + e.ph) * sprW * 0.12;
      for (let X = x0; X < x1; X++) {
        if (X < 0 || X >= RW) continue;
        for (let Y = y0; Y < y1; Y++) {
          if (Y < 0 || Y >= RH) continue;
          if (o.dist >= depth[Y * RW + X]) continue;
          const fr = (y1 - Y) / sprH;
          const tx = (((X - x0) - swayB * fr) / sprW * TWs) | 0; if (tx < 0 || tx >= TWs) continue;
          const ty = ((Y - y0) / sprH * THs) | 0; if (ty < 0 || ty >= THs) continue;
          const p = sp[ty * TWs + tx]; if ((p >>> 24) < 128) continue;
          fbuf[Y * RW + X] = p;
        }
      }
    }
    // pickups
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]; if (e.got) continue;
      const dx = e.x - px, dz = e.z - pz, dy = e.y - (py + 0.9);
      if (dx * dx + dz * dz < 0.9 && Math.abs(dy) < 1.6) {
        e.got = true; totalFound++;
        const isNew = !owned[e.c]; owned[e.c] = true;
        toast(isNew ? "NEW!  " + roster[e.c].name + " joined you!" : "Found another " + roster[e.c].name);
        beep(880, 0.08); setTimeout(() => beep(1320, 0.1), 70); spawnSparkle();
        if (totalFound === 1) unlock("first"); if (countOwned() >= 3) unlock("half"); checkComplete();
      }
    }
  }

  // =====================================================================
  //  Character images (real Wigglitz art) - menus + billboards
  // =====================================================================
  const TWs = 48, THs = 60;
  const imgCache = {};
  function buildSpriteFromImg(im) {
    const c = document.createElement("canvas"); c.width = TWs; c.height = THs; const g = c.getContext("2d");
    let dw = im.width || 1, dh = im.height || 1; const k = Math.min(TWs / dw, THs / dh); dw *= k; dh *= k;
    g.drawImage(im, (TWs - dw) / 2, THs - dh, dw, dh);
    return new Uint32Array(g.getImageData(0, 0, TWs, THs).data.buffer);
  }
  function loadImg(file) {
    if (imgCache[file]) return;
    const rec = { img: new Image(), ready: false, sprite: null };
    imgCache[file] = rec;
    rec.img.onload = function () { try { rec.sprite = buildSpriteFromImg(rec.img); rec.ready = true; } catch (e) { } };
    rec.img.src = "img/" + file;
  }
  function preloadAll() { for (let i = 0; i < WORLDS.length; i++) for (let j = 0; j < WORLDS[i].roster.length; j++) loadImg(WORLDS[i].roster[j].file); }
  function drawCharImg(g, cx, cy, h, file, t) {
    const rec = imgCache[file];
    if (!rec || !rec.ready) { g.fillStyle = "rgba(120,120,150,0.45)"; g.beginPath(); g.ellipse(cx, cy, h * 0.28, h * 0.42, 0, 0, 6.2832); g.fill(); return; }
    const im = rec.img, dh = h, dw = (im.width / im.height) * dh;
    const lean = Math.sin(t * 2.2) * 0.13, sway = Math.sin(t * 3) * h * 0.05, bob = Math.sin(t * 4) * h * 0.05;
    g.save(); g.translate(cx + sway, cy + bob); g.rotate(lean); g.drawImage(im, -dw / 2, -dh / 2, dw, dh); g.restore();
  }

  // =====================================================================
  //  Achievements, particles, audio, toasts
  // =====================================================================
  const ACH = [{ id: "first", name: "First Friend" }, { id: "half", name: "Halfway There" }, { id: "build", name: "Builder" }, { id: "dig", name: "Spelunker" }, { id: "all", name: "Gotta Find 'Em All" }];
  const unlocked = new Set();
  function unlock(id) { if (unlocked.has(id)) return; unlocked.add(id); const a = ACH.find(x => x.id === id); if (a) { toast("Achievement: " + a.name); beep(1400, 0.07); setTimeout(() => beep(1900, 0.09), 90); } }
  let totalFound = 0, completeShown = false, built = 0, dug = 0;
  function countOwned() { let n = 0; for (let i = 0; i < owned.length; i++) if (owned[i]) n++; return n; }
  function checkComplete() {
    for (let i = 0; i < owned.length; i++) if (!owned[i]) return;
    if (!completeShown) { completeShown = true; unlocked.add("all"); toastText = "COLLECTION COMPLETE!  You found every Wigglitz!"; toastUntil = now + 5; beep(660, 0.1); setTimeout(() => beep(990, 0.12), 110); setTimeout(() => beep(1320, 0.16), 240); }
  }
  let toastText = "", toastUntil = 0;
  function toast(s) { if (completeShown && now < toastUntil) return; toastText = s; toastUntil = now + 2.2; }
  const particles = [];
  function spawnBurst(col, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = 30 + Math.random() * 70; particles.push({ x: 240, y: 135, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.5, max: 0.5, col: col }); } }
  function spawnSparkle() { for (let i = 0; i < 22; i++) { const a = Math.random() * 6.283, s = 40 + Math.random() * 110; const c = i % 3 === 0 ? rgb(255, 240, 120) : i % 3 === 1 ? rgb(255, 255, 255) : rgb(120, 220, 255); particles.push({ x: 240, y: 150, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.9, max: 0.9, col: c }); } }
  function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); } }
  let actx = null;
  function ensureAudio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) { } }
  function beep(f, d) { try { if (!actx) return; const o = actx.createOscillator(), g = actx.createGain(); o.type = "square"; o.frequency.value = f; g.gain.value = 0.04; o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d); o.stop(actx.currentTime + d + 0.02); } catch (e) { } }

  // =====================================================================
  //  State + world application
  // =====================================================================
  let state = "title";   // title | world | avatar | play
  let worldIdx = 0, worldSel = 0, sel = 0, hotbarSel = 0;
  let roster = WORLDS[0].roster;
  let owned = new Array(roster.length).fill(false);
  let showCollection = false, showHelp = false, locked = false, sens = 1.0;
  const keys = new Set();
  let now = 0, lastT = 0, stepPhase = 0;
  let mouseDX = 0, mouseDY = 0, skipMouse = false;
  let lastSpace = -9, frameMs = 16, fpsSmooth = 16;
  let mbLeft = false, mbRight = false, lastAct = 0;   // mouse-button hold-to-repeat

  function applyWorld(wi) {
    worldIdx = wi; const w = WORLDS[wi];
    roster = w.roster; owned = new Array(roster.length).fill(false);
    totalFound = 0; completeShown = false; built = 0; dug = 0; unlocked.clear(); sel = 0;
    buildTextures(w); genWorld(w); placeCollectibles(w);
  }
  function startPlay() {
    state = "play"; showCollection = false; showHelp = false;
    px = WX / 2 + 0.5; pz = WZ / 2 + 0.5; py = surfaceY(Math.floor(px), Math.floor(pz)) + 1.05;
    vx = vy = vz = 0; yaw = 0; pitch = 0; onGround = false; flying = false; hotbarSel = 0;
    mouseDX = mouseDY = 0;
  }

  // =====================================================================
  //  Render frame
  // =====================================================================
  function dayCycle() {
    // slow day/night; returns {skyTop, skyHor, fog, sun}
    const w = WORLDS[worldIdx];
    const day = (Math.sin(now * 0.05) * 0.5 + 0.5);   // 0 night .. 1 day
    const sun = 0.45 + 0.55 * day;
    const top = mix(rgb(12, 14, 40), rgb(w.sky[0] * 0.7, w.sky[1] * 0.8, w.sky[2]), day);
    const hor = mix(rgb(40, 40, 70), rgb(w.fog[0], w.fog[1], w.fog[2]), day);
    return { skyTop: top, skyHor: hor, fog: hor, sun: sun };
  }
  function render() {
    if (fatal) return;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    if (state === "play") {
      camBasis();
      const dc = dayCycle();
      renderWorld(dc.skyTop, dc.skyHor, dc.fog, dc.sun);
      drawEntities();
      lctx.putImageData(frame, 0, 0);
      vctx.imageSmoothingEnabled = false;
      vctx.drawImage(low, 0, 0, canvas.width, canvas.height);
    } else {
      // menu background fill
      vctx.fillStyle = "#1a1430"; vctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // ---- UI in virtual 480x270 ----
    vctx.setTransform(canvas.width / UIW, 0, 0, canvas.height / UIH, 0, 0);
    vctx.imageSmoothingEnabled = true;
    const g = vctx;
    if (state === "play") { drawHud(g); if (showCollection) drawCollection(g); if (showHelp) drawHelp(g); }
    else { drawMenuBg(g); if (state === "title") drawTitle(g); else if (state === "world") drawWorldSelect(g); else drawAvatarSelect(g); }
  }

  // =====================================================================
  //  HUD + menus (virtual 480x270)
  // =====================================================================
  function centerText(g, s, font, color, cx, cy) { g.font = font; g.textBaseline = "middle"; g.textAlign = "center"; g.fillStyle = color; g.fillText(s, cx, cy); g.textAlign = "left"; }
  function drawParticles(g) { for (let i = 0; i < particles.length; i++) { const p = particles[i]; let a = p.life / p.max; if (a < 0) a = 0; g.fillStyle = "rgba(" + (p.col & 255) + "," + ((p.col >>> 8) & 255) + "," + ((p.col >>> 16) & 255) + "," + a + ")"; g.fillRect(p.x, p.y, 3, 3); } }
  function hbColor(b) { const ti = tex[b]; if (ti && ti.side) { const c = ti.side[8 * TS + 8]; return "rgb(" + (c & 255) + "," + ((c >>> 8) & 255) + "," + ((c >>> 16) & 255) + ")"; } return "#999"; }
  const HB_NAME = { 1: "Grass", 2: "Dirt", 3: "Stone", 4: "Log", 7: "Planks", 5: "Leaves", 6: "Sand", 11: "Block A", 12: "Block B" };
  function drawHotbar(g) {
    const n = HOTBAR.length, cs = 24, gap = 3, total = n * cs + (n - 1) * gap, ox = UIW / 2 - total / 2, oy = UIH - 34;
    for (let i = 0; i < n; i++) {
      const x = ox + i * (cs + gap);
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x - 1, oy - 1, cs + 2, cs + 2);
      g.fillStyle = hbColor(HOTBAR[i]); g.fillRect(x, oy, cs, cs);
      if (i === hotbarSel) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(x - 1, oy - 1, cs + 2, cs + 2); }
      g.fillStyle = "rgba(255,255,255,0.85)"; g.font = "bold 8px Segoe UI"; g.fillText("" + (i + 1), x + 2, oy + 9);
    }
    centerText(g, HB_NAME[HOTBAR[hotbarSel]] || "Block", "8px Segoe UI", "rgba(255,255,255,0.9)", UIW / 2, oy - 8);
  }
  function projUI(wx, wy, wz) {
    const rx = wx - px, ry = wy - (py + EYE), rz = wz - pz;
    const cz = rx * fwdx + ry * fwdy + rz * fwdz;
    if (cz < 0.05) return null;
    const cx = rx * rgtx + ry * rgty + rz * rgtz, cyv = rx * upx + ry * upy + rz * upz;
    return { x: UIW / 2 + (cx / cz) / tanX * (UIW / 2), y: UIH / 2 - (cyv / cz) / tanY * (UIH / 2) };
  }
  function drawHud(g) {
    drawParticles(g);
    // targeted block: wireframe selection box (Minecraft-style)
    const h = raycastVoxel();
    if (h) {
      const X = h.x, Y = h.y, Z = h.z;
      const c = [projUI(X, Y, Z), projUI(X + 1, Y, Z), projUI(X + 1, Y, Z + 1), projUI(X, Y, Z + 1), projUI(X, Y + 1, Z), projUI(X + 1, Y + 1, Z), projUI(X + 1, Y + 1, Z + 1), projUI(X, Y + 1, Z + 1)];
      const ed = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1.3; g.beginPath();
      for (let k = 0; k < ed.length; k++) { const a = c[ed[k][0]], b = c[ed[k][1]]; if (a && b) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } }
      g.stroke();
    }
    // crosshair
    g.strokeStyle = h ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)"; g.lineWidth = h ? 2 : 1.5;
    g.beginPath(); g.moveTo(UIW / 2 - 6, UIH / 2); g.lineTo(UIW / 2 + 6, UIH / 2); g.moveTo(UIW / 2, UIH / 2 - 6); g.lineTo(UIW / 2, UIH / 2 + 6); g.stroke();
    drawHotbar(g);
    // top banner
    const s = WORLDS[worldIdx].name + "   Wigglitz " + countOwned() + " / " + roster.length;
    g.font = "bold 11px Segoe UI"; g.textAlign = "center"; const w = g.measureText(s).width;
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(UIW / 2 - w / 2 - 7, 5, w + 14, 17);
    g.fillStyle = "#ffe85a"; g.textBaseline = "middle"; g.fillText(s, UIW / 2, 14); g.textAlign = "left";
    // controls hint
    g.font = "8px Segoe UI"; g.textBaseline = "alphabetic"; g.fillStyle = "rgba(255,255,255,0.85)";
    g.fillText("LMB break   RMB place   WASD move   Space jump   F fly   1-9 / scroll   C collection   H help", 6, UIH - 6);
    g.textAlign = "right"; g.fillStyle = "rgba(255,255,255,0.6)"; g.fillText("Achievements " + unlocked.size + "/" + ACH.length + "   " + Math.round(1000 / fpsSmooth) + "fps", UIW - 6, UIH - 6); g.textAlign = "left";
    if (!locked) { g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(0, UIH / 2 - 16, UIW, 24); centerText(g, "Click to play  -  capture the mouse", "bold 11px Segoe UI", "#fff", UIW / 2, UIH / 2 - 4); }
    if (now < toastUntil && toastText) { let a = Math.min(1, (toastUntil - now) / 0.5); g.font = "bold 12px Segoe UI"; g.textAlign = "center"; const tw = g.measureText(toastText).width; g.fillStyle = "rgba(0,0,0," + (0.6 * a) + ")"; g.fillRect(UIW / 2 - tw / 2 - 8, 30, tw + 16, 20); g.fillStyle = "rgba(255,235,120," + a + ")"; g.textBaseline = "middle"; g.fillText(toastText, UIW / 2, 40); g.textAlign = "left"; }
  }
  function drawMenuBg(g) {
    const grad = g.createLinearGradient(0, 0, 0, UIH); grad.addColorStop(0, "rgb(34,26,68)"); grad.addColorStop(1, "rgb(22,58,76)");
    g.fillStyle = grad; g.fillRect(0, 0, UIW, UIH);
    for (let i = 0; i < 28; i++) { const ph = now * 0.4 + i * 1.7, dx = (Math.sin(ph) * 0.5 + 0.5) * UIW, dy = ((i * 53) % UIH) + Math.sin(now + i) * 6; g.fillStyle = "rgba(255,255,255,0.12)"; g.beginPath(); g.arc(dx, dy, 1.4, 0, 6.283); g.fill(); }
  }
  function drawTitle(g) {
    centerText(g, "WIGGLITZ", "bold 36px Segoe UI", "rgb(255,230,90)", UIW / 2, 54);
    centerText(g, "C R A F T", "bold 13px Segoe UI", "rgb(120,220,210)", UIW / 2, 86);
    drawCharImg(g, UIW / 2, 134, 96, WORLDS[0].roster[0].file, now);
    const all = WORLDS[0].roster, n = all.length, sp = UIW / (n + 1);
    for (let i = 0; i < n; i++) drawCharImg(g, sp * (i + 1), 206, 36, all[i].file, now * 1.4 + i * 0.6);
    if (((now * 2) | 0) % 2 === 0) centerText(g, "Click or press ENTER to start", "10px Segoe UI", "#fff", UIW / 2, 176);
    centerText(g, "a voxel sandbox  -  build, dig, explore & collect every Wigglitz", "8px Segoe UI", "rgb(185,205,215)", UIW / 2, 238);
    g.font = "7px Segoe UI"; g.fillStyle = "rgba(255,255,255,0.4)"; g.textAlign = "right"; g.fillText("v7", UIW - 6, UIH - 6); g.textAlign = "left";
  }
  function startBtn() { return { x: UIW / 2 - 54, y: 244, w: 108, h: 20 }; }
  function drawWorldSelect(g) {
    centerText(g, "CHOOSE A WORLD", "bold 17px Segoe UI", "rgb(255,230,90)", UIW / 2, 22);
    const n = WORLDS.length, spacing = UIW / (n + 1), rowY = 122;
    for (let i = 0; i < n; i++) {
      const w = WORLDS[i], cx = spacing * (i + 1);
      g.fillStyle = cstr(w.sky, 0.55); g.fillRect(cx - 44, rowY - 58, 88, 98);
      g.fillStyle = cstr(w.grass, 1); g.fillRect(cx - 44, rowY + 24, 88, 16);
      for (let b = 0; b < 4; b++) { g.fillStyle = "rgb(" + w.blocks[b][0] + "," + w.blocks[b][1] + "," + w.blocks[b][2] + ")"; g.fillRect(cx - 40 + b * 20, rowY + 26, 16, 12); }
      drawCharImg(g, cx, rowY - 8, 66, w.roster[0].file, now + i);
      centerText(g, w.name, i === worldSel ? "bold 9px Segoe UI" : "8px Segoe UI", i === worldSel ? "#fff" : "rgb(170,180,195)", cx, rowY + 52);
      if (i === worldSel) { g.strokeStyle = "rgb(255,230,90)"; g.lineWidth = 2.5; g.strokeRect(cx - 44, rowY - 58, 88, 98); }
    }
    centerText(g, "click a world   (or LEFT / RIGHT, then ENTER)", "8px Segoe UI", "rgb(205,220,230)", UIW / 2, UIH - 16);
  }
  function drawAvatarSelect(g) {
    centerText(g, WORLDS[worldIdx].name.toUpperCase() + "  -  CHOOSE YOUR WIGGLITZ", "bold 13px Segoe UI", "rgb(255,230,90)", UIW / 2, 22);
    const n = roster.length, spacing = UIW / (n + 1), rowY = 108;
    for (let i = 0; i < n; i++) {
      const cx = spacing * (i + 1), scale = i === sel ? 38 : 26;
      if (i === sel) { g.strokeStyle = "rgb(255,230,90)"; g.lineWidth = 2; g.strokeRect(cx - 30, rowY - 44, 60, 92); }
      drawCharImg(g, cx, rowY, scale * 2.3, roster[i].file, now + i);
      centerText(g, roster[i].name, i === sel ? "bold 8px Segoe UI" : "7px Segoe UI", i === sel ? "#fff" : "rgb(150,160,175)", cx, rowY + 36);
    }
    centerText(g, "You picked:  " + roster[sel].name, "bold 12px Segoe UI", "#fff", UIW / 2, 182);
    const b = startBtn();
    g.fillStyle = "rgb(90,200,120)"; g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 1.5; g.strokeRect(b.x, b.y, b.w, b.h);
    centerText(g, "START", "bold 11px Segoe UI", "rgb(6,33,15)", UIW / 2, b.y + b.h / 2 + 1);
    centerText(g, "click a Wigglitz, then START   (Esc = back to worlds)", "7px Segoe UI", "rgb(205,220,230)", UIW / 2, b.y + b.h + 9);
  }
  function drawCollection(g) {
    g.fillStyle = "rgba(12,10,26,0.85)"; g.fillRect(0, 0, UIW, UIH);
    centerText(g, WORLDS[worldIdx].name.toUpperCase() + " COLLECTION", "bold 17px Segoe UI", "rgb(255,230,90)", UIW / 2, 24);
    centerText(g, "Found " + countOwned() + " of " + roster.length, "bold 9px Segoe UI", "#fff", UIW / 2, 46);
    const pw = 200, pxx = UIW / 2 - pw / 2, pyy = 54;
    g.fillStyle = "rgba(255,255,255,0.15)"; g.fillRect(pxx, pyy, pw, 6); g.fillStyle = "rgb(255,230,90)"; g.fillRect(pxx, pyy, pw * countOwned() / roster.length, 6);
    const cols = 3, cw = 110, chh = 64, ox = UIW / 2 - (cols * cw) / 2, oy = 78;
    for (let i = 0; i < roster.length; i++) {
      const cxi = i % cols, cyi = (i / cols) | 0, cx = ox + cxi * cw + cw / 2, cy = oy + cyi * chh + 24;
      if (owned[i]) { drawCharImg(g, cx, cy, 56, roster[i].file, now + i); centerText(g, roster[i].name, "8px Segoe UI", "#fff", cx, cy + 30); }
      else { g.fillStyle = "rgb(60,60,70)"; g.beginPath(); g.ellipse(cx, cy, 13, 16, 0, 0, 6.283); g.fill(); centerText(g, "? ? ?", "8px Segoe UI", "rgb(120,120,130)", cx, cy + 30); }
    }
    centerText(g, "Press C to return", "8px Segoe UI", "rgb(205,220,230)", UIW / 2, UIH - 10);
  }
  function drawHelp(g) {
    g.fillStyle = "rgba(12,10,26,0.9)"; g.fillRect(0, 0, UIW, UIH);
    centerText(g, "HOW TO PLAY", "bold 18px Segoe UI", "rgb(255,230,90)", UIW / 2, 28);
    const lines = ["Mouse  -  look around   (click to capture)", "W A S D  -  move        Space  -  jump", "F  or  double-tap Space  -  fly  (Space up / Shift down)", "Hold Left click  -  keep breaking blocks", "Hold Right click  -  keep placing blocks", "1-9 or scroll wheel  -  pick a block      C  collection", "- / +  sensitivity      H  help      Esc  menu"];
    g.font = "9px Segoe UI"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#e8e8f0";
    for (let i = 0; i < lines.length; i++) g.fillText(lines[i], UIW / 2, 58 + i * 20);
    g.textAlign = "left";
    centerText(g, "Goal: find all " + roster.length + " Wigglitz hidden on the island!", "bold 9px Segoe UI", "rgb(150,220,180)", UIW / 2, UIH - 30);
    centerText(g, "Press H or Esc to return", "8px Segoe UI", "rgb(205,220,230)", UIW / 2, UIH - 14);
  }

  // =====================================================================
  //  Main loop (with adaptive resolution)
  // =====================================================================
  function loop(ts) {
    try {
      const t = ts / 1000; let dt = t - lastT; lastT = t; if (dt > 0.05) dt = 0.05; now = t;
      // adaptive res
      frameMs = ts - (loop._last || ts); loop._last = ts; fpsSmooth += (frameMs - fpsSmooth) * 0.1;
      if (state === "play") {
        if (fpsSmooth > 24 && resLevel > 0) { resLevel--; setRes(RES[resLevel][0], RES[resLevel][1]); }
        else if (fpsSmooth < 13 && resLevel < RES.length - 1) { resLevel++; setRes(RES[resLevel][0], RES[resLevel][1]); }
      }
      // mouse look (bounded)
      if (state === "play" && !showCollection && !showHelp) {
        let dyaw = mouseDX * 0.0022 * sens; if (dyaw > 0.4) dyaw = 0.4; else if (dyaw < -0.4) dyaw = -0.4;
        yaw += dyaw;
        pitch -= mouseDY * 0.0022 * sens;
        const tr = 1.8 * dt;
        if (keys.has("ArrowLeft")) yaw -= tr; if (keys.has("ArrowRight")) yaw += tr;
        if (keys.has("ArrowUp")) pitch += tr; if (keys.has("ArrowDown")) pitch -= tr;
        const lim = 1.553; if (pitch > lim) pitch = lim; else if (pitch < -lim) pitch = -lim;
        physics(dt);
        if (locked && (mbLeft || mbRight) && now - lastAct >= 0.18) { if (mbLeft) doBreak(); else doPlace(); lastAct = now; }
        updateParticles(dt);
      } else { updateParticles(dt); }
      mouseDX = 0; mouseDY = 0;
      render();
    } catch (err) { showFatal((err && err.message) ? err.message : String(err)); }
    requestAnimationFrame(loop);
  }

  // =====================================================================
  //  Input
  // =====================================================================
  function relock() { try { if (state === "play" && !showCollection && !showHelp && document.pointerLockElement !== canvas) canvas.requestPointerLock(); } catch (e) { } }
  window.addEventListener("keydown", function (e) {
    keys.add(e.code); ensureAudio();
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].indexOf(e.code) >= 0) e.preventDefault();
    if (e.repeat) return;                              // ignore OS key-repeat for edge-triggered actions (toggles etc.)
    if (state === "title") { if (e.code === "Enter") state = "world"; }
    else if (state === "world") {
      if (e.code === "ArrowLeft") worldSel = (worldSel - 1 + WORLDS.length) % WORLDS.length;
      else if (e.code === "ArrowRight") worldSel = (worldSel + 1) % WORLDS.length;
      else if (e.code === "Enter") { applyWorld(worldSel); state = "avatar"; }
      else if (e.code === "Escape") state = "title";
    } else if (state === "avatar") {
      if (e.code === "ArrowLeft") sel = (sel - 1 + roster.length) % roster.length;
      else if (e.code === "ArrowRight") sel = (sel + 1) % roster.length;
      else if (e.code === "Enter") startPlay();
      else if (e.code === "Escape") state = "world";
    } else {
      if (e.code === "KeyC" || e.code === "Tab") { showCollection = !showCollection; showHelp = false; if (showCollection) { if (document.pointerLockElement) document.exitPointerLock(); } else relock(); }
      else if (e.code === "KeyH") { showHelp = !showHelp; showCollection = false; if (showHelp) { if (document.pointerLockElement) document.exitPointerLock(); } else relock(); }
      else if (e.code === "KeyF") { flying = !flying; toast("Fly " + (flying ? "ON" : "OFF")); }
      else if (e.code.indexOf("Digit") === 0) { const d = parseInt(e.code.slice(5), 10); if (d >= 1 && d <= HOTBAR.length) hotbarSel = d - 1; }
      else if (e.code === "Minus" || e.code === "NumpadSubtract") { sens = Math.max(0.2, sens / 1.25); toast("Sensitivity " + Math.round(sens * 100) + "%"); }
      else if (e.code === "Equal" || e.code === "NumpadAdd") { sens = Math.min(4, sens * 1.25); toast("Sensitivity " + Math.round(sens * 100) + "%"); }
      else if (e.code === "Escape") { if (showCollection) { showCollection = false; relock(); } else if (showHelp) { showHelp = false; relock(); } else state = "avatar"; }
      else if (e.code === "Space" && !showCollection && !showHelp) { if (now - lastSpace < 0.28) { flying = !flying; toast("Fly " + (flying ? "ON" : "OFF")); } lastSpace = now; }
    }
  });
  window.addEventListener("keyup", function (e) { keys.delete(e.code); });
  window.addEventListener("blur", function () { keys.clear(); mouseDX = 0; mouseDY = 0; mbLeft = false; mbRight = false; });
  document.addEventListener("visibilitychange", function () { if (document.hidden) { keys.clear(); mbLeft = false; mbRight = false; } });

  function uiXY(e) { return { x: e.offsetX * UIW / canvas.width, y: e.offsetY * UIH / canvas.height }; }
  canvas.addEventListener("click", function (e) {
    canvas.focus(); ensureAudio();
    if (state === "title") { state = "world"; return; }
    if (state === "world") {
      const p = uiXY(e), n = WORLDS.length, spacing = UIW / (n + 1), rowY = 122;
      for (let i = 0; i < n; i++) { const cx = spacing * (i + 1); if (p.x >= cx - 44 && p.x <= cx + 44 && p.y >= rowY - 58 && p.y <= rowY + 56) { worldSel = i; applyWorld(i); state = "avatar"; return; } }
      return;
    }
    if (state === "avatar") { const p = uiXY(e), b = startBtn(); if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { startPlay(); return; } const n = roster.length, spacing = UIW / (n + 1); let i = Math.round(p.x / spacing) - 1; if (i < 0) i = 0; else if (i >= n) i = n - 1; sel = i; return; }
    if (showCollection || showHelp) return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", function () { locked = document.pointerLockElement === canvas; if (locked) skipMouse = true; else { mouseDX = 0; mouseDY = 0; keys.clear(); mbLeft = false; mbRight = false; } });
  document.addEventListener("mousemove", function (e) {
    if (!locked) return; if (skipMouse) { skipMouse = false; return; }
    let dx = e.movementX || 0, dy = e.movementY || 0;
    if (dx > 180) dx = 180; else if (dx < -180) dx = -180; if (dy > 180) dy = 180; else if (dy < -180) dy = -180;
    mouseDX += dx; mouseDY += dy;
  });
  canvas.addEventListener("mousedown", function (e) { if (state === "play" && !showCollection && !showHelp && locked) { if (e.button === 0) { mbLeft = true; doBreak(); lastAct = now; } else if (e.button === 2) { mbRight = true; doPlace(); lastAct = now; } } });
  canvas.addEventListener("mouseup", function (e) { if (e.button === 0) mbLeft = false; else if (e.button === 2) mbRight = false; });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  canvas.addEventListener("wheel", function (e) { if (state === "play" && locked) { hotbarSel = (hotbarSel + (e.deltaY > 0 ? 1 : -1) + HOTBAR.length) % HOTBAR.length; e.preventDefault(); } }, { passive: false });

  // =====================================================================
  //  Boot
  // =====================================================================
  setRes(RES[resLevel][0], RES[resLevel][1]);
  resize();
  preloadAll();
  applyWorld(0);
  try { canvas.focus(); } catch (e) { }
  window.addEventListener("load", function () { try { canvas.focus(); } catch (e) { } });
  requestAnimationFrame(loop);
})();
