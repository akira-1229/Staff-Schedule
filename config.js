/**
 * 設定ファイル（ここを書き換えると表示が変わります）
 */
window.SCHEDULE_CONFIG = {
  // 画面の上に出る名前
  title: '指導員 勤務予定',

  // アップロード先（GitHub のリポジトリ）
  github: { owner: 'akira-1229', repo: 'Staff-Schedule', branch: 'main' },

  // 休校日の曜日（0=日 1=月 … 6=土）。予定表を読み取ったとき、この曜日に「休校日」のチェックを付ける
  // （確認画面で日ごとに直せます）
  closedWeekdays: [0, 1],
};
