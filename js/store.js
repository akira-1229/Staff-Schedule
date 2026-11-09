/**
 * アップロードされたファイルの管理
 *
 * data/manifest.json に、アップロード済みのものを記録する：
 * {
 *   "schedules": [{ "month": "2026-11", "data": "data/schedules/2026-11.json", "file": "schedules/2026-11.pdf", "name": "元のファイル名", "uploadedAt": "..." }],
 *   "teams":     [{ "year": 2026, "data": "data/teams/2026.json", "file": "teams/2026.jpg", "name": "...", "uploadedAt": "..." }]
 * }
 * file = アップロードした元の画像・PDF、data = 確認画面で確定した内容（アプリはこちらを使う）
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
    const list = normalize(manifest).schedules.filter((s) => s.month === key);
    if (!list.length) return null;
    list.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return { entry: list[0], month: m };
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
      return cleanToken(localStorage.getItem(TOKEN_KEY)) || '';
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

  /**
   * 貼り付けた鍵から、空白・改行・見えない文字を取り除く（全角英数字は半角にする）
   * 鍵の形（github_pat_… / ghp_…）でなければ空文字を返す
   */
  function cleanToken(t) {
    const s = String(t || '')
      .normalize('NFKC')
      .replace(/[^A-Za-z0-9_]/g, '');
    return /^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(s) ? s : '';
  }

  async function api(cfg, token, path, opts) {
    opts = opts || {};
    try {
      return await apiFetch(cfg, token, path, opts);
    } catch (e) {
      throw new Error('GitHubに接続できませんでした。電波の良い所でもう一度試すか、アプリを閉じて開き直してください。（' + e.message + '）');
    }
  }

  function apiFetch(cfg, token, path, opts) {
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

  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.(pdf|jpe?g|png|heic|webp)$/);
    return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'jpg';
  }
  function jsonBytes(obj) {
    return new TextEncoder().encode(JSON.stringify(obj, null, 1) + '\n');
  }
  function monthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    return y + '年' + m + '月';
  }

  /**
   * 予定表を保存：元のファイル1つ ＋ 確定した月ごとのデータ
   * file: { bytes, name }、months: [{ month: '2026-11', data: {...} }]
   */
  async function uploadSchedule(cfg, token, file, months) {
    const keys = months.map((x) => x.month);
    const label = keys.map(monthLabel).join('・');
    const src = 'schedules/' + keys.join('_') + '.' + extOf(file.name);
    await putFile(cfg, token, src, file.bytes, '予定表の元ファイル：' + label);
    for (const x of months) {
      const data = Object.assign({}, x.data, { month: x.month, source: src, confirmedAt: new Date().toISOString() });
      await putFile(cfg, token, 'data/schedules/' + x.month + '.json', jsonBytes(data), '予定表を確定：' + monthLabel(x.month));
    }
    return updateManifest(
      cfg,
      token,
      (m) => {
        m.schedules = m.schedules.filter((s) => !keys.includes(s.month));
        keys.forEach((k) => m.schedules.push({ month: k, data: 'data/schedules/' + k + '.json', file: src, name: file.name, uploadedAt: new Date().toISOString() }));
        m.schedules.sort((a, b) => a.month.localeCompare(b.month));
      },
      '予定表の登録を更新：' + label
    );
  }

  /** 体制表（班編成表）を保存：元のファイル ＋ 確定したデータ（year: 年度） */
  async function uploadTeams(cfg, token, file, year, data) {
    const src = 'teams/' + year + '.' + extOf(file.name);
    await putFile(cfg, token, src, file.bytes, '体制表の元ファイル：' + year + '年度');
    const json = 'data/teams/' + year + '.json';
    await putFile(cfg, token, json, jsonBytes(Object.assign({}, data, { year: Number(year), source: src, confirmedAt: new Date().toISOString() })), '体制表を確定：' + year + '年度');
    return updateManifest(
      cfg,
      token,
      (m) => {
        m.teams = m.teams.filter((t) => Number(t.year) !== Number(year));
        m.teams.push({ year: Number(year), data: json, file: src, name: file.name, uploadedAt: new Date().toISOString() });
        m.teams.sort((a, b) => a.year - b.year);
      },
      '体制表の登録を更新：' + year + '年度'
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
    cleanToken,
    setToken,
    checkToken,
    uploadSchedule,
    uploadTeams,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
  else root.ScheduleStore = api_;
})(typeof globalThis !== 'undefined' ? globalThis : this);
