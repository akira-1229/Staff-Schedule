// 実行: node tests/ocr.test.js    ※ Playwright（Chromium）が必要
// 架空の行事予定表・体制表の画像を実際に読み取り、正解とどれだけ合うかを確かめる
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.gz': 'application/gzip', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/tests/ocr-harness.html';
  const exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/expected.json'), 'utf8'));
  const br = await chromium.launch();
  try {
    const p = await br.newPage();
    await p.goto(url);

    // ---- 行事予定表 ----
    const s = await p.evaluate(() => readFixture('gyoji-sample.png', 'schedule'));
    assert.strictEqual(s.year, exp.Y, '年');
    assert.strictEqual(s.month, exp.M, '月');
    const n = new Date(exp.Y, exp.M, 0).getDate();
    assert.strictEqual(s.days.length, n, '日数');
    let kiji = 0, han = 0, fork = 0, closed = 0;
    const misses = [];
    s.days.forEach((d) => {
      const dow = new Date(exp.Y, exp.M - 1, d.d).getDay();
      if (d.closed === exp.CLOSED.includes(dow)) closed++;
      if (d.kiji === (exp.KIJI[d.d] || '')) kiji++; else misses.push(d.d + '日 記事: ' + d.kiji);
      const h = (exp.HAN[d.d] || '').replace('（', '(').replace('）', ')');
      if (d.han === h) han++; else misses.push(d.d + '日 班: ' + d.han + ' ≠ ' + h);
      const f = ['', '', '', '', '', ''];
      if (exp.FORK[d.d]) f[exp.FORK[d.d][0]] = exp.FORK[d.d][1];
      if (JSON.stringify(d.fork) === JSON.stringify(f)) fork++; else misses.push(d.d + '日 フォーク: ' + d.fork.join(','));
    });
    console.log('行事予定表: 記事 ' + kiji + '/' + n + '、班 ' + han + '/' + n + '、フォーク ' + fork + '/' + n + '、休校日 ' + closed + '/' + n);
    if (misses.length) console.log('  違い: ' + misses.join(' / '));
    assert.strictEqual(closed, n, '休校日');
    assert.ok(kiji >= n - 2, '記事の正解が少なすぎます');
    assert.ok(han >= n - 2, '班・振休等の正解が少なすぎます');
    assert.ok(fork >= n - 1, 'フォークの正解が少なすぎます');

    // ---- 体制表 ----
    const t = await p.evaluate(() => readFixture('taisei-sample.png', 'teams'));
    assert.strictEqual(t.year, exp.Y, '年度');
    assert.strictEqual(t.teams.length, exp.TEAMS.length, '班の数');
    let ok = 0, total = 0;
    const tm = [];
    exp.TEAMS.forEach((names, i) => {
      const got = t.teams[i].members.map((m) => m.mark + m.name);
      names.filter(Boolean).forEach((nm) => {
        total++;
        const plain = nm.replace(/^[◎○]/, '');
        if (got.some((g) => g.replace(/^[◎○]/, '') === plain)) ok++; else tm.push((i + 1) + '班 ' + nm);
      });
    });
    console.log('体制表: 氏名 ' + ok + '/' + total + '、班ごとの人数 ' + t.teams.map((x) => x.name + x.members.length).join(' '));
    if (tm.length) console.log('  読めなかった名前: ' + tm.join('、'));
    assert.ok(ok >= total - 3, '氏名の正解が少なすぎます');
    console.log('OK: 画像の読み取りテストに合格しました');
  } finally {
    await br.close();
    server.close();
  }
})().catch((e) => {
  console.error('NG:', e.message);
  process.exit(1);
});
