/**
 * 設定ファイル（ここを書き換えると表示が変わります）
 */
window.SCHEDULE_CONFIG = {
  // 画面の上に出る名前
  title: '指導員 勤務予定',

  // 勤務表PDFの置き場所とファイル名。{yyyy}=年, {mm}=月（2けた）
  //   例：2026年12月 → 2026-12.pdf
  pdfPath: '{yyyy}-{mm}.pdf',

  // PDFに書かれている記号の意味。
  //   off: true のものは「休み」として下にまとめて表示します。
  //   ここに無い記号は、PDFに書かれている文字をそのまま表示します。
  codes: {
    '早': { label: '早番', time: '', color: '#fde68a' },
    '日': { label: '日勤', time: '', color: '#bfdbfe' },
    '遅': { label: '遅番', time: '', color: '#c7d2fe' },
    '半': { label: '半日', time: '', color: '#bbf7d0' },
    '休': { label: '休み', off: true, color: '#e5e7eb' },
    '公': { label: '公休', off: true, color: '#e5e7eb' },
    '希': { label: '希望休', off: true, color: '#fecaca' },
    '有': { label: '有給', off: true, color: '#f5d0fe' },
    '×': { label: '休み', off: true, color: '#e5e7eb' },
    '/': { label: '休み', off: true, color: '#e5e7eb' },
  },
};
