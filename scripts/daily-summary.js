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

async function main() {
  const dateStr = process.argv[2] || todayJST();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const holiday = H.getHolidays(y)[H.dateKey(y, m, d)] || '';
  const dayLabel = m + '/' + d + '（' + WEEK[dow] + '）' + (holiday ? ' ' + holiday : '');
  const month = y + '-' + pad(m);
  const file = path.join(ROOT, (CFG.pdfPath || '{yyyy}-{mm}.pdf').replace('{yyyy}', y).replace('{mm}', pad(m)));
  const out = (o) => process.stdout.write(JSON.stringify(Object.assign({ month, date: dateStr }, o)) + '\n');

  if (!fs.existsSync(file)) {
    return out({ status: 'nopdf', title: dayLabel, body: '⚠ ' + path.basename(file) + ' がまだアップされていないため、' + dayLabel + ' の予定を読み取れません。' });
  }

  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({
    data,
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

  const res = P.extractDay(items, d);
  if (!res) {
    return out({ status: 'unreadable', title: dayLabel, body: '⚠ ' + path.basename(file) + ' から ' + dayLabel + ' の予定を読み取れませんでした。ページでPDFを確認してください。' });
  }

  const rows = res.rows.map((r) => ({ name: r.name.replace(/\s+/g, ' '), s: P.classify(r.value, CFG.codes) }));
  const work = rows.filter((r) => !r.s.off);
  const off = rows.filter((r) => r.s.off);
  const status = work.length ? 'ok' : 'closed';

  // 1行目は通知に表示される要約
  const short = (r) => r.name.split(' ')[0] + '（' + r.s.code + '）';
  const summary = dayLabel + ' 出勤' + work.length + '人：' + (work.map(short).join(' ') || 'なし');

  const lines = ['### ' + dayLabel + ' の勤務予定', '', '**出勤 ' + work.length + '人**'];
  work.forEach((r) => lines.push('- ' + r.s.code + '　' + r.name + '　' + r.s.label + (r.s.time ? '　' + r.s.time : '')));
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
