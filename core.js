// 解析コア：自動検出・追跡・厚みの推定（画面に依存しない部分）
// Midsole compression analysis core (framework-free; runs in browser and Node)
const Core = (() => {
  'use strict';

  // ---------- image utils ----------
  function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    return g;
  }
  function blur3(src, w, h) { // separable [1 2 1]/4
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) {
        const a = src[r + (x > 0 ? x - 1 : 0)], b = src[r + x], c = src[r + (x < w - 1 ? x + 1 : x)];
        tmp[r + x] = 0.25 * a + 0.5 * b + 0.25 * c;
      }
    }
    for (let y = 0; y < h; y++) {
      const ya = (y > 0 ? y - 1 : 0) * w, yb = y * w, yc = (y < h - 1 ? y + 1 : y) * w;
      for (let x = 0; x < w; x++) out[yb + x] = 0.25 * tmp[ya + x] + 0.5 * tmp[yb + x] + 0.25 * tmp[yc + x];
    }
    return out;
  }
  function half(img) {
    const { data, w, h } = img, w2 = w >> 1, h2 = h >> 1, out = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * w2 + x] = 0.25 * (data[i] + data[i + 1] + data[i + w] + data[i + w + 1]);
    }
    return { data: out, w: w2, h: h2 };
  }
  function pyramid(gray, w, h, levels) {
    const p = [{ data: blur3(gray, w, h), w, h }];
    for (let l = 1; l < levels; l++) {
      const prev = p[l - 1];
      if (prev.w < 24 || prev.h < 24) break;
      const hh = half(prev);
      p.push({ data: blur3(hh.data, hh.w, hh.h), w: hh.w, h: hh.h });
    }
    return p;
  }
  function bil(img, x, y) {
    const { data, w, h } = img;
    if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
    if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
  }
  function bilRGB(rgba, w, h, x, y, out, o) {
    if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
    if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = (y0 * w + x0) * 4, j = i + w * 4;
    const a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
    out[o] += a * rgba[i] + b * rgba[i + 4] + c * rgba[j] + d * rgba[j + 4];
    out[o + 1] += a * rgba[i + 1] + b * rgba[i + 5] + c * rgba[j + 1] + d * rgba[j + 5];
    out[o + 2] += a * rgba[i + 2] + b * rgba[i + 6] + c * rgba[j + 2] + d * rgba[j + 6];
  }

  // ---------- Shi-Tomasi corners ----------
  function goodFeatures(gray, w, h, inMask, maxN, minDist, quality) {
    const g = blur3(gray, w, h);
    const ixx = new Float32Array(w * h), iyy = new Float32Array(w * h), ixy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = 0.5 * (g[i + 1] - g[i - 1]), gy = 0.5 * (g[i + w] - g[i - w]);
      ixx[i] = gx * gx; iyy[i] = gy * gy; ixy[i] = gx * gy;
    }
    const R = 2, cand = [];
    let maxv = 0;
    const resp = new Float32Array(w * h);
    for (let y = R + 2; y < h - R - 2; y++) for (let x = R + 2; x < w - R - 2; x++) {
      if (!inMask(x, y)) continue;
      let a = 0, b = 0, c = 0;
      for (let dy = -R; dy <= R; dy++) { const r = (y + dy) * w + x; for (let dx = -R; dx <= R; dx++) { a += ixx[r + dx]; c += iyy[r + dx]; b += ixy[r + dx]; } }
      const l = 0.5 * (a + c) - Math.sqrt(0.25 * (a - c) * (a - c) + b * b);
      resp[y * w + x] = l; if (l > maxv) maxv = l;
    }
    const thr = maxv * quality;
    for (let y = R + 3; y < h - R - 3; y++) for (let x = R + 3; x < w - R - 3; x++) {
      const i = y * w + x, v = resp[i];
      if (v <= thr) continue;
      if (v < resp[i - 1] || v < resp[i + 1] || v < resp[i - w] || v < resp[i + w]) continue;
      cand.push([v, x, y]);
    }
    cand.sort((p, q) => q[0] - p[0]);
    const cell = Math.max(1, minDist), gw = Math.ceil(w / cell), grid = new Map(), out = [], md2 = minDist * minDist;
    for (const [, x, y] of cand) {
      const cx = (x / cell) | 0, cy = (y / cell) | 0;
      let ok = true;
      for (let yy = cy - 1; yy <= cy + 1 && ok; yy++) for (let xx = cx - 1; xx <= cx + 1 && ok; xx++) {
        const arr = grid.get(yy * gw + xx); if (!arr) continue;
        for (const p of arr) if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < md2) { ok = false; break; }
      }
      if (!ok) continue;
      const key = cy * gw + cx; if (!grid.has(key)) grid.set(key, []); grid.get(key).push([x, y]);
      out.push([x, y]);
      if (out.length >= maxN) break;
    }
    return out;
  }

  // ---------- pyramidal Lucas-Kanade ----------
  function lkPoint(pA, pB, x, y, gx0, gy0, win, iters) {
    const L = pA.length;
    let gx = gx0 / (1 << L), gy = gy0 / (1 << L);
    const n = (2 * win + 1) * (2 * win + 1);
    const T = new Float32Array(n), DX = new Float32Array(n), DY = new Float32Array(n);
    let vx = 0, vy = 0;
    for (let l = L - 1; l >= 0; l--) {
      gx *= 2; gy *= 2;
      const A = pA[l], B = pB[l], sc = 1 / (1 << l), px = x * sc, py = y * sc;
      if (px < 1 || py < 1 || px > A.w - 2 || py > A.h - 2) return null;
      let gxx = 0, gyy = 0, gxy = 0, k = 0;
      for (let dy = -win; dy <= win; dy++) for (let dx = -win; dx <= win; dx++, k++) {
        const sx = px + dx, sy = py + dy;
        T[k] = bil(A, sx, sy);
        const ix = 0.5 * (bil(A, sx + 1, sy) - bil(A, sx - 1, sy)), iy = 0.5 * (bil(A, sx, sy + 1) - bil(A, sx, sy - 1));
        DX[k] = ix; DY[k] = iy; gxx += ix * ix; gyy += iy * iy; gxy += ix * iy;
      }
      const det = gxx * gyy - gxy * gxy;
      if (det < 1e-3 * n * n || (gxx + gyy) < 1e-6) return null;
      vx = 0; vy = 0;
      for (let it = 0; it < iters; it++) {
        let bx = 0, by = 0; k = 0;
        const qx = px + gx + vx, qy = py + gy + vy;
        for (let dy = -win; dy <= win; dy++) for (let dx = -win; dx <= win; dx++, k++) {
          const e = T[k] - bil(B, qx + dx, qy + dy);
          bx += e * DX[k]; by += e * DY[k];
        }
        const ex = (gyy * bx - gxy * by) / det, ey = (gxx * by - gxy * bx) / det;
        vx += ex; vy += ey;
        if (ex * ex + ey * ey < 0.0009) break;
      }
      if (l > 0) { gx += vx; gy += vy; vx = 0; vy = 0; }
    }
    return [x + gx + vx, y + gy + vy];
  }

  // ---------- similarity transforms: x' = a x - b y + tx, y' = b x + a y + ty ----------
  function fitSim(src, dst, wts) {
    let sw = 0, sx = 0, sy = 0, dx = 0, dy = 0;
    for (let i = 0; i < src.length; i++) { const w = wts ? wts[i] : 1; sw += w; sx += w * src[i][0]; sy += w * src[i][1]; dx += w * dst[i][0]; dy += w * dst[i][1]; }
    if (sw <= 0) return null;
    sx /= sw; sy /= sw; dx /= sw; dy /= sw;
    let num1 = 0, num2 = 0, den = 0;
    for (let i = 0; i < src.length; i++) {
      const w = wts ? wts[i] : 1, px = src[i][0] - sx, py = src[i][1] - sy, qx = dst[i][0] - dx, qy = dst[i][1] - dy;
      num1 += w * (px * qx + py * qy); num2 += w * (px * qy - py * qx); den += w * (px * px + py * py);
    }
    if (den < 1e-9) return null;
    const a = num1 / den, b = num2 / den;
    return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
  }
  const apply = (M, p) => [M.a * p[0] - M.b * p[1] + M.tx, M.b * p[0] + M.a * p[1] + M.ty];
  const scaleOf = M => Math.hypot(M.a, M.b);
  function invert(M) {
    const s2 = M.a * M.a + M.b * M.b, a = M.a / s2, b = -M.b / s2;
    return { a, b, tx: -(a * M.tx - b * M.ty), ty: -(b * M.tx + a * M.ty) };
  }
  function ransacSim(src, dst, thr, iters, rnd) {
    const n = src.length; if (n < 2) return null;
    let best = null, bestCnt = -1;
    const t2 = thr * thr;
    for (let it = 0; it < iters; it++) {
      const i = (rnd() * n) | 0; let j = (rnd() * n) | 0; if (j === i) j = (j + 1) % n;
      const M = fitSim([src[i], src[j]], [dst[i], dst[j]]);
      if (!M) continue;
      const s = scaleOf(M); if (s < 0.5 || s > 2) continue;
      let cnt = 0;
      for (let k = 0; k < n; k++) { const p = apply(M, src[k]); if ((p[0] - dst[k][0]) ** 2 + (p[1] - dst[k][1]) ** 2 < t2) cnt++; }
      if (cnt > bestCnt) { bestCnt = cnt; best = M; }
    }
    if (!best) return null;
    let inl = [];
    for (let k = 0; k < n; k++) { const p = apply(best, src[k]); inl.push((p[0] - dst[k][0]) ** 2 + (p[1] - dst[k][1]) ** 2 < t2); }
    const s2 = [], d2 = [];
    inl.forEach((v, k) => { if (v) { s2.push(src[k]); d2.push(dst[k]); } });
    const M2 = s2.length >= 2 ? fitSim(s2, d2) : best;
    inl = []; let cnt = 0;
    for (let k = 0; k < n; k++) { const p = apply(M2, src[k]); const ok = (p[0] - dst[k][0]) ** 2 + (p[1] - dst[k][1]) ** 2 < t2 * 2.25; inl.push(ok); if (ok) cnt++; }
    return { M: M2, inliers: inl, count: cnt };
  }
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }

  // ---------- station geometry ----------
  function stationMeta(st) {
    const T = st.top, B = st.bot, h0 = Math.hypot(B[0] - T[0], B[1] - T[1]);
    const d0 = [(B[0] - T[0]) / h0, (B[1] - T[1]) / h0], n0 = [-d0[1], d0[0]];
    const step = Math.max(0.5, h0 / 110);
    const uMin = -0.5 * h0, uMax = 1.55 * h0, count = Math.floor((uMax - uMin) / step) + 1;
    return { T, B, h0, d0, n0, step, uMin, count, halfW: Math.max(2, Math.round(h0 * 0.05)) };
  }
  // feature region (in reference coordinates): band above the top line + upper part of midsole
  function featureRegion(stations) {
    const m = stations.map(stationMeta);
    const Ts = m.map(s => s.T), hs = m.map(s => s.h0), hmax = Math.max(...hs);
    let ux = 0, uy = 0; m.forEach(s => { ux -= s.d0[0]; uy -= s.d0[1]; });
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const first = Ts[0], last = Ts[Ts.length - 1];
    const ext = 0.32;
    const Eh = [first[0] + (first[0] - last[0]) * ext, first[1] + (first[1] - last[1]) * ext];
    const Ef = [last[0] + (last[0] - first[0]) * ext, last[1] + (last[1] - first[1]) * ext];
    const line = [Eh, ...Ts, Ef], hh = [hs[0], ...hs, hs[hs.length - 1]];
    const U = 0.9 * hmax;
    const top = line.map(p => [p[0] + ux * U, p[1] + uy * U]);
    const bot = line.map((p, i) => [p[0] - ux * 0.72 * hh[i], p[1] - uy * 0.72 * hh[i]]).reverse();
    return top.concat(bot);
  }

  function sampleProfile(rgba, w, h, c, d, n, s, meta) {
    const { uMin, step, count, halfW } = meta;
    const out = new Float32Array(count * 3), nw = 2 * halfW + 1;
    let jLo = -1, jHi = -1;
    for (let j = 0; j < count; j++) {
      const u = (uMin + j * step) * s, ex = Math.abs(n[0]) * halfW * s, ey = Math.abs(n[1]) * halfW * s;
      const x = c[0] + d[0] * u, y = c[1] + d[1] * u;
      const inside = x - ex >= 0.5 && x + ex <= w - 1.5 && y - ey >= 0.5 && y + ey <= h - 1.5;
      if (inside) { if (jLo < 0) jLo = j; jHi = j; }
    }
    out.jLo = jLo < 0 ? count : jLo; out.jHi = jHi;
    for (let j = 0; j < count; j++) {
      const u = (uMin + j * step) * s, bx = c[0] + d[0] * u, by = c[1] + d[1] * u;
      for (let k = -halfW; k <= halfW; k++) bilRGB(rgba, w, h, bx + n[0] * k * s, by + n[1] * k * s, out, j * 3);
      out[j * 3] /= nw; out[j * 3 + 1] /= nw; out[j * 3 + 2] /= nw;
    }
    return out;
  }

  // ---------- Tracker: sequential pass over frames ----------
  class Tracker {
    constructor(frame, stations, opts = {}) {
      this.opts = Object.assign({ maxFeatures: 160, win: 9, levels: 4, fbThr: 1.2, ransacThr: 2.2 }, opts);
      this.stations = stations;
      this.meta = stations.map(stationMeta);
      const { w, h, rgba } = frame;
      this.w = w; this.h = h;
      const gray = toGray(rgba, w, h);
      this.prevPyr = pyramid(gray, w, h, this.opts.levels);
      this.region = featureRegion(stations);
      const L = Math.hypot(stations[stations.length - 1].top[0] - stations[0].top[0], stations[stations.length - 1].top[1] - stations[0].top[1]);
      this.L = Math.max(L, 40);
      this.minDist = Math.max(4, Math.round(this.L / 45));
      const feats = goodFeatures(gray, w, h, (x, y) => pointInPoly(x, y, this.region), this.opts.maxFeatures, this.minDist, 0.02);
      this.ref = feats.map(p => [p[0], p[1]]);
      this.cur = feats.map(p => [p[0], p[1]]);
      this.vel = feats.map(() => [0, 0]);
      this.initialCount = feats.length;
      this.rnd = mulberry(12345);
      this.G = { a: 1, b: 0, tx: 0, ty: 0 };
      this.frames = [];
      this._record(frame, this.G, this.ref.map(() => true), this.ref, this.ref);
    }
    _record(frame, G, inliers, refPts, curPts) {
      const local = this.meta.map((m, k) => {
        const sig = 0.42 * this.L, s2 = 2 * sig * sig;
        const src = [], dst = [], wts = [];
        let sw = 0;
        for (let i = 0; i < refPts.length; i++) if (inliers[i]) {
          const dd = (refPts[i][0] - m.T[0]) ** 2 + (refPts[i][1] - m.T[1]) ** 2, wt = Math.exp(-dd / s2);
          src.push(refPts[i]); dst.push(curPts[i]); wts.push(wt); sw += wt;
        }
        let M = (sw > 2.5 && src.length >= 4) ? fitSim(src, dst, wts) : null;
        if (!M || Math.abs(scaleOf(M) / scaleOf(G) - 1) > 0.15) M = G;
        return M;
      });
      const profiles = this.meta.map((m, k) => {
        const M = local[k], s = scaleOf(M), c = apply(M, m.T);
        const ca = M.a / s, sb = M.b / s;
        const d = [ca * m.d0[0] - sb * m.d0[1], sb * m.d0[0] + ca * m.d0[1]];
        const n = [-d[1], d[0]];
        return sampleProfile(frame.rgba, frame.w, frame.h, c, d, n, s, m);
      });
      const nIn = inliers.reduce((a, v) => a + (v ? 1 : 0), 0);
      this.frames.push({ G, local, profiles, nFeatures: refPts.length, nInliers: nIn });
    }
    step(frame) {
      const { w, h, rgba } = frame;
      const gray = toGray(rgba, w, h);
      const pyr = pyramid(gray, w, h, this.opts.levels);
      const win = this.opts.win, newRef = [], newCur = [], newVel = [];
      for (let i = 0; i < this.cur.length; i++) {
        const p = this.cur[i], v = this.vel[i];
        const q = lkPoint(this.prevPyr, pyr, p[0], p[1], v[0], v[1], win, 20);
        if (!q) continue;
        const r = lkPoint(pyr, this.prevPyr, q[0], q[1], p[0] - q[0], p[1] - q[1], win, 20);
        if (!r || (r[0] - p[0]) ** 2 + (r[1] - p[1]) ** 2 > this.opts.fbThr ** 2) continue;
        if (q[0] < 2 || q[1] < 2 || q[0] > w - 3 || q[1] > h - 3) continue;
        newRef.push(this.ref[i]); newCur.push(q); newVel.push([q[0] - p[0], q[1] - p[1]]);
      }
      let G = this.G, inl = newRef.map(() => false);
      const rs = newRef.length >= 4 ? ransacSim(newRef, newCur, this.opts.ransacThr, 300, this.rnd) : null;
      if (rs && rs.count >= 4) { G = rs.M; inl = rs.inliers; }
      this.lost = !(rs && rs.count >= 4);
      // keep inliers only for continued tracking
      const kRef = [], kCur = [], kVel = [];
      for (let i = 0; i < newRef.length; i++) if (inl[i]) { kRef.push(newRef[i]); kCur.push(newCur[i]); kVel.push(newVel[i]); }
      this._record(frame, G, inl, newRef, newCur);
      // replenish features when they run low
      if (kRef.length < Math.max(24, 0.5 * this.initialCount) && !this.lost) {
        const regionCur = this.region.map(p => apply(G, p));
        const md = this.minDist * scaleOf(G);
        const feats = goodFeatures(gray, w, h, (x, y) => {
          if (!pointInPoly(x, y, regionCur)) return false;
          for (const c of kCur) if ((c[0] - x) ** 2 + (c[1] - y) ** 2 < md * md) return false;
          return true;
        }, this.opts.maxFeatures - kRef.length, md, 0.02);
        const Gi = invert(G);
        let mv = [0, 0]; if (kVel.length) { kVel.forEach(v => { mv[0] += v[0]; mv[1] += v[1]; }); mv = [mv[0] / kVel.length, mv[1] / kVel.length]; }
        for (const f of feats) { kRef.push(apply(Gi, f)); kCur.push([f[0], f[1]]); kVel.push(mv.slice()); }
      }
      this.ref = kRef; this.cur = kCur; this.vel = kVel; this.G = G; this.prevPyr = pyr;
      return this.frames[this.frames.length - 1];
    }
  }

  // ---------- scoring ----------
  function scoreStation(profiles, meta) {
    const { step, uMin, count, h0 } = meta;
    const F = profiles.length;
    const jT0 = Math.round((0 - uMin) / step), jB0 = Math.round((h0 - uMin) / step);
    const lin = Math.round(Math.min(Math.max(0.25 * h0, 6), 18) / step), lout = Math.round(Math.max(4, 0.08 * h0) / step);
    const linB = Math.round(Math.min(Math.max(0.32 * h0, 7), 22) / step), loutB = Math.round(Math.max(1.5, 0.025 * h0) / step);
    const P0 = profiles[0];
    const tmpl = (j0, a, b) => { const L = b - a + 1, t = new Float32Array(L * 3); for (let k = 0; k < L; k++) for (let c = 0; c < 3; c++) t[k * 3 + c] = P0[(j0 + a + k) * 3 + c]; return t; };
    const tT = tmpl(jT0, -lout, lin), tB = tmpl(jB0, -linB, loutB), tB2 = tmpl(jB0, -lin, lout);
    const ncc = (P, t, j0, a) => {
      const L = t.length / 3, out = new Float32Array(count).fill(-1);
      let mt = [0, 0, 0]; for (let k = 0; k < L; k++) for (let c = 0; c < 3; c++) mt[c] += t[k * 3 + c] / L;
      let st = 0; const tc = new Float32Array(t.length);
      for (let k = 0; k < L; k++) for (let c = 0; c < 3; c++) { const v = t[k * 3 + c] - mt[c]; tc[k * 3 + c] = v; st += v * v; }
      const noise = L * 3 * 36;
      for (let j = -a; j + a + L - 1 < count; j++) {
        const s0 = j + a; if (s0 < 0) continue;
        let mp = [0, 0, 0];
        for (let k = 0; k < L; k++) for (let c = 0; c < 3; c++) mp[c] += P[(s0 + k) * 3 + c] / L;
        let sp = 0, cr = 0;
        for (let k = 0; k < L; k++) for (let c = 0; c < 3; c++) { const v = P[(s0 + k) * 3 + c] - mp[c]; sp += v * v; cr += v * tc[k * 3 + c]; }
        out[j] = cr / Math.sqrt((st + noise) * (sp + noise));
      }
      return out;
    };
    const grad = P => {
      const g = new Float32Array(count);
      for (let j = 1; j < count - 1; j++) {
        let s = 0; for (let c = 0; c < 3; c++) { const v = 0.5 * (P[(j + 1) * 3 + c] - P[(j - 1) * 3 + c]); s += v * v; }
        g[j] = Math.sqrt(s);
      }
      return g;
    };
    const grads = profiles.map(grad);
    // robust normalisation of gradient strength across all frames
    const all = []; grads.forEach(g => { for (let j = 0; j < count; j += 2) all.push(g[j]); });
    all.sort((a, b) => a - b);
    const gN = all[Math.floor(all.length * 0.985)] || 1;
    const sT = [], sB = [], nT = [], nB = [];
    for (let f = 0; f < F; f++) {
      const P = profiles[f], g = grads[f];
      const a = ncc(P, tT, jT0, -lout), b1 = ncc(P, tB, jB0, -linB), b2 = ncc(P, tB2, jB0, -lin);
      const b = new Float32Array(count); for (let j = 0; j < count; j++) b[j] = Math.max(b1[j], b2[j]);
      const ST = new Float32Array(count), SB = new Float32Array(count);
      const lo = P.jLo ?? 0, hi = P.jHi ?? count - 1;
      for (let j = 0; j < count; j++) {
        if (j < lo + 1 || j > hi - 1) { ST[j] = 0; SB[j] = 0; a[j] = 0; b[j] = 0; continue; }
        const gn = Math.min(1, g[j] / gN);
        ST[j] = 0.7 * a[j] + 0.3 * gn;
        SB[j] = 0.65 * Math.max(0, b[j]) + 0.35 * gn;
      }
      sT.push(ST); sB.push(SB); nT.push(a); nB.push(b);
    }
    return { sT, sB, nT, nB, jT0, jB0, lims: profiles.map(P => [P.jLo ?? 0, P.jHi ?? count - 1]) };
  }

  // 1D L1 distance transform (max-form) with argmax
  function dt1(f, n, lam, out, idx, off, stride) {
    for (let i = 0; i < n; i++) { out[off + i * stride] = f[off + i * stride]; idx[off + i * stride] = i; }
    for (let i = 1; i < n; i++) {
      const p = off + (i - 1) * stride, c = off + i * stride;
      if (out[p] - lam > out[c]) { out[c] = out[p] - lam; idx[c] = idx[p]; }
    }
    for (let i = n - 2; i >= 0; i--) {
      const p = off + (i + 1) * stride, c = off + i * stride;
      if (out[p] - lam > out[c]) { out[c] = out[p] - lam; idx[c] = idx[p]; }
    }
  }

  // Joint DP over (top position, thickness). constraints: Map frame -> {jt, m}
  function solveStation(scores, meta, params = {}, constraints = new Map()) {
    const { step, h0, count } = meta;
    const { sT, sB, jT0, jB0 } = scores;
    const F = sT.length;
    const pct = 0.01 * h0 / step; // samples per 1% of h0
    const lamT = (params.lamTop ?? 0.01) / pct, lamH = (params.lamThick ?? 0.03) / pct;
    const aMin = Math.max(0, jT0 - Math.round(0.3 * h0 / step)), aMax = Math.min(count - 1, jT0 + Math.round(0.3 * h0 / step));
    const mMin = Math.round(0.42 * h0 / step), mMax = Math.round(1.3 * h0 / step);
    const NA = aMax - aMin + 1, NM = mMax - mMin + 1, N = NA * NM;
    const NEG = -1e9;
    let cost = new Float32Array(N).fill(NEG);
    const m0 = jB0 - jT0;
    cost[(jT0 - aMin) * NM + (m0 - mMin)] = 0;
    const back = [];
    const g1 = new Float32Array(N), i1 = new Int32Array(N), g2 = new Float32Array(N), i2 = new Int32Array(N);
    const data = (f, out) => {
      const T = sT[f], B = sB[f], con = constraints.get(f);
      const cjt = con ? Math.min(aMax, Math.max(aMin, con.jt)) : 0;
      const cm = con ? Math.max(mMin, Math.min(mMax, Math.min(con.m, count - 1 - cjt))) : 0;
      for (let a = 0; a < NA; a++) {
        const jt = aMin + a, st = T[jt];
        for (let m = 0; m < NM; m++) {
          const jb = jt + mMin + m;
          let v = jb < count ? st + B[jb] : NEG;
          if (con && (Math.abs(jt - cjt) > 1 || Math.abs(mMin + m - cm) > 1)) v = NEG;
          out[a * NM + m] = v;
        }
      }
    };
    const D = new Float32Array(N);
    // frame 0: anchored at the reference (data term irrelevant)
    for (let f = 1; f < F; f++) {
      for (let m = 0; m < NM; m++) dt1(cost, NA, lamT, g1, i1, m, NM);       // along top axis
      for (let a = 0; a < NA; a++) dt1(g1, NM, lamH, g2, i2, a * NM, 1);     // along thickness axis
      data(f, D);
      const bk = new Int32Array(N), nc = new Float32Array(N);
      for (let a = 0; a < NA; a++) for (let m = 0; m < NM; m++) {
        const i = a * NM + m, mp = i2[i];
        const am = i1[a * NM + mp];
        bk[i] = am * NM + mp;
        nc[i] = g2[i] + D[i];
      }
      back.push(bk); cost = nc;
    }
    let best = 0; for (let i = 1; i < N; i++) if (cost[i] > cost[best]) best = i;
    const path = new Array(F);
    let cur = best;
    for (let f = F - 1; f >= 1; f--) { path[f] = cur; cur = back[f - 1][cur]; }
    path[0] = (jT0 - aMin) * NM + (m0 - mMin);
    // decode + sub-sample refinement
    const parab = (arr, j) => {
      if (j <= 0 || j >= arr.length - 1) return 0;
      const l = arr[j - 1], c = arr[j], r = arr[j + 1], den = l - 2 * c + r;
      if (den >= -1e-6) return 0;
      const o = 0.5 * (l - r) / den; return Math.max(-0.5, Math.min(0.5, o));
    };
    const res = [];
    for (let f = 0; f < F; f++) {
      const a = Math.floor(path[f] / NM), m = path[f] % NM, jt = aMin + a, jb = jt + mMin + m;
      let ut = meta.uMin + jt * step, ub = meta.uMin + jb * step;
      if (f > 0 && !constraints.has(f)) { ut += parab(sT[f], jt) * step; ub += parab(sB[f], jb) * step; }
      const conf = 0.5 * (Math.max(0, scores.nT[f][jt]) + Math.max(0, scores.nB[f][jb]));
      const [lo, hi] = scores.lims[f], margin = Math.round((2 + 0.03 * h0) / step);
      const inFrame = jt >= lo + margin && jb <= hi - margin;
      res.push({ uTop: ut, uBot: ub, h: ub - ut, comp: 1 - (ub - ut) / h0, conf, jt, m: mMin + m, valid: constraints.has(f) || (inFrame && (f === 0 || (conf > 0.45 && m > 1 && m < NM - 2))), inFrame, constrained: constraints.has(f) });
    }
    return res;
  }

  // ---------- helpers for initial placement ----------
  function columnProfileRGB(rgba, w, h, x, y0, y1, halfW) {
    const n = Math.max(2, Math.round(y1 - y0) + 1), out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let k = -halfW; k <= halfW; k++) bilRGB(rgba, w, h, x + k, y0 + i, out, i * 3);
      for (let c = 0; c < 3; c++) out[i * 3 + c] /= (2 * halfW + 1);
    }
    return out;
  }
  function strongestEdge(rgba, w, h, x, ya, yb, halfW, preferDark) {
    const P = columnProfileRGB(rgba, w, h, x, ya, yb, halfW), n = P.length / 3;
    let best = -1, bi = Math.round(n / 2);
    for (let i = 2; i < n - 2; i++) {
      let s = 0, lum = 0;
      for (let c = 0; c < 3; c++) { const v = 0.25 * (P[(i + 2) * 3 + c] + P[(i + 1) * 3 + c] - P[(i - 1) * 3 + c] - P[(i - 2) * 3 + c]); s += v * v; lum += v; }
      let sc = Math.sqrt(s);
      if (preferDark && lum < 0) sc *= 1.25; // bright -> dark going down
      const centre = 1 - 0.35 * Math.abs(i - n / 2) / (n / 2);
      sc *= centre;
      if (sc > best) { best = sc; bi = i; }
    }
    return ya + bi + 0.5;
  }
  // ---------- sole contours: bottom edge and midsole/upper boundary, traced along the shoe by DP ----------
  function seamDP(S, NC, NR, lam, J) {
    const NEG = -1e9; let cost = S.slice(0, NR); const back = new Int32Array(NC * NR);
    for (let c = 1; c < NC; c++) {
      const nc = new Float32Array(NR);
      for (let r = 0; r < NR; r++) {
        const sv = S[c * NR + r];
        let best = NEG, bi = r;
        for (let q = Math.max(0, r - J); q <= Math.min(NR - 1, r + J); q++) { const v = cost[q] - lam * Math.abs(q - r); if (v > best) { best = v; bi = q; } }
        nc[r] = best + sv; back[c * NR + r] = bi;
      }
      cost = nc;
    }
    let r = 0; for (let q = 1; q < NR; q++) if (cost[q] > cost[r]) r = q;
    const path = new Array(NC);
    for (let c = NC - 1; c >= 0; c--) { path[c] = r; r = back[c * NR + r]; }
    return path;
  }
  function pctl(arr, q) { const t = Array.from(arr).filter(v => v > 0).sort((a, b) => a - b); return t.length ? t[Math.floor((t.length - 1) * q)] : 1; }
  function interpC(xs, ys, x) {
    if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    const step = xs[1] - xs[0], i = Math.min(xs.length - 2, Math.floor((x - xs[0]) / step)), f = (x - xs[i]) / step;
    return ys[i] * (1 - f) + ys[i + 1] * f;
  }
  // o: yA..yB = search rows for the bottom edge; tMin..tMax = allowed midsole thickness (px); tExp/tSig = thickness prior
  function soleContours(frame, x0, x1, o) {
    const { rgba, w, h } = frame, len = x1 - x0;
    if (len < 20) return null;
    const NC = Math.max(24, Math.min(160, Math.round(len / 4))), sx = len / (NC - 1);
    const hw = Math.max(1, Math.round(sx / 2)), k = Math.max(2, Math.round(len * 0.005));
    const yB = Math.min(h - k - 2, Math.ceil(o.yB)), yA = Math.max(k + 1, Math.min(yB - 4, Math.floor(o.yA)));
    const yT = Math.max(k + 1, Math.floor(yA - o.tMax)), NR = yB - yT + 1;
    if (NR < 10) return null;
    const xs = [], dl = new Float32Array(NC * NR), dc = new Float32Array(NC * NR), profs = [];
    for (let c = 0; c < NC; c++) {
      const x = x0 + c * sx; xs.push(x);
      const P = columnProfileRGB(rgba, w, h, x, yT, yB, hw), n = P.length / 3; profs.push(P);
      const cs = new Float32Array((n + 1) * 3);
      for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) cs[(i + 1) * 3 + ch] = cs[i * 3 + ch] + P[i * 3 + ch];
      for (let r = k; r < Math.min(NR, n) - k; r++) {
        let l = 0, d2 = 0;
        for (let ch = 0; ch < 3; ch++) {
          const up = (cs[r * 3 + ch] - cs[(r - k) * 3 + ch]) / k, dn = (cs[(r + k + 1) * 3 + ch] - cs[(r + 1) * 3 + ch]) / k;
          const d = up - dn; d2 += d * d; l += d * (ch === 0 ? 0.299 : ch === 1 ? 0.587 : 0.114);
        }
        dl[c * NR + r] = Math.max(0, l); dc[c * NR + r] = Math.sqrt(d2);
      }
    }
    const nB = pctl(dl, 0.985) || 1, nE = pctl(dc, 0.985) || 1;
    const J = Math.max(2, Math.ceil(1.1 * sx)), lamB = (o.lam ?? 0.3) / sx * 2.5, lamT = (o.lamTop ?? 0.15) / sx * 2.5;
    const SB = new Float32Array(NC * NR).fill(-5);
    for (let c = 0; c < NC; c++) for (let r = yA - yT; r < NR; r++) {
      let pr = 0;
      if (o.yRef !== undefined) {
        // the object's lowest extent (from the foreground mask) is a strong hint for where the sole ends
        const dy = (yT + r - o.yRef) / len;
        pr = dy < 0 ? -0.6 * Math.min(1.5, Math.max(0, -dy - 0.05) / 0.05) : -0.6 * Math.min(1.5, Math.max(0, dy - 0.02) / 0.04);
      }
      SB[c * NR + r] = Math.min(1.5, dl[c * NR + r] / nB) + 0.3 * Math.min(1.5, dc[c * NR + r] / nE) + pr;
    }
    const pb = seamDP(SB, NC, NR, lamB, J);
    // colour model of the midsole from a thin band just above the bottom edge; the top boundary is
    // where that colour stops (black upper over a cream midsole, print over foam, ...)
    const bandLo = Math.max(2, Math.round(0.012 * len)), bandHi = Math.max(bandLo + 2, Math.round(Math.min(0.05 * len, 0.6 * o.tMin + 0.03 * len)));
    const smp = [];
    for (let c = Math.round(NC * 0.15); c < Math.round(NC * 0.85); c++) {
      const P = profs[c];
      for (let r = pb[c] - bandHi; r <= pb[c] - bandLo; r++) if (r >= 0 && r < P.length / 3) smp.push([P[r * 3], P[r * 3 + 1], P[r * 3 + 2]]);
    }
    let mu = null, sig = 1;
    if (smp.length > 20) {
      mu = [0, 1, 2].map(ch => { const t = smp.map(v => v[ch]).sort((p, q) => p - q); return t[t.length >> 1]; });
      const ds = smp.map(v => Math.hypot(v[0] - mu[0], v[1] - mu[1], v[2] - mu[2])).sort((p, q) => p - q);
      sig = Math.max(14, 1.5 * ds[ds.length >> 1]) * 2.2;
    }
    // only trust the colour cue when the upper clearly differs from the midsole (a white upper over a
    // white midsole would otherwise latch onto logo edges)
    let msW = 0;
    if (mu) {
      const up = [];
      for (let c = Math.round(NC * 0.15); c < Math.round(NC * 0.85); c++) {
        const P = profs[c], ra = Math.round(pb[c] - 0.26 * len), rb2 = Math.round(pb[c] - 0.17 * len);
        for (let r = Math.max(0, ra); r <= rb2 && r < P.length / 3; r++) up.push([P[r * 3], P[r * 3 + 1], P[r * 3 + 2]]);
      }
      if (up.length > 20) {
        const muU = [0, 1, 2].map(ch => { const t = up.map(v => v[ch]).sort((p, q) => p - q); return t[t.length >> 1]; });
        const dd = Math.hypot(mu[0] - muU[0], mu[1] - muU[1], mu[2] - muU[2]);
        msW = Math.max(0, Math.min(1, (dd - 40) / 60));
      }
    }
    const edgeW = 1 - 0.3 * msW;
    const k2 = Math.max(3, Math.round(0.01 * len));
    const ST = new Float32Array(NC * NR).fill(-5);
    for (let c = 0; c < NC; c++) {
      const rb = pb[c], P = profs[c], n = P.length / 3;
      let mcs = null;
      if (mu) {
        mcs = new Float32Array(n + 1);
        for (let i = 0; i < n; i++) { const d = Math.hypot(P[i * 3] - mu[0], P[i * 3 + 1] - mu[1], P[i * 3 + 2] - mu[2]) / sig; mcs[i + 1] = mcs[i] + Math.exp(-0.5 * d * d); }
      }
      for (let r = Math.max(0, Math.round(rb - o.tMax)); r <= rb - o.tMin; r++) {
        const t = rb - r, z = (t - o.tExp) / o.tSig;
        let ms = 0;
        if (mcs && r - k2 >= 0 && r + k2 < n) ms = (mcs[r + k2 + 1] - mcs[r + 1]) / k2 - (mcs[r] - mcs[r - k2]) / k2;
        ST[c * NR + r] = msW * Math.max(0, ms) + edgeW * (Math.min(1.5, dc[c * NR + r] / nE) - o.wPrior * Math.min(1, z * z));
      }
    }
    const pt = seamDP(ST, NC, NR, lamT, J);
    // running median removes narrow spikes (logo ends, lace shadows) before the stations are read off
    const rmed = (arr, half) => arr.map((_, i) => { const t = arr.slice(Math.max(0, i - half), Math.min(arr.length, i + half + 1)).sort((p, q) => p - q); return t[t.length >> 1]; });
    const half = Math.max(2, Math.round(NC * 0.03));
    return { xs, top: rmed(pt.map(r => yT + r), half), bot: rmed(pb.map(r => yT + r), half), mu, msW };
  }

  // place 3 stations from a box around the midsole (x0..x1 = shoe length, y0 = midsole top, y1 = bottom)
  function placeStations(frame, box, toeRight, fr = [0.17, 0.5, 0.8]) {
    const { rgba, w, h } = frame;
    const bw = box.x1 - box.x0, bh = Math.max(4, box.y1 - box.y0);
    const con = soleContours(frame, box.x0, box.x1, { yA: box.y1 - 0.5 * bh, yB: box.y1 + 0.5 * bh, tMin: 0.35 * bh, tMax: 1.7 * bh, tExp: bh, tSig: 0.45 * bh, wPrior: 0.35 });
    const hw = Math.max(2, Math.round(bw * 0.006)), win = Math.max(4, 0.28 * bh);
    const st = fr.map(f => {
      const x = toeRight ? box.x0 + f * bw : box.x1 - f * bw;
      let top, bot;
      if (con) { top = interpC(con.xs, con.top, x); bot = interpC(con.xs, con.bot, x); }
      else { top = strongestEdge(rgba, w, h, x, box.y0 - win, box.y0 + win, hw, false); bot = strongestEdge(rgba, w, h, x, box.y1 - win, box.y1 + win, hw, true); }
      return { top: [x, top], bot: [x, Math.max(bot, top + 4)] };
    });
    st.contours = con;
    return st;
  }

  // Auto proposal of the midsole.
  // samples: frames spread over the clip. With a fixed camera their median is the background
  // (motion mode); with a moving camera we fall back to "sharp + bright" and drop static UI overlays.
  // prev: optional frame a few frames earlier, used to tell the running direction (= toe direction).
  function autoDetect(frame, samples = [], prev = null) {
    const { rgba, w, h } = frame;
    const bs = Math.max(4, Math.round(Math.max(w, h) / 160)), gw = Math.floor(w / bs), gh = Math.floor(h / bs), NB = gw * gh;
    const blockMean = (px) => {
      const out = new Float32Array(NB * 3);
      for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = by * bs; y < by * bs + bs; y += 2) for (let x = bx * bs; x < bx * bs + bs; x += 2) { const j = (y * w + x) * 4; r += px[j]; g += px[j + 1]; b += px[j + 2]; n++; }
        const o = (by * gw + bx) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
      }
      return out;
    };
    const gray = toGray(rgba, w, h), sharp = new Float32Array(NB);
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      let s = 0, n = 0;
      for (let y = Math.max(1, by * bs); y < Math.min(h - 1, by * bs + bs); y++) for (let x = Math.max(1, bx * bs); x < Math.min(w - 1, bx * bs + bs); x++) {
        const i = y * w + x; s += Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + w] - gray[i - w]); n++;
      }
      sharp[by * gw + bx] = n ? s / n : 0;
    }
    const cur = blockMean(rgba);
    const dist = (A, B, i) => Math.hypot(A[i * 3] - B[i * 3], A[i * 3 + 1] - B[i * 3 + 1], A[i * 3 + 2] - B[i * 3 + 2]);
    const pct = (arr, q) => { const t = Array.from(arr).sort((a, b) => a - b); return t[Math.floor((t.length - 1) * q)] || 0; };
    const sp95 = pct(sharp, 0.95) || 1;
    const mask = new Uint8Array(NB);
    let mode = 'sharp', fgArr = null;
    const ms = samples.map(s => blockMean(s.rgba));
    if (ms.length >= 5) {
      const bg = new Float32Array(NB * 3), tmp = new Float32Array(ms.length);
      for (let i = 0; i < NB * 3; i++) { for (let k = 0; k < ms.length; k++) tmp[k] = ms[k][i]; tmp.sort(); bg[i] = tmp[ms.length >> 1]; }
      let fgc = 0, unstable = 0;
      const fg = new Uint8Array(NB); fgArr = fg;
      for (let i = 0; i < NB; i++) {
        fg[i] = dist(cur, bg, i) > 28 ? 1 : 0; fgc += fg[i];
        let dev = 0; for (const m of ms) if (dist(m, bg, i) > 28) dev++;
        if (dev > 0.6 * ms.length) unstable++;
      }
      if (fgc / NB > 0.004 && fgc / NB < 0.5 && unstable / NB < 0.2) {
        mode = 'motion';
        for (let i = 0; i < NB; i++) mask[i] = fg[i] && sharp[i] > 0.12 * sp95 ? 1 : 0;
      }
    }
    if (mode === 'sharp') {
      const vs = []; for (let i = 0; i < NB; i++) vs.push(Math.max(cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]));
      const v70 = pct(vs, 0.7);
      for (let i = 0; i < NB; i++) {
        let still = ms.length >= 2; for (const m of ms) if (dist(m, cur, i) > 8) { still = false; break; }
        mask[i] = (!still && sharp[i] > 0.22 * sp95 && vs[i] > Math.max(150, v70)) ? 1 : 0;
      }
    }
    const morph = (m, dil) => { const o = new Uint8Array(m.length); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let v = dil ? 0 : 1; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; const q = (yy < 0 || xx < 0 || yy >= gh || xx >= gw) ? 0 : m[yy * gw + xx]; if (dil) v |= q; else v &= q; } o[y * gw + x] = v; } return o; };
    const mm = morph(morph(mask, true), false);
    const lab = new Int32Array(NB).fill(-1); let best = null;
    for (let i = 0; i < NB; i++) if (mm[i] && lab[i] < 0) {
      const q = [i], pts = []; lab[i] = i;
      while (q.length) { const c = q.pop(); pts.push(c); const cx = c % gw, cy = (c / gw) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const k = yy * gw + xx; if (mm[k] && lab[k] < 0) { lab[k] = i; q.push(k); } } }
      if (!best || pts.length > best.pts.length) best = { pts };
    }
    if (!best || best.pts.length < 12) return null;
    const colBottom = new Map(), colTop = new Map();
    for (const c of best.pts) { const cx = c % gw, cy = (c / gw) | 0; colBottom.set(cx, Math.max(colBottom.get(cx) ?? -1, cy)); colTop.set(cx, Math.min(colTop.get(cx) ?? 1e9, cy)); }
    const cols = [...colBottom.keys()].sort((a, b) => a - b);
    const bottoms = cols.map(c => colBottom.get(c)).sort((a, b) => a - b);
    const yCoarse = (bottoms[Math.floor(bottoms.length * 0.6)] + 1) * bs, yLow = (bottoms[Math.floor(bottoms.length * 0.9)] + 1) * bs;
    const tol = Math.max(3 * bs, 0.1 * cols.length * bs);
    const near = cols.filter(c => (colBottom.get(c) + 1) * bs > yCoarse - tol);
    let x0 = near[0] * bs, x1 = (near[near.length - 1] + 1) * bs;
    {
      // rockered soles lift at the heel and toe, so take the run of columns that hold the object
      // anywhere in the lower part of the shoe instead of only those touching the sole line
      const len0 = Math.max(20, x1 - x0), ya = Math.floor((yCoarse - 0.2 * len0) / bs), yb = Math.floor(yCoarse / bs) - 1;
      const has = new Uint8Array(gw);
      for (const c of best.pts) { const cx = c % gw, cy = (c / gw) | 0; if (cy >= ya && cy <= yb) has[cx] = 1; }
      const on = bx => bx >= 0 && bx < gw && has[bx];
      let a = Math.round(0.5 * (x0 + x1) / bs), b = a;
      if (on(a)) {
        while (on(a - 1) || on(a - 2)) a -= on(a - 1) ? 1 : 2;
        while (on(b + 1) || on(b + 2)) b += on(b + 1) ? 1 : 2;
        if ((b + 1 - a) * bs >= 0.8 * len0 && (b + 1 - a) * bs <= 1.6 * len0) { x0 = a * bs; x1 = (b + 1) * bs; }
      }
    }
    const dbg = { coarse: [x0, x1], yCoarse, yLow };
    let len = Math.max(20, x1 - x0);
    // trace the sole bottom and the midsole top along the whole shoe
    const med = (arr) => { const t = arr.slice().sort((a, b) => a - b); return t[t.length >> 1]; };
    const trace = () => soleContours(frame, x0, x1, { yA: yCoarse - 0.3 * len, yB: Math.max(yCoarse + 0.12 * len, yLow + 0.06 * len), tMin: 0.035 * len, tMax: 0.24 * len, tExp: 0.12 * len, tSig: 0.06 * len, wPrior: 0.45, yRef: yCoarse });
    // refine the shoe's length from how far the object fills the lower band of the shoe
    // (drops the upper leg, the other foot higher up, and stray blobs to the side)
    let touches = { l: false, r: false };
    {
      const occSrc = fgArr || mm, by0 = Math.max(0, Math.floor((yCoarse - 0.25 * len) / bs)), by1 = Math.min(gh - 1, Math.floor(yCoarse / bs) - 1);
      if (by1 >= by0) {
        const occ = new Float32Array(gw);
        for (let bx = 0; bx < gw; bx++) { let c = 0; for (let by = by0; by <= by1; by++) c += occSrc[by * gw + bx]; occ[bx] = c / (by1 - by0 + 1); }
        const on = bx => bx >= 0 && bx < gw && (occ[bx] > 0.25 || (bx > 0 && bx < gw - 1 && occ[bx - 1] > 0.25 && occ[bx + 1] > 0.25));
        let cx = Math.round(0.5 * (x0 + x1) / bs);
        if (!on(cx)) { let bd = 1e9; for (let bx = 0; bx < gw; bx++) if (on(bx) && Math.abs(bx - cx) < bd) bd = Math.abs(bx - cx); if (bd < 1e9) cx = on(cx - bd) ? cx - bd : cx + bd; }
        if (on(cx)) {
          let a = cx, b = cx; while (on(a - 1) || on(a - 2)) a -= on(a - 1) ? 1 : 2; while (on(b + 1) || on(b + 2)) b += on(b + 1) ? 1 : 2;
          touches = { l: a <= 1, r: b >= gw - 2 };
          const nx0 = a * bs, nx1 = (b + 1) * bs;
          dbg.occ = [nx0, nx1];
          if (nx1 - nx0 > 0.4 * len) { x0 = nx0; x1 = nx1; len = Math.max(20, x1 - x0); }
        }
      }
    }
    const bandOf = (c) => { const n = c.xs.length, p = Math.round(n * 0.2), q = Math.round(n * 0.8); return [med(c.top.slice(p, q)), med(c.bot.slice(p, q))]; };
    let con = trace(), y0, y1;
    if (con) [y0, y1] = bandOf(con);
    if (!con) { y1 = yCoarse; y0 = yCoarse - 0.14 * len; }
    if (y1 - y0 < 6) y0 = y1 - Math.max(6, 0.1 * len);
    const box = { x0: x0 + 0.02 * len, x1: x1 - 0.02 * len, y0, y1 };
    // toe direction: votes from (a) the leg rising above the heel, (b) the running direction, (c) the thicker heel
    const runSrc = fgArr ? morph(fgArr, true) : mm, runTop = new Map();
    for (const c of cols) {
      let by = Math.min(gh - 1, Math.floor((y1 - 0.03 * len) / bs)), gap = 0, top = by;
      while (by >= 0) { if (runSrc[by * gw + c] || mm[by * gw + c]) { top = by; gap = 0; } else if (++gap > 2) break; by--; }
      runTop.set(c, top);
    }
    const votes = { leg: 0, motion: 0, thick: 0, shape: 0 };
    {
      // the heel end carries the heel counter (and the leg), so the silhouette stands taller there
      const L = x1 - x0;
      const sideTop = (fromLeft) => {
        const sel = cols.filter(c => { const xc = (c + 0.5) * bs, f = fromLeft ? (xc - x0) / L : (x1 - xc) / L; return f >= 0.04 && f <= 0.22; });
        if (sel.length < 2) return null;
        const ys = sel.map(c => runTop.get(c) * bs).sort((p, q) => p - q); return ys[Math.floor(ys.length * 0.3)];
      };
      const tl = sideTop(true), tr = sideTop(false);
      if (tl !== null && tr !== null && Math.abs(tl - tr) > 0.05 * len) votes.shape = tl < tr ? 2 : -2;
    }
    const tall = cols.filter(c => runTop.get(c) * bs < y1 - 0.36 * len && c * bs >= x0 && c * bs <= x1);
    if (tall.length >= 3) {
      const lx = tall.reduce((a, c) => a + c, 0) / tall.length * bs + bs / 2, cx = 0.5 * (x0 + x1);
      if (Math.abs(lx - cx) > 0.06 * len) votes.leg = lx < cx ? 2 : -2;
    }
    if (prev) {
      const ya = Math.max(0, Math.round(y0 - 0.4 * len)), yb = Math.min(h - 1, Math.round(y1));
      const colMean = (px) => { const out = new Float32Array(w); for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let y = ya; y <= yb; y += 2) { const j = (y * w + x) * 4; s += 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]; n++; } out[x] = s / n; } return out; };
      const A = colMean(rgba), B = colMean(prev.rgba), R = Math.round(0.3 * len);
      const costAt = (s) => { let c = 0, n = 0; for (let x = Math.round(x0); x <= Math.round(x1); x += 2) { const xp = x - s; if (xp < 0 || xp >= w) continue; c += Math.abs(A[x] - B[xp]); n++; } return n > 10 ? c / n : 1e9; };
      let bsft = 0, bc = costAt(0); const c0 = bc;
      for (let s = -R; s <= R; s += 2) { const c = costAt(s); if (c < bc) { bc = c; bsft = s; } }
      if (Math.abs(bsft) > 0.02 * len && bc < 0.75 * c0) votes.motion = bsft > 0 ? 1.5 : -1.5;
    }
    if (con) {
      const n = con.xs.length, th = i => con.bot[i] - con.top[i];
      let l = 0, r = 0, m = 0;
      for (let i = Math.round(n * 0.08); i <= Math.round(n * 0.28); i++) { l += th(i); r += th(n - 1 - i); m++; }
      if (m && Math.abs(l - r) / Math.max(l, r) > 0.04) votes.thick = l > r ? 1 : -1;
    }
    const clipped = (touches.l || x0 <= 1.5 * bs) ? 'left' : ((touches.r || x1 >= w - 1.5 * bs) ? 'right' : null);
    const thickRaw = votes.thick;
    if (clipped) votes.thick = 0;
    let sum = votes.leg + votes.motion + votes.thick + votes.shape;
    if (sum === 0) {
      // tie-breakers: highest point of the whole object (leg above the heel), then the thicker end
      const tall2 = cols.filter(c => colTop.get(c) * bs < y1 - 0.36 * len && c * bs >= x0 && c * bs <= x1);
      if (tall2.length >= 3) { const lx = tall2.reduce((p, c) => p + c, 0) / tall2.length * bs + bs / 2; if (Math.abs(lx - 0.5 * (x0 + x1)) > 0.04 * len) sum = lx < 0.5 * (x0 + x1) ? 0.5 : -0.5; }
      if (sum === 0) sum = thickRaw;
    }
    const toeRight = sum !== 0 ? sum > 0 : true;
    return { box, toeRight, mode, contours: con, clipped, votes, dbg, maskInfo: { bs, gw, gh, mm: Array.from(mm).join('') } };
  }

  return { toGray, Tracker, scoreStation, solveStation, stationMeta, placeStations, autoDetect, apply, scaleOf, featureRegion };
})();
if (typeof module !== 'undefined') module.exports = Core;
