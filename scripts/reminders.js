// 今必要な「アップロードしてください」のお知らせを出力する（1行に1つ、JSON）
// GitHub Actions（.github/workflows/reminders.yml）から毎朝実行される。
//
//   node scripts/reminders.js [YYYY-MM-DD]
//
// ・予定表：今日から見た次月の予定表がまだ無い（日付の条件なし）
// ・班編成表：4月以降、その年度の班編成表がまだ無い（4月中にアップロードする決まり）
const fs = require('fs');
const path = require('path');
const S = require('../js/store.js');

const ROOT = path.join(__dirname, '..');
const PAGE = 'https://akira-1229.github.io/Staff-Schedule/';

function todayJST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

const [y, m, d] = (process.argv[2] || todayJST()).split('-').map(Number);
const manifest = S.normalize(JSON.parse(fs.readFileSync(path.join(ROOT, S.MANIFEST), 'utf8')));
const how = '予定表アプリ右上の ⚙（設定）からアップロードしてください。\n' + PAGE;
const out = [];

const next = S.addMonths(y, m, 1);
if (!S.scheduleFor(manifest, next.y, next.m)) {
  out.push({
    title: '【予定表】' + S.monthKey(next.y, next.m) + ' の予定表がまだアップロードされていません',
    body: next.y + '年' + next.m + '月の予定表がまだアップロードされていません。\n\n' + how,
  });
}

const fy = S.fiscalYear(new Date(y, m - 1, d));
if (m >= 4 && !manifest.teams.some((t) => Number(t.year) === fy)) {
  out.push({
    title: '【体制表】' + fy + '年度の体制表（班編成）がまだアップロードされていません',
    body: fy + '年度の体制表（班編成）がまだアップロードされていません（毎年4月中にアップロードする決まりです）。\n\n' + how,
  });
}

out.forEach((o) => process.stdout.write(JSON.stringify(o) + '\n'));
