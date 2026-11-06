(function () {
  'use strict';
  const CFG = window.SCHEDULE_CONFIG || {};
  const H = window.JPHolidays;
  const P = window.PdfSchedule;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const PDFJS = new URL('lib/pdfjs/', location.href).href;
  const $ = (id) => document.getElementById(id);

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  }

  // ?date=2026-11-06 で日付を指定して表示することもできる
  const q = new URLSearchParams(location.search).get('date');
  let view = q ? new Date(q + 'T00:00:00') : new Date();
  if (isNaN(view)) view = new Date();
  view.setHours(0, 0, 0, 0);

  const cache = {}; // 'YYYY-MM' -> Promise<{ doc, items } | { error }>

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isToday(d) {
    return d.toDateString() === new Date().toDateString();
  }
  function pdfUrl(y, m) {
    return (CFG.pdfPath || '{yyyy}-{mm}.pdf').replace('{yyyy}', y).replace('{mm}', pad(m));
  }

  function loadMonth(y, m) {
    const k = y + '-' + pad(m);
    if (!cache[k]) {
      const url = pdfUrl(y, m);
      cache[k] = (async () => {
        if (!window.pdfjsLib) return { url, error: 'PDF読み込み用の部品（lib/pdfjs）が見つかりません。' };
        try {
          // 毎朝最新のPDFを読むためキャッシュを使わない
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) return { url, error: 'notfound' };
          const data = new Uint8Array(await res.arrayBuffer());
          const doc = await pdfjsLib.getDocument({
            data,
            cMapUrl: PDFJS + 'cmaps/',
            cMapPacked: true,
            standardFontDataUrl: PDFJS + 'standard_fonts/',
          }).promise;
          const items = [];
          for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const tc = await page.getTextContent();
            tc.items.forEach((it) => {
              if (!it.str) return;
              items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]), page: p });
            });
          }
          return { url, doc, items };
        } catch (e) {
          return { url, error: 'PDFを読み込めませんでした：' + e.message };
        }
      })();
    }
    return cache[k];
  }

  function lookup(value) {
    const v = (value || '').trim();
    const codes = CFG.codes || {};
    if (!v) return { label: '予定なし', off: true, blank: true, code: '－', color: '#fff' };
    if (codes[v]) return Object.assign({ code: v }, codes[v]);
    // 「早」「早番」「早8:30」などは先頭の文字で判定
    const key = Object.keys(codes).find((c) => v.startsWith(c) || codes[c].label === v);
    if (key) return Object.assign({ code: key }, codes[key], { label: v.length > key.length ? v : codes[key].label });
    return { label: v, code: v.slice(0, 2), color: '#dbeafe' };
  }

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

    const month = await loadMonth(y, m);
    if (token !== renderToken) return;
    $('loading').hidden = true;
    $('source').textContent = '読み込んだ勤務表：' + month.url;

    if (month.error) {
      $('pdfBox').hidden = true;
      showMessage(
        month.error === 'notfound'
          ? y + '年' + m + '月の勤務表（' + month.url + '）がまだ置かれていません。'
          : month.error
      );
      return;
    }

    const res = P.extractDay(month.items, d);
    $('pdfBox').hidden = false;
    $('pdfLink').href = month.url;
    drawPdf(month.doc, res, token);

    if (!res) {
      showMessage('PDFから表を読み取れませんでした。下の「勤務表PDFで確認する」から見てください。\n（スキャンした画像のPDFは文字を読み取れません）');
      $('pdfBox').open = true;
      return;
    }

    const rows = res.rows.map((r) => ({ name: r.name, raw: r.value, s: lookup(r.value) }));
    const work = rows.filter((r) => !r.s.off);
    const off = rows.filter((r) => r.s.off);
    $('summary').innerHTML = '<b>' + work.length + '</b>人 出勤　<span>休み ' + off.length + '人</span>';
    $('work').innerHTML = work.map(item).join('') || '<li class="none">出勤者なし</li>';
    $('off').innerHTML = off.map(item).join('') || '<li class="none">休みの人はいません</li>';
    $('lists').hidden = false;
  }

  function item(r) {
    return (
      '<li style="--c:' + esc(r.s.color || '#dbeafe') + '"><span class="badge">' + esc(r.s.code) + '</span>' +
      '<span class="who"><b>' + esc(r.name) + '</b></span>' +
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
    const pageNo = res ? res.page : 1;
    const page = await doc.getPage(pageNo);
    if (token !== renderToken) return;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, Math.max(1, (wrap.clientWidth || 600) * 2 / base.width));
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
    ctx.fillStyle = 'rgba(37, 99, 235, 0.18)';
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
    ctx.lineWidth = 2;
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    // 表の部分だけを切り出して表示（ページ下の余白を省く）
    const top = Math.max(0, ry - 60 * scale);
    const bottom = Math.min(canvas.height, ry + rh + 40 * scale);
    const crop = document.createElement('canvas');
    crop.width = canvas.width;
    crop.height = bottom - top;
    crop.getContext('2d').drawImage(canvas, 0, top, canvas.width, crop.height, 0, 0, canvas.width, crop.height);
    wrap.replaceChild(crop, canvas);
  }

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
  // 1時間ごとに読み込み直して、差し替えられたPDFも反映する。
  let lastDay = new Date().toDateString();
  const openedAt = Date.now();
  setInterval(() => {
    const nowDay = new Date().toDateString();
    if (nowDay !== lastDay || Date.now() - openedAt > 60 * 60 * 1000) {
      lastDay = nowDay;
      location.href = location.pathname;
    }
  }, 60 * 1000);

  render();
})();
