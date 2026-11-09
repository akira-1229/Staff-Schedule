/**
 * 勤務予定表・班編成表のPDFテキストを読み取る
 *
 * 勤務予定表の想定：
 *   行 = 職員（左端に氏名）、列 = 日付（見出し行に 1, 2, 3 … 31）
 *   見出しは「1」「1日」「1(月)」のどれでもよい。
 *   1つのPDFに2か月分ある場合（ページごと、または1ページに上下2つの表）は、
 *   表の上にある「2026年12月」などの文字で月を見分ける。見分けられないときは並び順で判断する。
 *
 * 班編成表の想定（どちらでも可）：
 *   ・横並び： 「1班  山田 太郎  佐藤 花子 …」のように、班名の行に氏名が並ぶ
 *   ・縦並び： 見出し行に「1班 2班 3班」、その下に各班の氏名が縦に並ぶ
 *   ・見出し： 「1班」だけの行のあと、次の班名までの行に氏名が並ぶ
 */
(function (root) {
  'use strict';

  const WEEK_RE = /^[(（]?[日月火水木金土][)）]?$/;
  // 氏名ではない行（注記・合計・人数など）
  const SKIP_RE = /^(※|＊|\*|注|備考|合計|計$|出勤|人数|勤務人数|日付|曜日|氏名|職員名|名前)/;
  const DAY_RE = /^(\d{1,2})(?:日)?(?:[(（][日月火水木金土祝][)）])?$/;
  const MONTH_RE = /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/;
  // 「1班」「A班」「第2班」「ひまわり班」など（「班長」「班編成」は除く）
  const TEAM_RE = /^(?:第?[0-9０-９A-Za-zＡ-Ｚａ-ｚ一二三四五六七八九十]{1,3}|[^\s0-9０-９]{1,6})班$/;
  const NOT_NAME_RE = /^(班長|副班長|リーダー|サブ|氏名|職員名|名前|担当|役割|備考|年度|班編成表?|編成表|[0-9０-９.．、,()（）\-－~〜:：/／◎○●◇◆☆★・]+)$/;

  // ------------------------------------------------------------
  // 共通
  // ------------------------------------------------------------

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
      const chars = [...s];
      const ws = chars.map(charWeight);
      const total = ws.reduce((a, b) => a + b, 0) || 1;
      const unit = (it.w || 0) / total;
      let pos = 0;
      let tok = '';
      let tokStart = 0;
      const flush = () => {
        if (tok) out.push(Object.assign({}, it, { str: tok, x: it.x + tokStart * unit, w: (pos - tokStart) * unit, split: true }));
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
    if (/[｡-ﾟ]/.test(ch)) return 0.5; // 半角カナ
    return 1;
  }

  function prepare(items) {
    return splitItems(items.filter((it) => it.str && it.str.trim()));
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
    rows.forEach((r) => {
      r.items.sort((a, b) => a.x - b.x);
      r.text = r.items.map((it) => it.str).join('');
    });
    return rows.sort((a, b) => b.y - a.y);
  }

  function center(it) {
    return it.x + (it.w || 0) / 2;
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }

  /** 氏名の比較用（空白・記号を除く） */
  function normName(s) {
    return String(s || '')
      .replace(/[\s　・.,，、()（）［］\[\]「」◎○●☆★*＊]/g, '')
      .replace(/(班長|副班長|リーダー)$/, '');
  }

  // ------------------------------------------------------------
  // 勤務予定表
  // ------------------------------------------------------------

  /** ページ内の日付見出し（1〜31 が20個以上並ぶ行）をすべて探し、月の表示も調べる */
  function findTables(rows, page) {
    const headers = [];
    rows.forEach((r, i) => {
      const days = new Map();
      r.items.forEach((it) => {
        const m = it.str.trim().match(DAY_RE);
        if (m) {
          const n = Number(m[1]);
          if (n >= 1 && n <= 31 && !days.has(n)) days.set(n, it);
        }
      });
      if (days.size >= 20) headers.push({ row: r, index: i, days, page });
    });
    headers.forEach((h, k) => {
      // 見出し行そのもの → その上の行 の順に「〇月」を探す（前の表の見出しより上は見ない）
      const stop = k > 0 ? headers[k - 1].index : -1;
      const cands = [];
      // 見出し行に「12月 1 2 3 …」のように月が書かれている場合（「1(月)」の曜日は除く）
      const hm = h.row.text.match(/(?:^|[^\d(（])((?:\d{4}\s*年\s*)?\d{1,2}\s*月)(?![)）])/);
      if (hm) cands.push(hm[1]);
      for (let i = h.index - 1; i > stop; i--) cands.push(rows[i].text);
      for (const t of cands) {
        const m = t.match(MONTH_RE);
        if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
          h.month = Number(m[2]);
          if (m[1]) h.year = Number(m[1]);
          break;
        }
      }
      h.endIndex = k < headers.length - 1 ? headers[k + 1].index : rows.length;
    });
    return headers;
  }

  /**
   * items: [{ str, x, y, w, h, page }]（PDF座標：y は下から上へ増える）
   * opts: { month: 対象の月(1-12), monthIndex: ファイル内で何か月目か(0始まり), monthCount: ファイルの月数 }
   * 返り値: { day, page, month, rows: [{ name, value }], column: { x, w, top, bottom } } または null
   */
  function extractDay(items, day, opts) {
    opts = opts || {};
    items = prepare(items);
    const pages = [...new Set(items.map((it) => it.page))].sort((a, b) => a - b);
    const tables = [];
    pages.forEach((page) => {
      const rows = groupRows(items.filter((it) => it.page === page));
      findTables(rows, page).forEach((h) => tables.push(Object.assign(h, { rows })));
    });
    if (!tables.length) return null;

    let cands = tables;
    if (opts.month) {
      const withMonth = tables.filter((t) => t.month);
      if (withMonth.length) {
        cands = tables.filter((t) => t.month === opts.month);
      } else if (opts.monthCount > 1 && tables.length === opts.monthCount) {
        // 月の表示が無い場合は並び順（1つ目の表＝1か月目）
        cands = [tables[opts.monthIndex || 0]];
      }
    }
    for (const t of cands) {
      const res = extractFromTable(t, day);
      if (res) return res;
    }
    return null;
  }

  function extractFromTable(table, day) {
    const header = table;
    if (!header.days.has(day)) return null;
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
    table.rows.slice(header.index + 1, header.endIndex).forEach((r) => {
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
      // 「2026年12月 勤務予定表」のような表題（次の表の見出し）は除外
      if (/\d\s*月/.test(name) || /\d\s*月/.test(r.text.slice(0, 12))) return;
      // 日付の列に何も無く、名前だけの行（表の外の注記など）は除外
      if (!dayItems.length) return;
      result.push({ name, value: cell });
      bottom = Math.min(bottom, r.y - (r.items[0].h || 8));
    });

    if (!result.length) return null;
    return {
      day,
      page: table.page,
      month: table.month || null,
      rows: result,
      column: { x: left, w: right - left, top: header.row.y + (header.row.items[0].h || 8), bottom },
    };
  }

  /**
   * PDFに入っている予定表の月を、表の上の「2026年12月」などから調べる
   * 返り値: [{ month: 12, year: 2026 | null }]（表の順。月が書かれていない表は含まない）
   */
  function detectMonths(items) {
    items = prepare(items);
    const pages = [...new Set(items.map((it) => it.page))].sort((a, b) => a - b);
    const out = [];
    pages.forEach((page) => {
      findTables(groupRows(items.filter((it) => it.page === page)), page).forEach((t) => {
        if (t.month && !out.some((o) => o.month === t.month && o.year === (t.year || null))) out.push({ month: t.month, year: t.year || null });
      });
    });
    return out;
  }

  /** 表（日付の見出し）がいくつあるか */
  function countTables(items) {
    items = prepare(items);
    const pages = [...new Set(items.map((it) => it.page))];
    return pages.reduce((n, page) => n + findTables(groupRows(items.filter((it) => it.page === page)), page).length, 0);
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

  // ------------------------------------------------------------
  // 班編成表
  // ------------------------------------------------------------

  /** 行の中で近い文字同士をまとめて「語」にする */
  function words(row) {
    const out = [];
    row.items.forEach((it) => {
      const last = out[out.length - 1];
      const gap = last ? it.x - (last.x + last.w) : Infinity;
      // 空白で区切られていた語（split）はつなげない。1文字ずつ別になっている文字だけつなげる
      if (last && !last.split && !it.split && gap <= (it.h || 8) * 0.4) {
        last.str += it.str.trim();
        last.w = it.x + (it.w || 0) - last.x;
      } else {
        out.push({ str: it.str.trim(), x: it.x, w: it.w || 0, h: it.h, split: it.split });
      }
    });
    // 「1」「班」のように分かれた班名をつなげる
    for (let i = out.length - 2; i >= 0; i--) {
      if (/^班$/.test(out[i + 1].str) && /^(?:第?[0-9０-９A-Za-zＡ-Ｚ一二三四五六七八九十]{1,3})$/.test(out[i].str)) {
        out[i].str += '班';
        out[i].w = out[i + 1].x + out[i + 1].w - out[i].x;
        out.splice(i + 1, 1);
      }
    }
    return out;
  }

  /**
   * 班編成表を読み取る
   * 返り値: { teams: [{ name: '1班', members: ['山田 太郎', ...] }] }（読めなければ teams は空）
   */
  function extractTeams(items) {
    items = prepare(items);
    const pages = [...new Set(items.map((it) => it.page))].sort((a, b) => a - b);
    const teams = new Map(); // 班名 -> [行ごとの氏名の配列]
    const add = (team, names) => {
      if (!names.length) return;
      if (!teams.has(team)) teams.set(team, []);
      teams.get(team).push(...names);
    };
    const isName = (w) => w.str && !TEAM_RE.test(w.str) && !NOT_NAME_RE.test(w.str) && !/\d\s*月|\d{4}|年度/.test(w.str) && normName(w.str);

    pages.forEach((page) => {
      const rows = groupRows(items.filter((it) => it.page === page));
      let columns = null; // 縦並びの見出し [{ name, cx }]
      let section = null; // 見出し形式の現在の班
      rows.forEach((r) => {
        const ws = words(r);
        const teamWords = ws.filter((w) => TEAM_RE.test(w.str));
        if (teamWords.length >= 2) {
          // 縦並びの見出し行。ただし同じ行に氏名もあれば「班名 氏名 班名 氏名」の横並び
          if (ws.some(isName) && !ws.every((w) => TEAM_RE.test(w.str) || !isName(w))) {
            let cur = null;
            const buf = [];
            ws.forEach((w) => {
              if (TEAM_RE.test(w.str)) {
                if (cur) add(cur, buf.splice(0));
                cur = w.str;
              } else if (cur && isName(w)) buf.push(w.str);
            });
            if (cur) add(cur, buf);
            columns = null;
          } else {
            columns = teamWords.map((w) => ({ name: w.str, cx: w.x + w.w / 2 }));
            teamWords.forEach((w) => teams.has(w.str) || teams.set(w.str, []));
          }
          section = null;
          return;
        }
        if (teamWords.length === 1) {
          const t = teamWords[0].str;
          const names = ws.filter((w) => w !== teamWords[0] && isName(w)).map((w) => w.str);
          if (names.length) add(t, joinSplitNames(names, ws));
          else {
            section = t;
            if (!teams.has(t)) teams.set(t, []);
          }
          columns = null;
          return;
        }
        const names = ws.filter(isName);
        if (!names.length) return;
        if (columns) {
          // 一番近い見出しの班に入れる
          names.forEach((w) => {
            const cx = w.x + w.w / 2;
            const col = columns.reduce((a, b) => (Math.abs(b.cx - cx) < Math.abs(a.cx - cx) ? b : a));
            add(col.name, [w.str]);
          });
        } else if (section) {
          add(section, joinSplitNames(names.map((w) => w.str), ws));
        }
      });
    });

    return {
      teams: [...teams.entries()].filter(([, m]) => m.length).map(([name, members]) => ({ name, members })),
    };
  }

  /** 「山田」「太郎」のように姓と名が別の語になっていても、そのまま残す（照合は teamOf で行う） */
  function joinSplitNames(names) {
    return names;
  }

  /** 職員名がどの班か（姓名が分かれていても、姓だけでも一致すれば可） */
  function teamOf(teamData, staffName) {
    if (!teamData || !teamData.teams) return '';
    const target = normName(staffName);
    if (!target) return '';
    // 1) 完全一致 → 2) 連続する語をつなげて一致 → 3) 姓（先頭2文字以上）で一意に一致
    for (const t of teamData.teams) if (t.members.some((m) => normName(m) === target)) return t.name;
    for (const t of teamData.teams) {
      const ms = t.members.map(normName);
      for (let i = 0; i < ms.length - 1; i++) if (ms[i] + ms[i + 1] === target) return t.name;
    }
    const surname = String(staffName).trim().split(/[\s　]+/)[0];
    if (surname && surname.length >= 2 && normName(surname) !== target) {
      const hits = teamData.teams.filter((t) => t.members.some((m) => normName(m) === normName(surname) || normName(m).startsWith(normName(surname))));
      if (hits.length === 1) return hits[0].name;
    }
    return '';
  }

  const api = { extractDay, detectMonths, countTables, extractTeams, teamOf, groupRows, splitItems, classify, normName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PdfSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
