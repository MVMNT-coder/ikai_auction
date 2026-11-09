/**
 * 異界オークション — 中継サーバー（Google Apps Script）
 *
 * ・ページから自動撮影した写真を受け取り、Claude API に送って競売の台本を作る
 * ・結果をこのスプレッドシートの「auction_log」シートに1行ずつ記録する
 *
 * 「プロジェクトの設定 > スクリプト プロパティ」：
 *   ANTHROPIC_API_KEY  （必須）Claude API のキー
 *   MODEL              （任意）既定は claude-sonnet-5-5
 *   RATE_PER_MIN       （任意）1分あたりの受付上限。既定 20
 *   SAVE_IMAGES        （任意）"true" にすると写真をドライブに保存する（既定は保存しない）
 *   IMAGE_FOLDER_ID    （任意）写真の保存先フォルダID。未設定なら自動で作る
 */

const PROPS = PropertiesService.getScriptProperties();
const SHEET_NAME = 'auction_log';
const HEADERS = ['日時', '都市', '品物', '時代', '落札者', '落札額', '単位', '使い道', 'ひとこと', '入札数', '写真'];

const CITIES = {
  sea: { name: '海上都市ネオ・ワダツミ', unit: '塩',
    world: '陸地が水没した2126年の海上都市。真水と乾いたものが何より貴重。金属は錆びる。陸の時代の品は「遺物」と呼ばれる。',
    residents: [['潮守のばあさん', '真水を集めるものに目がない。条件が合えば全財産を突っ込む。'], ['漂着物コレクターの少年', '「陸の時代」の遺物に憧れている。何でも欲しがるが、お金がない。'], ['海藻商人', '浮くか、錆びるかしか見ていない実用主義者。'], ['都市の考古学者', '陸の人間の使い方を、だいたい間違って解説する。']] },
  moon: { name: '月面都市セレネ第三区', unit: '錨貨',
    world: '2088年の月面都市。重力が地球の6分の1で、物はすぐ浮いて漂う。重いものほど「錨」として価値がある。',
    residents: [['浮遊症の配管工', 'すぐ天井まで浮いてしまう。重いものなら何でも欲しい。'], ['重量信仰の神官', '重さこそ徳。重い品を聖遺物として祀る。'], ['軽量化マニアの技師', '1グラムでも軽くしたい。重い品は逆に買い叩く。'], ['地球史の講師', '地球人の暮らしを、だいたい間違って解説する。']] },
  silent: { name: '静寂都市ミナモ', unit: '沈黙',
    world: '2201年、声を出すことが法律で禁じられた都市。会話は筆談か身振りだけ。音や言葉を伝えられる道具は禁断の品。',
    residents: [['筆談代書屋', '筆談の代筆で食べている。文字が書ける道具に目がない。'], ['音の密売人', '禁じられた音を扱う闇商人。音が出るものを欲しがる。'], ['静寂警備隊長', '違法な品は高値で買い取って没収したい。'], ['古代言語学者', '声のあった時代の道具を、だいたい間違って解説する。']] },
  cyber: { name: '電脳都市ゼロ・レイヤー', unit: '実体',
    world: '2310年、全てがデータ化され物理的なものがほぼ残っていない都市。手で触れる物体そのものが異常に珍しく、消せない記録は危険視される。',
    residents: [['実体フェチの富豪', '触れる物体なら何でも集める。'], ['データ消去局の役人', '消せない記録を残す道具を危険物として回収したい。'], ['アナログ復興派の若者', '手作業の時代に憧れている。'], ['物理考古学者', '物体があった時代の使い方を、だいたい間違って解説する。']] }
};

function buildPrompt_(c) {
  const res = c.residents.map(function (r) { return '- ' + r[0] + '：' + r[1]; }).join('\n');
  return 'あなたは展示イベント「異界オークション」の脚本家です。展示会場の監視カメラが、来場者の持ち物を勝手に撮影して、架空の都市のオークションに強制出品しました。その品が競り落とされる寸劇を書きます。\n\n' +
    '【都市】' + c.name + '\n' + c.world + '\n通貨単位：' + c.unit + '\n\n' +
    '【住人（入札者）】\n' + res + '\n\n' +
    '【出品物】添付の写真に写っている持ち物から、いちばん目立つもの1点だけを選ぶ。写っている人物の顔・容姿・服装・体には一切触れない。持ち物が見当たらなければ、机や壁など写っている物体のどれか1点を選ぶ。\n\n' +
    '【ルール】\n' +
    '- この都市の常識で、品の価値を勘違い込みで再解釈する。現代での価値は無視。\n' +
    '- 入札は4〜6件。価格は単調増加（最後に上がった入札額＝落札額）。途中で「降りる」住人がいてもよい（その場合priceは直前の価格のまま）。\n' +
    '- 各セリフは40字以内、住人の性格が出る口調で、なぜその値をつけるのかを一言で。\n' +
    '- appraisalは考古学者役が、元の時代での使い方を「だいたい間違って」解説する1文（50字以内）。\n' +
    '- useは落札者がこの都市で実際にどう使うか、具体的に1文（45字以内）。\n' +
    '- quoteは落札者のひとこと。3行、改行は\\nで、合計60字以内。最後の行は「〜のか」のような驚きで終える。\n' +
    '- itemは見たままを短く（例：透明な傘）。eraはこの都市から見た元の時代の呼び名（例：陸時代）。\n' +
    '- 下品な表現、人を傷つける表現は使わない。\n\n' +
    'JSONのみで返答：\n{"item":"","era":"","appraisal":"","bids":[{"who":"住人名","line":"","price":0}],"winner":"住人名","price":0,"use":"","quote":""}';
}

function doPost(e) {
  if (!e || !e.postData) return out_({ ok: false, error: 'no_request' });
  try {
    if (!rateOk_()) return out_({ ok: false, error: 'rate_limited' });
    const body = JSON.parse(e.postData.contents || '{}');
    const image = body.image;
    if (typeof image !== 'string' || image.length < 1000 || image.length > 4000000) return out_({ ok: false, error: 'bad_image' });
    const key = CITIES[body.city] ? body.city : 'sea';
    const c = CITIES[key];
    const result = callClaude_(image, buildPrompt_(c));
    let photoUrl = '';
    try { photoUrl = saveImage_(image); } catch (err) { console.error('saveImage', err); }
    try { logRow_(result, c, photoUrl); } catch (err) { console.error('logRow', err); }
    return out_({ ok: true, result: result });
  } catch (err) {
    console.error(err);
    const msg = String(err.message || err);
    return out_({ ok: false, error: msg.indexOf('rate') >= 0 ? 'rate_limited' : 'server_error', detail: msg.slice(0, 300) });
  }
}

function doGet() {
  return out_({ ok: true, service: 'ikai-auction', ready: !!PROPS.getProperty('ANTHROPIC_API_KEY') });
}

function callClaude_(imageBase64, promptText) {
  const key = (PROPS.getProperty('ANTHROPIC_API_KEY') || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY が未設定です');
  const payload = {
    model: PROPS.getProperty('MODEL') || 'claude-sonnet-5-5',
    max_tokens: 4000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
      { type: 'text', text: promptText }
    ] }]
  };
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 429 || code === 529) throw new Error('rate limited by API');
  if (code !== 200) throw new Error('Claude API error ' + code + ': ' + res.getContentText().slice(0, 300));
  const data = JSON.parse(res.getContentText());
  const text = data.content.filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  const s = text.indexOf('{'), t = text.lastIndexOf('}');
  if (s < 0 || t < s) throw new Error('JSONが見つかりません: ' + text.slice(0, 200));
  return JSON.parse(text.slice(s, t + 1));
}

function rateOk_() {
  const limit = Number(PROPS.getProperty('RATE_PER_MIN') || 20);
  const cache = CacheService.getScriptCache();
  const k = 'rate_' + Math.floor(Date.now() / 60000);
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try { const n = Number(cache.get(k) || 0) + 1; cache.put(k, String(n), 120); return n <= limit; }
  finally { lock.releaseLock(); }
}

function saveImage_(imageBase64) {
  if (PROPS.getProperty('SAVE_IMAGES') !== 'true') return '';
  let folderId = PROPS.getProperty('IMAGE_FOLDER_ID'), folder;
  if (folderId) folder = DriveApp.getFolderById(folderId);
  else { folder = DriveApp.createFolder('ikai_auction_images'); PROPS.setProperty('IMAGE_FOLDER_ID', folder.getId()); }
  const name = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0, 6) + '.jpg';
  return folder.createFile(Utilities.newBlob(Utilities.base64Decode(imageBase64), 'image/jpeg', name)).getUrl();
}

function logRow_(r, c, photoUrl) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  sh.appendRow([new Date(), c.name, r.item, r.era, r.winner, r.price, c.unit, r.use, r.quote, (r.bids || []).length, photoUrl]);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// エディタから一度実行すると、シート・外部通信の許可画面が出る
function setupCheck() {
  console.log('API key set:', !!PROPS.getProperty('ANTHROPIC_API_KEY'));
  UrlFetchApp.fetch('https://api.anthropic.com', { muteHttpExceptions: true });
  SpreadsheetApp.getActiveSpreadsheet();
}
