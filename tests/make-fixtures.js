// テスト用のサンプルPDFを作る（架空の名前）。Playwright が必要。
//   node tests/make-fixtures.js
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'fixtures');
const W = '日月火水木金土';
const NAMES = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 美咲', '田中 健'];
const CODES = ['早', '日', '遅', '休', '早', '日', '希', '遅', '有', '日'];

// 月ごとに少しずらした決まった並び（テストで答え合わせできるように）
function code(y, m, d, i) {
  return CODES[(d + i * 3 + m) % CODES.length];
}

function table(y, m, { title = true } = {}) {
  const n = new Date(y, m, 0).getDate();
  let h = '<tr><th rowspan=2>氏名</th>';
  let w = '<tr>';
  for (let d = 1; d <= n; d++) {
    h += `<th>${d}</th>`;
    w += `<th>${W[new Date(y, m - 1, d).getDay()]}</th>`;
  }
  h += '</tr>';
  w += '</tr>';
  let b = '';
  NAMES.forEach((nm, i) => {
    b += `<tr><td>${nm}</td>`;
    for (let d = 1; d <= n; d++) b += `<td>${code(y, m, d, i)}</td>`;
    b += '</tr>';
  });
  return (title ? `<h3>${y}年${m}月 指導員 勤務予定表</h3>` : '<div style="height:20px"></div>') +
    `<table border=1 style="border-collapse:collapse;font-size:10px">${h}${w}${b}</table>`;
}

const PAGE = '<div style="page-break-after:always"></div>';
const docs = {
  // 2か月分：ページごと
  'sample-2months-pages.pdf': table(2026, 12) + PAGE + table(2027, 1),
  // 2か月分：1ページに上下2つ
  'sample-2months-stacked.pdf': table(2026, 12) + '<br>' + table(2027, 1),
  // 2か月分：月の表題なし（並び順で判断）
  'sample-2months-notitle.pdf': table(2026, 12, { title: false }) + PAGE + table(2027, 1, { title: false }),
  // 班編成表：縦並び（見出し行に班名）
  'teams-columns.pdf': `<h3>2026年度 班編成表</h3><table border=1 style="border-collapse:collapse;font-size:14px">
    <tr><th>1班</th><th>2班</th><th>3班</th></tr>
    <tr><td>山田 太郎</td><td>佐藤 花子</td><td>鈴木 一郎</td></tr>
    <tr><td>高橋 美咲</td><td>田中 健</td><td></td></tr></table>`,
  // 班編成表：横並び（班名の行に氏名）
  'teams-rows.pdf': `<h3>2026年度 班編成表</h3><table border=1 style="border-collapse:collapse;font-size:14px">
    <tr><th>班</th><th colspan=3>氏名</th></tr>
    <tr><td>A班</td><td>山田 太郎</td><td>高橋 美咲</td><td></td></tr>
    <tr><td>B班</td><td>佐藤 花子</td><td>田中 健</td><td></td></tr>
    <tr><td>C班</td><td>鈴木 一郎</td><td></td><td></td></tr></table>`,
  // 班編成表：見出し形式（班名のあとに縦に氏名）
  'teams-sections.pdf': `<h3>2026年度 班編成</h3>
    <p><b>ひまわり班</b></p><p>山田 太郎（班長）</p><p>高橋 美咲</p>
    <p><b>さくら班</b></p><p>佐藤 花子</p><p>田中 健</p><p>鈴木 一郎</p>`,
};

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage();
  for (const [file, html] of Object.entries(docs)) {
    await p.setContent(`<html><body style="font-family:'Noto Sans CJK JP',sans-serif">${html}</body></html>`);
    await p.pdf({ path: path.join(OUT, file), format: 'A4', landscape: true });
    console.log('wrote', file);
  }
  await br.close();
})();

