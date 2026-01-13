// たまっごち（超軽量）
// 依存なし / Canvas描画 / 自動セーブ（localStorage）

const $ = (id) => document.getElementById(id);

const canvas = $("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const ui = {
  hunger: $("hungerV"),
  happy: $("happyV"),
  health: $("healthV"),
  clean: $("cleanV"),
  age: $("ageV"),
  log: $("log"),
  feed: $("feedBtn"),
  play: $("playBtn"),
  cleanBtn: $("cleanBtn"),
  med: $("medBtn"),
  sleep: $("sleepBtn"),
  reset: $("resetBtn"),
};

const STORAGE_KEY = "tamaggochi_save_v1";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function nowMs(){ return Date.now(); }

function defaultState(){
  return {
    // core stats 0..100
    hunger: 80,
    happy: 70,
    health: 90,
    clean: 90,

    // meta
    ageMin: 0,             // 経過分
    stage: "egg",          // egg -> baby -> teen -> adult
    form: "A",             // 進化先（A/B/C）
    asleep: false,

    // world state
    poop: 0,               // うんち数
    sick: false,
    dead: false,

    // history
    mistakes: 0,           // 世話ミスカウント
    lastUpdate: nowMs(),
    msg: "はじめまして！",
  };
}

let state = load() ?? defaultState();
log(state.msg);

// ----- Save / Load -----
function save(){
  const payload = JSON.stringify(state);
  localStorage.setItem(STORAGE_KEY, payload);
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    // 最低限のバリデーション
    if(typeof s !== "object" || s === null) return null;
    return s;
  }catch{
    return null;
  }
}

// ----- UI actions -----
ui.feed.onclick = () => {
  if (state.dead) return log("もう反応しない…");
  state.hunger = clamp(state.hunger + 18, 0, 100);
  state.clean = clamp(state.clean - 4, 0, 100);
  maybePoop(0.35);
  state.msg = "もぐもぐ！";
  log(state.msg);
  save();
};

ui.play.onclick = () => {
  if (state.dead) return log("もう遊べない…");
  state.happy = clamp(state.happy + 16, 0, 100);
  state.hunger = clamp(state.hunger - 6, 0, 100);
  state.msg = "たのしい！";
  log(state.msg);
  save();
};

ui.cleanBtn.onclick = () => {
  if (state.dead) return log("…");
  if (state.poop === 0){
    state.msg = "きれいだよ";
  } else {
    state.poop = 0;
    state.clean = clamp(state.clean + 28, 0, 100);
    state.msg = "そうじした！";
  }
  log(state.msg);
  save();
};

ui.med.onclick = () => {
  if (state.dead) return log("…");
  if (!state.sick){
    state.msg = "いまは元気！";
  } else {
    state.sick = false;
    state.health = clamp(state.health + 25, 0, 100);
    state.msg = "なおった！";
  }
  log(state.msg);
  save();
};

ui.sleep.onclick = () => {
  if (state.dead) return log("…");
  state.asleep = !state.asleep;
  state.msg = state.asleep ? "すやすや…" : "おはよう！";
  log(state.msg);
  save();
};

ui.reset.onclick = () => {
  if (!confirm("本当にデータを初期化しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  log("データを初期化した");
  save();
};

// ----- Core simulation -----
const TICK_MS = 1000; // 1秒ごと更新（軽く）
setInterval(() => {
  if (state.dead) {
    render();
    return;
  }
  step();
  updateHud();
  render();
  save();
}, TICK_MS);

// 初回描画
updateHud();
render();

function step(){
  // 前回更新からの経過を分に換算（オフライン分も反映）
  const t = nowMs();
  const dtMs = t - (state.lastUpdate ?? t);
  state.lastUpdate = t;

  // 異常に長い/短い差分を丸め（時刻変更など対策）
  const safeDtMs = clamp(dtMs, 0, 1000 * 60 * 60 * 24 * 2); // 最大48h
  const dtMin = safeDtMs / 60000;

  // 年齢
  state.ageMin += dtMin;

  // ステータス劣化：睡眠中はゆるめ
  const slow = state.asleep ? 0.35 : 1.0;

  state.hunger = clamp(state.hunger - (2.2 * slow), 0, 100);
  state.happy  = clamp(state.happy  - (1.6 * slow), 0, 100);
  state.clean  = clamp(state.clean  - (1.2 * slow), 0, 100);

  // うんち発生（空腹低い＋食べた後に増えやすく）
  if (!state.asleep && Math.random() < 0.18) maybePoop(0.18);

  // 汚いと体調が下がり病気に
  const dirty = (state.clean < 35) || (state.poop >= 2);
  if (dirty) state.health = clamp(state.health - 2.0, 0, 100);
  else       state.health = clamp(state.health + 0.8, 0, 100);

  // 病気判定
  if (!state.sick && (state.health < 40) && Math.random() < 0.35) {
    state.sick = true;
    log("ぐあいがわるい…（くすり）");
  }

  // 世話ミス（放置）判定：閾値を下回っている時間が続くと増える
  // ※簡易：毎tick判定。厳密にしたければカウンタ方式に変更OK
  if (state.hunger < 20 || state.happy < 15 || state.clean < 20 || state.poop >= 3) {
    state.mistakes += 1;
  }

  // 死亡判定
  if (state.health <= 0 || (state.hunger <= 0 && state.happy <= 0)) {
    state.dead = true;
    log("……おわかれです。");
  }

  // 進化（年齢で段階）
  evolveIfNeeded();

  // 眠ってるときはちょい回復
  if (state.asleep && !state.sick) {
    state.happy = clamp(state.happy + 1.2, 0, 100);
    state.health = clamp(state.health + 1.0, 0, 100);
  }
}

function evolveIfNeeded(){
  const m = state.ageMin;

  // 分換算：デモ用に速め（リアルにしたければ桁を上げる）
  const eggToBaby = 2;    // 2分
  const babyToTeen = 6;   // 6分
  const teenToAdult = 12; // 12分

  if (state.stage === "egg" && m >= eggToBaby) {
    state.stage = "baby";
    log("たまごがかえった！");
  }
  if (state.stage === "baby" && m >= babyToTeen) {
    state.stage = "teen";
    log("ちょっと成長した！");
  }
  if (state.stage === "teen" && m >= teenToAdult) {
    state.stage = "adult";
    // 進化先決定（ミス少→A、多→C）
    if (state.mistakes <= 8) state.form = "A";
    else if (state.mistakes <= 18) state.form = "B";
    else state.form = "C";
    log(`進化した！ タイプ${state.form}`);
  }
}

function maybePoop(p){
  if (Math.random() < p) {
    state.poop = clamp(state.poop + 1, 0, 5);
    state.clean = clamp(state.clean - 8, 0, 100);
  }
}

// ----- HUD -----
function updateHud(){
  ui.hunger.textContent = bar(state.hunger);
  ui.happy.textContent  = bar(state.happy);
  ui.health.textContent = state.sick ? `🤒 ${bar(state.health)}` : bar(state.health);
  ui.clean.textContent  = state.poop > 0 ? `💩x${state.poop} ${bar(state.clean)}` : bar(state.clean);
  ui.age.textContent    = formatAge(state.ageMin);
  ui.sleep.textContent  = state.asleep ? "おきる" : "ねる";
}

function bar(v){
  const n = Math.round(clamp(v,0,100));
  return `${n}`;
}

function formatAge(min){
  const m = Math.floor(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h${String(mm).padStart(2,"0")}m` : `${mm}m`;
}

// ----- Log -----
let logTimer = null;
function log(text){
  ui.log.textContent = text;
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    ui.log.textContent = "";
  }, 4500);
}

// ----- Render (Canvas) -----
function render(){
  const w = canvas.width, h = canvas.height;

  // background
  ctx.fillStyle = "#0c1220";
  ctx.fillRect(0, 0, w, h);

  // frame
  drawRect(10, 10, w-20, h-20, "#0f1a2e");
  drawRect(12, 12, w-24, h-24, "#0b1426");

  // status icons top
  drawText(18, 26, statusLine(), "#9aa4b2");

  // ground
  ctx.fillStyle = "#0a2b22";
  ctx.fillRect(24, 142, w-48, 18);
  ctx.fillStyle = "rgba(124,240,182,.14)";
  ctx.fillRect(24, 142, w-48, 2);

  // pet
  if (state.dead){
    drawPetDead();
  } else {
    drawPet();
  }

  // poop
  for (let i=0; i<state.poop; i++){
    drawPoop(56 + i*18, 148);
  }
}

function statusLine(){
  const s = [];
  if (state.asleep) s.push("💤");
  if (state.sick) s.push("🤒");
  if (state.stage === "egg") s.push("🥚");
  else s.push(`stage:${state.stage}`);
  if (state.stage === "adult") s.push(`type:${state.form}`);
  return s.join("  ");
}

function drawRect(x,y,w,h,color){
  ctx.fillStyle = color;
  ctx.fillRect(x,y,w,h);
}

function drawText(x,y,text,color){
  ctx.fillStyle = color;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(text, x, y);
}

function drawPet(){
  // center
  const cx = 120, cy = 98;

  // body color by stage/form
  let body = "#7cf0b6";
  if (state.stage === "egg") body = "#d7dbe2";
  if (state.stage === "baby") body = "#7cf0b6";
  if (state.stage === "teen") body = "#6fb0ff";
  if (state.stage === "adult"){
    body = (state.form === "A") ? "#ffd166" : (state.form === "B") ? "#8f7bff" : "#ff6b6b";
  }

  // simple pixel body
  pixBody(cx, cy, body);

  // face
  const eye = state.asleep ? "-" : "o";
  drawText(cx-16, cy-2, `${eye}   ${eye}`, "#0b1426");
  drawText(cx-8,  cy+10, state.sick ? "~" : "_", "#0b1426");
}

function drawPetDead(){
  const cx = 120, cy = 98;
  pixBody(cx, cy, "#444b5b");
  drawText(cx-18, cy, "x   x", "#111");
  drawText(cx-8,  cy+10, "_", "#111");
}

function pixBody(cx, cy, color){
  // 16x14-ish pixel blob
  const px = (x,y,w,h)=>{ ctx.fillStyle=color; ctx.fillRect(x,y,w,h); };
  const s = 4; // pixel size
  const ox = cx - 8*s/2;
  const oy = cy - 7*s/2;

  // outline shadow
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.fillRect(ox-2, oy+2, 8*s+4, 7*s+4);

  // blob blocks
  px(ox+1*s, oy+0*s, 6*s, 1*s);
  px(ox+0*s, oy+1*s, 8*s, 1*s);
  px(ox+0*s, oy+2*s, 8*s, 1*s);
  px(ox+0*s, oy+3*s, 8*s, 1*s);
  px(ox+0*s, oy+4*s, 8*s, 1*s);
  px(ox+1*s, oy+5*s, 6*s, 1*s);
  px(ox+2*s, oy+6*s, 4*s, 1*s);
}

function drawPoop(x,y){
  // tiny poop
  ctx.fillStyle = "#7a4a2b";
  ctx.fillRect(x, y-10, 8, 6);
  ctx.fillRect(x+1, y-14, 6, 4);
  ctx.fillRect(x+2, y-17, 4, 3);
}
