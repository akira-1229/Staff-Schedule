/**
 * 勤務予定表PDFのテキストから、指定日の列を読み取る
 *
 * 想定する表の形：
 *   行 = 職員（左端に氏名）、列 = 日付（見出し行に 1, 2, 3 … 31）
 * 見出しが「1日」「1(月)」のような書き方でも読み取れます。
 */
(function (root) {
  'use strict';

  const WEEK_RE = /^[(（]?[日月火水木金土][)）]?$/;
  // 氏名ではない行（注記・合計・人数など）
  const SKIP_RE = /^(※|＊|\*|注|備考|合計|計$|出勤|人数|勤務人数|日付|曜日|氏名)/;
  const DAY_RE = /^(\d{1,2})(?:日)?(?:[(（][日月火水木金土祝][)）])?$/;

  /**
   * items: [{ str, x, y, w, h, page }]（PDF座標：y は下から上へ増える）
   * 返り値: { day, rows: [{ name, value }], column: { page, x, w, top, bottom } } または null
   */
  function extractDay(items, day) {
    items = splitItems(items.filter((it) => it.str && it.str.trim()));
    const pages = [...new Set(items.map((it) => it.page))];
    for (const page of pages) {
      const res = extractFromPage(items.filter((it) => it.page === page), day);
      if (res) return Object.assign(res, { page });
    }
    return null;
  }

  /**
   * 「9 10 11 12」「土 日」のように、隣のセルがまとめて1つの文字列になった
   * ものを、空白で区切って位置を推定しながら分割する
   */
  function splitItems(items) {
    const out = [];
    items.forEach((it) => {
      const s = it.str;
      if (!/\S\s+\S/.test(s)) {
        out.push(Object.assign({}, it, { str: s.trim() }));
        return;
      }
      // 文字の幅の比率（全角=1、数字・英字≒0.55、空白≒0.28）で位置を推定
      const ws = [...s].map(charWeight);
      const total = ws.reduce((a, b) => a + b, 0) || 1;
      const unit = (it.w || 0) / total;
      const chars = [...s];
      let pos = 0;
      let tok = '';
      let tokStart = 0;
      const flush = () => {
        if (tok) out.push(Object.assign({}, it, { str: tok, x: it.x + tokStart * unit, w: (pos - tokStart) * unit }));
        tok = '';
      };
      chars.forEach((ch, i) => {
        if (/\s/.test(ch)) {
          flush();
        } else {
          if (!tok) tokStart = pos;
          tok += ch;
        }
        pos += ws[i];
      });
      flush();
    });
    return out;
  }

  function charWeight(ch) {
    if (/\s/.test(ch)) return 0.28;
    if (/[0-9]/.test(ch)) return 0.556;
    if (/[A-Za-z]/.test(ch)) return 0.6;
    if (/[\x21-\x7e]/.test(ch)) return 0.33;
    if (/[\uff61-\uff9f]/.test(ch)) return 0.5; // 半角カナ
    return 1;
  }

  /** 1文字ずつに分かれた氏名などをつなげる（離れていれば空白を入れる） */
  function joinText(parts) {
    let text = '';
    let prevEnd = null;
    parts.forEach((it) => {
      const gap = prevEnd == null ? 0 : it.x - prevEnd;
      if (prevEnd != null && gap > (it.h || 8) * 0.4) text += ' ';
      text += it.str.trim();
      prevEnd = it.x + (it.w || 0);
    });
    return text.trim();
  }

  function groupRows(items) {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    sorted.forEach((it) => {
      const tol = Math.max(2, (it.h || 8) * 0.45);
      const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
      if (row) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    });
    rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
    return rows.sort((a, b) => b.y - a.y);
  }

  function center(it) {
    return it.x + (it.w || 0) / 2;
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }

  function extractFromPage(items, day) {
    const rows = groupRows(items);

    // 1〜31 の数字が最も多く並んでいる行を日付の見出しとみなす
    let header = null;
    let best = 0;
    rows.forEach((r) => {
      const days = new Map();
      r.items.forEach((it) => {
        const m = it.str.trim().match(DAY_RE);
        if (m) {
          const n = Number(m[1]);
          if (n >= 1 && n <= 31 && !days.has(n)) days.set(n, it);
        }
      });
      if (days.size > best) {
        best = days.size;
        header = { row: r, days };
      }
    });
    if (!header || best < 20 || !header.days.has(day)) return null;

    const sortedDays = [...header.days.entries()].sort((a, b) => a[0] - b[0]);
    const centers = sortedDays.map(([, it]) => center(it));
    const gaps = [];
    for (let i = 1; i < centers.length; i++) gaps.push(centers[i] - centers[i - 1]);
    const colW = median(gaps) || 12;
    // 列の幅は日によって違う（1〜9日は狭い等）ので、隣の日付との中間を境目にする
    const idx = sortedDays.findIndex(([n]) => n === day);
    const cx = centers[idx];
    const left = idx > 0 ? (centers[idx - 1] + cx) / 2 : cx - colW / 2;
    const right = idx < centers.length - 1 ? (cx + centers[idx + 1]) / 2 : cx + colW / 2;
    const firstLeft = centers[0] - (centers[1] - centers[0]) / 2;
    const lastRight = centers[centers.length - 1] + colW / 2;

    const result = [];
    let bottom = header.row.y;
    rows
      .filter((r) => r.y < header.row.y - 1)
      .forEach((r) => {
        let nameParts = r.items.filter((it) => center(it) < firstLeft);
        let dayItems = r.items.filter((it) => center(it) >= firstLeft && center(it) <= lastRight);
        // 曜日だけの行は飛ばす
        if (dayItems.length && dayItems.every((it) => WEEK_RE.test(it.str.trim()))) return;
        let cell = joinText(dayItems.filter((it) => center(it) >= left && center(it) < right));

        // 1行がまるごと1つの文字列になっている場合は位置の推定がずれるので、
        // 全日分のセルがそろっていれば「並び順」で日付に対応させる
        const rest = r.items.filter((it) => center(it) >= firstLeft);
        if (rest.length >= centers.length && rest.length <= centers.length + 3) {
          dayItems = rest.slice(0, centers.length);
          cell = dayItems[idx].str.trim();
        }
        const name = joinText(nameParts);
        if (!name || SKIP_RE.test(name)) return;
        // 日付の列に何も無く、名前だけの行（表の外の注記など）は除外
        if (!dayItems.length) return;
        result.push({ name, value: cell });
        bottom = Math.min(bottom, r.y - (r.items[0].h || 8));
      });

    if (!result.length) return null;
    return {
      day,
      rows: result,
      column: { x: left, w: right - left, top: header.row.y + (header.row.items[0].h || 8), bottom },
    };
  }

  /** PDFのセルの文字を、config.js の codes で意味づけする */
  function classify(value, codes) {
    const v = (value || '').trim();
    codes = codes || {};
    if (!v) return { label: '予定なし', off: true, blank: true, code: '－', color: '#fff' };
    if (codes[v]) return Object.assign({ code: v }, codes[v]);
    // 「早」「早番」「早8:30」などは先頭の文字で判定
    const key = Object.keys(codes).find((c) => v.startsWith(c) || codes[c].label === v);
    if (key) return Object.assign({ code: key }, codes[key], { label: v.length > key.length ? v : codes[key].label });
    return { label: v, code: v.slice(0, 2), color: '#dbeafe' };
  }

  const api = { extractDay, groupRows, splitItems, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
