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

// 住人の設定：n＝名前（画面と一字一句同じ）、want＝行動原理、judge＝値をつける基準、money＝予算と入札のクセ
const CITIES = {
  island: { name: '無人島サバイバル', world: '船が難破して流れついた島。3年たっても助けが来ない。火・水・刃物になる物が何より大事。店も電気もない。', residents: [
    { n: '漂流3年目の元会社員', want: '元は経理の仕事。毎日「あと何日生きのびられるか」を計算して暮らしている。',
      judge: '水・食べ物・火の確保に何日ぶん役立つか。雨や潮でこわれないか。数字で考える。',
      money: '3年ためた貯金があり、上限は3人の中で一番高い。ただし計算が合わない値上げはしない。' },
    { n: '救助を待つ船長', want: '目的は「島を出ること」だけ。島の暮らしを良くする気はない。',
      judge: '遠くの船から見えるか（大きさ・色・光の反射）、音が遠くまで届くか、水に浮くか。',
      money: '脱出に使えると見たら一気に値を上げる。使えないと見たら、あっさり降りる。' },
    { n: '島のサル', want: '人間の使い道はわからない。おもしろい物がほしいだけ。',
      judge: '光るか、音が鳴るか、かじれるか、いいにおいがするか。',
      money: 'バナナで払うので数百円まで。最初に手をあげて、すぐ負ける。セリフは鳴き声＋（）で気持ち。' } ] },
  ninja: { name: '忍者の里', world: '山奥に隠れた忍者の里。音を立てない物、隠せる物、投げられる物ほど役に立つ。里の外の町は普通の昔の日本。', residents: [
    { n: '見習い忍者', want: 'もうすぐ昇級試験。足音が大きくて、いつも見つかってしまうのが悩み。',
      judge: '自分の弱点（音・目立つこと）を補えるか。修行ですぐ使えるか。',
      money: 'おこづかいなので数千円まで。気持ちは強いが、すぐ予算が尽きる。' },
    { n: 'くノ一', want: '町に潜入して情報を集める専門家。失敗は命取り。',
      judge: '町の人が持っていても怪しまれないか。袖や帯に隠せる大きさか。使い道が2通り以上あるか。',
      money: '任務の経費で払う。冷静で、相手の値を少しだけ上回る入札をする。' },
    { n: '里の長老', want: '里の宝物庫を守っている。里の外の珍しい技術を集めて、後の世代に残したい。',
      judge: '里で見たことがない素材や作りか。実際に役立つかは問わない。',
      money: '里の予算で大きく出せる。ただし若い者が「任務で使う」と言えば、ゆずる。' } ] },
  zombie: { name: 'ゾンビがあふれた世界', world: '町はゾンビだらけ。生き残った37人がショッピングモールに立てこもっている。ゾンビは音に集まる。電気と水道は止まっている。', residents: [
    { n: 'モールのリーダー', want: '37人全員を生かす責任がある。けんかの種になる物は入れたくない。',
      judge: '何人の役に立つか。何日もつか。取り合いにならないか。',
      money: 'みんなの共同資金で払う。1人しか得をしない物には出さない。全員の得になるなら高く出す。' },
    { n: '物資の調達係', want: '毎日モールの外へ出て、物を集めてくる役。一番あぶない仕事。',
      judge: '音が出ないか。片手で使えるか。走るときにじゃまにならない重さ・大きさか。',
      money: '自分の命にかかわる物なら、持ち金の限界まで出す。関係ない物は見向きもしない。' },
    { n: '元ホームセンター店員', want: '道具と材料の知識がある。使えない物に高い値がつくのが許せない。',
      judge: '何の素材でできているか。直せるか。別の道具に作り変えられるか。使ったらなくなる物か。',
      money: '現実派。素材と作りに見合う値までしか出さず、高すぎると「その値は出しすぎ」と降りる。' } ] },
  kaiju: { name: '怪獣が毎週来る街', world: '毎週日曜に怪獣が現れて街を壊していく。月曜からみんなで建て直す。それ以外は普通の今の日本。', residents: [
    { n: '防衛隊の新人隊員', want: '怪獣にまだ一度も勝てていない。怪獣の弱点を探している。',
      judge: '怪獣の気を引けるか（光・音・色）。遠くへ投げられるか。作戦に使えるか。',
      money: '給料が安い。熱意で値を上げるが、上限は低い。' },
    { n: '怪獣保険の営業マン', want: '壊れた物の保険金の支払いで、会社が大赤字。壊れない物を広めたい。',
      judge: '踏まれても壊れないか。壊れても安く直せるか。「丈夫な物の見本」としてお客に見せられるか。',
      money: '損か得かを計算して、得なら会社の金で上げる。計算が合わなくなったら降りる。' },
    { n: '商店街の会長', want: '毎週、自分の店と商店街が壊される。それでも店を続けたい。',
      judge: '30秒で持って逃げられるか。店を建て直すとき役立つか。お客を呼べるか。',
      money: '商店街の積立金で払う。商店街のためになると思えば粘る。' } ] },
  robot: { name: '巨大ロボットがある世界', world: '身長18メートルの巨大ロボットが街を守っている。基地では200人の隊員が働いている。それ以外は普通の今の日本。', residents: [
    { n: 'ロボの整備士', want: 'いつも部品が足りない。次の出撃までに修理を間に合わせたい。',
      judge: '素材（金属・ゴム・ガラス・布）と寸法。ロボの関節や配線、操縦席の部品に流用できるか。',
      money: '部品としての値段しか出さない。相場にきびしく、それ以上は降りる。' },
    { n: '新人パイロット', want: '出撃がこわい。操縦席でひとりになると手がふるえる。',
      judge: '操縦席に置ける大きさか。にぎると落ち着くか。地上の普通の暮らしを思い出せるか。',
      money: '給料の範囲で、気持ちで値を上げる。' },
    { n: '基地の食堂のおばちゃん', want: '隊員200人のごはんと元気を守っている。みんなのお母さん役。',
      judge: '食堂で使えるか。洗えるか。隊員が笑顔になるか。',
      money: '食堂の経費で堅実に払う。隊員のためと思えば、かんたんには引かない。' } ] },
  edo: { name: '江戸時代', world: '電気もプラスチックもない江戸の町。今の道具は、見たことのない不思議な品に見える。金属やガラスは貴重。', residents: [
    { n: '長屋の大工', want: '腕はいいが道具が古い。仕事が早くなる道具がほしい。',
      judge: '手になじむか。丈夫か。木を切る・測る・打つ仕事に使えるか。',
      money: '日当で払える数千円まで。使えない物には1文も出さない。' },
    { n: '呉服屋の若旦那', want: '店の評判を上げて、父親を見返したい。',
      judge: '江戸でだれも見たことがないか。店先に置くと人が足を止めるか。上客への贈り物になるか。',
      money: 'お金はある。ただし人に見せびらかせない物には出さない。' },
    { n: '浮世絵師', want: 'まだ売れていない。だれも描いたことのない題材を探している。',
      judge: '形・色・透け方・光り方が絵になるか。江戸にない色か。',
      money: '貧乏。版元に前借りして無理をするが、限界が来て降りる。' } ] }
};

function buildPrompt_(c) {
  const res = c.residents.map(function (r) {
    return '■ ' + r.n + '\n  ・どんな人：' + r.want + '\n  ・値をつける基準：' + r.judge + '\n  ・お金と入札のクセ：' + r.money;
  }).join('\n');
  return 'あなたは展示イベント「異界オークション」の台本係です。会場のカメラが来場者の持ち物を勝手に撮影し、誰もが知っている物語のお約束でできた世界のオークションに出品しました。その品が、その世界の住人にとってどんな価値があるかを、競りのやりとりで見せます。\n\n' +
    '【世界】' + c.name + '\n' + c.world + '\n値段の単位：円\n\n' +
    '【入札者】この3人だけ。名前は一字一句このまま使う。\n' + res + '\n\n' +
    '【出品物】写真に写っている持ち物から、いちばん目立つ1点を選ぶ。人の顔・容姿・服装・体には一切触れない。持ち物が見当たらなければ、写っている物体のどれか1点を選ぶ。\n\n' +
    '【考える順番】\n' +
    '1. 写真をよく見て、その品の特徴を3つ書き出す（素材、形、大きさ、重さ、色や透け方、音が出るか、こわれやすさ、もともとの働き、など）。これが features。\n' +
    '2. 入札者ごとに、その特徴が「値をつける基準」に当たるかを判断する。当たる人ほど高く、当たらない人は安値で1回だけ入札するか、理由を言って降りる。\n' +
    '3. その判断にそって競りを組み立てる。落札するのは、その品が自分の基準に一番よく当たる人。\n\n' +
    '【競りのルール】\n' +
    '- どのセリフも「品物の具体的な特徴」と「その人の事情」を結びつける。「ほしい！」「すごい！」だけのセリフは禁止。\n' +
    '- 値を上げるときは、新しい理由が必要。次のどれかを使う：(a) まだ出ていない別の特徴に気づく (b) 相手の使い道より自分のほうが切実だと言う (c) 数で言う（何人ぶん、何日ぶん、何回使える、など）。同じ理由のくり返しは禁止。\n' +
    '- 上げ幅は理由の強さに合わせる。強い理由なら大きく、弱い理由なら少しだけ。最初の値は低めに始める。\n' +
    '- 降りる人は、予算か基準を理由にして降りる（例：「部品としてはその値は出せない」）。\n' +
    '- 3人それぞれ、考え方のちがいがはっきり出るようにする。\n\n' +
    '【言葉づかい】見ている人が一瞬でわかること。\n' +
    '- 小学5年生でもわかる、短くてやさしい言葉だけを使う。カタカナ語・専門用語・造語は使わない。\n' +
    '- その世界の、誰でも知っているイメージだけを使う。マイナーな設定や造語は足さない。\n' +
    '- 実在の作品名・キャラクター名・商品名は出さない。下品な表現、人を傷つける表現は使わない。\n\n' +
    '【書くもの】\n' +
    '- features：品の特徴3つ。それぞれ15字以内。\n' +
    '- item：見たままの品名を短く（例：透明な傘）。\n' +
    '- appraisal：この世界での値打ちを、品の特徴を1つ挙げて言う1文。35字以内（例：「この島では、雨を集められる形の物は宝物。」）。\n' +
    '- bids：入札4〜6件。line は30字以内の話し言葉。値段は画面に出るので、line に書かなくてよい。price は数値で、上がっていく。降りるときは line で理由を言い、price は直前と同じにする。値段は100円〜50万円の範囲で、その人の予算に合わせる。\n' +
    '- winner：最後に一番高い値をつけた人。price：落札額。\n' +
    '- use：落札者がその世界でどう使うか。品の特徴を生かした具体的な1文。35字以内。\n' +
    '- quote：落札者のひとこと。2行、改行は\\n、合計30字以内。その人の事情がにじむ、くすっと笑える本音。\n\n' +
    'JSONのみで返答：\n{"features":["","",""],"item":"","appraisal":"","bids":[{"who":"","line":"","price":0}],"winner":"","price":0,"use":"","quote":""}';
}

function doPost(e) {
  if (!e || !e.postData) return out_({ ok: false, error: 'no_request' });
  try {
    if (!rateOk_()) return out_({ ok: false, error: 'rate_limited' });
    const body = JSON.parse(e.postData.contents || '{}');
    const image = body.image;
    if (typeof image !== 'string' || image.length < 1000 || image.length > 4000000) return out_({ ok: false, error: 'bad_image' });
    const key = CITIES[body.city] ? body.city : 'island';
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
  sh.appendRow([new Date(), c.name, r.item, r.appraisal, r.winner, r.price, '円', r.use, r.quote, (r.bids || []).length, photoUrl]);
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
