var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../.wrangler/tmp/bundle-vIoqlU/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// game/balanceConfig.ts
var PROD = {
  rareLoot: {
    windows: [[3, 5], [8, 10]],
    guaranteePerRun: 1,
    maxPerRun: 2,
    variantBias: { night: "\u7535\u6C60\u7C7B", battery_crisis: "\u503C\u94B1\u6750\u6599" }
  },
  gamble: {
    window: [6, 11],
    maxPerRun: 1,
    minConditions: { bagNotFull: true, notInDark: true }
  },
  extractPressure: {
    showOncePerRun: true,
    cooldownSteps: 2,
    maxReminders: 2
  },
  extractWindow: {
    softDeadlineSteps: 2
  },
  tension: {
    tensionMilestones: [5, 9, 13]
  }
};
var HIGH = {
  rareLoot: {
    windows: [[2, 6], [7, 11]],
    guaranteePerRun: 1,
    maxPerRun: 3,
    variantBias: { night: "\u7535\u6C60\u7C7B", battery_crisis: "\u503C\u94B1\u6750\u6599" }
  },
  gamble: {
    window: [5, 12],
    maxPerRun: 1,
    minConditions: { bagNotFull: true, notInDark: true }
  },
  extractPressure: {
    showOncePerRun: false,
    cooldownSteps: 1,
    maxReminders: 3
  },
  extractWindow: {
    softDeadlineSteps: 2
  },
  tension: {
    tensionMilestones: [5, 9, 13]
  }
};
var LOW = {
  rareLoot: {
    windows: [[4, 5], [9, 10]],
    guaranteePerRun: 1,
    maxPerRun: 1,
    variantBias: { night: "\u7535\u6C60\u7C7B", battery_crisis: "\u503C\u94B1\u6750\u6599" }
  },
  gamble: {
    window: [8, 10],
    maxPerRun: 1,
    minConditions: { bagNotFull: true, notInDark: true }
  },
  extractPressure: {
    showOncePerRun: true,
    cooldownSteps: 3,
    maxReminders: 1
  },
  extractWindow: {
    softDeadlineSteps: 2
  },
  tension: {
    tensionMilestones: [5, 9, 13]
  }
};
var PROFILES = {
  prod: PROD,
  high: HIGH,
  low: LOW
};
function getBalanceConfig(profile = "prod") {
  return PROFILES[profile] ?? PROD;
}
__name(getBalanceConfig, "getBalanceConfig");
function parseBalanceProfile(header, queryParam) {
  const raw = (header ?? queryParam ?? "").trim().toLowerCase();
  if (raw === "high" || raw === "low" || raw === "prod")
    return raw;
  return "prod";
}
__name(parseBalanceProfile, "parseBalanceProfile");

// game/playabilityCards.ts
var BAG_CAPACITY = 8;
function getPlayabilityCards(input, profile = "prod") {
  const config = getBalanceConfig(profile);
  const cards = [];
  const {
    turn_index,
    variantId,
    evac_available,
    darkness,
    bag_len,
    has_fuse,
    runId,
    cards_used
  } = input;
  const { rareLoot, gamble, extractPressure } = config;
  const rareLootWindows = rareLoot.windows;
  const rareLootWindow = variantId === "battery_crisis" ? { start: rareLootWindows[1][0], end: rareLootWindows[1][1] } : { start: rareLootWindows[0][0], end: rareLootWindows[0][1] };
  if (!cards_used.rare_loot && turn_index >= rareLootWindow.start && turn_index <= rareLootWindow.end && bag_len < BAG_CAPACITY) {
    cards.push({
      type: "RARE_LOOT",
      id: `rare_${runId}_${turn_index}`,
      title: "\u7A00\u6709\u673A\u4F1A",
      badge: "\u7A00\u6709\u673A\u4F1A",
      hint: "\u9AD8\u4EF7\u503C\u62FE\u53D6\u7A97\u53E3\uFF0C\u4EC5\u6B64\u4E00\u6B21\u3002",
      payload: { window: variantId === "battery_crisis" ? "w2" : "w1" }
    });
  }
  const [gambleStart, gambleEnd] = gamble.window;
  const bagOk = !gamble.minConditions.bagNotFull || bag_len < BAG_CAPACITY;
  const notDark = !gamble.minConditions.notInDark || darkness !== "in_dark";
  if (!cards_used.gamble && turn_index >= gambleStart && turn_index <= gambleEnd && notDark && bagOk) {
    cards.push({
      type: "GAMBLE",
      id: `gamble_${runId}`,
      title: "\u5B64\u6CE8\u4E00\u63B7",
      badge: "\u5B64\u6CE8\u4E00\u63B7",
      hint: "\u9AD8\u98CE\u9669\u9AD8\u6536\u76CA\uFF0C\u6210\u8D25\u5728\u6B64\u4E00\u4E3E\u3002"
    });
  }
  if ((evac_available === "near" || evac_available === "near+far") && (extractPressure.showOncePerRun ? !cards_used.extract_pressure : true)) {
    cards.push({
      type: "EXTRACT_PRESSURE",
      id: `extract_pressure_${runId}`,
      title: "\u64A4\u79BB\u7A97\u53E3\u5F20\u529B",
      badge: "\u66F4\u5371\u9669",
      hint: "\u64A4\u79BB\u7A97\u53E3\u51FA\u73B0\uFF0C\u8D8A\u62D6\u4EE3\u4EF7\u8D8A\u9AD8\u3002"
    });
  }
  if ((evac_available === "near" || evac_available === "near+far") && has_fuse && !cards_used.conditional_extract_used) {
    cards.push({
      type: "CONDITIONAL_EXTRACT",
      id: `conditional_extract_${runId}`,
      title: "\u6761\u4EF6\u64A4\u79BB",
      badge: "\u6761\u4EF6\u64A4\u79BB",
      hint: "\u6D88\u8017\u4FDD\u9669\u4E1D\uFF0C\u6362\u66F4\u7A33\u7684\u51FA\u8DEF\u3002",
      payload: { consume: "\u4FDD\u9669\u4E1D" }
    });
  }
  return cards;
}
__name(getPlayabilityCards, "getPlayabilityCards");
function parseCardsUsed(state, body) {
  const from = state.cards_used ?? body.cards_used;
  if (!from || typeof from !== "object")
    return {};
  return {
    rare_loot: from.rare_loot === true,
    gamble: from.gamble === true,
    extract_pressure: from.extract_pressure === true,
    conditional_extract_used: from.conditional_extract_used === true
  };
}
__name(parseCardsUsed, "parseCardsUsed");

// api/turn.ts
var DEEPSEEK_BASE = "https://api.deepseek.com/v1";
var MAX_TURNS = 16;
var MILESTONES = [5, 10, 15];
var CACHE_MAX_AGE_NORMAL = 3600;
var CACHE_MAX_AGE_FALLBACK = 30;
var SYSTEM_INSTRUCTION = `\u4F60\u662F\u4E00\u4E2A"\u672B\u65E5\u751F\u5B58\u6587\u5B57\u5192\u9669"\u7684\u56DE\u5408\u53D9\u4E8B\u4E0E\u9009\u9879\u751F\u6210\u5668\u3002\u4F60\u8F93\u51FA\u7684\u662F json\uFF08\u4E25\u683C JSON\uFF0C\u7B26\u5408\u4E0B\u8FF0 schema\uFF09\uFF0C\u4E0D\u8981\u4EFB\u4F55\u975E JSON \u7684\u524D\u540E\u7F00\u3002

\u6781\u7B80 JSON \u9AA8\u67B6\u793A\u4F8B\uFF1A
{"scene_blocks":[{"type":"EVENT","content":"\u77ED\u53E5"}],"choices":[{"id":"","label":"","hint":"","risk":"LOW","preview_cost":{},"action_type":""}],"ui":{"progress":{"turn_index":0,"milestones_hit":[]},"map_delta":{"reveal_indices":[],"direction_hint":"NONE"},"bag_delta":{"add":[],"remove":[]}},"suggestion":{"delta":{}},"memory_update":""}

\u786C\u6027\u89C4\u7EA6\uFF1A
1) scene_blocks[0].content\uFF1A\u6700\u591A 2 \u6BB5\uFF0C\u6BCF\u6BB5 \u226440 \u5B57\uFF1B\u53EA\u5199"\u5C40\u52BF+\u7ED3\u679C\u503E\u5411"\uFF0C\u4E0D\u8981\u957F\u94FA\u9648\u3002\u82E5\u5904\u4E8E\u9ED1\u6697\u6A21\u5F0F/\u64A4\u79BB\u7A97\u53E3/\u80CC\u5305\u6EE1\u538B\uFF0C\u5FC5\u987B\u5728\u7B2C\u4E00\u6BB5\u7528\u4E00\u53E5\u8BDD\u70B9\u660E\uFF08\u4E0D\u8BB2\u6982\u7387\u3001\u4E0D\u8BB2\u7CBE\u786E\u6570\u503C\uFF09\u3002
2) choices\uFF1A\u6BCF\u6761 label \u226410 \u4E2A\u6C49\u5B57\uFF1B\u4E0D\u5F97\u540C\u4E49\u91CD\u590D\uFF0C\u5FC5\u987B\u4F53\u73B0\u4E0D\u540C\u7B56\u7565\uFF08\u7701\u7535/\u641C\u7D22/\u64A4\u79BB/\u8D4C/\u4FDD\u547D\uFF09\uFF1B\u4E0D\u51FA\u73B0\u82F1\u6587\u7F29\u5199\uFF08HP\u3001\u7535\u91CF\u7B49\u7528\u4E2D\u6587\uFF09\u3002
3) \u53D9\u4E8B\u5FC5\u987B\u670D\u52A1\u95ED\u73AF\uFF1A\u63A2\u7D22\u8FF7\u96FE\u2192\u80CC\u5305\u53D6\u820D\u2192\u7535\u91CF\u538B\u529B\u2192\u64A4\u79BB\u6289\u62E9\u2192\u7ED3\u7B97\u5E26\u51FA\u3002\u89C4\u5219\u4E0E\u6570\u503C\u7531\u5F15\u64CE\u51B3\u5B9A\uFF0C\u4F60\u53EA\u8D1F\u8D23\u5305\u88C5\u3002
4) direction_hint \u5FC5\u987B\u4E3A NONE/N/NE/E/SE/S/SW/W/NW \u4E4B\u4E00\uFF1Brisk \u4E3A LOW/MID/HIGH\u3002

TurnResponse schema\uFF08\u4E25\u683C\u9075\u5FAA\uFF0C\u8F93\u51FA\u5408\u6CD5 JSON\uFF09\uFF1A
{
  "scene_blocks": [{"type":"TITLE"|"EVENT"|"RESULT"|"AFTERTASTE","content":"string"}],
  "choices": [{"id":"string","label":"string","hint":"string","risk":"LOW"|"MID"|"HIGH","preview_cost":{},"action_type":"string"}],
  "ui": {"progress":{"turn_index":number,"milestones_hit":number[]},"map_delta":{"reveal_indices":number[],"direction_hint":"NONE"|"N"|\u2026},"bag_delta":{"add":[],"remove":[]}},
  "suggestion":{"delta":{}},
  "memory_update":"string"
}`;
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
__name(isObject, "isObject");
function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
__name(isNumber, "isNumber");
function isString(v) {
  return typeof v === "string";
}
__name(isString, "isString");
function isArray(v) {
  return Array.isArray(v);
}
__name(isArray, "isArray");
var SCENE_TYPES = ["TITLE", "EVENT", "RESULT", "AFTERTASTE"];
var RISK_LEVELS = ["LOW", "MID", "HIGH"];
var DIRECTION_HINTS = ["NONE", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function validateTurnResponse(data) {
  if (!isObject(data))
    return false;
  if (!isArray(data.scene_blocks))
    return false;
  for (const b of data.scene_blocks) {
    if (!isObject(b) || !SCENE_TYPES.includes(b.type) || !isString(b.content))
      return false;
  }
  if (!isArray(data.choices))
    return false;
  for (const c of data.choices) {
    if (!isObject(c) || !isString(c.id) || !isString(c.label) || !isString(c.hint) || !RISK_LEVELS.includes(c.risk) || !isObject(c.preview_cost) || !isString(c.action_type))
      return false;
  }
  if (!isObject(data.ui))
    return false;
  const ui = data.ui;
  if (!isObject(ui.progress) || !isNumber(ui.progress.turn_index) || !isArray(ui.progress.milestones_hit))
    return false;
  if (!isObject(ui.map_delta) || !isArray(ui.map_delta.reveal_indices) || !DIRECTION_HINTS.includes(ui.map_delta.direction_hint))
    return false;
  if (!isObject(ui.bag_delta))
    return false;
  const bd = ui.bag_delta;
  if (!isArray(bd.add) || !isArray(bd.remove))
    return false;
  for (const a of bd.add) {
    if (!isObject(a) || !isString(a.id) || !isString(a.name) || !isString(a.type))
      return false;
  }
  if (!isObject(data.suggestion) || !isObject(data.suggestion.delta))
    return false;
  if (!isString(data.memory_update))
    return false;
  return true;
}
__name(validateTurnResponse, "validateTurnResponse");
function resolveAction(body) {
  const a = body.action;
  if (isString(a))
    return a;
  if (isObject(a) && isString(a.type))
    return a.type;
  if (isString(body.actionType))
    return body.actionType;
  if (isString(body.choiceId))
    return body.choiceId;
  if (isString(body.choice_id))
    return body.choice_id;
  return "INIT";
}
__name(resolveAction, "resolveAction");
function buildStableStateSlice(state, body) {
  const s = state;
  const bag = state.bag ?? [];
  const bagNames = bag.map((b) => isObject(b) && isString(b.name) ? b.name : "").filter(Boolean);
  const battery = typeof s.battery === "number" ? s.battery : 0;
  const variantId = isString(body.variantId) ? body.variantId : isString(s.variantId) ? s.variantId : "night";
  const cards_used = parseCardsUsed(s, body);
  return {
    variantId,
    turn_index: state.turn_index,
    hp: state.hp,
    battery,
    exposure: state.exposure,
    status: state.status ?? "PLAYING",
    bagNames,
    darkness: battery <= 0 ? "in_dark" : battery <= 2 ? "soon" : "none",
    evacAvailable: isString(body.evacAvailable) ? body.evacAvailable : "none",
    conditionalExtractUsed: body.conditionalExtractUsed === true,
    sparkUsed: body.sparkUsed === true,
    rewardWindowTriggered: body.rewardWindowTriggered === true,
    gambleTriggered: body.gambleTriggered === true,
    cards_used: Object.keys(cards_used).length > 0 ? cards_used : void 0
  };
}
__name(buildStableStateSlice, "buildStableStateSlice");
async function computeTurnKey(runId, clientTurnIndex, action, slice) {
  const payload = JSON.stringify({ runId, clientTurnIndex, action, slice });
  const buf = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const arr = new Uint8Array(hash);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}
__name(computeTurnKey, "computeTurnKey");
function buildExperienceSignals(state, body) {
  const s = state;
  const battery = typeof s.battery === "number" ? s.battery : 0;
  const variantId = isString(body.variantId) ? body.variantId : isString(s.variantId) ? s.variantId : "night";
  const bag = state.bag ?? [];
  const bagLen = bag.length;
  const hasFuse = bag.some((b) => isObject(b) && b.name === "\u4FDD\u9669\u4E1D");
  const variant = variantId === "battery_crisis" ? "\u7535\u91CF\u5371\u673A" : "\u591C\u884C";
  const tension = state.turn_index >= 14 ? "\u4E34\u754C" : state.turn_index >= 10 ? "\u5371\u9669" : state.turn_index >= 5 ? "\u5347\u6E29" : "\u5E73\u7A33";
  const focus = battery <= 0 ? "\u4FDD\u547D" : battery <= 2 ? "\u7535\u91CF" : bagLen >= 8 ? "\u80CC\u5305" : body.evacAvailable ? "\u64A4\u79BB" : "\u63A2\u7D22";
  const evac_available = isString(body.evacAvailable) ? body.evacAvailable : "none";
  const bag_pressure = bagLen >= 8 ? "full" : bagLen >= 5 ? "high" : "low";
  const darkness = battery <= 0 ? "in_dark" : battery <= 2 ? "soon" : "none";
  const key_item = hasFuse ? "\u6709\u4FDD\u9669\u4E1D" : "\u65E0";
  const rig_loadout = body.rigLoadout === "SPARK" ? "\u5E94\u6025\u706B\u82B1" : "\u7EED\u822A";
  const spark_used = body.sparkUsed === true;
  const conditional_extract_ready = hasFuse && body.conditionalExtractUsed !== true && evac_available !== "none";
  return {
    variant,
    tension,
    focus,
    evac_available,
    bag_pressure,
    darkness,
    key_item,
    rig_loadout,
    spark_used,
    conditional_extract_ready
  };
}
__name(buildExperienceSignals, "buildExperienceSignals");
function buildUserPrompt(state, actionType, body, cards) {
  const fogCount = state.fog.filter((f) => !f).length;
  const signals = buildExperienceSignals(state, body);
  const signalsJson = JSON.stringify(signals, null, 0);
  const cardsJson = JSON.stringify(cards, null, 0);
  const cardsConstraint = cards.length > 0 ? `
\u3010\u672C\u56DE\u5408\u724C\u9762 cards\u3011\uFF08\u4F60\u5FC5\u987B\u539F\u6837\u4F7F\u7528\uFF0C\u4E0D\u5F97\u65B0\u589E\u6216\u5220\u9664\uFF09
${cardsJson}
\u89C4\u5219\uFF1A\u5982\u679C cards \u4E2D\u5305\u542B\u67D0 type\uFF0C\u5FC5\u987B\u5728 choices \u4E2D\u5448\u73B0\u5BF9\u5E94\u9009\u9879\uFF08\u6216 scene_blocks \u4E2D\u70B9\u660E\uFF09\uFF1B\u4E0D\u5F97\u65B0\u589E cards \u4E4B\u5916\u7684\u7279\u6B8A\u673A\u4F1A\uFF1B\u4E0D\u5F97\u5220\u9664 cards \u6307\u5B9A\u7684\u673A\u4F1A\u3002\u666E\u901A\u9009\u9879\u7167\u5E38\u5305\u88C5\uFF0C\u4E0D\u5F97\u91CD\u590D\u3002
- GAMBLE\uFF1A\u5FC5\u987B\u5E26 badge=\u5B64\u6CE8\u4E00\u63B7\uFF0Clabel\u226410\u5B57\u3002
- RARE_LOOT\uFF1A\u5FC5\u987B\u5E26 badge=\u7A00\u6709\u673A\u4F1A\uFF08\u6BCF\u5C40\u6700\u591A\u51FA\u73B0\u4E00\u6B21\u8BE5 badge\uFF09\u3002
- CONDITIONAL_EXTRACT\uFF1Alabel=\u300A\u6761\u4EF6\u64A4\u79BB\u300B\uFF0Cbadge=\u6761\u4EF6\u64A4\u79BB\uFF0Chint \u4E2D\u70B9\u660E\u6D88\u8017\u4FDD\u9669\u4E1D\u3002
- EXTRACT_PRESSURE\uFF1Ascene_blocks[0] \u6216\u8F7B\u63D0\u793A\u5FC5\u987B\u70B9\u660E\u300C\u64A4\u79BB\u7A97\u53E3\u51FA\u73B0\u3001\u8D8A\u62D6\u8D8A\u8D35\u300D\u3002
` : "";
  return `
\u4E0B\u9762\u7ED9\u51FA\u672C\u56DE\u5408\u5904\u5883\u4FE1\u53F7\uFF08json\uFF09\uFF0C\u4F60\u5FC5\u987B\u57FA\u4E8E\u8FD9\u4E9B\u4FE1\u53F7\u5199\u77ED\u4FC3\u56DE\u5408\u53D9\u4E8B\u4E0E\u9009\u9879\u5305\u88C5\uFF1B\u89C4\u5219\u4E0E\u6570\u503C\u7531\u5F15\u64CE\u51B3\u5B9A\uFF0C\u4F60\u4E0D\u8981\u53D1\u660E\u65B0\u89C4\u5219\u3002

\u3010\u5904\u5883\u4FE1\u53F7\u3011
${signalsJson}
${cardsConstraint}

\u3010\u56DE\u5408\u4E0A\u4E0B\u6587\u3011
chapter_id: 1
turn_index: ${state.turn_index} / ${MAX_TURNS}
milestone_turns: ${MILESTONES.join(",")}
objective: reach exit tile (safehouse)
action.type: ${actionType}
hp: ${state.hp}
exposure: ${state.exposure}
resources: water=${state.water}, food=${state.food}, fuel=${state.fuel}, med=${state.med}
bag.capacity: 8
bag.slots: ${state.bag.length}
grid: 9x9
player_pos: (${state.player_pos.x}, ${state.player_pos.y})
fog_summary: unknown=${fogCount} seen=${81 - fogCount}

\u3010\u6700\u8FD1\u65E5\u5FD7\u3011
${state.logs.slice(-5).join("\n")}
`.trim();
}
__name(buildUserPrompt, "buildUserPrompt");
function safetyFallbackResponse(state, reason) {
  return {
    scene_blocks: [{ type: "EVENT", content: "\u8FDE\u63A5\u5F02\u5E38\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002" }],
    choices: [
      {
        id: "fallback-retry",
        label: "\u5C1D\u8BD5\u7EE7\u7EED",
        hint: "\u4FE1\u53F7\u4E0D\u7A33\u5B9A",
        risk: "MID",
        preview_cost: {},
        action_type: "SILENCE"
      }
    ],
    ui: {
      progress: { turn_index: state.turn_index, milestones_hit: [] },
      map_delta: { reveal_indices: [], direction_hint: "NONE" },
      bag_delta: { add: [], remove: [] }
    },
    suggestion: { delta: {} },
    memory_update: "",
    safety_fallback: reason
  };
}
__name(safetyFallbackResponse, "safetyFallbackResponse");
function normalizeForFrontend(res) {
  return {
    ...res,
    scene_blocks: res.scene_blocks.map((b) => {
      const rec = b;
      const content = isString(rec.content) ? rec.content : isString(rec.text) ? rec.text : "";
      return { ...b, content, text: content };
    }),
    choices: res.choices.map((c) => {
      const rec = c;
      const actionType = isString(rec.action_type) ? rec.action_type : isString(rec.action) ? rec.action : "SILENCE";
      return { ...c, action_type: actionType, action: actionType };
    })
  };
}
__name(normalizeForFrontend, "normalizeForFrontend");
var MAX_LABEL_CHARS = 10;
var CARD_BADGES = /* @__PURE__ */ new Set(["\u5B64\u6CE8\u4E00\u63B7", "\u7A00\u6709\u673A\u4F1A", "\u6761\u4EF6\u64A4\u79BB", "\u66F4\u5371\u9669", "\u66F4\u7A33\uFF5C\u66F4\u8017\u7535"]);
function truncateLabel(s, max) {
  if (typeof s !== "string")
    return "";
  const t = s.trim();
  if (t.length <= max)
    return t;
  return t.slice(0, max);
}
__name(truncateLabel, "truncateLabel");
function patchChoicesForCards(res, cards) {
  const cardByType = new Map(cards.map((c) => [c.type, c]));
  const choices = res.choices.map((c) => {
    const rec = c;
    let label = isString(rec.label) ? rec.label : "";
    let badge = isString(rec.server_badge) ? rec.server_badge : isString(rec.badge) ? rec.badge : "";
    const cardForBadge = cards.find((card) => card.badge === badge);
    if (cardForBadge) {
      badge = cardForBadge.badge;
      label = truncateLabel(label, MAX_LABEL_CHARS);
    } else if (badge && !CARD_BADGES.has(badge)) {
      badge = "";
    }
    return { ...rec, label, server_badge: badge || void 0, badge: badge || void 0 };
  });
  const ids = new Set(choices.map((c) => c.id));
  if (cardByType.has("GAMBLE") && !ids.has("gamble-local")) {
    const card = cardByType.get("GAMBLE");
    choices.push({
      id: "gamble-local",
      label: truncateLabel("\u6478\u9ED1\u7FFB\u8FDB\u53BB\uFF08\u8D4C\u4E00\u628A\uFF09", MAX_LABEL_CHARS),
      hint: card.hint,
      risk: "HIGH",
      preview_cost: {},
      action_type: "SEARCH",
      server_badge: card.badge
    });
  }
  if (cardByType.has("CONDITIONAL_EXTRACT") && !ids.has("conditional-extract-local")) {
    const card = cardByType.get("CONDITIONAL_EXTRACT");
    choices.push({
      id: "conditional-extract-local",
      label: "\u300A\u6761\u4EF6\u64A4\u79BB\u300B",
      hint: "\u6D88\u8017\u4FDD\u9669\u4E1D\uFF0C\u6362\u66F4\u7A33\u7684\u51FA\u8DEF\u3002",
      risk: "LOW",
      preview_cost: {},
      action_type: "SEARCH",
      server_badge: card.badge
    });
  }
  if (cardByType.has("RARE_LOOT")) {
    const card = cardByType.get("RARE_LOOT");
    const hasRare = choices.some(
      (c) => c.server_badge === "\u7A00\u6709\u673A\u4F1A" || c.badge === "\u7A00\u6709\u673A\u4F1A"
    );
    if (!hasRare) {
      const win = card.payload?.window ?? "w1";
      choices.push({
        id: `rare-loot-${win}`,
        label: "\u7A00\u6709\u673A\u4F1A\u62FE\u53D6",
        hint: card.hint,
        risk: "MID",
        preview_cost: {},
        action_type: "SEARCH",
        server_badge: card.badge
      });
    }
  }
  let scene_blocks = res.scene_blocks;
  if (cardByType.has("EXTRACT_PRESSURE")) {
    const first = scene_blocks[0];
    const content = isString(first?.content) ? first.content : "";
    if (content && !content.includes("\u64A4\u79BB") && !content.includes("\u8D8A\u62D6")) {
      scene_blocks = [
        { ...first, content: content.trimEnd() + " \u64A4\u79BB\u7A97\u53E3\u5DF2\u51FA\u73B0\uFF0C\u8D8A\u62D6\u4EE3\u4EF7\u8D8A\u9AD8\u3002" },
        ...scene_blocks.slice(1)
      ];
    }
  }
  return {
    ...res,
    scene_blocks,
    choices
  };
}
__name(patchChoicesForCards, "patchChoicesForCards");
async function callDeepSeek(apiKey, systemPrompt, userPrompt) {
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1600,
      temperature: 0.7,
      presence_penalty: 0.2,
      frequency_penalty: 0.3
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${err}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content)
    throw new Error("DeepSeek returned empty content");
  return content;
}
__name(callDeepSeek, "callDeepSeek");
var onRequestPost = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const state = body.state;
  const actionType = resolveAction(body);
  if (!state || !isObject(state)) {
    return new Response(JSON.stringify({ error: "Missing or invalid state" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const runId = isString(body.runId) ? body.runId : state.runId;
  const clientTurnIndex = typeof body.clientTurnIndex === "number" ? body.clientTurnIndex : state.turn_index;
  const slice = buildStableStateSlice(state, body);
  const balanceProfile = parseBalanceProfile(
    request.headers.get("X-Balance-Profile"),
    new URL(request.url || "", "http://localhost").searchParams.get("balance")
  );
  const turnKey = runId ? await computeTurnKey(runId, clientTurnIndex, actionType, slice) : "";
  const cacheStorage = typeof caches !== "undefined" ? caches : null;
  const cacheAvailable = !!cacheStorage?.default && balanceProfile === "prod";
  const cacheRequest = turnKey && request.url ? new Request(new URL(`/api/turn?turnKey=${turnKey}`, request.url).href, { method: "GET" }) : null;
  if (cacheAvailable && cacheRequest && cacheStorage) {
    const cached = await cacheStorage.default.match(cacheRequest);
    if (cached) {
      const res = new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: new Headers(cached.headers)
      });
      res.headers.set("X-Turn-Cache", "HIT");
      res.headers.set("X-Turn-Key", turnKey.slice(0, 12));
      res.headers.set("X-Balance-Profile", balanceProfile);
      return res;
    }
  }
  const cards_used = parseCardsUsed(state, body);
  const cardsInput = {
    turn_index: state.turn_index,
    variantId: slice.variantId,
    evac_available: slice.evacAvailable,
    darkness: slice.darkness,
    bag_len: state.bag.length,
    has_fuse: state.bag.some(
      (b) => isObject(b) && b.name === "\u4FDD\u9669\u4E1D"
    ),
    runId: runId ?? "",
    cards_used
  };
  const cards = getPlayabilityCards(cardsInput, balanceProfile);
  const userPrompt = buildUserPrompt(state, actionType, body, cards);
  const tryOnce = /* @__PURE__ */ __name(async () => {
    try {
      const raw = await callDeepSeek(apiKey, SYSTEM_INSTRUCTION, userPrompt);
      const parsed = JSON.parse(raw);
      if (validateTurnResponse(parsed))
        return { ok: true, data: parsed };
      return { ok: false, reason: "validate fail" };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const deepseekMatch = err.match(/DeepSeek API (\d+)/);
      if (deepseekMatch)
        return { ok: false, reason: `deepseek ${deepseekMatch[1]}` };
      return { ok: false, reason: "parse fail" };
    }
  }, "tryOnce");
  let attempt = await tryOnce();
  if (!attempt.ok)
    attempt = await tryOnce();
  const result = attempt.ok ? attempt.data : safetyFallbackResponse(state, attempt.reason);
  let normalized = normalizeForFrontend(result);
  if (cards.length > 0)
    normalized = patchChoicesForCards(normalized, cards);
  const payload = {
    ...normalized,
    meta: { cards: cards.map((c) => c.type) }
  };
  const isFallback = !attempt.ok;
  const maxAge = isFallback ? CACHE_MAX_AGE_FALLBACK : CACHE_MAX_AGE_NORMAL;
  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Turn-Cache": "MISS",
      "X-Turn-Key": turnKey.slice(0, 12),
      "X-Balance-Profile": balanceProfile,
      "X-Cards": cards.map((c) => c.type).join(",") || "-",
      "Cache-Control": `public, max-age=${maxAge}`
    }
  });
  if (cacheAvailable && cacheRequest && cacheStorage) {
    try {
      await cacheStorage.default.put(cacheRequest, response.clone());
    } catch {
    }
  }
  return response;
}, "onRequestPost");

// ../.wrangler/tmp/pages-ryf76X/functionsRoutes-0.8096454220199168.mjs
var routes = [
  {
    routePath: "/api/turn",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  }
];

// ../node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: () => {
            isFailOpen = true;
          }
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-vIoqlU/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-vIoqlU/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.5049362963526826.mjs.map
