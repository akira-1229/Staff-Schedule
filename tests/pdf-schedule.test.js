// 実行: node tests/pdf-schedule.test.js
// サンプルPDFから指定日の列を正しく読み取れるかを確認する
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pdfjs = require('../lib/pdfjs/pdf.min.js');
pdfjs.GlobalWorkerOptions.workerSrc = path.join(__dirname, '../lib/pdfjs/pdf.worker.min.js');
const P = require('../js/pdf-schedule.js');

async function load(file) {
  const data = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', file)));
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    tc.items.forEach((it) => items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height, page: p }));
  }
  return items;
}

(async () => {
  // 1行がまるごと1つの文字列になっているPDF
  const a = await load('sample-2026-11.pdf');
  const pat = ['早', '日', '遅', '休', '早', '日', '希', '遅', '有', '日'];
  for (let d = 1; d <= 30; d++) {
    const res = P.extractDay(a, d);
    assert.ok(res, d + '日を読み取れない');
    assert.deepStrictEqual(res.rows.map((r) => r.name.replace(/\s/g, '')), ['山田太郎', '佐藤花子', '鈴木一郎', '高橋美咲', '田中健']);
    assert.deepStrictEqual(res.rows.map((r) => r.value), [0, 1, 2, 3, 4].map((i) => pat[(d + i * 3) % 10]), d + '日の値');
  }

  // 空欄のセルがあり、見出しが「1日」形式のPDF
  const b = await load('sample-blank-cells.pdf');
  for (let d = 1; d <= 31; d++) {
    const res = P.extractDay(b, d);
    assert.ok(res, d + '日を読み取れない');
    const exp = [0, 1, 2].map((i) => ['', '早番', '休', '遅'][(d + i) % 4]);
    assert.deepStrictEqual(res.rows.map((r) => r.value), exp, d + '日の値');
  }
  // 2か月分のPDF（ページごと / 1ページに上下 / 月の表題なし）
  const CODES = ['早', '日', '遅', '休', '早', '日', '希', '遅', '有', '日'];
  const code = (m, d, i) => CODES[(d + i * 3 + m) % CODES.length];
  for (const file of ['sample-2months-pages.pdf', 'sample-2months-stacked.pdf', 'sample-2months-notitle.pdf']) {
    const items = await load(file);
    [[12, 0, 31], [1, 1, 31]].forEach(([m, monthIndex, n]) => {
      for (let d = 1; d <= n; d++) {
        const res = P.extractDay(items, d, { month: m, monthIndex, monthCount: 2 });
        assert.ok(res, file + ' ' + m + '/' + d + 'を読み取れない');
        assert.strictEqual(res.rows.length, 5, file + ' ' + m + '/' + d + ' の人数');
        assert.deepStrictEqual(res.rows.map((r) => r.value), [0, 1, 2, 3, 4].map((i) => code(m, d, i)), file + ' ' + m + '/' + d + ' の値');
      }
    });
  }

  // 班編成表（縦並び / 横並び / 見出し形式）
  const staff = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 美咲', '田中 健'];
  const expectTeams = {
    'teams-columns.pdf': ['1班', '2班', '3班', '1班', '2班'],
    'teams-rows.pdf': ['A班', 'B班', 'C班', 'A班', 'B班'],
    'teams-sections.pdf': ['ひまわり班', 'さくら班', 'さくら班', 'ひまわり班', 'さくら班'],
  };
  for (const [file, exp] of Object.entries(expectTeams)) {
    const t = P.extractTeams(await load(file));
    assert.deepStrictEqual(staff.map((n) => P.teamOf(t, n)), exp, file + ' ' + JSON.stringify(t));
    // 勤務表側で姓名がつながっていても一致する
    assert.deepStrictEqual(staff.map((n) => P.teamOf(t, n.replace(' ', ''))), exp, file + '（空白なし）');
  }

  console.log('OK: すべてのテストに合格しました');
})().catch((e) => {
  console.error('NG:', e.message);
  process.exit(1);
});
