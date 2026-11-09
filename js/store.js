/**
 * アップロードされたファイルの管理
 *
 * data/manifest.json に、アップロード済みのファイルを記録する：
 * {
 *   "schedules": [{ "file": "schedules/2026-12_2027-01.pdf", "months": ["2026-12", "2027-01"], "name": "元のファイル名.pdf", "uploadedAt": "..." }],
 *   "teams":     [{ "file": "teams/2026.pdf", "year": 2026, "name": "...", "uploadedAt": "..." }]
 * }
 * 班編成表の year は「年度」（4月始まり）。
 */
(function (root) {
  'use strict';

  const MANIFEST = 'data/manifest.json';
  const TOKEN_KEY = 'staff-schedule-github-token';
  const pad = (n) => String(n).padStart(2, '0');

  function monthKey(y, m) {
    return y + '-' + pad(m);
  }

  function addMonths(y, m, n) {
    const d = new Date(y, m - 1 + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }

  /** 年度（4月始まり） */
  function fiscalYear(date) {
    return date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1;
  }

  function emptyManifest() {
    return { schedules: [], teams: [] };
  }

  function normalize(m) {
    m = m || {};
    return { schedules: Array.isArray(m.schedules) ? m.schedules : [], teams: Array.isArray(m.teams) ? m.teams : [] };
  }

  /** その月を含む予定表（同じ月が複数あれば、後からアップロードしたもの） */
  function scheduleFor(manifest, y, m) {
    const key = monthKey(y, m);
    const list = normalize(manifest).schedules.filter((s) => (s.months || []).includes(key));
    if (!list.length) return null;
    list.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    const entry = list[0];
    return { entry, month: m, monthIndex: entry.months.indexOf(key), monthCount: entry.months.length };
  }

  /** その日に使う班編成表（その年度のもの。まだ無ければ前の年度のもの） */
  function teamsFor(manifest, date) {
    const fy = fiscalYear(date);
    const list = normalize(manifest).teams.filter((t) => Number(t.year) <= fy);
    if (!list.length) return null;
    list.sort((a, b) => b.year - a.year || String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return { entry: list[0], current: Number(list[0].year) === fy, fiscalYear: fy };
  }

  // ---------------- GitHub への保存 ----------------

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* 保存できない環境 */
    }
  }

  function api(cfg, token, path, opts) {
    opts = opts || {};
    return fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        token ? { Authorization: 'Bearer ' + token } : {},
        opts.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
    });
  }

  async function explain(res) {
    let msg = '';
    try {
      msg = (await res.json()).message || '';
    } catch (e) {
      /* 本文なし */
    }
    if (res.status === 401) return '鍵（トークン）が正しくないか、期限が切れています。設定の「GitHubの鍵」を入れ直してください。';
    if (res.status === 403 || res.status === 404) return '鍵（トークン）にこのリポジトリへの書き込み権限がありません（Contents: Read and write が必要です）。';
    return 'GitHubへの保存に失敗しました（' + res.status + ' ' + msg + '）';
  }

  /** 鍵が使えるか確認 */
  async function checkToken(cfg, token) {
    const res = await api(cfg, token, '');
    if (!res.ok) throw new Error(await explain(res));
    const repo = await res.json();
    if (!repo.permissions || !repo.permissions.push) throw new Error('この鍵では書き込みができません（Contents: Read and write が必要です）。');
    return repo;
  }

  function toBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function fromBase64Utf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function getSha(cfg, token, path) {
    const res = await api(cfg, token, '/contents/' + encodeURI(path) + '?ref=' + encodeURIComponent(cfg.branch));
    if (res.status === 404) return { sha: null };
    if (!res.ok) throw new Error(await explain(res));
    const j = await res.json();
    return { sha: j.sha, content: j.content };
  }

  async function putFile(cfg, token, path, bytes, message) {
    const { sha } = await getSha(cfg, token, path);
    const res = await api(cfg, token, '/contents/' + encodeURI(path), {
      method: 'PUT',
      body: Object.assign({ message, content: toBase64(bytes), branch: cfg.branch }, sha ? { sha } : {}),
    });
    if (!res.ok) throw new Error(await explain(res));
  }

  /** manifest を読み直して書き換える（GitHub上の最新を元にする） */
  async function updateManifest(cfg, token, change, message) {
    const cur = await getSha(cfg, token, MANIFEST);
    const manifest = normalize(cur.content ? JSON.parse(fromBase64Utf8(cur.content)) : emptyManifest());
    change(manifest);
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
    const res = await api(cfg, token, '/contents/' + MANIFEST, {
      method: 'PUT',
      body: Object.assign({ message, content: toBase64(bytes), branch: cfg.branch }, cur.sha ? { sha: cur.sha } : {}),
    });
    if (!res.ok) throw new Error(await explain(res));
    return manifest;
  }

  /** 予定表をアップロード（months: ['2026-12'] または ['2026-12', '2027-01']） */
  async function uploadSchedule(cfg, token, bytes, months, name) {
    const file = 'schedules/' + months.join('_') + '.pdf';
    const label = months.map((k) => k.replace('-', '年').replace(/^(\d+)年0?(\d+)$/, '$1年$2月')).join('・');
    await putFile(cfg, token, file, bytes, '予定表をアップロード：' + label);
    return updateManifest(
      cfg,
      token,
      (m) => {
        m.schedules = m.schedules.filter((s) => s.file !== file);
        m.schedules.push({ file, months, name, uploadedAt: new Date().toISOString() });
        m.schedules.sort((a, b) => a.months[0].localeCompare(b.months[0]));
      },
      '予定表の登録を更新：' + label
    );
  }

  /** 班編成表をアップロード（year: 年度） */
  async function uploadTeams(cfg, token, bytes, year, name) {
    const file = 'teams/' + year + '.pdf';
    await putFile(cfg, token, file, bytes, '班編成表をアップロード：' + year + '年度');
    return updateManifest(
      cfg,
      token,
      (m) => {
        m.teams = m.teams.filter((t) => Number(t.year) !== Number(year));
        m.teams.push({ file, year: Number(year), name, uploadedAt: new Date().toISOString() });
        m.teams.sort((a, b) => a.year - b.year);
      },
      '班編成表の登録を更新：' + year + '年度'
    );
  }

  const api_ = {
    MANIFEST,
    monthKey,
    addMonths,
    fiscalYear,
    emptyManifest,
    normalize,
    scheduleFor,
    teamsFor,
    getToken,
    setToken,
    checkToken,
    uploadSchedule,
    uploadTeams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
  else root.ScheduleStore = api_;
})(typeof globalThis !== 'undefined' ? globalThis : this);
