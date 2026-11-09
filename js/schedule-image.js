/**
 * 行事予定表（画像）の読み取り
 *
 * 表の形（聖徳自動車学園の行事予定表）：
 *   上に「行事予定表（令和8年11月）」
 *   列：月日 | 曜日 | 記事 | 摘要 | 班・振休等 | フォーク（11時間・31時間・35時間 × 土日・平日）
 *   行：1日〜月末（日曜・月曜などの休校日は曜日が丸囲み）
 *
 *   const r = await ScheduleImage.read(canvas, ocr, onProgress)
 *   r = { year, month, days: [{ d, closed, kiji, tekiyo, han, fork: [6] }], grid }
 */
(function (root) {
  'use strict';
  const T = root.TableImage;

  const FORK_LABELS = ['11時間・土日', '11時間・平日', '31時間・土日', '31時間・平日', '35時間・土日', '35時間・平日'];

  function median(a) {
    const s = a.slice().sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }

  /**
   * 横線から「等間隔に並んだ日の行」を見つける（見落とした線は間隔から補う）
   * 返り値: { y0, step, count }（y0 = 1日の上の線）
   */
  function fitRows(lines, wantCount) {
    const diffs = [];
    for (let i = 1; i < lines.length; i++) diffs.push(lines[i] - lines[i - 1]);
    const plausible = diffs.filter((d) => d > 20);
    if (!plausible.length) return null;
    // 一番多い間隔（＝1行の高さ）
    let step = median(plausible);
    const near = plausible.filter((d) => Math.abs(d - step) < step * 0.2);
    if (near.length) step = near.reduce((a, b) => a + b, 0) / near.length;
    // 1日の上の線の候補：見つかった線そのもの、または見落とした線（線から1〜2行分上）
    const cands = [];
    lines.forEach((l) => [0, 1, 2].forEach((k) => cands.push(l - k * step)));
    const tol = step * 0.12;
    const maxK = wantCount || 31;
    let best = null;
    cands.forEach((y0) => {
      const matched = [];
      let resid = 0, last = 0;
      for (let k = 0; k <= maxK; k++) {
        const y = y0 + k * step;
        const hit = lines.find((l) => Math.abs(l - y) < tol);
        if (hit != null) {
          matched.push([k, hit]);
          resid += Math.abs(hit - y);
          last = k;
        }
      }
      // 一番下の線より下に何行も続くような候補は除く
      if (!wantCount && last < 28) return;
      // 表の下の太い枠線（最後の日の下）と合うものを優先
      const bottomHit = wantCount && matched.some(([k]) => k === wantCount);
      const score = matched.length - resid / (step * 10) + (bottomHit ? 5 : 0);
      if (!best || score > best.score) best = { y0, score, matched, count: wantCount || last };
    });
    if (!best) return null;
    // 線の位置にあわせて間隔を補正（最小二乗）
    const m = best.matched.filter(([k]) => k <= best.count);
    const n = m.length;
    const sx = m.reduce((a, [k]) => a + k, 0), sy = m.reduce((a, [, y]) => a + y, 0);
    const sxx = m.reduce((a, [k]) => a + k * k, 0), sxy = m.reduce((a, [k, y]) => a + k * y, 0);
    const den = n * sxx - sx * sx;
    if (n >= 3 && den) {
      step = (n * sxy - sx * sy) / den;
      best.y0 = (sy - step * sx) / n;
    }
    return { y0: best.y0, step, count: wantCount || best.count, lines: best.matched.map(([, y]) => y) };
  }

  /** 縦線から列を決める：月日・曜日・記事・摘要・班・フォーク6列 */
  function fitColumns(cols, left, right) {
    const xs = cols.filter((x) => x >= left - 12 && x <= right + 12).filter((x, i, a) => i === 0 || x - a[i - 1] > 15);
    if (xs[0] - left > 12) xs.unshift(left);
    if (right - xs[xs.length - 1] > 12) xs.push(right);
    const widths = xs.slice(1).map((x, i) => x - xs[i]);
    // 一番広いのが「記事」、その右が「摘要」
    let ki = 0;
    widths.forEach((w, i) => {
      if (w > widths[ki]) ki = i;
    });
    if (ki < 2 || ki + 3 > widths.length) return null;
    const cell = (i) => [xs[i], xs[i + 1]];
    const out = {
      date: [xs[ki - 2], xs[ki - 1]],
      dow: cell(ki - 1),
      kiji: cell(ki),
      tekiyo: cell(ki + 1),
      han: cell(ki + 2),
    };
    // フォーク：残りの範囲を6等分（線が見つかればそれを使う）
    const fx = xs.slice(ki + 3);
    if (fx.length === 7) out.fork = fx.slice(1).map((x, i) => [fx[i], x]);
    else {
      const a = xs[ki + 3], b = xs[xs.length - 1];
      const step = (b - a) / 6;
      out.fork = FORK_LABELS.map((_, i) => [a + i * step, a + (i + 1) * step]);
    }
    return out;
  }

  /**
   * 月日の列をまとめて読み、書かれている数字と行の番号の差（何行ずれているか）を多数決で求める
   * 例：1行目の位置に「3」と書いてあれば、行の位置が2行ずれている
   */
  async function dateShift(c, ocr, dateCol, rows, count) {
    const top = Math.max(0, rows.y0 - 3 * rows.step);
    const bottom = Math.min(c.height, rows.y0 + (count + 3) * rows.step);
    const k = 2;
    const im = upscale(T.crop(c, dateCol[0] + 4, top, dateCol[1] - 4, bottom, 0), k);
    await ocr.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789' });
    const { data } = await ocr.recognize(margin(blackWhite(im), 24));
    const votes = {};
    (data.words || []).forEach((wd) => {
      const n = Number((wd.text || '').replace(/\D/g, ''));
      if (!n || n > 31 || wd.confidence < 40) return;
      const cy = top + ((wd.bbox.y0 + wd.bbox.y1) / 2 - 24) / k;
      const row = Math.floor((cy - rows.y0) / rows.step);
      const off = row - (n - 1);
      if (Math.abs(off) <= 4) votes[off] = (votes[off] || 0) + 1;
    });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (root.__ocrDebug) root.__ocrDebug.push(['dateShift', votes]);
    // 3つ以上の日付が同じずれを示したときだけ直す
    return best && best[1] >= 3 ? Number(best[0]) : 0;
  }

  /** 和暦・西暦の「〇年〇月」 */
  function parseYearMonth(text) {
    const t = String(text || '').normalize('NFKC').replace(/\s/g, '');
    let m = t.match(/和(\d{1,2}|元)年(\d{1,2})月/); // 「令和」の読み間違いにも対応
    if (m) return { year: 2018 + (m[1] === '元' ? 1 : Number(m[1])), month: Number(m[2]) };
    m = t.match(/(20\d{2})年(\d{1,2})月/);
    if (m) return { year: Number(m[1]), month: Number(m[2]) };
    return null;
  }

  /**
   * 班・振休等の欄を読み解く
   *   (2)出 → 2班 出勤 / (2)休 → 2班 振休 / ②休 → 2班 班休 / 定時 → 全員定時
   * 返り値: { teams: [{ team: '2', kind: '出勤'|'振休'|'班休' }], teiji: bool }
   */
  function parseHan(raw) {
    const CIRC = '①②③④⑤⑥⑦⑧⑨';
    let s = String(raw || '').replace(/\s/g, '');
    // 丸数字はNFKCで数字になってしまうので、先に印を付ける
    s = s.replace(/[①-⑨]/g, (c) => '<C' + (CIRC.indexOf(c) + 1) + '>');
    s = s.normalize('NFKC').replace(/[⑴-⑼]/g, (c) => '(' + (c.charCodeAt(0) - 0x2473) + ')');
    const out = { teams: [], teiji: /定時/.test(s) };
    // カッコの片方が読めなくても（「1)出」「(1出」）数字と出・休があれば読む
    const re = /(?:<C(\d)>|\(?(\d)\)?|(\d))\s*(出|休)/g;
    let m;
    while ((m = re.exec(s))) {
      const circled = !!m[1];
      const team = m[1] || m[2] || m[3];
      const kind = m[4] === '出' ? '出勤' : circled ? '班休' : '振休';
      out.teams.push({ team, kind });
    }
    return out;
  }

  /**
   * 「)休」のように班の番号が読めなかった振休を補う
   * この表では、(n)出（休日出勤）のあとに、その班の振休 (n)休 が来る
   */
  function inferMissingTeams(days) {
    const owed = []; // 出勤したがまだ振休が出ていない班
    days.forEach((d) => {
      d.han.teams.forEach((t) => {
        if (t.kind === '出勤') owed.push(t.team);
        if (t.kind === '振休') {
          const i = owed.indexOf(t.team);
          if (i >= 0) owed.splice(i, 1);
        }
      });
      const raw = String(d.hanRaw || '');
      if (/休/.test(raw) && !d.han.teams.length && !/[①-⑨]/.test(raw) && owed.length) {
        d.han.teams.push({ team: owed.shift(), kind: '振休' });
        d.guessed = true;
      }
    });
  }

  /** 読み取った内容を、確認画面で編集する文字に戻す */
  function hanText(h) {
    const CIRC = '①②③④⑤⑥⑦⑧⑨';
    const parts = (h.teams || []).map((t) => (t.kind === '班休' ? CIRC[Number(t.team) - 1] + '休' : '(' + t.team + ')' + (t.kind === '出勤' ? '出' : '休')));
    if (h.teiji) parts.push('定時');
    return parts.join(' ');
  }

  /** まわりに白い余白を付ける（文字が画像の端に接していると読み取りに失敗しやすい） */
  function margin(c, m) {
    const out = document.createElement('canvas');
    out.width = c.width + m * 2;
    out.height = c.height + m * 2;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, m, m);
    return out;
  }

  /** 背景より暗い所を黒、ほかを白にする（薄い灰色の文字や、ほぼ白一色の背景でも読みやすく） */
  function blackWhite(c, fixed) {
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const g = [];
    for (let i = 0; i < d.length; i += 4) g.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000);
    const bg = median(g);
    // 境目：背景と、一番濃い文字の色のちょうど中間（文字のふちのぼやけを太らせない）
    const sorted = g.slice().sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const t = fixed || (bg - lo > 60 ? (bg + lo) / 2 : bg - 45);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = g[j] < t ? 0 : 255;
    ctx.putImageData(img, 0, 0);
    return c;
  }

  let lastConf = 0; // 直前の読み取りの確かさ（0〜100）
  function copyCanvas(c) {
    const o = document.createElement('canvas');
    o.width = c.width;
    o.height = c.height;
    o.getContext('2d').drawImage(c, 0, 0);
    return o;
  }
  async function ocrText(ocr, canvas, params, minConf, raw) {
    if (params) await ocr.setParameters(params);
    let data;
    if (raw) data = (await ocr.recognize(canvas)).data;
    else {
      // 白黒にしたもの → 確かさが低ければ、灰色のままのものでも読んで、良い方を使う
      data = (await ocr.recognize(margin(blackWhite(copyCanvas(canvas)), 24))).data;
      const alts = [() => margin(canvas, 24), () => margin(blackWhite(copyCanvas(canvas), 170), 24)];
      for (const make of alts) {
        if (data.confidence >= 60) break;
        const alt = (await ocr.recognize(make())).data;
        if (alt.confidence > data.confidence) data = alt;
      }
    }
    lastConf = data.confidence;
    if (minConf && data.confidence < minConf) return '';
    const t = (data.text || '').replace(/[ \t]+/g, '').replace(/\n+/g, ' ').trim();
    // 罫線のかけらだけ（ー・｜・_ など）なら空欄
    return /^[\s|｜_ー一\-—=~〜.,。、・'"`:;!！lI1il\[\]()]*$/.test(t) ? '' : t;
  }

  /**
   * セルの中に残った罫線（横・縦に長く続く黒）を白で消す
   */
  function cleanLines(c) {
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data, w = c.width, h = c.height;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    const bg = median(Array.from(g));
    const dark = (x, y) => g[y * w + x] < bg - 45;
    const wipe = (x, y) => {
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = bg;
    };
    // 罫線＝途切れずに長く続く黒（文字は途中で途切れるので消えない）
    const longRun = (len, at) => {
      let cur = 0, gap = 0, max = 0;
      for (let i = 0; i < len; i++) {
        if (at(i)) {
          cur += 1 + gap;
          gap = 0;
          if (cur > max) max = cur;
        } else if (cur && gap < 2) gap++;
        else cur = gap = 0;
      }
      return max;
    };
    const rowsToWipe = [], colsToWipe = [];
    for (let y = 0; y < h; y++) if (longRun(w, (x) => dark(x, y)) > w * 0.5) rowsToWipe.push(y);
    // 縦の罫線はセルの上から下まで続く（文字の縦線を消さないよう、ほぼ全体の長さのものだけ）
    for (let x = 0; x < w; x++) if (longRun(h, (y) => dark(x, y)) > h * 0.9) colsToWipe.push(x);
    // 線の太さ分、となりも消す
    rowsToWipe.forEach((y) => { for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let x = 0; x < w; x++) wipe(x, yy); });
    colsToWipe.forEach((x) => { for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) for (let y = 0; y < h; y++) wipe(xx, y); });
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /**
   * 薄い文字（写真・コピーの灰色の文字）をくっきりさせる
   * 背景（明るい方）を白、文字（暗い方の端）を黒に引きのばす。差が小さければ空欄として真っ白にする
   */
  function enhance(c) {
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hist = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) hist[(d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0]++;
    const n = d.length / 4;
    const pct = (p) => {
      let acc = 0;
      for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * p) return v;
      return 255;
    };
    const lo = pct(0.003), bg = pct(0.5);
    const empty = bg - lo < 45;
    const span = Math.max(1, bg - 15 - lo);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      const v = empty ? 255 : Math.max(0, Math.min(255, ((g - lo) / span) * 255));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** 背景よりはっきり暗い部分の割合（薄い灰色の文字も数え、紙のムラは数えない） */
  function inkOf(c) {
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const g = [];
    for (let i = 0; i < data.length; i += 4) g.push((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000);
    const bg = median(g);
    let n = 0;
    for (let i = 0; i < g.length; i++) if (g[i] < bg - 55) n++;
    return n / g.length;
  }

  /**
   * 記事欄によく出る文（確定した月の記事からも自動で増える）
   * 読み取った文がこれに近ければ、こちらに置き換える
   */
  const KNOWN_PHRASES = [
    '高齢講',
    '修検、高齢講',
    '入校日、修検、卒検(二輪)、高齢講',
    '入校日、修検、卒検(二輪)、初講、高齢講',
    '入校日、修検、卒検(大特・二輪・審査)、高齢講',
    '入校日、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
    '入校日、修検、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
    '入校日、卒検(大型・中型・準中・普通・大特・大二・二輪・審査)、高齢講',
    '卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
    '卒検(大型・中型・準中・普通・大特・大二・審査)、高齢講',
    '卒検(大型・中型・準中・普通・大特・大二・審査)、原講、高齢講',
  ];

  function lev(a, b) {
    a = [...a];
    b = [...b];
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[b.length];
  }

  /** 読み取った文を、よく出る文のうち一番近いものに置き換える（近いものが無ければそのまま） */
  function snap(text, phrases) {
    if (!text) return text;
    const norm = (t) => t.normalize('NFKC').replace(/\s/g, '');
    const t = norm(text);
    let best = null, bestD = Infinity;
    (phrases || KNOWN_PHRASES).forEach((p) => {
      const d = lev(t, norm(p));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    return best && bestD <= Math.max(2, Math.round([...norm(best)].length * 0.3)) ? best : text;
  }

  /** この表でよく出る言葉の読み間違いを直す */
  const FIXES = [
    [/[人入八]+校日/g, '入校日'],
    [/[^\s、,()（）]検(?=[(（])/g, '卒検'],
    [/卒[栓険倹]/g, '卒検'],
    [/[修脩][検険]/g, '修検'],
    [/高[齢令鈴般]?[講護購構]/g, '高齢講'],
    [/[審客容]査/g, '審査'],
    [/大[ニ二]/g, '大二'],
    [/二[輪論倫]/g, '二輪'],
    [/[初][講護]/g, '初講'],
    [/[原][講護]/g, '原講'],
    [/[。．]+$/g, ''],
  ];
  function fixText(t) {
    let s = String(t || '').replace(/\|/g, '');
    FIXES.forEach(([re, to]) => (s = s.replace(re, to)));
    return s.trim();
  }

  /** 少し大きくして読みやすくする */
  function upscale(c, k) {
    const out = document.createElement('canvas');
    out.width = c.width * k;
    out.height = c.height * k;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, out.width, out.height);
    return out;
  }

  /**
   * 行事予定表を読み取る
   * ocr: Tesseract の worker（jpn）
   */
  async function read(page, ocr, onProgress, opts) {
    const progress = onProgress || (() => {});
    const phrases = KNOWN_PHRASES.concat((opts && opts.phrases) || []);
    progress(0.02, '表を探しています…');
    const grid = T.detect(page);
    const c = grid.canvas;
    const w = c.width;

    // 年月（表の上の題名）
    progress(0.05, '何月の予定表か読み取っています…');
    let ym = null;
    if (grid.rows.length) {
      const titleArea = T.crop(c, w * 0.2, 0, w * 0.8, grid.rows[0], 0);
      ym = parseYearMonth(await ocrText(ocr, titleArea, { tessedit_pageseg_mode: '6' }));
    }
    const days = ym ? new Date(ym.year, ym.month, 0).getDate() : null;

    const rows = fitRows(grid.rows, days);
    if (!rows || rows.count < 28) throw new Error('表の行（日付）を見つけられませんでした。表全体がまっすぐ写るように撮り直してください。');
    const count = days || rows.count;
    // 表の左右：写真のふち（画像の端）を除いた、一番外側の縦線
    const inner = grid.cols.filter((x) => x > w * 0.015 && x < w * 0.985);
    const left = inner[0], right = inner[inner.length - 1];
    const cols = fitColumns(grid.cols, left, right);
    if (!cols) throw new Error('表の列（記事・摘要・班など）を見つけられませんでした。表全体が写るように撮り直してください。');

    // 「月日」の列の数字（1, 2, 3 …）を読んで、行の位置が日付とずれていないか確かめる
    progress(0.08, '日付の列を確かめています…');
    if (opts && opts.testOffset) rows.y0 += opts.testOffset * rows.step; // テスト用：わざと行をずらす
    const shift = await dateShift(c, ocr, cols.date, rows, count);
    if (shift) rows.y0 += shift * rows.step;
    rows.shift = shift;

    // 各行の上下：予想位置の近くに本物の線があればそれに合わせる（紙のゆがみ対策）
    const lineAt = (k) => {
      const y = rows.y0 + k * rows.step;
      const hit = grid.rows.find((l) => Math.abs(l - y) < rows.step * 0.2);
      return hit != null ? hit : y;
    };
    const cell = (x, y0, y1, k, clean) => {
      const padX = 7, padY = Math.max(6, (y1 - y0) * 0.12);
      const im = upscale(T.crop(c, x[0] + padX, y0 + padY, x[1] - padX, y1 - padY, 0), k || 2);
      return clean === false ? im : cleanLines(im);
    };
    const closedDays = (root.SCHEDULE_CONFIG && root.SCHEDULE_CONFIG.closedWeekdays) || [0, 1];

    const out = [];
    for (let i = 0; i < count; i++) {
      progress(0.1 + (0.88 * i) / count, (i + 1) + '日を読み取っています…');
      const y0 = lineAt(i), y1 = lineAt(i + 1);
      const read1 = async (x, params, opts) => {
        opts = opts || {};
        const im = cell(x, y0, y1, opts.scale, opts.clean);
        // 何か書いてあるか：暗い点の数を「文字1つ分の大きさ（高さ×高さ）」で割った値で判断する
        // （幅の広いセルに短い言葉だけ、という場合も取りこぼさない）
        const ink = (inkOf(im) * im.width * im.height) / (im.height * im.height);
        if (root.__ocrDebug) root.__ocrDebug.push([i + 1, opts.name, +ink.toFixed(4)]);
        if (ink < (opts.minInk == null ? 0.03 : opts.minInk)) return '';
        return ocrText(ocr, im, params, opts.minConf, opts.clean === false);
      };
      // 記事：よく出る文に近ければ採用。そうでなければ、確かさが低いもの（空欄のゴミなど）は捨てる
      const kijiRaw = fixText(await read1(cols.kiji, { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '' }, { name: 'kiji', minConf: 5 }));
      let kiji = snap(kijiRaw, phrases);
      if (kiji === kijiRaw && lastConf < 45) kiji = '';
      const tekiyo = fixText(await read1(cols.tekiyo, { tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' }, { name: 'tekiyo', scale: 3, minConf: 40 }));
      const hanRaw = await read1(cols.han, { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '()（）0123456789①②③④⑤⑥⑦⑧⑨⑴⑵⑶⑷⑸⑹⑺⑻⑼出休定時' }, { name: 'han', scale: 3 });
      const fork = [];
      for (const fx of cols.fork) {
        // 「学」「技」の横線を罫線と間違えて消さないよう、線の除去はしない
        const v = await read1(fx, { tessedit_pageseg_mode: '8', tessedit_char_whitelist: '学技' }, { name: 'fork', scale: 3, minInk: 0, minConf: 60, clean: false });
        fork.push(/学/.test(v) ? '学' : /技/.test(v) ? '技' : '');
      }
      const date = ym ? new Date(ym.year, ym.month - 1, i + 1) : null;
      out.push({
        d: i + 1,
        closed: date ? closedDays.includes(date.getDay()) : false,
        kiji,
        tekiyo,
        hanRaw,
        han: parseHan(hanRaw),
        fork,
        box: { y0, y1 },
      });
    }
    inferMissingTeams(out);
    progress(1, '読み取りが終わりました');
    return { year: ym ? ym.year : null, month: ym ? ym.month : null, days: out, grid: { canvas: c, rows, cols } };
  }

  root.ScheduleImage = { read, _cleanLines: cleanLines, _blackWhite: blackWhite, _margin: margin, _inkOf: inkOf, parseHan, hanText, parseYearMonth, fixText, snap, fitRows, fitColumns, KNOWN_PHRASES, FORK_LABELS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
