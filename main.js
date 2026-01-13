// たまっごち（Step1〜3対応）
// - ハート制（0..4）
// - ごはん/おやつ/ゲーム、💩、病気（薬1〜2回）
// - Attention（呼び出し）と放置によるケアミス
// - しつけ（わがまま/拒否の簡易）
// - 成長段階 egg/infant/rebel/teen/adult + adult分岐（A/B/C）
// - 夜は就寝、電気OFF要求（lightsOff）
// - 自動セーブ（localStorage）

const $ = (id) => document.getElementById(id);

const canvas = $("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const ui = {
  hunger: $("hungerV"),
  happy: $("happyV"),
  discipline: $("disciplineV"),
  state: $("stateV"),
  age: $("ageV"),
  poop: $("poopV"),
  att: $("attV"),
  miss: $("missV"),
  gp: $("gpV"),
  log: $("log"),

  meal: $("mealBtn"),
  snack: $("snackBtn"),
  game: $("gameBtn"),
  clean: $("cleanBtn"),
  med: $("medBtn"),
  disc: $("discBtn"),
  light: $("lightBtn"),
  reset: $("resetBtn"),
};

const STORAGE_KEY = "tamaggochi_step123_v2";

// =====================
// 設定（ここを触ると調整できる）
// =====================
const DEV_FAST = true; // true: 成長/減衰が速い（デバッグ用） false: 現実寄り

const HEART_MAX = 4;

// Attention放置でケアミス加算（分）
const ATTENTION_MISS_MIN = DEV_FAST ? 1.5 : 15;

// 💩放置で病気になりやすくなる（分）
const POOP_SICK_MIN = DEV_FAST ? 2.0 : 60;

// 「わがままAttention」の発生確率（毎分）
const WHIM_RATE_PER_MIN = DEV_FAST ? 0.20 : 0.04;

// 食事後に💩が出る確率
const POOP_AFTER_MEAL_P = 0.55;

// 自然に💩が出る確率（毎分）
const POOP_IDLE_P_PER_MIN = DEV_FAST ? 0.08 : 0.02;

// 段階ごとの設定
// - decayMin: 何分で1ハート減るか（目安）
// - bedtimeHour: 何時に寝るか（起床は9時固定）
// ※あなたの整理に合わせつつ、デモ用に短縮も可能
const STAGE_CONFIG = {
  egg:    { label: "たまご",  hungerDecayMin: DEV_FAST ? 0.8 : 10,  happyDecayMin: DEV_FAST ? 1.0 : 12, bedtimeHour: 20 },
  infant: { label: "幼児期",  hungerDecayMin: DEV_FAST ? 1.2 : 45,  happyDecayMin: DEV_FAST ? 1.6 : 60, bedtimeHour: 20 },
  rebel:  { label: "反抗期",  hungerDecayMin: DEV_FAST ? 1.8 : 75,  happyDecayMin: DEV_FAST ? 2.2 : 90, bedtimeHour: 21 },
  teen:   { label: "思春期",  hungerDecayMin: DEV_FAST ? 2.4 : 75,  happyDecayMin: DEV_FAST ? 2.8 : 90, bedtimeHour: 21 },
  adult:  { label: "産卵期",  hungerDecayMin: DEV_FAST ? 3.2 : 150, happyDecayMin: DEV_FAST ? 3.6 : 180, bedtimeHour: 22 }, // formで上書き可
};

// 成長（分）：デモ用の短縮
const GROWTH_MIN = DEV_FAST
  ? { egg: 0.8, infant: 3.0, rebel: 6.0, teen: 10.0 }   // 合計~20分でadult
  : { egg: 60,  infant: 6 * 60, rebel: 12 * 60, teen: 24 * 60 };

// adultの分岐（最小構成：2〜3体）
function decideAdultForm({ careMistakes, disciplineH, gotchiPoints }) {
  // 良い子（ケアミス少＆しつけ高）
  if (careMistakes <= 1 && disciplineH >= 2) return "A";
  // のんびり系（ポイント稼いでるがしつけ低）
  if (gotchiPoints >= (DEV_FAST ? 30 : 120) && disciplineH <= 1) return "B";
  // 不摂生系（ケアミス多）
  return "C";
}

// adultの就寝時間（あなたの整理：良い子=早寝、のんびり=遅め）
function adultBedtimeHour(form) {
  if (form === "A") return 21;
  if (form === "B") return 22;
  return 23; // C
}

// =====================
// 状態
// =====================
function defaultState() {
  const t = Date.now();
  return {
    // hearts
    hungerH: HEART_MAX,
    happyH: HEART_MAX,
    disciplineH: 0,

    // poop / sickness
    poopCount: 0,
    poopSince: null,      // ms
    sickLevel: 0,         // 0..2
    medicineNeed: 0,      // 0..2

    // attention / care mistakes / discipline event
    attention: false,
    attentionReason: null, // "HUNGER"|"HAPPY"|"POOP"|"SICK"|"DISCIPLINE"|"LIGHTS"
    attentionSince: null,  // ms
    needDiscipline: false,
    refuse: null,          // "FOOD"|"GAME"|null
    careMistakes: 0,

    // sleep & lights
    sleeping: false,
    lightsOff: false,

    // growth
    stage: "egg",          // egg/infant/rebel/teen/adult
    form: "A",             // adult A/B/C
    bornAt: t,             // ms
    ageMin: 0,             // 経過分（実時間換算）

    // decay timers
    lastHungerDecayAt: t,
    lastHappyDecayAt: t,

    // currency (Step4寄りだが、Step3の分岐にも使えるので先に入れておく)
    gotchiPoints: 0,

    // misc
    dead: false,
    msg: "はじめまして！",
    lastUpdate: t,
  };
}

let state = load() ?? defaultState();
log(state.msg);

// =====================
// Save / Load
// =====================
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return null;
    return s;
  } catch {
    return null;
  }
}

// =====================
// UI: actions
// =====================
ui.meal.onclick = () => {
  if (state.mode !== "home") return;
  if (state.dead) return log("……");
  if (state.sleeping) return log("ねている…");
  const COST_MEAL = 10;
  if (state.gotchiPoints < COST_MEAL) return log("GPがたりない…（ごはん10GP）");
  state.gotchiPoints -= COST_MEAL;
  const COST_SNACK = 15;
  if (state.gotchiPoints < COST_SNACK) return log("GPがたりない…（おやつ15GP）");
  state.gotchiPoints -= COST_SNACK;


  // 空腹0のときに稀に「食べない（しつけ必要）」を発生させる
  if (state.hungerH === 0 && Math.random() < 0.25) {
    triggerDiscipline("FOOD");
    log("ごはんをたべない…（しつけ）");
    return;
  }

  if (state.hungerH >= HEART_MAX) {
    log("おなかいっぱい！");
    return;
  }

  state.hungerH = clampInt(state.hungerH + 1, 0, HEART_MAX);

  // 食後は💩が出やすい
  if (Math.random() < POOP_AFTER_MEAL_P) addPoop(1);

  resolveAttentionIfMatches(["HUNGER"]);
  log("もぐもぐ（ごはん）");
  save();
};

ui.snack.onclick = () => {
  if (state.dead) return log("……");
  if (state.sleeping) return log("ねている…");

  if (state.happyH >= HEART_MAX) {
    log("ごきげんMAX！");
    return;
  }
  state.happyH = clampInt(state.happyH + 1, 0, HEART_MAX);
  resolveAttentionIfMatches(["HAPPY"]);
  log("おやつ！");
  save();
};

ui.game.onclick = () => {
  if (state.dead) return log("……");
  if (state.sleeping) return log("ねている…");

  // homeならスロットへ、slotなら進行
  if (state.mode === "home") {
    enterSlotMode();
  } else if (state.mode === "slot") {
    slotAdvance();
  }

  save();
};


  // 簡易ミニゲーム（超ミニ）：勝率50%でポイント＆ごきげん
  // ※本格ミニゲームはStep4でmode導入して実装する想定
// const win = Math.random() < 0.5;

//  if (state.happyH === 0 && Math.random() < 0.20) {
//    triggerDiscipline("GAME");
//    log("ゲームしない…（しつけ）");
//    return;
//  }

//  if (win) {
//    state.gotchiPoints += 10;
//    state.happyH = clampInt(state.happyH + 1, 0, HEART_MAX);
//    log("WIN! ごきげんUP +10GP");
//  } else {
//    log("LOSE…");
//  }
//  resolveAttentionIfMatches(["HAPPY"]);
//  save();
//};

// =====================
// Step4: Slot mini game (3 reels, “device-like” UI)
// =====================
const SLOT = {
  symbols: ["G", "O", "7", "★", "♥", "♪"], // まずは文字が安定
  reels: 3,
  reelIndex: [0, 0, 0],
  spinning: false,
  stopped: [false, false, false],
  stopStep: 0,
  lastTickMs: 0,
  resultText: "",
  finished: false,
  blinkOn: true,
  blinkMs: 0,
};

// ポイント報酬（えさ購入通貨 = gotchiPoints）
function slotPayout(combo) {
  // combo 例 "GOG"
  if (combo === "777") return 200;
  if (combo === "★★★") return 120;
  if (combo === "GOG") return 80;
  if (combo === "OOO") return 60;
  if (combo[0] === combo[1] && combo[1] === combo[2]) return 50; // 3つ揃い一般
  return 5; // 参加賞
}

function isWin(combo) {
  return slotPayout(combo) >= 50;
}

function resetSlot() {
  SLOT.reelIndex = [
    randInt(0, SLOT.symbols.length - 1),
    randInt(0, SLOT.symbols.length - 1),
    randInt(0, SLOT.symbols.length - 1),
  ];
  SLOT.spinning = false;
  SLOT.stopped = [false, false, false];
  SLOT.stopStep = 0;
  SLOT.resultText = "";
  SLOT.finished = false;
  SLOT.lastTickMs = performance.now();
  SLOT.blinkOn = true;
  SLOT.blinkMs = 0;
}

function enterSlotMode() {
  if (state.dead) return log("……");
  if (state.sleeping) return log("ねている…");
  state.mode = "slot";
  resetSlot();
  log("SLOT：ゲームでスタート→順にストップ");
  updateButtonsForMode();
  save();
}

function exitSlotMode() {
  state.mode = "home";
  log("もどった！");
  updateButtonsForMode();
  save();
}

function slotAdvance() {
  if (SLOT.finished) {
    exitSlotMode();
    return;
  }
  if (!SLOT.spinning) {
    SLOT.spinning = true;
    SLOT.resultText = "";
    log("スタート！ もう一度ゲームで止める");
    return;
  }

  if (SLOT.stopStep < SLOT.reels) {
    SLOT.stopped[SLOT.stopStep] = true;
    SLOT.stopStep++;

    if (SLOT.stopStep < SLOT.reels) {
      log(`リール${SLOT.stopStep}停止！ 次もゲームで止める`);
    } else {
      SLOT.spinning = false;
      judgeSlot3();
    }
  }
}

function judgeSlot3() {
  const combo = SLOT.reelIndex.map(i => SLOT.symbols[i]).join("");
  const pay


ui.clean.onclick = () => {
  if (state.dead) return log("……");
  if (state.poopCount === 0) return log("きれいだよ");

  state.poopCount = 0;
  state.poopSince = null;
  resolveAttentionIfMatches(["POOP"]);
  log("💩をながした！");
  save();
};

ui.med.onclick = () => {
  if (state.dead) return log("……");
  if (state.sickLevel === 0) return log("げんきだよ");
}

  state.medicineNeed = clampInt(state.medicineNeed - 1, 0, 2);
  if (state.medicineNeed === 0) {
    state.sickLevel = 0;
    resolveAttentionIfMatches(["SICK"]);
    log("なおった！");
  } else {
    log(`くすり…あと${state.medicineNeed}回`);
  }
  save();
};

ui.disc.onclick = () => {
  if (state.dead) return log("……");
  if (!state.needDiscipline && state.attentionReason !== "DISCIPLINE") {
    // 叱る必要がないのに叱る（軽いペナルティ）
    state.happyH = clampInt(state.happyH - 1, 0, HEART_MAX);
    log("しつけは今じゃない…（ごきげん-1）");
    save();
    return;
  }

  state.disciplineH = clampInt(state.disciplineH + 1, 0, HEART_MAX);
  state.needDiscipline = false;
  state.refuse = null;
  resolveAttention(); // DISCIPLINEを解除
  log("しつけした！（しつけ+1）");
  save();
};

ui.light.onclick = () => {
  if (state.dead) return log("……");

  state.lightsOff = !state.lightsOff;
  const label = state.lightsOff ? "でんきOFF" : "でんきON";
  // LIGHTS attentionは「寝ているのに消灯してない」時に出す
  if (state.sleeping && state.lightsOff) resolveAttentionIfMatches(["LIGHTS"]);
  log(label);
  save();
};

ui.reset.onclick = () => {
  if (!confirm("本当にデータを初期化しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = defaultState();
  log("データを初期化した");
  save();
};

// =====================
// Core loop
// =====================
const TICK_MS = 1000; // 1秒ごと
setInterval(() => {
  step();
  updateHud();
  render();
  save();
}, TICK_MS);

updateHud();
render();

function step() {
  if (state.dead) return;

  const t = Date.now();
  const dtMs = clampNum(t - (state.lastUpdate ?? t), 0, 1000 * 60 * 60 * 48);
  state.lastUpdate = t;

  const dtMin = dtMs / 60000;
  state.ageMin += dtMin;

  // 進化
  evolveIfNeeded();

  // 睡眠判定（時計）
  updateSleepByClock();

  // ハート減衰（段階ごと）
  decayHearts(t);

  // 💩（自然発生）
  if (!state.sleeping) {
    const p = 1 - Math.pow(1 - POOP_IDLE_P_PER_MIN, dtMin); // dtMin分での発生確率
    if (Math.random() < p) addPoop(1);
  }

  // 💩放置で病気になりやすい（あなたの仕様に合わせて“ドクロ→薬1〜2回”）
  if (state.poopCount > 0 && state.poopSince) {
    const poopMin = (t - state.poopSince) / 60000;
    if (poopMin >= POOP_SICK_MIN && state.sickLevel === 0) {
      // 放置が長いほど2回になりやすい
      const heavy = poopMin >= POOP_SICK_MIN * 2;
      triggerSick(heavy ? 2 : 1);
      log("ぐあいがわるい…（くすり）");
    }
  }

  // わがままAttention（しつけ）発生：条件が整っている時に確率で
  maybeTriggerWhim(dtMin);

  // Attention判定（優先度付き）
  evaluateAttention();

  // Attention放置でケアミス
  applyCareMissIfIgnored(t);

  // 死亡判定（最小構成）
  // - 病気放置が続く＆空腹/ごきげん0が続くと危険
  if (state.sickLevel > 0) {
    // 病気中にさらに放置が続くと危険（簡易：一定確率）
    if (state.hungerH === 0 && state.happyH === 0 && Math.random() < (DEV_FAST ? 0.02 : 0.002)) {
      state.dead = true;
      log("……おわかれです。");
    }
  }
}

function evolveIfNeeded() {
  // stageの閾値（経過分）
  const m = state.ageMin;

  if (state.stage === "egg" && m >= GROWTH_MIN.egg) {
    state.stage = "infant";
    log("たまごがかえった！");
  } else if (state.stage === "infant" && m >= GROWTH_MIN.infant) {
    state.stage = "rebel";
    log("ちょっと反抗的…！");
  } else if (state.stage === "rebel" && m >= GROWTH_MIN.rebel) {
    state.stage = "teen";
    log("思春期っぽい！");
  } else if (state.stage === "teen" && m >= GROWTH_MIN.teen) {
    state.stage = "adult";
    state.form = decideAdultForm(state);
    log(`成長した！ type:${state.form}`);
  }
}

function stageCfg() {
  if (state.stage !== "adult") return STAGE_CONFIG[state.stage];
  const base = { ...STAGE_CONFIG.adult };
  base.bedtimeHour = adultBedtimeHour(state.form);
  return base;
}

// =====================
// Heart decay（離散減衰）
// =====================
function decayHearts(nowMs) {
  const cfg = stageCfg();

  // 睡眠中は減衰を緩める（実機っぽく：完全停止ではなく緩め）
  const sleepMul = state.sleeping ? 1.8 : 1.0;

  const hungerInterval = cfg.hungerDecayMin * sleepMul;
  const happyInterval = cfg.happyDecayMin * sleepMul;

  // hungry
  while ((nowMs - state.lastHungerDecayAt) / 60000 >= hungerInterval) {
    state.lastHungerDecayAt += hungerInterval * 60000;
    state.hungerH = clampInt(state.hungerH - 1, 0, HEART_MAX);
  }

  // happy
  while ((nowMs - state.lastHappyDecayAt) / 60000 >= happyInterval) {
    state.lastHappyDecayAt += happyInterval * 60000;
    state.happyH = clampInt(state.happyH - 1, 0, HEART_MAX);
  }
}

// =====================
// Sleep & lights
// =====================
function updateSleepByClock() {
  // 端末のローカル時刻に従う（簡易）
  const d = new Date();
  const hour = d.getHours();
  const min = d.getMinutes();

  const cfg = stageCfg();
  const bedtime = cfg.bedtimeHour;
  const wake = 9;

  const isNight = isBetweenTime(hour, min, bedtime, 0, wake, 0);

  if (isNight && !state.sleeping) {
    state.sleeping = true;
    state.lightsOff = false; // 寝るときは「消してね」を出したいので一旦ONに戻す
    // LIGHTS attentionはevaluateAttentionで出す
    log("ねむい…（でんきを消して）");
  } else if (!isNight && state.sleeping) {
    state.sleeping = false;
    state.lightsOff = false;
    log("おはよう！");
  }
}

function isBetweenTime(h, m, startH, startM, endH, endM) {
  // start→endが日跨ぎする可能性がある前提で「今がその範囲内か」
  const toMin = (hh, mm) => hh * 60 + mm;
  const now = toMin(h, m);
  const start = toMin(startH, startM);
  const end = toMin(endH, endM);
  if (start <= end) return now >= start && now < end;
  // 日跨ぎ
  return now >= start || now < end;
}

// =====================
// Attention
// =====================
function evaluateAttention() {
  // 既に死んでたらなし
  if (state.dead) return;

  // 優先度：SICK > LIGHTS > HUNGER0 > HAPPY0 > POOP > DISCIPLINE
  if (state.sickLevel > 0) return setAttention("SICK");
  if (state.sleeping && !state.lightsOff) return setAttention("LIGHTS");
  if (state.hungerH === 0) return setAttention("HUNGER");
  if (state.happyH === 0) return setAttention("HAPPY");
  if (state.poopCount > 0) return setAttention("POOP");
  if (state.needDiscipline) return setAttention("DISCIPLINE");

  // 何もなければ解除
  resolveAttention();
}

function setAttention(reason) {
  if (state.attention && state.attentionReason === reason) return;
  state.attention = true;
  state.attentionReason = reason;
  state.attentionSince = state.attentionSince ?? Date.now();
}

function resolveAttention() {
  state.attention = false;
  state.attentionReason = null;
  state.attentionSince = null;
}

function resolveAttentionIfMatches(reasons) {
  if (!state.attention) return;
  if (reasons.includes(state.attentionReason)) resolveAttention();
}

// 放置でケアミス：一定分ごとに加算して、Attentionは継続（実機っぽく）
function applyCareMissIfIgnored(nowMs) {
  if (!state.attention || !state.attentionSince) return;

  const attMin = (nowMs - state.attentionSince) / 60000;
  if (attMin < ATTENTION_MISS_MIN) return;

  // ケアミス加算
  state.careMistakes += 1;

  // タイマーをリセットして次のミスまでカウント
  state.attentionSince = nowMs;

  // ペナルティの簡易：
  // - 放置ミスでごきげんが落ちる
  state.happyH = clampInt(state.happyH - 1, 0, HEART_MAX);

  log("放置された…（ケアミス+1）");
}

// =====================
// Discipline (簡易) / Whim
// =====================
function maybeTriggerWhim(dtMin) {
  if (state.sleeping) return;
  if (state.sickLevel > 0) return;
  if (state.poopCount > 0) return;
  if (state.hungerH === 0 || state.happyH === 0) return;

  // 既にしつけ要求中なら増やさない
  if (state.needDiscipline) return;

  // dtMin分での確率に変換
  const p = 1 - Math.pow(1 - WHIM_RATE_PER_MIN, dtMin);
  if (Math.random() < p) {
    state.needDiscipline = true;
    log("わがまま…（しつけ？）");
  }
}

function triggerDiscipline(refuseType) {
  state.needDiscipline = true;
  state.refuse = refuseType;
  // AttentionはevaluateAttentionが立てる
}

function triggerSick(level) {
  state.sickLevel = clampInt(level, 1, 2);
  // 薬回数：1〜2
  state.medicineNeed = clampInt(level, 1, 2);
  // 病気になったらしつけイベントは解除
  state.needDiscipline = false;
  state.refuse = null;
}

// =====================
// Poop
// =====================
function addPoop(n) {
  state.poopCount = clampInt(state.poopCount + n, 0, 3);
  if (!state.poopSince) state.poopSince = Date.now();
}

// =====================
// HUD
// =====================
function updateHud() {
  ui.hunger.textContent = hearts(state.hungerH);
  ui.happy.textContent = hearts(state.happyH);
  ui.discipline.textContent = hearts(state.disciplineH);

  const cfg = stageCfg();
  const label = cfg.label + (state.stage === "adult" ? `(${state.form})` : "");
  const flags = [
    state.sickLevel > 0 ? "🤒" : "",
    state.sleeping ? (state.lightsOff ? "💤(OFF)" : "💤(ON)") : "",
  ].filter(Boolean).join(" ");

  ui.state.textContent = flags ? `${label} ${flags}` : label;

  ui.age.textContent = formatAge(state.ageMin);
  ui.poop.textContent = String(state.poopCount);

  ui.att.textContent = state.attention ? `${state.attentionReason}` : "OFF";
  ui.miss.textContent = String(state.careMistakes);
  ui.gp.textContent = String(state.gotchiPoints);

  ui.light.textContent = state.lightsOff ? "でんきOFF" : "でんきON";
}

function hearts(n) {
  const full = "♥";
  const empty = "♡";
  n = clampInt(n, 0, HEART_MAX);
  return full.repeat(n) + empty.repeat(HEART_MAX - n);
}

function formatAge(min) {
  const m = Math.floor(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h${String(mm).padStart(2, "0")}m` : `${mm}m`;
}

// =====================
// Log
// =====================
let logTimer = null;
function log(text) {
  ui.log.textContent = text;
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => (ui.log.textContent = ""), 4500);
}

// =====================
// Render (Canvas)
// =====================
// 画像スプライトを入れる場合：assets/ に置けば自動で使う
//（無ければフォールバック描画）
const SPRITES = {
  egg: "assets/egg.png",
  infant: "assets/infant.png",
  rebel: "assets/rebel.png",
  teen: "assets/teen.png",
  adult_A: "assets/adult_A.png",
  adult_B: "assets/adult_B.png",
  adult_C: "assets/adult_C.png",
  dead: "assets/dead.png",
};
const spriteCache = {};
let spritesReady = false;
loadSprites().then(() => {
  spritesReady = true;
  render();
});

function loadSprites() {
  const entries = Object.entries(SPRITES);
  let loaded = 0;
  return new Promise((resolve) => {
    entries.forEach(([key, src]) => {
      const img = new Image();
      img.onload = () => {
        spriteCache[key] = img;
        loaded++;
        if (loaded === entries.length) resolve();
      };
      img.onerror = () => {
        loaded++;
        if (loaded === entries.length) resolve();
      };
      img.src = src;
    });
  });
}

function spriteKey() {
  if (state.dead) return "dead";
  if (state.stage === "adult") return `adult_${state.form}`;
  return state.stage; // egg/infant/rebel/teen
}

function render() {
  const w = canvas.width, h = canvas.height;

  // background
  ctx.fillStyle = "#0c1220";
  ctx.fillRect(0, 0, w, h);

  // outer frame
  fillRect(10, 10, w - 20, h - 20, "#0f1a2e");
  fillRect(12, 12, w - 24, h - 24, "#0b1426");

  // top status
  const att = state.attention ? `⚠️${state.attentionReason}` : "";
  const top = `${STAGE_CONFIG[state.stage]?.label ?? state.stage}${state.stage === "adult" ? `(${state.form})` : ""}  ${att}`;
  drawText(18, 26, top, state.attention ? "#ffd166" : "#9aa4b2");

  // hearts
  drawText(18, 40, `H:${hearts(state.hungerH)}  P:${hearts(state.happyH)}  D:${hearts(state.disciplineH)}`, "#9aa4b2");

  // screen dim if sleeping & lights off
  const dim = state.sleeping && state.lightsOff;

  // ground
  ctx.fillStyle = "#0a2b22";
  ctx.fillRect(24, 142, w - 48, 18);
  ctx.fillStyle = "rgba(124,240,182,.14)";
  ctx.fillRect(24, 142, w - 48, 2);

  // poop icons
  for (let i = 0; i < state.poopCount; i++) {
    drawPoop(56 + i * 18, 148);
  }

  // pet
  drawPet();

  // overlays
  if (state.sickLevel > 0) drawBadge(200, 58, "🤒");
  if (state.sleeping) drawBadge(200, 78, state.lightsOff ? "💤" : "💡");

  if (dim) {
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(12, 12, w - 24, h - 24);
    drawText(90, 96, "lights off", "rgba(255,255,255,.35)");
  }
}

function drawPet() {
  const cx = 120, cy = 98;

  const key = spriteKey();
  const img = spriteCache[key];

  if (spritesReady && img) {
    const scale = 3;
    const ww = img.width * scale;
    const hh = img.height * scale;
    const x = Math.round(cx - ww / 2);
    const y = Math.round(cy - hh / 2);
    ctx.drawImage(img, x, y, ww, hh);
    return;
  }

  // fallback: simple pixel blob by stage/form
  let body = "#7cf0b6";
  if (state.stage === "egg") body = "#d7dbe2";
  if (state.stage === "infant") body = "#7cf0b6";
  if (state.stage === "rebel") body = "#6fb0ff";
  if (state.stage === "teen") body = "#8f7bff";
  if (state.stage === "adult") {
    body = state.form === "A" ? "#ffd166" : state.form === "B" ? "#8f7bff" : "#ff6b6b";
  }
  pixBody(cx, cy, body);

  const eye = state.sleeping ? "-" : "o";
  drawText(cx - 16, cy - 2, `${eye}   ${eye}`, "#0b1426");
  drawText(cx - 8, cy + 10, state.sickLevel > 0 ? "~" : "_", "#0b1426");
}

function pixBody(cx, cy, color) {
  const px = (x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const s = 4;
  const ox = cx - (8 * s) / 2;
  const oy = cy - (7 * s) / 2;

  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.fillRect(ox - 2, oy + 2, 8 * s + 4, 7 * s + 4);

  px(ox + 1 * s, oy + 0 * s, 6 * s, 1 * s);
  px(ox + 0 * s, oy + 1 * s, 8 * s, 1 * s);
  px(ox + 0 * s, oy + 2 * s, 8 * s, 1 * s);
  px(ox + 0 * s, oy + 3 * s, 8 * s, 1 * s);
  px(ox + 0 * s, oy + 4 * s, 8 * s, 1 * s);
  px(ox + 1 * s, oy + 5 * s, 6 * s, 1 * s);
  px(ox + 2 * s, oy + 6 * s, 4 * s, 1 * s);
}

function drawPoop(x, y) {
  ctx.fillStyle = "#7a4a2b";
  ctx.fillRect(x, y - 10, 8, 6);
  ctx.fillRect(x + 1, y - 14, 6, 4);
  ctx.fillRect(x + 2, y - 17, 4, 3);
}

function drawBadge(x, y, emoji) {
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillStyle = "#fff";
  ctx.fillText(emoji, x, y);
}

function fillRect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawText(x, y, text, color) {
  ctx.fillStyle = color;
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(text, x, y);
}

// =====================
// Utils
// =====================
function clampInt(v, a, b) {
  v = Math.floor(v);
  return Math.max(a, Math.min(b, v));
}
function clampNum(v, a, b) {
  return Math.max(a, Math.min(b, v));
}



