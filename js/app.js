(function () {
  'use strict';
  const CFG = window.SCHEDULE_CONFIG || {};
  const GH = CFG.github || {};
  const H = window.JPHolidays;
  const S = window.ScheduleStore;
  const L = window.DayLogic;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const PDFJS = new URL('lib/pdfjs/', location.href).href;
  const TESS = new URL('lib/tesseract/', location.href).href;
  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';

  // ?date=2026-11-06 で日付を指定して表示することもできる
  const q = new URLSearchParams(location.search).get('date');
  let view = q ? new Date(q + 'T00:00:00') : new Date();
  if (isNaN(view)) view = new Date();
  view.setHours(0, 0, 0, 0);

  let manifest = S.emptyManifest();
  const jsonCache = {}; // パス -> Promise<データ | null>

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isToday(d) {
    return d.toDateString() === new Date().toDateString();
  }
  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return y + '年' + m + '月';
  }

  // ---------------- 読み込み ----------------

  async function loadManifest() {
    try {
      const res = await fetch(S.MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) manifest = S.normalize(await res.json());
    } catch (e) {
      /* 読めなければ空のまま */
    }
  }

  function loadJson(path) {
    if (!jsonCache[path]) {
      jsonCache[path] = fetch(path + '?t=' + Date.now(), { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return jsonCache[path];
  }

  async function teamsDataFor(date) {
    const t = S.teamsFor(manifest, date);
    return t ? loadJson(t.entry.data) : null;
  }

  // ---------------- 今日の予定 ----------------

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const y = view.getFullYear();
    const m = view.getMonth() + 1;
    const d = view.getDate();
    const holiday = H.getHolidays(y)[H.dateKey(y, m, d)] || '';

    $('title').textContent = CFG.title || '勤務予定';
    $('date').textContent = y + '年' + m + '月' + d + '日（' + WEEK[view.getDay()] + '）' + (isToday(view) ? ' 今日' : '');
    $('holiday').textContent = holiday;
    $('todayBtn').hidden = isToday(view);
    document.title = m + '/' + d + ' 勤務予定';
    $('loading').hidden = false;
    $('message').hidden = true;
    $('day').hidden = true;

    const sch = S.scheduleFor(manifest, y, m);
    const [data, teams] = await Promise.all([sch ? loadJson(sch.entry.data) : null, teamsDataFor(view)]);
    if (token !== renderToken) return;
    $('loading').hidden = true;
    if (!sch) return showMessage(y + '年' + m + '月の予定表がまだアップロードされていません。\n右上の ⚙（設定）からアップロードしてください。');
    if (!data) return showMessage('予定表のデータを読み込めませんでした。アップロード直後は1〜2分お待ちください。');
    const day = (data.days || []).find((x) => x.d === d);
    if (!day) return showMessage(m + '月' + d + '日の予定が見つかりませんでした。');

    const st = L.dayStatus(day, teams);
    document.body.dataset.dow = st.closed || holiday ? 0 : view.getDay();

    const badges = [];
    if (st.closed) badges.push('<span class="badge-big closed">休校日</span>');
    if (st.teiji) badges.push('<span class="badge-big teiji">全員定時</span>');
    $('badges').innerHTML = badges.join('');

    $('teamStatus').innerHTML = st.teams
      .map((t) => '<div class="team ' + (t.working ? 'on' : 'off') + '"><b>' + esc(t.name) + '</b><span>' + (t.working ? esc(t.reason || '出勤') : esc(t.reason || '休み')) + '</span></div>')
      .join('');

    $('kiji').textContent = st.kiji;
    $('kijiBox').hidden = !st.kiji;
    $('tekiyo').textContent = st.tekiyo;
    $('tekiyoBox').hidden = !st.tekiyo;
    $('fork').innerHTML = st.fork.map((f) => '<li><span>' + esc(f.label) + '</span><b>' + esc(f.word) + '</b></li>').join('');
    $('forkBox').hidden = !st.fork.length;

    const hasPeople = !!(teams && teams.teams && teams.teams.length);
    $('people').hidden = !hasPeople;
    $('noTeams').hidden = hasPeople;
    if (hasPeople) {
      $('workCount').textContent = st.work.length + '人';
      $('offCount').textContent = st.off.length + '人';
      $('work').innerHTML = st.work.map(person).join('') || '<li class="none">出勤者なし</li>';
      $('off').innerHTML = st.off.map(person).join('') || '<li class="none">休みの人はいません</li>';
    }
    $('sourceLink').href = data.source || sch.entry.file;
    $('day').hidden = false;
  }

  function person(p) {
    return (
      '<li><span class="badge">' + esc(String(p.team || '').replace('班', '')) + '</span>' +
      '<span class="who"><b>' + (p.mark ? '<i>' + esc(p.mark) + '</i>' : '') + esc(p.display || p.name) + '</b>' +
      '<small>' + esc([p.role, p.quals].filter(Boolean).join('　')) + '</small></span>' +
      '<span class="time">' + esc(p.reason || p.team || '') + '</span></li>'
    );
  }

  function showMessage(text) {
    $('message').textContent = text;
    $('message').hidden = false;
  }

  // ---------------- お知らせ（未アップロード） ----------------

  function renderAlerts() {
    const t = new Date();
    const out = [];
    const next = S.addMonths(t.getFullYear(), t.getMonth() + 1, 1);
    // 今日から見た次月の予定表が未提出なら表示
    if (!S.scheduleFor(manifest, next.y, next.m)) out.push(next.y + '年' + next.m + '月の予定表がまだアップロードされていません');
    const fy = S.fiscalYear(t);
    const month = t.getMonth() + 1;
    if (month >= 4 && !manifest.teams.some((x) => Number(x.year) === fy)) {
      out.push(fy + '年度の体制表がまだアップロードされていません' + (month === 4 ? '（4月中にアップロードしてください）' : ''));
    }
    $('alerts').innerHTML = out.map((m) => '<button class="alert" data-open-settings>⚠ ' + esc(m) + '<small>タップしてアップロード</small></button>').join('');
    $('alerts').querySelectorAll('[data-open-settings]').forEach((b) => (b.onclick = openSettings));
  }

  // ---------------- 設定 ----------------

  function openSheet(id) {
    $(id).hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeSheet(id) {
    $(id).hidden = true;
    if ($('settings').hidden && $('confirm').hidden) document.body.classList.remove('no-scroll');
  }
  function openSettings() {
    renderStatus();
    $('token').value = S.getToken();
    openSheet('settings');
  }
  $('openSettings').onclick = openSettings;
  $('closeSettings').onclick = () => closeSheet('settings');

  function renderStatus() {
    const t = new Date();
    const lines = [];
    for (let i = 0; i <= 2; i++) {
      const a = S.addMonths(t.getFullYear(), t.getMonth() + 1, i);
      const sch = S.scheduleFor(manifest, a.y, a.m);
      lines.push([a.y + '年' + a.m + '月の予定表', sch ? '<a href="' + esc(sch.entry.file) + '" target="_blank" rel="noopener">登録済み</a>' : '未登録', !!sch]);
    }
    const fy = S.fiscalYear(t);
    const team = manifest.teams.find((x) => Number(x.year) === fy);
    lines.push([fy + '年度の体制表', team ? '<a href="' + esc(team.file) + '" target="_blank" rel="noopener">登録済み</a>' : '未登録', !!team]);
    $('status').innerHTML = lines.map(([k, v, ok]) => '<li class="' + (ok ? 'ok' : 'ng') + '"><span>' + (ok ? '✓' : '！') + ' ' + k + '</span><span>' + v + '</span></li>').join('');
  }

  $('saveToken').onclick = async () => {
    const raw = $('token').value;
    const st = $('tokenStatus');
    if (!raw.trim()) {
      st.textContent = '鍵を入力してください。';
      return;
    }
    const t = S.cleanToken(raw);
    if (!t) {
      st.textContent = '！ 鍵の形が正しくありません。「github_pat_」で始まる文字を、最初から最後まですべてコピーして貼り付けてください。';
      return;
    }
    $('token').value = t;
    st.textContent = '確認中…';
    try {
      await S.checkToken(GH, t);
      S.setToken(t);
      st.textContent = '✓ 使える鍵です。この端末に保存しました。';
    } catch (e) {
      st.textContent = '！ ' + e.message;
    }
  };
  $('clearToken').onclick = () => {
    S.setToken('');
    $('token').value = '';
    $('tokenStatus').textContent = 'この端末から鍵を消しました。';
  };

  // ---------------- 読み取り（OCR） ----------------

  let ocrWorker = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('読み取り用の部品を読み込めませんでした（通信を確認してください）'));
      document.head.appendChild(s);
    });
  }
  async function getOcr(progress) {
    if (ocrWorker) return ocrWorker;
    progress(0.01, '読み取りの準備をしています（初回は少し時間がかかります）…');
    if (!window.Tesseract) await loadScript(TESS + 'tesseract.min.js');
    ocrWorker = await Tesseract.createWorker('jpn', 1, { workerPath: TESS + 'worker.min.js', corePath: TESS + 'core/', langPath: TESS + 'lang/', gzip: true });
    return ocrWorker;
  }

  function setProgress(id, ratio, text) {
    const el = $(id);
    el.hidden = ratio == null;
    if (ratio == null) return;
    el.querySelector('div').style.width = Math.round(ratio * 100) + '%';
    el.querySelector('span').textContent = text || '';
  }

  /** これまでに確定した月の「記事」を集める（読み取りの補正に使う） */
  async function learnedPhrases() {
    const list = manifest.schedules.slice(-3);
    const out = new Set();
    for (const e of list) {
      const d = await loadJson(e.data);
      ((d && d.days) || []).forEach((x) => x.kiji && out.add(x.kiji));
    }
    return [...out];
  }

  // 予定表
  $('schFile').onchange = async () => {
    const f = $('schFile').files[0];
    $('schFile').value = '';
    if (!f) return;
    const prog = (r, t) => setProgress('schProgress', r, t);
    try {
      prog(0, 'ファイルを開いています…');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pages = await TableImage.load(f);
      const ocr = await getOcr(prog);
      const phrases = await learnedPhrases();
      const results = [];
      for (let i = 0; i < pages.length; i++) {
        const r = await ScheduleImage.read(pages[i], ocr, (x, t) => prog((i + x) / pages.length, (pages.length > 1 ? (i + 1) + 'ページ目：' : '') + t), { phrases });
        results.push(r);
      }
      prog(null);
      openScheduleEditor({ name: f.name, bytes }, results);
    } catch (e) {
      prog(null);
      alert('読み取れませんでした：' + e.message);
    }
  };

  // 体制表
  $('teamFile').onchange = async () => {
    const f = $('teamFile').files[0];
    $('teamFile').value = '';
    if (!f) return;
    const prog = (r, t) => setProgress('teamProgress', r, t);
    try {
      prog(0, 'ファイルを開いています…');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const [page] = await TableImage.load(f);
      const ocr = await getOcr(prog);
      const r = await TeamsImage.read(page, ocr, prog);
      prog(null);
      openTeamsEditor({ name: f.name, bytes }, r);
    } catch (e) {
      prog(null);
      alert('読み取れませんでした：' + e.message);
    }
  };

  // ---------------- 確認・修正画面（予定表） ----------------

  function monthOptions(selected) {
    const t = new Date();
    const keys = new Set([selected].filter(Boolean));
    for (let i = -1; i <= 3; i++) {
      const a = S.addMonths(t.getFullYear(), t.getMonth() + 1, i);
      keys.add(S.monthKey(a.y, a.m));
    }
    return [...keys].sort().map((k) => '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + monthLabel(k) + '</option>').join('');
  }

  /** 元の表から、その日の行の一部（x0〜x1）を切り出した画像 */
  function rowImage(grid, box, x0, x1) {
    const c = grid.canvas;
    x0 -= 3;
    x1 += 3;
    const h = box.y1 - box.y0 + 8;
    const scale = Math.min(1, 900 / (x1 - x0));
    const out = document.createElement('canvas');
    out.width = Math.round((x1 - x0) * scale);
    out.height = Math.round(h * scale);
    out.getContext('2d').drawImage(c, x0, box.y0 - 4, x1 - x0, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.75);
  }

  function hanChips(raw) {
    const h = ScheduleImage.parseHan(raw);
    const chips = h.teams.map((t) => '<span class="chip ' + (t.kind === '出勤' ? 'on' : 'off') + '">' + esc(t.team) + '班 ' + esc(t.kind) + '</span>');
    if (h.teiji) chips.push('<span class="chip">全員定時</span>');
    if (!chips.length && String(raw || '').trim()) chips.push('<span class="chip warn">読み取れない書き方です</span>');
    return chips.join('');
  }

  let pending = null; // 確定待ちの内容

  function openScheduleEditor(file, results) {
    const today = new Date();
    const nextKey = (() => {
      const a = S.addMonths(today.getFullYear(), today.getMonth() + 1, 1);
      return S.monthKey(a.y, a.m);
    })();
    $('confirmTitle').textContent = '予定表の確認';
    $('confirmNote').textContent = '元の表（写真）と見比べて、違うところを直してから確定してください。オレンジの日は特に確認してください。';
    $('confirmBody').innerHTML = results
      .map((r, pi) => {
        const key = r.year && r.month ? S.monthKey(r.year, r.month) : nextKey;
        const ym = key.split('-').map(Number);
        const cols = r.grid.cols;
        const days = r.days
          .map((d, di) => {
            const warn = d.guessed || (String(d.hanRaw || '').trim() && !d.han.teams.length && !d.han.teiji);
            const dow = WEEK[new Date(ym[0], ym[1] - 1, d.d).getDay()];
            return (
              '<div class="day-card' + (warn ? ' warn' : '') + '" data-p="' + pi + '" data-i="' + di + '">' +
              '<div class="day-head"><b>' + d.d + '日（' + dow + '）</b><label><input type="checkbox" data-f="closed"' + (d.closed ? ' checked' : '') + '> 休校日</label></div>' +
              '<label class="fld">記事<img class="row-img" src="' + rowImage(r.grid, d.box, cols.kiji[0], cols.kiji[1]) + '" alt=""><input data-f="kiji" value="' + esc(d.kiji) + '"></label>' +
              '<label class="fld">摘要<img class="row-img" src="' + rowImage(r.grid, d.box, cols.tekiyo[0], cols.tekiyo[1]) + '" alt=""><input data-f="tekiyo" value="' + esc(d.tekiyo) + '"></label>' +
              '<label class="fld">班・振休等／フォーク<img class="row-img" src="' + rowImage(r.grid, d.box, cols.han[0], cols.fork[cols.fork.length - 1][1]) + '" alt=""><input data-f="han" value="' + esc(ScheduleImage.hanText(d.han) || d.hanRaw || '') + '" placeholder="例：(2)出　③休　定時"></label>' +
              '<div class="chips">' + hanChips(ScheduleImage.hanText(d.han) || d.hanRaw) + (d.guessed ? '<span class="chip warn">番号は推定です</span>' : '') + '</div>' +
              '<div class="fork-edit">' +
              ScheduleImage.FORK_LABELS.map((lab, fi) => '<label>' + esc(lab) + '<select data-f="fork" data-k="' + fi + '">' + ['', '学', '技'].map((v) => '<option' + (d.fork[fi] === v ? ' selected' : '') + ' value="' + v + '">' + (v || '－') + '</option>').join('') + '</select></label>').join('') +
              '</div></div>'
            );
          })
          .join('');
        return (
          '<section class="card page" data-p="' + pi + '">' +
          '<label class="field">何月の予定表か' + (r.year ? '' : '（読み取れなかったので選んでください）') + '<select data-f="month">' + monthOptions(key) + '</select></label>' +
          days + '</section>'
        );
      })
      .join('');
    $('confirmBody').querySelectorAll('input[data-f=han]').forEach((inp) => {
      inp.oninput = () => (inp.closest('.day-card').querySelector('.chips').innerHTML = hanChips(inp.value));
    });
    pending = { type: 'schedule', file, results };
    $('confirmSave').disabled = false;
    $('confirm').scrollTop = 0;
    openSheet('confirm');
  }

  function collectSchedule() {
    const months = [];
    $('confirmBody').querySelectorAll('section.page').forEach((sec) => {
      const month = sec.querySelector('select[data-f=month]').value;
      const days = [...sec.querySelectorAll('.day-card')].map((card, i) => {
        const v = (f) => card.querySelector('[data-f=' + f + ']');
        const fork = [...card.querySelectorAll('select[data-f=fork]')].map((s) => s.value);
        return {
          d: i + 1,
          closed: v('closed').checked,
          kiji: v('kiji').value.trim(),
          tekiyo: v('tekiyo').value.trim(),
          han: ScheduleImage.parseHan(v('han').value),
          fork,
        };
      });
      months.push({ month, data: { days } });
    });
    return months;
  }

  // ---------------- 確認・修正画面（体制表） ----------------

  function memberRow(m) {
    m = m || { mark: '', name: '', surname: '', role: '', quals: '' };
    const sur = m.surname || (m.name ? L.guessSurname(m.name) : '');
    return (
      '<div class="member">' +
      '<select data-f="mark">' + ['', '◎', '○'].map((x) => '<option' + (m.mark === x ? ' selected' : '') + ' value="' + x + '">' + (x || '－') + '</option>').join('') + '</select>' +
      '<input data-f="name" value="' + esc(m.name) + '" placeholder="氏名">' +
      '<input data-f="surname" value="' + esc(sur) + '" placeholder="名字（表示）" title="アプリに表示する名字">' +
      '<button class="del" type="button" aria-label="削除">✕</button>' +
      '<input data-f="role" value="' + esc(m.role) + '" placeholder="担当" list="roleList">' +
      '<input data-f="quals" value="' + esc(m.quals) + '" placeholder="資格">' +
      '</div>'
    );
  }

  function teamCard(t) {
    return (
      '<section class="card team-edit"><div class="team-head"><input data-f="team" value="' + esc(t.name) + '"><span>' + t.members.length + '人</span></div>' +
      '<div class="members">' + t.members.map(memberRow).join('') + '</div>' +
      '<button class="add" type="button">＋ 人を追加</button></section>'
    );
  }

  function openTeamsEditor(file, r) {
    const t = new Date();
    const fy = r.year || S.fiscalYear(t) + (t.getMonth() + 1 === 3 ? 1 : 0);
    $('confirmTitle').textContent = '体制表の確認';
    $('confirmNote').textContent = '元の体制表と見比べて、名前の漢字・◎（責任者）・○（副責任者）を確認してください。アプリには「名字」欄の文字が表示されます（名字と名前の区切りが違っていたら直してください）。';
    $('confirmBody').innerHTML =
      '<section class="card"><label class="field">年度' + (r.year ? '' : '（読み取れなかったので選んでください）') + '<select data-f="year">' +
      [fy - 1, fy, fy + 1].map((y) => '<option value="' + y + '"' + (y === fy ? ' selected' : '') + '>' + y + '年度（' + y + '年4月〜' + (y + 1) + '年3月）</option>').join('') +
      '</select></label></section>' +
      '<datalist id="roleList">' + TeamsImage.KNOWN_ROLES.map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' +
      '<div id="teamCards">' + r.teams.map(teamCard).join('') + '</div>' +
      '<button class="add wide" type="button" id="addTeam">＋ 班を追加</button>';
    const wire = () => {
      $('confirmBody').querySelectorAll('.del').forEach((b) => (b.onclick = () => b.closest('.member').remove()));
      $('confirmBody').querySelectorAll('.member input[data-f=name]').forEach((inp) => {
        inp.onchange = () => {
          const sur = inp.closest('.member').querySelector('[data-f=surname]');
          if (!sur.value) sur.value = L.guessSurname(inp.value);
        };
      });
      $('confirmBody').querySelectorAll('.team-edit .add').forEach((b) => (b.onclick = () => {
        b.previousElementSibling.insertAdjacentHTML('beforeend', memberRow());
        wire();
      }));
    };
    $('addTeam').onclick = () => {
      $('teamCards').insertAdjacentHTML('beforeend', teamCard({ name: ($('teamCards').children.length + 1) + '班', members: [] }));
      wire();
    };
    wire();
    pending = { type: 'teams', file };
    $('confirmSave').disabled = false;
    $('confirm').scrollTop = 0;
    openSheet('confirm');
  }

  function collectTeams() {
    const year = Number($('confirmBody').querySelector('select[data-f=year]').value);
    const teams = [...$('confirmBody').querySelectorAll('.team-edit')]
      .map((sec) => ({
        name: sec.querySelector('[data-f=team]').value.trim(),
        members: [...sec.querySelectorAll('.member')]
          .map((row) => {
            const v = (f) => row.querySelector('[data-f=' + f + ']').value.trim();
            return { name: v('name'), surname: v('surname') || L.guessSurname(v('name')), role: v('role'), mark: v('mark'), quals: v('quals') };
          })
          .filter((m) => m.name),
      }))
      .filter((t) => t.name);
    return { year, data: { teams } };
  }

  // ---------------- 確定（アップロード） ----------------

  $('closeConfirm').onclick = () => {
    if (confirm('確認中の内容を破棄して閉じますか？')) {
      pending = null;
      closeSheet('confirm');
    }
  };

  $('confirmSave').onclick = async () => {
    if (!pending) return;
    const token = S.getToken();
    if (!token) {
      alert('先に、設定の「GitHubの鍵」を入れて「保存して確認」を押してください。（確認中の内容はそのまま残ります）');
      return;
    }
    const btn = $('confirmSave');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'アップロード中…';
    try {
      if (pending.type === 'schedule') {
        const months = collectSchedule();
        const dup = months.map((x) => x.month).filter((k, i, a) => a.indexOf(k) !== i);
        if (dup.length) throw new Error(monthLabel(dup[0]) + 'が2回選ばれています。月を確認してください。');
        manifest = S.normalize(await S.uploadSchedule(GH, token, pending.file, months));
        months.forEach((x) => (jsonCache['data/schedules/' + x.month + '.json'] = Promise.resolve(x.data)));
      } else {
        const { year, data } = collectTeams();
        if (!data.teams.length) throw new Error('班が1つもありません。');
        manifest = S.normalize(await S.uploadTeams(GH, token, pending.file, year, data));
        jsonCache['data/teams/' + year + '.json'] = Promise.resolve(data);
      }
      pending = null;
      closeSheet('confirm');
      renderStatus();
      renderAlerts();
      render();
      alert('確定しました。ほかの端末やスマホには1〜2分で反映されます。');
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  // ---------------- 日付の操作・自動更新 ----------------

  function move(days) {
    view.setDate(view.getDate() + days);
    render();
  }
  $('prev').onclick = () => move(-1);
  $('next').onclick = () => move(1);
  $('todayBtn').onclick = () => {
    view = new Date();
    view.setHours(0, 0, 0, 0);
    render();
  };

  // 開きっぱなしでも、日付が変わったら今日の予定に切り替える。
  // 1時間ごとに読み込み直す（設定・確認画面を開いている間は除く）。
  let lastDay = new Date().toDateString();
  const openedAt = Date.now();
  setInterval(() => {
    const nowDay = new Date().toDateString();
    if ($('settings').hidden && $('confirm').hidden && (nowDay !== lastDay || Date.now() - openedAt > 60 * 60 * 1000)) {
      lastDay = nowDay;
      location.href = location.pathname;
    }
  }, 60 * 1000);

  // ---------------- ホーム画面に追加（アプリとして使う） ----------------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.__appStarted = true;
  loadManifest().then(() => {
    renderAlerts();
    render();
  });
})();
