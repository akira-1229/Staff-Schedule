/**
 * 画像（写真・スキャン・画像だけのPDF）から表の罫線を見つけて、セルを切り出す
 *
 *   const pages = await TableImage.load(file)          // [canvas, ...]（PDFはページごと）
 *   const grid  = TableImage.detect(canvas)            // { canvas(傾き補正済み), rows:[y...], cols:[x...] }
 *   const cell  = TableImage.crop(grid.canvas, x0, y0, x1, y1)
 *   TableImage.ink(grid.canvas, x0, y0, x1, y1)        // 黒い部分の割合（0〜1）
 */
(function (root) {
  'use strict';

  const TARGET_WIDTH = 2000; // 読み取りに使う画像の横幅（px）

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.round(w);
    c.height = Math.round(h);
    return c;
  }

  /** ファイル（PDF・画像）を canvas の配列にする */
  async function load(file) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data }).promise;
      const out = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: TARGET_WIDTH / base.width });
        const c = canvasOf(vp.width, vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        out.push(c);
      }
      return out;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('画像を開けませんでした（JPEG・PNG の写真を選んでください）'));
        i.src = url;
      });
      const scale = TARGET_WIDTH / img.naturalWidth;
      const c = canvasOf(img.naturalWidth * scale, img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return [c];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** 明るさ（0〜255）の配列 */
  function gray(c) {
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const g = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) g[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    return g;
  }

  /**
   * 周りより暗い所を「黒」とする（照明のムラや写真のふちの影に強い）
   * 返り値: 1=黒, 0=白 の配列
   */
  function binarize(g, w, h, win, C) {
    win = win || 41;
    C = C == null ? 18 : C;
    const W = w + 1;
    const integral = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += g[y * w + x];
        integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + rowSum;
      }
    }
    const r = win >> 1;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        out[y * w + x] = g[y * w + x] < mean - C && g[y * w + x] < 200 ? 1 : 0;
      }
    }
    return out;
  }

  /** 黒とみなす明るさ（大津の方法で自動決定） */
  function threshold(g) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = g.length - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) {
        best = v;
        t = i;
      }
    }
    return Math.min(t, 170);
  }

  function rotate(c, deg) {
    if (!deg) return c;
    const out = canvasOf(c.width, c.height);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(c, -c.width / 2, -c.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // 後で描き込むときに回転が残らないように戻す
    return out;
  }

  /** 傾きを推定（横罫線がいちばんそろう角度） */
  function estimateSkew(c) {
    // 縮小した画像で、横方向にそろう角度を探す（粗く探してから細かく）
    const s = 1000 / c.width;
    const small = canvasOf(c.width * s, c.height * s);
    small.getContext('2d').drawImage(c, 0, 0, small.width, small.height);
    const m = binarize(gray(small), small.width, small.height, 21, 12);
    const xs = [], ys = [];
    for (let y = 0; y < small.height; y++) for (let x = 0; x < small.width; x++) if (m[y * small.width + x]) {
      xs.push(x - small.width / 2);
      ys.push(y);
    }
    const score = (a) => {
      const r = (a * Math.PI) / 180, sn = Math.sin(r), cs = Math.cos(r);
      const hist = new Float64Array(small.height + 800);
      for (let i = 0; i < xs.length; i++) {
        const yy = Math.round(ys[i] * cs + xs[i] * sn) + 400;
        if (yy >= 0 && yy < hist.length) hist[yy]++;
      }
      let sc = 0;
      for (let i = 0; i < hist.length; i++) sc += hist[i] * hist[i];
      return sc;
    };
    const search = (from, to, step, best) => {
      let bestScore = -1;
      for (let a = from; a <= to + 1e-9; a += step) {
        const sc = score(a);
        if (sc > bestScore) {
          bestScore = sc;
          best = a;
        }
      }
      return best;
    };
    const coarse = search(-5, 5, 0.1, 0);
    const fine = search(coarse - 0.12, coarse + 0.12, 0.02, coarse);
    // 見つけた角度だけ回すと横線がまっすぐになる（スキャナーで少し斜めに読み込んだ場合など）
    // ごくわずか（0.1度未満）なら回さない（回すと細い文字がぼやけるため）
    return Math.abs(fine) < 0.1 ? 0 : Math.round(fine * 100) / 100;
  }

  /** 罫線の位置：長く続く黒い線のある行・列 */
  function findLines(m, w, h, horizontal, minFrac) {
    const len = horizontal ? h : w;
    const span = horizontal ? w : h;
    const run = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      let cur = 0, gap = 0, max = 0;
      for (let j = 0; j < span; j++) {
        const v = horizontal ? m[i * w + j] : m[j * w + i];
        if (v) {
          cur += 1 + gap;
          gap = 0;
          if (cur > max) max = cur;
        } else if (cur && gap < 6) gap++;
        else {
          cur = 0;
          gap = 0;
        }
      }
      run[i] = max;
    }
    // 隣り合う行（太い線・わずかな傾き）を1本にまとめる
    const lines = [];
    let start = -1;
    for (let i = 0; i <= len; i++) {
      const on = i < len && run[i] >= span * minFrac;
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        lines.push((start + i - 1) / 2);
        start = -1;
      }
    }
    // 近すぎる線はまとめる
    return lines.filter((v, k) => k === 0 || v - lines[k - 1] > 6);
  }

  /**
   * 表を見つける
   * 返り値: { canvas, rows: [y...], cols: [x...], left, right, top, bottom }
   */
  function detect(src, opts) {
    opts = opts || {};
    const canvas = rotate(src, estimateSkew(src));
    const w = canvas.width, h = canvas.height;
    const m = binarize(gray(canvas), w, h);
    const rows = findLines(m, w, h, true, opts.rowFrac || 0.3);
    if (rows.length < 2) return { canvas, rows, cols: [] };
    const top = rows[0], bottom = rows[rows.length - 1];
    // 縦線は表の上下の範囲だけで探す
    const hh = Math.max(1, Math.round(bottom - top));
    const sub = m.subarray(Math.round(top) * w, (Math.round(top) + hh) * w);
    const cols = findLines(sub, w, hh, false, opts.colFrac || 0.3);
    return { canvas, rows, cols, left: cols[0], right: cols[cols.length - 1], top, bottom, mask: m };
  }

  function crop(c, x0, y0, x1, y1, pad) {
    pad = pad == null ? 3 : pad;
    const x = Math.max(0, Math.round(x0 + pad)), y = Math.max(0, Math.round(y0 + pad));
    const out = canvasOf(Math.max(1, Math.round(x1 - x0 - pad * 2)), Math.max(1, Math.round(y1 - y0 - pad * 2)));
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, x, y, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /** セルの中の黒い部分の割合（何か書いてあるかの判定に使う） */
  function ink(c, x0, y0, x1, y1, t) {
    const cc = crop(c, x0, y0, x1, y1, 5);
    const g = gray(cc);
    t = t || 150;
    let n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] < t) n++;
    return n / g.length;
  }

  const api = { load, detect, crop, ink, rotate, estimateSkew, binarize, gray };
  root.TableImage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
