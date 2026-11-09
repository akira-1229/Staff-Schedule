// 指定日（省略時は日本時間の今日）の勤務予定を、通知用の文章にして出力する。
// GitHub Actions（.github/workflows/daily-notify.yml）から毎朝実行される。
// 確認画面で確定したデータ（data/schedules/*.json・data/teams/*.json）を使う。
//
//   node scripts/daily-summary.js [YYYY-MM-DD]
//
// 出力（JSON）: { status: 'ok' | 'nodata' | 'closed', month, date, summary, body }
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'js/store.js'));
const L = require(path.join(ROOT, 'js/day-logic.js'));
const H = require(path.join(ROOT, 'js/holidays.js'));

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n) => String(n).padStart(2, '0');

function todayJST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function readJson(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function main() {
  const dateStr = process.argv[2] || todayJST();
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const holiday = H.getHolidays(y)[H.dateKey(y, m, d)] || '';
  const label = m + '/' + d + '（' + WEEK[date.getDay()] + '）' + (holiday ? ' ' + holiday : '');
  const out = (o) => process.stdout.write(JSON.stringify(Object.assign({ month: y + '-' + pad(m), date: dateStr }, o)) + '\n');

  const manifest = S.normalize(readJson(S.MANIFEST));
  const sch = S.scheduleFor(manifest, y, m);
  const data = sch && readJson(sch.entry.data);
  const day = data && (data.days || []).find((x) => x.d === d);
  if (!day) return out({ status: 'nodata', summary: label, body: '⚠ ' + y + '年' + m + '月の予定表がまだアップロードされていないため、' + label + ' の予定を表示できません。' });

  const t = S.teamsFor(manifest, date);
  const teams = t && readJson(t.entry.data);
  const st = L.dayStatus(day, teams);

  const lines = ['### ' + label + ' の予定', ''];
  if (st.closed) lines.push('**休校日**');
  if (st.teiji) lines.push('**全員定時**');
  if (st.teams.length) lines.push(st.teams.map((x) => x.name + '：' + (x.working ? x.reason || '出勤' : x.reason || '休み')).join('　'));
  if (st.kiji) lines.push('', '**記事**：' + st.kiji);
  if (st.tekiyo) lines.push('**摘要**：' + st.tekiyo);
  if (st.fork.length) lines.push('**フォーク**：' + st.fork.map((f) => f.label + ' ' + f.word).join('、'));
  if (teams && teams.teams) {
    lines.push('', '**出勤 ' + st.work.length + '人**');
    lines.push(st.work.length ? st.work.map((p) => p.mark + (p.display || p.name) + '（' + p.team + '）').join('、') : 'なし');
    lines.push('', '**休み ' + st.off.length + '人**');
    lines.push(st.off.length ? st.off.map((p) => (p.display || p.name) + '（' + p.team + '・' + p.reason + '）').join('、') : 'なし');
  }
  out({
    // 出勤者がいない休校日は通知しない設定にできるよう 'closed' を返す
    status: st.closed && !st.teams.some((x) => x.working) ? 'closed' : 'ok',
    summary: L.summaryLine(label, st),
    body: lines.join('\n'),
  });
}

main();
