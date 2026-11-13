// GAS をウェブアプリとしてデプロイしたときの URL（https://script.google.com/macros/s/.../exec）をここに貼る。
// 空のままだと「模擬鑑定」モード（Claudeを呼ばず、用意した台本で競売）で動く。
window.GAS_URL = "https://script.google.com/macros/s/AKfycbwBLSOhklIwofg4-qORtb337xRcERsQwtLeATSVxGgMUi_Rld6iGnGpCrpfamNoLdvr4w/exec";

window.AUCTION = {
  minSec: 8,      // 自動シャッターの最短間隔（秒）
  maxSec: 28,     // 自動シャッターの最長間隔（秒）
  lockSec: 3,     // シャッター前の「照準ロック」予告（秒）
  certSec: 14,    // 結果ページを表示しておく時間（秒）
  resultTheme: "dark"   // 結果ページの色。"dark"＝黒いフィルターのカード、"light"＝グリッドと同じ白いカードで画面全体も白
};
