// テスト用の画像を作る（行事予定表・体制表と同じ形。内容と名前は架空）
//   node tests/make-fixtures.js     ※ Playwright が必要
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'fixtures');
const W = '日月火水木金土';

// 2027年1月（令和9年1月）の架空の予定
const Y = 2027, M = 1;
const KIJI = {
  5: '入校日、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
  6: '入校日、修検、卒検(二輪)、高齢講',
  7: '高齢講',
  8: '高齢講',
  9: '入校日、修検、卒検(大特・二輪・審査)、高齢講',
  12: '入校日、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
  13: '入校日、修検、卒検(二輪)、初講、高齢講',
  14: '卒検(大型・中型・準中・普通・大特・大二・審査)、原講、高齢講',
  15: '修検、高齢講',
  16: '入校日、修検、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
  19: '入校日、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
  20: '入校日、修検、卒検(二輪)、高齢講',
  21: '卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
  22: '高齢講',
  23: '入校日、修検、卒検(大特・二輪・審査)、高齢講',
  26: '入校日、卒検(大型・中型・準中、普通・大特・大二・審査)、高齢講',
  27: '入校日、修検、卒検(二輪)、高齢講',
  28: '卒検(大型・中型・準中・普通・大特・大二・審査)、高齢講',
  29: '高齢講',
  30: '入校日、修検、卒検(大特・二輪・審査)、高齢講',
};
const TEKIYO = { 5: '仕事始め', 12: '健診(田中、高橋)', 20: '研修(校長)' };
const HAN = { 3: '(1)出', 5: '(1)休', 8: '②休', 10: '(3)出', 12: '(3)休', 15: '①休', 17: '(2)出', 19: '(2)休', 23: '定時', 29: '③休', 31: '(1)出' };
const FORK = { 13: [1, '学'], 14: [3, '学'], 15: [3, '技'], 16: [1, '技'] };
const CLOSED = [0, 1]; // 日・月

function schedule() {
  const n = new Date(Y, M, 0).getDate();
  let rows = '';
  for (let d = 1; d <= n; d++) {
    const dow = new Date(Y, M - 1, d).getDay();
    const circle = CLOSED.includes(dow);
    const f = ['', '', '', '', '', ''];
    if (FORK[d]) f[FORK[d][0]] = FORK[d][1];
    rows += `<tr><td class=r>${d}</td><td class=c>${circle ? `<span class=circ>${W[dow]}</span>` : W[dow]}</td>` +
      `<td class=k>${KIJI[d] || ''}</td><td class=t>${TEKIYO[d] || ''}</td><td class=c>${HAN[d] || ''}</td>` +
      f.map((x) => `<td class=c>${x}</td>`).join('') + '</tr>';
  }
  return `<style>
    body{margin:0;padding:40px 50px;font-family:'Noto Sans CJK JP',sans-serif;background:#fbfbf8;color:#333}
    h1{text-align:center;font-size:30px;letter-spacing:8px;margin:0}h2{text-align:center;font-size:24px;margin:4px 0 30px;font-weight:600}
    table{border-collapse:collapse;width:100%}td,th{border:1.6px solid #555;height:44px;font-size:17px;padding:0 4px}
    th{font-weight:500;font-size:16px}.r{text-align:right;width:34px}.c{text-align:center}.k{width:46%;white-space:nowrap;font-size:15px}
    .t{width:22%;font-size:13px}.f{width:30px;font-size:11px}
    .circ{display:inline-block;border:1.5px solid #444;border-radius:50%;width:26px;height:26px;line-height:26px}
  </style><h1>行事予定表</h1><h2>（令和9年1月）</h2>
  <table><tr><th>月日</th><th>曜日</th><th>記　事</th><th>摘　要</th><th>班・振休等</th>
  <th class=f>土日</th><th class=f>平日</th><th class=f>土日</th><th class=f>平日</th><th class=f>土日</th><th class=f>平日</th></tr>${rows}</table>`;
}

const TEAMS = [
  ['○青木一郎', '', '加藤二郎', '◎木村三郎', '佐々木四郎', '清水五郎', '杉山花子', '', '田村桜', ''],
  ['◎中島健', '○西川誠', '野口美咲', '橋本学', '林大輔', '藤田翔', '前田翼', '松本葵', '', '三浦結衣'],
  ['◎村上剛', '', '森田拓', '○山口隆', '山崎亮', '横山健太', '吉田優子', '渡部光', '和田誠', '石井舞'],
];
const ROLES = ['休日出勤<br>の受付', '大・中・<br>準中型(主)', '大・中・<br>準中型(副)', '二輪', '日曜二輪', '普通', '普通', '普通', '受付<br>事務', '受付<br>事務'];

function teams() {
  const body = TEAMS.map((names, i) =>
    `<tr><td rowspan=3 class=c>${i + 1}<br>班</td><td class=c>新</td>${names.map((n) => `<td class="c b">${n}</td>`).join('')}<td class=c>${names.filter(Boolean).length}</td><td class=c></td></tr>` +
    `<tr class=q><td></td>${names.map((n, j) => `<td class=c>${n && j % 3 === 0 ? 'F・危' : ''}</td>`).join('')}<td></td><td></td></tr>` +
    `<tr><td class=c>旧</td>${names.map(() => '<td></td>').join('')}<td></td><td></td></tr>`).join('');
  return `<style>
    body{margin:0;padding:40px 30px;font-family:'Noto Sans CJK JP',sans-serif;background:#fbfbf8;color:#333}
    h1{text-align:center;font-size:30px;margin:0 0 20px}table{border-collapse:collapse;width:100%;table-layout:fixed}
    td,th{border:1.6px solid #555;height:52px;font-size:17px;padding:0 3px}th{font-weight:500}.c{text-align:center}.b{font-weight:700;font-size:19px}
    tr.q td{height:34px;font-size:14px;border-top:1.5px dotted #777}
  </style><h1>令和9年度 体制表</h1>
  <table><colgroup><col style="width:40px"><col style="width:40px">${ROLES.map(() => '<col style="width:130px">').join('')}<col style="width:60px"><col style="width:60px"></colgroup>
  <tr><th></th><th></th>${ROLES.map((_, i) => `<th>${i + 1}</th>`).join('')}<th colspan=2>人員</th></tr>
  <tr><th colspan=2>班別</th>${ROLES.map((r) => `<th>${r}</th>`).join('')}<th>人数</th><th>女性</th></tr>${body}</table>`;
}

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1400, height: 1900 } });
  await p.setContent(schedule());
  await p.screenshot({ path: path.join(OUT, 'gyoji-sample.png'), fullPage: true });
  await p.setViewportSize({ width: 1600, height: 900 });
  await p.setContent(teams());
  await p.screenshot({ path: path.join(OUT, 'taisei-sample.png'), fullPage: true });
  await br.close();
  // 正解（テストで答え合わせに使う）
  require('fs').writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify({ Y, M, KIJI, TEKIYO, HAN, FORK, CLOSED, TEAMS }, null, 1));
  console.log('wrote gyoji-sample.png, taisei-sample.png, expected.json');
})();
