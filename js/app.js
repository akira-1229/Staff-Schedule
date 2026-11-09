(function () {
  'use strict';
  const CFG = window.SCHEDULE_CONFIG || {};
  const GH = CFG.github || {};
  const H = window.JPHolidays;
  const P = window.PdfSchedule;
  const S = window.ScheduleStore;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const PDFJS = new URL('lib/pdfjs/', location.href).href;
  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';

  // ?date=2026-11-06 で日付を指定して表示することもできる
  const q = new URLSearchParams(location.search).get('date');
  let view = q ? new Date(q + 'T00:00:00') : new Date();
  if (isNaN(view)) view = new Date();
  view.setHours(0, 0, 0, 0);

  let manifest = S.emptyManifest();
  const docs = {}; // ファイルのパス -> Promise<{ doc, items } | { error }>

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

  async function parsePdf(bytes) {
    const doc = await pdfjsLib.getDocument({
      data: bytes.slice(), // pdf.js が中身を移動させるので複製を渡す
      cMapUrl: PDFJS + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDFJS + 'standard_fonts/',
    }).promise;
    const items = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      tc.items.forEach((it) => {
        if (it.str) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]), page: p });
      });
    }
    return { doc, items };
  }

  function loadDoc(file) {
    if (!docs[file]) {
      docs[file] = (async () => {
        if (!window.pdfjsLib) return { error: 'PDF読み込み用の部品（lib/pdfjs）が見つかりません。' };
        try {
          const res = await fetch(file + '?t=' + Date.now(), { cache: 'no-store' });
          if (!res.ok) return { error: 'ファイル（' + file + '）を取得できませんでした。アップロード直後は1〜2分お待ちください。' };
          return await parsePdf(new Uint8Array(await res.arrayBuffer()));
        } catch (e) {
          return { error: 'PDFを読み込めませんでした：' + e.message };
        }
      })();
    }
    return docs[file];
  }

  async function teamDataFor(date) {
    const t = S.teamsFor(manifest, date);
    if (!t) return null;
    const d = await loadDoc(t.entry.file);
    if (d.error) return null;
    return Object.assign(P.extractTeams(d.items), { year: t.entry.year, current: t.current });
  }

  // ---------------- 表示 ----------------

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
    document.body.dataset.dow = holiday ? 0 : view.getDay();
    document.title = m + '/' + d + ' 勤務予定';

    $('loading').hidden = false;
    $('lists').hidden = true;
    $('message').hidden = true;
    $('summary').textContent = '';
    $('teamSummary').textContent = '';
    $('pdfBox').hidden = true;

    const sch = S.scheduleFor(manifest, y, m);
    if (!sch) {
      $('loading').hidden = true;
      $('source').textContent = '';
      showMessage(y + '年' + m + '月の予定表がまだアップロードされていません。\n右上の ⚙（設定）からアップロードしてください。');
      return;
    }
    const [month, teamData] = await Promise.all([loadDoc(sch.entry.file), teamDataFor(view)]);
    if (token !== renderToken) return;
    $('loading').hidden = true;
    $('source').textContent = '予定表：' + (sch.entry.name || sch.entry.file) + (teamData ? '　班編成：' + teamData.year + '年度' : '');

    if (month.error) {
      showMessage(month.error);
      return;
    }

    const res = P.extractDay(month.items, d, sch);
    $('pdfBox').hidden = false;
    $('pdfLink').href = sch.entry.file;
    drawPdf(month.doc, res, token);

    if (!res) {
      showMessage('PDFから表を読み取れませんでした。下の「予定表PDFで確認する」から見てください。\n（スキャンした画像のPDFは文字を読み取れません）');
      $('pdfBox').open = true;
      return;
    }

    const rows = res.rows.map((r) => ({ name: r.name, s: P.classify(r.value, CFG.codes), team: teamData ? P.teamOf(teamData, r.name) : '' }));
    // 班 → 元の並び順
    const teamOrder = teamData ? teamData.teams.map((t) => t.name) : [];
    const rank = (r) => (r.team ? teamOrder.indexOf(r.team) : 999);
    const work = rows.filter((r) => !r.s.off).sort((a, b) => rank(a) - rank(b));
    const off = rows.filter((r) => r.s.off);

    $('summary').innerHTML = '<b>' + work.length + '</b>人 出勤　<span>休み ' + off.length + '人</span>';
    if (teamData && teamData.teams.length) {
      $('teamSummary').innerHTML = teamOrder
        .map((t) => '<span class="team-chip">' + esc(t) + ' ' + work.filter((r) => r.team === t).length + '人</span>')
        .join('');
    }
    $('work').innerHTML = work.map(item).join('') || '<li class="none">出勤者なし</li>';
    $('off').innerHTML = off.map(item).join('') || '<li class="none">休みの人はいません</li>';
    $('lists').hidden = false;
  }

  function item(r) {
    return (
      '<li style="--c:' + esc(r.s.color || '#dbeafe') + '"><span class="badge">' + esc(r.s.code) + '</span>' +
      '<span class="who"><b>' + esc(r.name) + '</b>' + (r.team ? '<small class="team">' + esc(r.team) + '</small>' : '') + '</span>' +
      '<span class="time">' + esc(r.s.label) + (r.s.time ? '<br><b>' + esc(r.s.time) + '</b>' : '') + '</span></li>'
    );
  }

  function showMessage(text) {
    $('message').textContent = text;
    $('message').hidden = false;
  }

  async function drawPdf(doc, res, token) {
    const wrap = $('pdfWrap');
    wrap.innerHTML = '';
    const page = await doc.getPage(res ? res.page : 1);
    if (token !== renderToken) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, Math.max(1, ((wrap.clientWidth || 600) * 2) / base.width));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    wrap.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (!res || token !== renderToken) return;
    const c = res.column;
    const [x1, y1] = vp.convertToViewportPoint(c.x, c.top);
    const [x2, y2] = vp.convertToViewportPoint(c.x + c.w, c.bottom);
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.18)';
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
    ctx.lineWidth = 2;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    // 今日の表の部分だけを切り出して表示
    const top = Math.max(0, ry - 60 * scale);
    const bottom = Math.min(canvas.height, ry + rh + 40 * scale);
    const crop = document.createElement('canvas');
    crop.width = canvas.width;
    crop.height = bottom - top;
    crop.getContext('2d').drawImage(canvas, 0, top, canvas.width, crop.height, 0, 0, canvas.width, crop.height);
    wrap.replaceChild(crop, canvas);
  }

  // ---------------- お知らせ（未アップロード） ----------------

  function renderAlerts() {
    const t = new Date();
    const out = [];
    const next = S.addMonths(t.getFullYear(), t.getMonth() + 1, 1);
    // 今日から見た次月の予定表が未提出なら表示（日付の条件なし）
    if (!S.scheduleFor(manifest, next.y, next.m)) {
      out.push(next.y + '年' + next.m + '月の予定表がまだアップロードされていません');
    }
    const fy = S.fiscalYear(t);
    const month = t.getMonth() + 1;
    if (month >= 4 && !manifest.teams.some((x) => Number(x.year) === fy)) {
      out.push(fy + '年度の班編成表がまだアップロードされていません' + (month === 4 ? '（4月中にアップロードしてください）' : ''));
    }
    $('alerts').innerHTML = out.map((m) => '<button class="alert" data-open-settings>⚠ ' + esc(m) + '<small>タップしてアップロード</small></button>').join('');
    $('alerts').querySelectorAll('[data-open-settings]').forEach((b) => (b.onclick = openSettings));
  }

  // ---------------- 設定・アップロード ----------------

  function openSettings() {
    renderStatus();
    $('token').value = S.getToken();
    $('settings').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeSettings() {
    $('settings').hidden = true;
    document.body.classList.remove('no-scroll');
  }
  $('openSettings').onclick = openSettings;
  $('closeSettings').onclick = closeSettings;

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
    lines.push([fy + '年度の班編成表', team ? '<a href="' + esc(team.file) + '" target="_blank" rel="noopener">登録済み</a>' : '未登録', !!team]);
    $('status').innerHTML = lines.map(([k, v, ok]) => '<li class="' + (ok ? 'ok' : 'ng') + '"><span>' + (ok ? '✓' : '！') + ' ' + k + '</span><span>' + v + '</span></li>').join('');
  }

  // 年度（初期値：4〜12月は今年度、1〜2月は今年度、3月は来年度）
  (function fillYears() {
    const t = new Date();
    const fy = S.fiscalYear(t);
    const def = t.getMonth() + 1 === 3 ? fy + 1 : fy;
    const sel = $('teamYear');
    [fy - 1, fy, fy + 1].forEach((y) => {
      const o = document.createElement('option');
      o.value = y;
      o.textContent = y + '年度（' + y + '年4月〜' + (y + 1) + '年3月）';
      if (y === def) o.selected = true;
      sel.appendChild(o);
    });
  })();

  /** チェックされた月（古い順） */
  function selectedMonths() {
    return [...document.querySelectorAll('#schMonths input:checked')].map((c) => c.value).sort();
  }

  /** PDFに年が書かれていない月は、今日に一番近い年にする */
  function monthKeyFor(m, y) {
    if (y) return S.monthKey(y, m);
    const t = new Date();
    const now = t.getFullYear() * 12 + t.getMonth();
    const best = [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1].sort(
      (a, b) => Math.abs(a * 12 + m - 1 - now) - Math.abs(b * 12 + m - 1 - now)
    )[0];
    return S.monthKey(best, m);
  }

  const picked = { sch: null, team: null };

  async function readFile(input, nameEl) {
    const f = input.files[0];
    if (!f) return null;
    nameEl.textContent = f.name;
    const bytes = new Uint8Array(await f.arrayBuffer());
    return { name: f.name, bytes, parsed: await parsePdf(bytes) };
  }

  // 予定表：選んだら何月の予定表かを読み取り、月ごとに読み取れるか確認する
  function showMonths() {
    const box = $('schMonths');
    const detected = P.detectMonths(picked.sch.parsed.items).map((d) => monthKeyFor(d.month, d.year));
    const t = new Date();
    const keys = new Set(detected);
    for (let i = 0; i <= 2; i++) {
      const a = S.addMonths(t.getFullYear(), t.getMonth() + 1, i);
      keys.add(S.monthKey(a.y, a.m));
    }
    const next = S.addMonths(t.getFullYear(), t.getMonth() + 1, 1);
    const checked = detected.length ? detected : [S.monthKey(next.y, next.m)];
    box.innerHTML =
      '<p class="desc">' + (detected.length ? 'PDFから読み取った月にチェックしています。違っていたら直してください。' : 'PDFに月が書かれていませんでした。<b>何月の予定表か</b>チェックしてください。') + '</p>' +
      [...keys]
        .sort()
        .map((k) => '<label class="radio"><input type="checkbox" value="' + k + '"' + (checked.includes(k) ? ' checked' : '') + '> ' + monthLabel(k) + '</label>')
        .join('');
    box.hidden = false;
    box.querySelectorAll('input').forEach((c) => (c.onchange = checkSchedule));
  }

  function checkSchedule() {
    const box = $('schCheck');
    if (!picked.sch) {
      box.innerHTML = '';
      $('schUpload').disabled = true;
      return;
    }
    const months = selectedMonths();
    if (!months.length) {
      box.innerHTML = '<ul><li class="ng">！ 何月の予定表かチェックしてください</li></ul>';
      $('schUpload').disabled = true;
      return;
    }
    const lines = months.map((key, i) => {
      const m = Number(key.split('-')[1]);
      const res = P.extractDay(picked.sch.parsed.items, 1, { month: m, monthIndex: i, monthCount: months.length });
      const replace = S.scheduleFor(manifest, ...key.split('-').map(Number)) ? '（登録済みのものと差し替え）' : '';
      return res
        ? '<li class="ok">✓ ' + monthLabel(key) + '：' + res.rows.length + '人の予定を読み取れました' + replace + '</li>'
        : '<li class="ng">！ ' + monthLabel(key) + '：表を読み取れませんでした（月のチェック・PDFを確認してください）</li>';
    });
    picked.sch.ok = !lines.some((l) => l.includes('class="ng"'));
    box.innerHTML = '<ul>' + lines.join('') + '</ul>';
    $('schUpload').disabled = false;
  }
  $('schFile').onchange = async () => {
    $('schCheck').textContent = '読み取り中…';
    $('schMonths').hidden = true;
    try {
      picked.sch = await readFile($('schFile'), $('schFileName'));
    } catch (e) {
      picked.sch = null;
      $('schCheck').textContent = 'PDFを開けませんでした：' + e.message;
      return;
    }
    if (!picked.sch) return checkSchedule();
    showMonths();
    checkSchedule();
  };

  // 班編成表：班と人数を表示
  async function checkTeams() {
    const box = $('teamCheck');
    if (!picked.team) {
      box.innerHTML = '';
      $('teamUpload').disabled = true;
      return;
    }
    const t = P.extractTeams(picked.team.parsed.items);
    picked.team.ok = t.teams.length > 0;
    box.innerHTML = t.teams.length
      ? '<ul><li class="ok">✓ ' + t.teams.length + 'つの班を読み取れました</li>' +
        t.teams.map((x) => '<li>' + esc(x.name) + '：' + esc(x.members.join(' ')) + '</li>').join('') + '</ul>'
      : '<ul><li class="ng">！ 班を読み取れませんでした（PDFはそのまま保存され、画面から開けます）</li></ul>';
    $('teamUpload').disabled = false;
  }
  $('teamFile').onchange = async () => {
    $('teamCheck').textContent = '読み取り中…';
    try {
      picked.team = await readFile($('teamFile'), $('teamFileName'));
    } catch (e) {
      picked.team = null;
      $('teamCheck').textContent = 'PDFを開けませんでした：' + e.message;
      return;
    }
    checkTeams();
  };

  function needToken() {
    const t = S.getToken();
    if (!t) {
      alert('先に、下の「GitHubの鍵」を入れて「保存して確認」を押してください。');
      $('token').focus();
    }
    return t;
  }

  async function doUpload(button, kind) {
    const token = needToken();
    if (!token) return;
    const p = picked[kind];
    if (!p.ok && !confirm('読み取れない部分があります。このままアップロードしますか？')) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'アップロード中…';
    try {
      let file;
      if (kind === 'sch') {
        const months = selectedMonths();
        manifest = S.normalize(await S.uploadSchedule(GH, token, p.bytes, months, p.name));
        file = 'schedules/' + months.join('_') + '.pdf';
      } else {
        const year = Number($('teamYear').value);
        manifest = S.normalize(await S.uploadTeams(GH, token, p.bytes, year, p.name));
        file = 'teams/' + year + '.pdf';
      }
      // この端末ではすぐに表示する（ほかの端末は公開ページの更新を待つ）
      docs[file] = Promise.resolve(p.parsed);
      picked[kind] = null;
      $(kind === 'sch' ? 'schFile' : 'teamFile').value = '';
      if (kind === 'sch') $('schMonths').hidden = true;
      $(kind === 'sch' ? 'schFileName' : 'teamFileName').textContent = 'PDFを選ぶ';
      $(kind === 'sch' ? 'schCheck' : 'teamCheck').innerHTML = '<ul><li class="ok">✓ アップロードしました。ほかの端末やスマホには1〜2分で反映されます。</li></ul>';
      renderStatus();
      renderAlerts();
      render();
    } catch (e) {
      alert(e.message);
      button.disabled = false;
    } finally {
      button.textContent = label;
    }
  }
  $('schUpload').onclick = () => doUpload($('schUpload'), 'sch');
  $('teamUpload').onclick = () => doUpload($('teamUpload'), 'team');

  $('saveToken').onclick = async () => {
    const t = $('token').value.trim();
    const st = $('tokenStatus');
    if (!t) {
      st.textContent = '鍵を入力してください。';
      return;
    }
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
  // 1時間ごとに読み込み直して、新しくアップロードされた予定表も反映する（設定を開いている間は除く）。
  let lastDay = new Date().toDateString();
  const openedAt = Date.now();
  setInterval(() => {
    const nowDay = new Date().toDateString();
    if ($('settings').hidden && (nowDay !== lastDay || Date.now() - openedAt > 60 * 60 * 1000)) {
      lastDay = nowDay;
      location.href = location.pathname;
    }
  }, 60 * 1000);

  loadManifest().then(() => {
    renderAlerts();
    render();
  });
})();
