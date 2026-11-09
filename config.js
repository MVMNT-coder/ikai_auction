// GAS をウェブアプリとしてデプロイしたときの URL（https://script.google.com/macros/s/.../exec）をここに貼る。
// 空のままだと「模擬鑑定」モード（Claudeを呼ばず、用意した台本で競売）で動く。
window.GAS_URL = "https://script.google.com/macros/s/AKfycbwBLSOhklIwofg4-qORtb337xRcERsQwtLeATSVxGgMUi_Rld6iGnGpCrpfamNoLdvr4w/exec";

window.AUCTION = {
  minSec: 8,      // 自動シャッターの最短間隔（秒）
  maxSec: 28,     // 自動シャッターの最長間隔（秒）
  lockSec: 3,     // シャッター前の「照準ロック」予告（秒）
  certSec: 14,    // 落札証明書を表示しておく時間（秒）
  qrUrl: ""       // 証明書のQRに入れるURL（MVMNTの問い合わせ先など）。空ならQRを出さない
};
