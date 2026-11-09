// 実行: node tests/logic.test.js
// 読み取り後の整理・出勤/休みのきまり・保存先の管理のテスト（画像は使わない）
const assert = require('assert');
require('../js/schedule-image.js'); // globalThis.ScheduleImage
require('../js/teams-image.js'); // globalThis.TeamsImage
const SI = globalThis.ScheduleImage;
const TI = globalThis.TeamsImage;
const L = require('../js/day-logic.js');
const S = require('../js/store.js');

// 班・振休等の欄
const han = (s) => JSON.stringify(SI.parseHan(s));
assert.strictEqual(han('(2)出'), JSON.stringify({ teams: [{ team: '2', kind: '出勤' }], teiji: false }));
assert.strictEqual(han('（3）休'), JSON.stringify({ teams: [{ team: '3', kind: '振休' }], teiji: false }));
assert.strictEqual(han('⑵休'), JSON.stringify({ teams: [{ team: '2', kind: '振休' }], teiji: false }));
assert.strictEqual(han('③休'), JSON.stringify({ teams: [{ team: '3', kind: '班休' }], teiji: false }));
assert.strictEqual(han('定時'), JSON.stringify({ teams: [], teiji: true }));
assert.strictEqual(han('1)出'), JSON.stringify({ teams: [{ team: '1', kind: '出勤' }], teiji: false }));
assert.strictEqual(han('(1)出 ②休'), JSON.stringify({ teams: [{ team: '1', kind: '出勤' }, { team: '2', kind: '班休' }], teiji: false }));
assert.strictEqual(SI.hanText(SI.parseHan('(1)出 ②休 定時')), '(1)出 ②休 定時');

// 年月・年度
assert.deepStrictEqual(SI.parseYearMonth('行事予定表（令和8年11月）'), { year: 2026, month: 11 });
assert.deepStrictEqual(SI.parseYearMonth('（信和８年１２月）'), { year: 2026, month: 12 });
assert.deepStrictEqual(SI.parseYearMonth('2027年1月'), { year: 2027, month: 1 });
assert.strictEqual(TI.parseFiscalYear('信和 8 年 度 聖徳自動車学園体制表'), 2026);

// 読み間違いの補正
assert.strictEqual(SI.snap(SI.fixText('入疲日、修淡、卒浅(二嶋)、初講、高齢講')), '入校日、修検、卒検(二輪)、初講、高齢講');
assert.strictEqual(SI.snap('馬師講'), '高齢講');
assert.strictEqual(SI.snap('設置者研修(校長)'), '設置者研修(校長)'); // 知らない文はそのまま
assert.strictEqual(TI.snapRole('光<中準中型(主)'), '大・中・準中型(主)');
assert.deepStrictEqual(TI.splitMark('ぱ〇福井 聡'), { mark: '○', name: '福井聡', surname: '福井' });
assert.deepStrictEqual(TI.splitMark('長 村三男'), { mark: '', name: '長村三男', surname: '' }); // 読み取りで入った空白は使わない


// 等間隔の行（見落とした線を補う・見出しの行は高さが違う）
const lines = [434, 575, 642, 710, 777, 844, 912, 979, 1046, 1113, 1179, 1246, 1312, 1378, 1445, 1510, 1702, 1768, 1834, 1900, 1966, 2032, 2098, 2164, 2230, 2297, 2363, 2430, 2496, 2816];
const fit = SI.fitRows(lines, 30);
assert.ok(Math.abs(fit.y0 - 509) < 10 && Math.abs(fit.step - 66) < 1, JSON.stringify(fit));

// 出勤・休みのきまり
const teams = { teams: [{ name: '1班', members: [{ name: 'A' }, { name: 'B' }] }, { name: '2班', members: [{ name: 'C' }] }, { name: '3班', members: [{ name: 'D' }] }] };
const st = (day) => L.dayStatus(day, teams);
let r = st({ closed: true, han: { teams: [{ team: '2', kind: '出勤' }] } });
assert.deepStrictEqual(r.work.map((p) => p.name), ['C']);
assert.deepStrictEqual(r.off.map((p) => p.reason), ['休校日', '休校日', '休校日']);
r = st({ closed: false, han: { teams: [{ team: '2', kind: '振休' }, { team: '3', kind: '班休' }] } });
assert.deepStrictEqual(r.work.map((p) => p.name), ['A', 'B']);
assert.deepStrictEqual(r.off.map((p) => p.name + p.reason), ['C振休', 'D班休']);
r = st({ closed: false, han: { teams: [], teiji: true }, fork: ['', '学', '', '技', '', ''] });
assert.strictEqual(r.teiji, true);
assert.deepStrictEqual(r.fork.map((f) => f.label + f.word), ['11時間・平日学科', '31時間・平日技能']);

// 保存先の管理
const m = { schedules: [{ month: '2026-11', data: 'a', uploadedAt: '1' }, { month: '2026-11', data: 'b', uploadedAt: '2' }], teams: [{ year: 2025, data: 't' }] };
assert.strictEqual(S.scheduleFor(m, 2026, 11).entry.data, 'b');
assert.strictEqual(S.scheduleFor(m, 2026, 12), null);
assert.strictEqual(S.teamsFor(m, new Date(2026, 3, 10)).entry.year, 2025); // 4月でまだ新年度が無ければ前年度
assert.strictEqual(S.fiscalYear(new Date(2027, 2, 31)), 2026);
assert.strictEqual(S.cleanToken(' github_pat_11ABCDEFG0abcdefghij\n_KLMN '), 'github_pat_11ABCDEFG0abcdefghij_KLMN');

// 名字だけの表示
assert.deepStrictEqual(['小原直人', '福井 聡', '堀 友佳子', '辻 知明', '佐々木一郎', '長谷川 誠'].map(L.guessSurname), ['小原', '福井', '堀', '辻', '佐々木', '長谷川']);
assert.deepStrictEqual([...L.displayNames({ teams: [{ name: '1班', members: [{ name: '福井聡', surname: '福井' }, { name: '福井里菜' }, { name: '小原直人' }] }] }).values()], ['福井(聡)', '福井(里)', '小原']);
assert.deepStrictEqual(TI.splitMark('◎辻　知明'), { mark: '◎', name: '辻知明', surname: '辻' });

console.log('OK: すべてのテストに合格しました');
