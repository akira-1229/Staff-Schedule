/**
 * 体制表（班編成表）の画像の読み取り
 *
 * 表の形（聖徳自動車学園の体制表）：
 *   上に「令和8年度…体制表」
 *   見出し：1〜10 の番号の行、担当（休日出勤の受付・大中準中型・二輪・普通・受付事務…）の行、右端に人員（人数・女性）
 *   各班：「新」（今年度の氏名）・資格（危・F など）・「旧」の3行
 *   ◎＝班の責任者、○＝副責任者
 *
 *   const r = await TeamsImage.read(canvas, ocr, onProgress)
 *   r = { year, teams: [{ name: '1班', members: [{ name, role, mark, quals }] }] }
 */
(function (root) {
  'use strict';
  const T = root.TableImage;

  function median(a) {
    const s = a.slice().sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }

  /** 色の付いた文字（ローズピンクの女性職員名など）も黒く見えるよう、一番暗い色の成分で白黒にする */
  function darkest(c) {
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = Math.min(d[i], d[i + 1], d[i + 2]);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // この体制表の担当（列の見出し）
  const KNOWN_ROLES = ['休日出勤の受付', '大・中・準中型(主)', '大・中・準中型(副)', '二輪', '日曜二輪', '普通', '受付事務'];

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
  function snapRole(t) {
    const s = String(t || '').normalize('NFKC').replace(/\s/g, '');
    if (!s) return '';
    let best = '', bd = Infinity;
    KNOWN_ROLES.forEach((r) => {
      const d = lev(s, r.normalize('NFKC'));
      if (d < bd) {
        bd = d;
        best = r;
      }
    });
    return bd <= Math.max(2, Math.ceil(best.length * 0.5)) ? best : s;
  }

  function upscale(c, k) {
    const out = document.createElement('canvas');
    out.width = c.width * k;
    out.height = c.height * k;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, out.width, out.height);
    return out;
  }

  async function ocrText(ocr, canvas, params) {
    await ocr.setParameters(Object.assign({ tessedit_char_whitelist: '' }, params || {}));
    const { data } = await ocr.recognize(canvas);
    if (data.confidence < 25) return '';
    const t = (data.text || '').replace(/[\s|｜_]+/g, ' ').trim();
    return /^[\s|｜_ー一\-—=~〜.,。、・'"`:;!！\[\]]*$/.test(t) ? '' : t;
  }

  /** 和暦・西暦の年度 */
  function parseFiscalYear(text) {
    const t = String(text || '').normalize('NFKC').replace(/\s/g, '');
    let m = t.match(/和(\d{1,2}|元)年度/); // 「令和」が「信和」などと読まれても年度は取れる
    if (m) return 2018 + (m[1] === '元' ? 1 : Number(m[1]));
    m = t.match(/(20\d{2})年度/);
    return m ? Number(m[1]) : null;
  }

  // よくある1文字の名字
  const ONE_CHAR_SURNAMES = [...'辻堀林森原関東西南北岡谷堤泉菅星岩宮島嶋浜畑奥牧柴杉梅桜秋菊沢滝黒白金千曽楠榊蓮梶峰舘丸今玉都葛柳栗桂樋篠萩藤坂堺境城塚郷湊港岬巽鎌錦鷲鶴新築'];

  /** 名前の前の ◎・○ と空白を整理 */
  function splitMark(text) {
    let t = String(text || '').replace(/\s+/g, ' ').trim();
    let mark = '';
    // 先頭（数文字以内）の ◎・○。その前の読み間違いの文字も取り除く
    const m = t.match(/^.{0,2}?([◎◉⊚@GQ]|[○〇◯Ｏ])\s*/) || t.match(/^([Oo0])\s*(?=\S)/);
    if (m) {
      mark = /[◎◉⊚@GQ]/.test(m[1]) ? '◎' : '○';
      t = t.slice(m[0].length);
    }
    const parts = t.split(/\s+/).filter(Boolean);
    // 「福井 聡」「辻 知明」のように空白があれば、その前を名字にする。
    // ただし1文字の場合は、よくある1文字の名字のときだけ（読み取りで「長 村三男」のように空白が入ることがあるため）
    let surname = parts.length > 1 ? parts[0] : '';
    if ([...surname].length === 1 && !ONE_CHAR_SURNAMES.includes(surname)) surname = '';
    return { mark, name: parts.join(''), surname };
  }

  /** 同じくらいの幅の列が続くところ（担当の列）を探す */
  function roleColumns(cols) {
    const widths = cols.slice(1).map((x, i) => x - cols[i]);
    let best = [0, 0];
    for (let i = 0; i < widths.length; i++) {
      let j = i;
      while (j + 1 < widths.length && Math.abs(widths[j + 1] - widths[i]) < widths[i] * 0.15) j++;
      if (j - i > best[1] - best[0]) best = [i, j];
    }
    const out = [];
    for (let i = best[0]; i <= best[1]; i++) out.push([cols[i], cols[i + 1]]);
    return out;
  }

  async function read(page, ocr, onProgress) {
    const progress = onProgress || (() => {});
    progress(0.03, '表を探しています…');
    const grid = T.detect(page, { rowFrac: 0.3 });
    const c = grid.canvas;
    const w = c.width;
    const cols = grid.cols.filter((x) => x > w * 0.015 && x < w * 0.985);
    const h = c.height;
    // 写真のふち（画像の上下の端）は表の線ではない
    const rows = grid.rows.filter((y) => y > h * 0.015 && y < h * 0.985).filter((y, i, a) => i === 0 || y - a[i - 1] > 15);
    if (rows.length < 5 || cols.length < 5) throw new Error('表を見つけられませんでした。表全体がまっすぐ写るように撮り直してください。');

    const crop = (x0, y0, x1, y1, k) => darkest(upscale(T.crop(c, x0 + 6, y0 + 5, x1 - 6, y1 - 5, 0), k || 2));

    progress(0.08, '年度を読み取っています…');
    const titleText = await ocrText(ocr, crop(w * 0.15, Math.max(0, rows[0] - (rows[1] - rows[0]) * 2.5), w * 0.85, rows[0], 1), { tessedit_pageseg_mode: '6' });
    const year = parseFiscalYear(titleText);
    if (root.__ocrDebug) root.__ocrDebug.push(['title', titleText]);

    const roles = roleColumns(cols);
    const labelX = [cols[0], roles[0][0]];

    // 行ごとの見出し（新・旧・班）を読む
    progress(0.12, '班の行を探しています…');
    const labels = [];
    for (let i = 0; i < rows.length - 1; i++) {
      labels.push(await ocrText(ocr, crop(labelX[0], rows[i], labelX[1], rows[i + 1]), { tessedit_pageseg_mode: '6' }));
    }
    let newRows = labels.map((l, i) => (/新/.test(l) ? i : -1)).filter((i) => i >= 0);
    // 「新」が読めない場合：見出しの2行のあと、3行ずつ（新・資格・旧）
    if (!newRows.length) {
      const heights = rows.slice(1).map((y, i) => y - rows[i]);
      const tall = median(heights) * 1.25;
      newRows = heights.map((h, i) => (h > tall && i >= 2 ? i : -1)).filter((i) => i >= 0);
    }
    const headerRow = Math.max(0, (newRows[0] || 2) - 1);

    progress(0.2, '担当を読み取っています…');
    const roleNames = [];
    for (const [x0, x1] of roles) roleNames.push(snapRole(await ocrText(ocr, crop(x0, rows[headerRow], x1, rows[headerRow + 1]), { tessedit_pageseg_mode: '6' })));

    // この体制表と同じ10列なら、読めなかった見出しは決まった並びで補う
    const TEMPLATE = ['休日出勤の受付', '大・中・準中型(主)', '大・中・準中型(副)', '二輪', '日曜二輪', '普通', '普通', '普通', '受付事務', '受付事務'];
    if (roleNames.length === TEMPLATE.length && roleNames.filter((r, i) => r === TEMPLATE[i]).length >= 6) {
      roleNames.forEach((r, i) => (roleNames[i] = r || TEMPLATE[i]));
    }

    const teams = [];
    for (let k = 0; k < newRows.length; k++) {
      const r = newRows[k];
      const members = [];
      for (let j = 0; j < roles.length; j++) {
        progress(0.25 + (0.7 * (k * roles.length + j)) / (newRows.length * roles.length), (k + 1) + '班を読み取っています…');
        const [x0, x1] = roles[j];
        const raw = await ocrText(ocr, crop(x0, rows[r], x1, rows[r + 1], 3), { tessedit_pageseg_mode: '7' });
        const { mark, name, surname } = splitMark(raw);
        if (!name) continue;
        // 資格の行（新のすぐ下）
        const quals = rows[r + 2] ? (await ocrText(ocr, crop(x0, rows[r + 1], x1, rows[r + 2], 3), { tessedit_pageseg_mode: '7' })).replace(/\s/g, '') : '';
        members.push({ name, surname, role: roleNames[j] || String(j + 1), mark, quals });
      }
      const num = (labels[r] + (labels[r + 1] || '')).match(/\d/);
      teams.push({ name: (num ? num[0] : String(k + 1)) + '班', members });
    }
    progress(1, '読み取りが終わりました');
    return { year, teams, roles: roleNames };
  }

  root.TeamsImage = { read, splitMark, parseFiscalYear, roleColumns, snapRole, KNOWN_ROLES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
