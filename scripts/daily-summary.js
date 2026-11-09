// 指定日（省略時は日本時間の今日）の勤務予定を、通知用の文章にして出力する。
// GitHub Actions（.github/workflows/daily-notify.yml）から毎朝実行される。
//
//   node scripts/daily-summary.js [YYYY-MM-DD]
//
// 出力（JSON）: { status: 'ok' | 'nopdf' | 'unreadable' | 'closed', month, title, body }
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// pdf.js の警告が出力（JSON）に混ざらないよう、ログはすべて標準エラーへ
console.log = console.info = console.warn = (...a) => process.stderr.write(a.join(' ') + '\n');
const pdfjs = require(path.join(ROOT, 'lib/pdfjs/pdf.min.js'));
pdfjs.GlobalWorkerOptions.workerSrc = path.join(ROOT, 'lib/pdfjs/pdf.worker.min.js');
const P = require(path.join(ROOT, 'js/pdf-schedule.js'));
const H = require(path.join(ROOT, 'js/holidays.js'));
const S = require(path.join(ROOT, 'js/store.js'));

// config.js はブラウザ用（window.SCHEDULE_CONFIG = ...）なので、window を用意して読み込む
global.window = {};
require(path.join(ROOT, 'config.js'));
const CFG = global.window.SCHEDULE_CONFIG || {};

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n) => String(n).padStart(2, '0');

function todayJST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

async function readItems(file) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    verbosity: 0,
    cMapUrl: path.join(ROOT, 'lib/pdfjs/cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(ROOT, 'lib/pdfjs/standard_fonts') + '/',
  }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    tc.items.forEach((it) => {
      if (it.str) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]), page: p });
    });
  }
  return items;
}

async function main() {
  const dateStr = process.argv[2] || todayJST();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const holiday = H.getHolidays(y)[H.dateKey(y, m, d)] || '';
  const dayLabel = m + '/' + d + '（' + WEEK[dow] + '）' + (holiday ? ' ' + holiday : '');
  const month = y + '-' + pad(m);
  const out = (o) => process.stdout.write(JSON.stringify(Object.assign({ month, date: dateStr }, o)) + '\n');
  const manifest = S.normalize(JSON.parse(fs.readFileSync(path.join(ROOT, S.MANIFEST), 'utf8')));

  const sch = S.scheduleFor(manifest, y, m);
  if (!sch || !fs.existsSync(path.join(ROOT, sch.entry.file))) {
    return out({ status: 'nopdf', title: dayLabel, body: '⚠ ' + y + '年' + m + '月の予定表がまだアップロードされていないため、' + dayLabel + ' の予定を読み取れません。' });
  }
  const items = await readItems(path.join(ROOT, sch.entry.file));

  // 班編成表（その年度のもの。無ければ前の年度）
  let teams = null;
  const t = S.teamsFor(manifest, new Date(y, m - 1, d));
  if (t && fs.existsSync(path.join(ROOT, t.entry.file))) teams = P.extractTeams(await readItems(path.join(ROOT, t.entry.file)));

  const res = P.extractDay(items, d, sch);
  if (!res) {
    return out({ status: 'unreadable', title: dayLabel, body: '⚠ 予定表（' + (sch.entry.name || sch.entry.file) + '）から ' + dayLabel + ' の予定を読み取れませんでした。ページでPDFを確認してください。' });
  }

  const rows = res.rows.map((r) => ({ name: r.name.replace(/\s+/g, ' '), s: P.classify(r.value, CFG.codes), team: teams ? P.teamOf(teams, r.name) : '' }));
  const order = teams ? teams.teams.map((x) => x.name) : [];
  const rank = (r) => (r.team ? order.indexOf(r.team) : 999);
  const work = rows.filter((r) => !r.s.off).sort((a, b) => rank(a) - rank(b));
  const off = rows.filter((r) => r.s.off);
  const status = work.length ? 'ok' : 'closed';

  // 1行目は通知に表示される要約
  const short = (r) => r.name.split(' ')[0] + '（' + r.s.code + '）';
  const summary = dayLabel + ' 出勤' + work.length + '人：' + (work.map(short).join(' ') || 'なし');

  const lines = ['### ' + dayLabel + ' の勤務予定', '', '**出勤 ' + work.length + '人**'];
  if (order.length) lines.push(order.map((tn) => tn + ' ' + work.filter((r) => r.team === tn).length + '人').join('・'), '');
  work.forEach((r) => lines.push('- ' + r.s.code + '　' + r.name + (r.team ? '（' + r.team + '）' : '') + '　' + r.s.label + (r.s.time ? '　' + r.s.time : '')));
  if (!work.length) lines.push('- なし');
  lines.push('', '**休み ' + off.length + '人**');
  off.forEach((r) => lines.push('- ' + r.name + '　' + r.s.label));
  if (!off.length) lines.push('- なし');

  out({ status, title: dayLabel, summary, body: lines.join('\n') });
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ status: 'error', body: '⚠ 勤務予定の読み取り中にエラー：' + e.message }) + '\n');
  process.exit(1);
});
