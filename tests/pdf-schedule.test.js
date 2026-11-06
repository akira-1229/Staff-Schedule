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
  console.log('OK: すべてのテストに合格しました');
})().catch((e) => {
  console.error('NG:', e.message);
  process.exit(1);
});
