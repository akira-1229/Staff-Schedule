/**
 * 日本の祝日計算（1980〜2099年対応）
 * 振替休日・国民の休日にも対応。
 */
(function (root) {
  'use strict';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function key(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d);
  }

  /** m月の第n月曜日の日付 */
  function nthMonday(y, m, n) {
    const first = new Date(y, m - 1, 1).getDay();
    const firstMonday = 1 + ((8 - first) % 7);
    return firstMonday + (n - 1) * 7;
  }

  function vernalEquinox(y) {
    return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  function autumnalEquinox(y) {
    return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }

  /**
   * 指定年の祝日を { 'YYYY-MM-DD': '祝日名' } で返す
   */
  function getHolidays(y) {
    const h = {};
    const add = (m, d, name) => {
      h[key(y, m, d)] = name;
    };

    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    if (y >= 2020) add(2, 23, '天皇誕生日');
    add(3, vernalEquinox(y), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, autumnalEquinox(y), '秋分の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');

    // 国民の休日：前後を祝日に挟まれた平日
    const base = Object.keys(h).sort();
    base.forEach((k) => {
      const d = new Date(k + 'T00:00:00');
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const next2 = new Date(d);
      next2.setDate(d.getDate() + 2);
      const k1 = key(next.getFullYear(), next.getMonth() + 1, next.getDate());
      const k2 = key(next2.getFullYear(), next2.getMonth() + 1, next2.getDate());
      if (!h[k1] && h[k2] && next.getDay() !== 0) {
        h[k1] = '国民の休日';
      }
    });

    // 振替休日：日曜の祝日の後の最初の平日（祝日でない日）
    Object.keys(h)
      .sort()
      .forEach((k) => {
        const d = new Date(k + 'T00:00:00');
        if (d.getDay() !== 0) return;
        const s = new Date(d);
        do {
          s.setDate(s.getDate() + 1);
        } while (h[key(s.getFullYear(), s.getMonth() + 1, s.getDate())]);
        if (s.getFullYear() === y) {
          h[key(s.getFullYear(), s.getMonth() + 1, s.getDate())] = '振替休日';
        }
      });

    return h;
  }

  const api = { getHolidays, dateKey: key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JPHolidays = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
