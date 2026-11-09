/**
 * その日の「誰が出勤・誰が休み」を決める（画面・毎朝の通知で共通）
 *
 * 予定表の1日分（day）：{ d, closed, kiji, tekiyo, han: { teams: [{ team, kind }], teiji }, fork: [6] }
 *   closed = 休校日（曜日が丸囲みの日）
 *   kind   = '出勤'（(n)出）・'振休'（(n)休）・'班休'（ⓝ休）
 * 体制表（teams）：{ teams: [{ name: '1班', members: [{ name, role, mark, quals }] }] }
 *
 * きまり（確認済み）：
 *   ・休校日：「出」と書かれた班だけ出勤、ほかは全員休み
 *   ・それ以外の日：「休」と書かれた班（振休・班休）は休み、ほかは全員出勤
 *   ・定時：全員定時
 */
(function (root) {
  'use strict';

  const FORK_LABELS = ['11時間・土日', '11時間・平日', '31時間・土日', '31時間・平日', '35時間・土日', '35時間・平日'];
  const FORK_WORDS = { 学: '学科', 技: '技能' };

  // 3文字の名字（これ以外は、空白で区切られていなければ最初の2文字を名字とみなす）
  const SURNAME3 = ['佐々木', '長谷川', '五十嵐', '小野寺', '久保田', '宇都宮', '大和田', '佐久間', '早乙女', '東海林', '小山内', '阿久津', '加賀谷', '長谷部', '佐々井', '曽我部', '我妻'];

  /** 氏名から名字を推定する（「福井 聡」→福井、「辻 知明」→辻、「長村三男」→長村） */
  function guessSurname(full) {
    const t = String(full || '').trim();
    const parts = t.split(/[\s\u3000]+/);
    if (parts.length > 1) return parts[0];
    const s3 = SURNAME3.find((x) => t.startsWith(x));
    if (s3 && t.length > s3.length) return s3;
    if (t.length <= 2) return t.slice(0, 1) || t;
    return t.slice(0, 2);
  }

  /**
   * 画面・通知に出す名前（名字だけ）
   * 同じ名字の人がいるときは「福井(聡)」のように名前の1文字目を付けて見分ける
   */
  function displayNames(teamsData) {
    const all = [];
    ((teamsData && teamsData.teams) || []).forEach((t) => (t.members || []).forEach((m) => all.push(m)));
    const sur = (m) => (m.surname || guessSurname(m.name)).trim();
    const count = {};
    all.forEach((m) => (count[sur(m)] = (count[sur(m)] || 0) + 1));
    const map = new Map();
    all.forEach((m) => {
      const s = sur(m);
      const given = String(m.name || '').replace(/[\s\u3000]/g, '').slice(s.length);
      map.set(m, count[s] > 1 && given ? s + '(' + given[0] + ')' : s);
    });
    return map;
  }

  function teamNo(name) {
    const m = String(name || '').normalize('NFKC').match(/\d+/);
    return m ? m[0] : String(name || '');
  }

  /**
   * 返り値：
   * {
   *   closed, teiji, kiji, tekiyo,
   *   fork: [{ label, value, word }],                  // 書いてある欄だけ
   *   teams: [{ name, working, reason }],              // 体制表の班（無ければ予定表に出てくる班）
   *   work: [{ name, team, role, mark, quals }], off: [{ ..., reason }]
   * }
   */
  function dayStatus(day, teamsData, opts) {
    day = day || {};
    opts = opts || {};
    const han = day.han || { teams: [], teiji: false };
    const marks = {};
    (han.teams || []).forEach((t) => (marks[teamNo(t.team)] = t));

    const teamList = teamsData && teamsData.teams && teamsData.teams.length
      ? teamsData.teams.map((t) => t.name)
      : Object.keys(marks).sort().map((n) => n + '班');

    const statusOf = (teamName) => {
      const mark = marks[teamNo(teamName)];
      const kind = mark && mark.kind;
      if (day.closed) return kind === '出勤' ? { working: true, reason: '休日出勤' } : { working: false, reason: '休校日' };
      if (kind === '振休' || kind === '班休') return { working: false, reason: kind };
      return { working: true, reason: '' };
    };

    /**
     * 振休・休日出勤が班と逆になる人（config.js の reverseMembers）
     *   (n)休（振休）の日 → 出勤、(n)出（休日出勤）の日 → 休み
     *   ②出（丸数字の出）・ⓝ休（班休）・印の無い日 → 班と同じ
     */
    const reverse = (opts.reverseMembers || []).map((x) => String(x).replace(/[\s\u3000]/g, ''));
    const isReverse = (m) => reverse.length && reverse.includes(String(m.name || '').replace(/[\s\u3000]/g, ''));
    const memberStatus = (teamName, m, st) => {
      if (!isReverse(m)) return st;
      const mark = marks[teamNo(teamName)];
      if (!mark) return st;
      if (mark.kind === '振休') return { working: true, reason: '', special: '班は振休・本人は出勤' };
      if (mark.kind === '出勤' && !mark.circled) return { working: false, reason: '休み', special: '班は休日出勤・本人は休み' };
      return st;
    };

    const teams = teamList.map((name) => Object.assign({ name }, statusOf(name)));
    const work = [], off = [];
    if (teamsData && teamsData.teams) {
      const names = displayNames(teamsData);
      teamsData.teams.forEach((t) => {
        const tst = statusOf(t.name);
        (t.members || []).forEach((m, i) => {
          const st = memberStatus(t.name, m, tst);
          const p = Object.assign({ team: t.name, order: i }, m, { display: names.get(m), working: st.working }, st.special ? { special: st.special } : {});
          if (st.working) work.push(p);
          else off.push(Object.assign(p, { reason: st.reason }));
        });
      });
    }
    const fork = (day.fork || [])
      .map((v, i) => ({ label: FORK_LABELS[i], value: v, word: FORK_WORDS[v] || v }))
      .filter((f) => f.value);
    return { closed: !!day.closed, teiji: !!han.teiji, kiji: day.kiji || '', tekiyo: day.tekiyo || '', fork, teams, work, off };
  }

  /** 毎朝の通知などに使う短い要約 */
  function summaryLine(label, st) {
    const parts = [label];
    if (st.closed) parts.push('休校日');
    if (st.teams.length) parts.push(st.teams.map((t) => t.name + (t.working ? '出勤' : t.reason || '休み')).join('・'));
    if (st.teiji) parts.push('定時');
    if (st.kiji) parts.push(st.kiji);
    return parts.join('　');
  }

  const api = { dayStatus, summaryLine, teamNo, guessSurname, displayNames, FORK_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DayLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
