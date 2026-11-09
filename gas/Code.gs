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
const HEADERS = ['日時', '世界', '品物', 'この世界での価値', '落札者', '落札額', '単位', '使い道', 'ひとこと', '入札数', '写真'];

const CITIES = {
  half: { name: '重力が半分の世界', unit: '円', world: '重力がいつもの半分。物も人も、ふわっと浮きやすい。それ以外は今の日本と同じ。',
    residents: [['浮きやすい小学生', 'すぐ体が浮いて困っている'], ['配送会社の社長', '物を投げて遠くへ運ぶ商売'], ['重りコレクター', '重い物を集めている']] },
  lockdown: { name: 'ロックダウンが当たり前の世界', unit: '円', world: '外に出られるのは週に1回だけ。みんな家の中で暮らしている。それ以外は今の日本と同じ。',
    residents: [['在宅10年目の会社員', '家の中が退屈でしかたない'], ['5人家族のお母さん', '家族がずっと家にいて息がつまる'], ['配達ドローン乗り', '外に出られる数少ない人']] },
  smart: { name: 'すべての物に知能がある世界', unit: '円', world: '道具にもぜんぶ心と意見があり、しゃべる。人は物にも気をつかって暮らす。それ以外は今の日本と同じ。',
    residents: [['物の悩み相談員', '道具の悩みを聞く仕事'], ['しゃべる冷蔵庫', '家電の仲間をふやしたい'], ['静かな物が好きな作家', 'うるさい道具に疲れている']] },
  rain: { name: '毎日雨が降る世界', unit: '円', world: '1年365日、雨がやまない。晴れを見たことがある人はいない。それ以外は今の日本と同じ。',
    residents: [['乾かし屋', '濡れた物を乾かす商売'], ['晴れを知らない子ども', '太陽の話にあこがれている'], ['傘職人', '雨の道具なら負けない']] },
  noon: { name: '夜が来ない世界', unit: '円', world: '太陽が沈まず、ずっと昼。みんな眠るのに苦労している。それ以外は今の日本と同じ。',
    residents: [['眠れない看護師', '夜勤明けでも眠れない'], ['暗さ屋', '暗い部屋を貸す商売'], ['星を見たい天文ファン', '本物の星を見たことがない']] }
};

function buildPrompt_(c) {
  const res = c.residents.map(function (r) { return '- ' + r[0] + '（' + r[1] + '）'; }).join('\n');
  return 'あなたは展示イベント「異界オークション」の台本係です。会場のカメラが来場者の持ち物を勝手に撮影し、現実から1つだけずれた「パラレルワールド」のオークションに出品しました。その品が、その世界の住人にとってどんな価値があるかを競りで見せます。\n\n' +
    '【世界】' + c.name + '\n' + c.world + '\n値段の単位：円\n\n' +
    '【入札者】この3人だけ。名前は一字一句このまま使う。\n' + res + '\n\n' +
    '【出品物】写真に写っている持ち物から、いちばん目立つ1点を選ぶ。人の顔・容姿・服装・体には一切触れない。持ち物が見当たらなければ、写っている物体のどれか1点を選ぶ。\n\n' +
    '【いちばん大事なこと】見ている人が一瞬でわかること。\n' +
    '- 小学5年生でもわかる、短くてやさしい言葉だけを使う。カタカナ語・専門用語・造語は使わない。\n' +
    '- 値段の理由は、その世界の設定（' + c.world.split('。')[0] + '）と品物の特徴を、そのまま結びつける。ひねりすぎない。\n' +
    '- 現実と同じところはそのままにする。SFっぽい新技術は出さない。\n\n' +
    '【書くもの】\n' +
    '- item：見たままの品名を短く（例：透明な傘）。\n' +
    '- appraisal：「この世界では、〜だから値打ちがある／ない」という1文。30字以内。\n' +
    '- bids：入札4〜5件。line は20字以内の話し言葉で、値段も言う（例：「浮かずにすむ！5,000円！」）。price は数値。値段は上がっていく。途中で1人が降りてもよい（そのときは line で降りると言い、price は直前と同じ）。値段は100円〜50万円くらいの現実的な範囲。\n' +
    '- winner：最後に一番高い値をつけた人。price：落札額。\n' +
    '- use：落札者がその世界でどう使うか。30字以内の1文。\n' +
    '- quote：落札者のひとこと。2行、改行は\\n、合計30字以内。くすっと笑える本音。\n' +
    '- 下品な表現、人を傷つける表現は使わない。\n\n' +
    'JSONのみで返答：\n{"item":"","appraisal":"","bids":[{"who":"","line":"","price":0}],"winner":"","price":0,"use":"","quote":""}';
}

function doPost(e) {
  if (!e || !e.postData) return out_({ ok: false, error: 'no_request' });
  try {
    if (!rateOk_()) return out_({ ok: false, error: 'rate_limited' });
    const body = JSON.parse(e.postData.contents || '{}');
    const image = body.image;
    if (typeof image !== 'string' || image.length < 1000 || image.length > 4000000) return out_({ ok: false, error: 'bad_image' });
    const key = CITIES[body.city] ? body.city : 'half';
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
  sh.appendRow([new Date(), c.name, r.item, r.appraisal, r.winner, r.price, c.unit, r.use, r.quote, (r.bids || []).length, photoUrl]);
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
