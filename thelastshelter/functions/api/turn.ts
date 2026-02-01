/**
 * Cloudflare Pages Function: POST /api/turn
 * Calls DeepSeek OpenAI-compatible API, enforces JSON mode, validates TurnResponse.
 * Playability cards (GAMBLE/RARE_LOOT/CONDITIONAL_EXTRACT/EXTRACT_PRESSURE) are deterministic server-side.
 * DEEPSEEK_API_KEY must be set in Cloudflare dashboard (never exposed to frontend).
 */

import {
  getPlayabilityCards,
  parseCardsUsed,
  type PlayabilityCard,
  type CardsUsed,
} from "../game/playabilityCards";
import { parseBalanceProfile, type BalanceProfile } from "../game/balanceConfig";

type PagesFunction<E = unknown> = (ctx: {
  request: Request;
  env: E;
  params?: Record<string, string>;
  data?: unknown;
  next?: () => Promise<Response>;
}) => Promise<Response> | Response;

const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const MAX_TURNS = 16;
const MILESTONES = [5, 10, 15];
const CACHE_MAX_AGE_NORMAL = 3600;
const CACHE_MAX_AGE_FALLBACK = 30;

/** 槽位化 system prompt：短、硬、围绕决策与收益差量；输出 json。 */
const SYSTEM_INSTRUCTION = `你是一个"末日生存文字冒险"的回合叙事与选项生成器。你输出的是 json（严格 JSON，符合下述 schema），不要任何非 JSON 的前后缀。

极简 JSON 骨架示例：
{"scene_blocks":[{"type":"EVENT","content":"短句"}],"choices":[{"id":"","label":"","hint":"","risk":"LOW","preview_cost":{},"action_type":""}],"ui":{"progress":{"turn_index":0,"milestones_hit":[]},"map_delta":{"reveal_indices":[],"direction_hint":"NONE"},"bag_delta":{"add":[],"remove":[]}},"suggestion":{"delta":{}},"memory_update":""}

硬性规约：
1) scene_blocks[0].content：最多 2 段，每段 ≤40 字；只写"局势+结果倾向"，不要长铺陈。若处于黑暗模式/撤离窗口/背包满压，必须在第一段用一句话点明（不讲概率、不讲精确数值）。
2) choices：每条 label ≤10 个汉字；不得同义重复，必须体现不同策略（省电/搜索/撤离/赌/保命）；不出现英文缩写（HP、电量等用中文）。
3) 叙事必须服务闭环：探索迷雾→背包取舍→电量压力→撤离抉择→结算带出。规则与数值由引擎决定，你只负责包装。
4) direction_hint 必须为 NONE/N/NE/E/SE/S/SW/W/NW 之一；risk 为 LOW/MID/HIGH。

TurnResponse schema（严格遵循，输出合法 JSON）：
{
  "scene_blocks": [{"type":"TITLE"|"EVENT"|"RESULT"|"AFTERTASTE","content":"string"}],
  "choices": [{"id":"string","label":"string","hint":"string","risk":"LOW"|"MID"|"HIGH","preview_cost":{},"action_type":"string"}],
  "ui": {"progress":{"turn_index":number,"milestones_hit":number[]},"map_delta":{"reveal_indices":number[],"direction_hint":"NONE"|"N"|…},"bag_delta":{"add":[],"remove":[]}},
  "suggestion":{"delta":{}},
  "memory_update":"string"
}`;

interface Env {
  DEEPSEEK_API_KEY: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

const SCENE_TYPES = ["TITLE", "EVENT", "RESULT", "AFTERTASTE"];
const RISK_LEVELS = ["LOW", "MID", "HIGH"];
const DIRECTION_HINTS = ["NONE", "N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function validateTurnResponse(data: unknown): data is TurnResponse {
  if (!isObject(data)) return false;
  if (!isArray(data.scene_blocks)) return false;
  for (const b of data.scene_blocks) {
    if (!isObject(b) || !SCENE_TYPES.includes(b.type as string) || !isString(b.content)) return false;
  }
  if (!isArray(data.choices)) return false;
  for (const c of data.choices) {
    if (!isObject(c) || !isString(c.id) || !isString(c.label) || !isString(c.hint) || !RISK_LEVELS.includes(c.risk as string) || !isObject(c.preview_cost) || !isString(c.action_type)) return false;
  }
  if (!isObject(data.ui)) return false;
  const ui = data.ui as Record<string, unknown>;
  if (!isObject(ui.progress) || !isNumber((ui.progress as Record<string, unknown>).turn_index) || !isArray((ui.progress as Record<string, unknown>).milestones_hit)) return false;
  if (!isObject(ui.map_delta) || !isArray((ui.map_delta as Record<string, unknown>).reveal_indices) || !DIRECTION_HINTS.includes((ui.map_delta as Record<string, unknown>).direction_hint as string)) return false;
  if (!isObject(ui.bag_delta)) return false;
  const bd = ui.bag_delta as Record<string, unknown>;
  if (!isArray(bd.add) || !isArray(bd.remove)) return false;
  for (const a of bd.add as unknown[]) {
    if (!isObject(a) || !isString((a as Record<string, unknown>).id) || !isString((a as Record<string, unknown>).name) || !isString((a as Record<string, unknown>).type)) return false;
  }
  if (!isObject(data.suggestion) || !isObject((data.suggestion as Record<string, unknown>).delta)) return false;
  if (!isString(data.memory_update)) return false;
  return true;
}

interface TurnResponse {
  scene_blocks: Array<{ type: string; content: string }>;
  choices: Array<Record<string, unknown>>;
  ui: {
    progress: { turn_index: number; milestones_hit: number[] };
    map_delta: { reveal_indices: number[]; direction_hint: string };
    bag_delta: { add: Array<{ id: string; name: string; type: string }>; remove: string[] };
  };
  suggestion: { delta: Record<string, unknown> };
  memory_update: string;
  safety_fallback?: string;
}

/** body.action 为 string 用其值；为 object 且有 type 用 body.action.type；否则尝试 actionType / choiceId / choice_id；缺省 INIT。 */
function resolveAction(body: Record<string, unknown>): string {
  const a = body.action;
  if (isString(a)) return a;
  if (isObject(a) && isString(a.type)) return a.type as string;
  if (isString(body.actionType)) return body.actionType as string;
  if (isString(body.choiceId)) return body.choiceId as string;
  if (isString(body.choice_id)) return body.choice_id as string;
  return "INIT";
}

/** 用于 turnKey 的稳定状态切片（只含影响叙事/选项的字段，强一致可复现）。 */
interface StableStateSlice {
  variantId: string;
  turn_index: number;
  hp: number;
  battery: number;
  exposure: number;
  status: string;
  bagNames: string[];
  darkness: "none" | "soon" | "in_dark";
  evacAvailable: string;
  conditionalExtractUsed: boolean;
  sparkUsed: boolean;
  rewardWindowTriggered?: boolean;
  gambleTriggered?: boolean;
  cards_used?: CardsUsed;
}

function buildStableStateSlice(state: GameState, body: Record<string, unknown>): StableStateSlice {
  const s = state as unknown as Record<string, unknown>;
  const bag = (state.bag as unknown[]) ?? [];
  const bagNames = bag.map((b) => (isObject(b) && isString((b as Record<string, unknown>).name) ? (b as Record<string, unknown>).name as string : "")).filter(Boolean);
  const battery = typeof s.battery === "number" ? s.battery : 0;
  const variantId = (isString(body.variantId) ? body.variantId : isString(s.variantId) ? s.variantId : "night") as string;
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
    evacAvailable: (isString(body.evacAvailable) ? body.evacAvailable : "none") as string,
    conditionalExtractUsed: body.conditionalExtractUsed === true,
    sparkUsed: body.sparkUsed === true,
    rewardWindowTriggered: body.rewardWindowTriggered === true,
    gambleTriggered: body.gambleTriggered === true,
    cards_used: Object.keys(cards_used).length > 0 ? cards_used : undefined,
  };
}

/** 强一致、可复现的 turnKey：SHA-256(runId + clientTurnIndex + action + stableStateSlice) 取 hex。 */
async function computeTurnKey(
  runId: string,
  clientTurnIndex: number,
  action: string,
  slice: StableStateSlice
): Promise<string> {
  const payload = JSON.stringify({ runId, clientTurnIndex, action, slice });
  const buf = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const arr = new Uint8Array(hash);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/** 引擎权威的处境信号（服务端从 state 计算，不靠模型推断）。 */
interface ExperienceSignals {
  variant: string;
  tension: string;
  focus: string;
  evac_available: string;
  bag_pressure: string;
  darkness: string;
  key_item: string;
  rig_loadout: string;
  spark_used: boolean;
  conditional_extract_ready: boolean;
}

function buildExperienceSignals(state: GameState, body: Record<string, unknown>): ExperienceSignals {
  const s = state as unknown as Record<string, unknown>;
  const battery = typeof s.battery === "number" ? s.battery : 0;
  const variantId = (isString(body.variantId) ? body.variantId : isString(s.variantId) ? s.variantId : "night") as string;
  const bag = (state.bag as unknown[]) ?? [];
  const bagLen = bag.length;
  const hasFuse = bag.some((b) => isObject(b) && (b as Record<string, unknown>).name === "保险丝");
  const variant = variantId === "battery_crisis" ? "电量危机" : "夜行";
  const tension =
    state.turn_index >= 14 ? "临界" : state.turn_index >= 10 ? "危险" : state.turn_index >= 5 ? "升温" : "平稳";
  const focus =
    battery <= 0 ? "保命" : battery <= 2 ? "电量" : bagLen >= 8 ? "背包" : body.evacAvailable ? "撤离" : "探索";
  const evac_available = (isString(body.evacAvailable) ? body.evacAvailable : "none") as string;
  const bag_pressure = bagLen >= 8 ? "full" : bagLen >= 5 ? "high" : "low";
  const darkness = battery <= 0 ? "in_dark" : battery <= 2 ? "soon" : "none";
  const key_item = hasFuse ? "有保险丝" : "无";
  const rig_loadout = body.rigLoadout === "SPARK" ? "应急火花" : "续航";
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
    conditional_extract_ready,
  };
}

function buildUserPrompt(
  state: GameState,
  actionType: string,
  body: Record<string, unknown>,
  cards: PlayabilityCard[]
): string {
  const fogCount = (state.fog as boolean[]).filter((f) => !f).length;
  const signals = buildExperienceSignals(state, body);
  const signalsJson = JSON.stringify(signals, null, 0);
  const cardsJson = JSON.stringify(cards, null, 0);
  const cardsConstraint = cards.length > 0
    ? `
【本回合牌面 cards】（你必须原样使用，不得新增或删除）
${cardsJson}
规则：如果 cards 中包含某 type，必须在 choices 中呈现对应选项（或 scene_blocks 中点明）；不得新增 cards 之外的特殊机会；不得删除 cards 指定的机会。普通选项照常包装，不得重复。
- GAMBLE：必须带 badge=孤注一掷，label≤10字。
- RARE_LOOT：必须带 badge=稀有机会（每局最多出现一次该 badge）。
- CONDITIONAL_EXTRACT：label=《条件撤离》，badge=条件撤离，hint 中点明消耗保险丝。
- EXTRACT_PRESSURE：scene_blocks[0] 或轻提示必须点明「撤离窗口出现、越拖越贵」。
`
    : "";
  return `
下面给出本回合处境信号（json），你必须基于这些信号写短促回合叙事与选项包装；规则与数值由引擎决定，你不要发明新规则。

【处境信号】
${signalsJson}
${cardsConstraint}

【回合上下文】
chapter_id: 1
turn_index: ${state.turn_index} / ${MAX_TURNS}
milestone_turns: ${MILESTONES.join(",")}
objective: reach exit tile (safehouse)
action.type: ${actionType}
hp: ${state.hp}
exposure: ${state.exposure}
resources: water=${state.water}, food=${state.food}, fuel=${state.fuel}, med=${state.med}
bag.capacity: 8
bag.slots: ${(state.bag as unknown[]).length}
grid: 9x9
player_pos: (${(state.player_pos as { x: number; y: number }).x}, ${(state.player_pos as { x: number; y: number }).y})
fog_summary: unknown=${fogCount} seen=${81 - fogCount}

【最近日志】
${(state.logs as string[]).slice(-5).join("\n")}
`.trim();
}

interface GameState {
  hp: number;
  exposure: number;
  water: number;
  food: number;
  fuel: number;
  med: number;
  turn_index: number;
  player_pos: { x: number; y: number };
  exit_pos: { x: number; y: number };
  bag: unknown[];
  fog: unknown[];
  grid_type: unknown[];
  status: string;
  logs: string[];
  history: string[];
}

function safetyFallbackResponse(state: GameState, reason: string): TurnResponse {
  return {
    scene_blocks: [{ type: "EVENT", content: "连接异常，请稍后再试。" }],
    choices: [
      {
        id: "fallback-retry",
        label: "尝试继续",
        hint: "信号不稳定",
        risk: "MID",
        preview_cost: {},
        action_type: "SILENCE",
      },
    ],
    ui: {
      progress: { turn_index: state.turn_index, milestones_hit: [] },
      map_delta: { reveal_indices: [], direction_hint: "NONE" },
      bag_delta: { add: [], remove: [] },
    },
    suggestion: { delta: {} },
    memory_update: "",
    safety_fallback: reason,
  };
}

/** 校验通过后再做：scene_blocks 同时带 content 与 text（有其一则补齐另一）；choices 同时带 action_type 与 action（缺省 SILENCE）。 */
function normalizeForFrontend(res: TurnResponse): TurnResponse {
  return {
    ...res,
    scene_blocks: res.scene_blocks.map((b) => {
      const rec = b as Record<string, unknown>;
      const content = (isString(rec.content) ? rec.content : isString(rec.text) ? rec.text : "") as string;
      return { ...b, content, text: content };
    }),
    choices: res.choices.map((c) => {
      const rec = c as Record<string, unknown>;
      const actionType = (isString(rec.action_type) ? rec.action_type : isString(rec.action) ? rec.action : "SILENCE") as string;
      return { ...c, action_type: actionType, action: actionType };
    }),
  };
}

const MAX_LABEL_CHARS = 10;
const CARD_BADGES = new Set(["孤注一掷", "稀有机会", "条件撤离", "更危险", "更稳｜更耗电"]);

/** 中文安全截断到最多 max 字（不截断中间汉字）。 */
function truncateLabel(s: string, max: number): string {
  if (typeof s !== "string") return "";
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

/** 牌面落地：补缺 choice、修正 badge、截断 label、移除非牌面 badge。 */
function patchChoicesForCards(res: TurnResponse, cards: PlayabilityCard[]): TurnResponse {
  const cardByType = new Map(cards.map((c) => [c.type, c]));
  const choices = res.choices.map((c) => {
    const rec = c as Record<string, unknown>;
    let label: string = isString(rec.label) ? rec.label : "";
    let badge: string = isString(rec.server_badge) ? rec.server_badge : isString(rec.badge) ? rec.badge : "";
    const cardForBadge = cards.find((card) => card.badge === badge);
    if (cardForBadge) {
      badge = cardForBadge.badge;
      label = truncateLabel(label, MAX_LABEL_CHARS);
    } else if (badge && !CARD_BADGES.has(badge)) {
      badge = "";
    }
    return { ...rec, label, server_badge: badge || undefined, badge: badge || undefined } as Record<string, unknown>;
  });

  const ids = new Set(choices.map((c) => (c as Record<string, unknown>).id as string));

  if (cardByType.has("GAMBLE") && !ids.has("gamble-local")) {
    const card = cardByType.get("GAMBLE")!;
    (choices as Record<string, unknown>[]).push({
      id: "gamble-local",
      label: truncateLabel("摸黑翻进去（赌一把）", MAX_LABEL_CHARS),
      hint: card.hint,
      risk: "HIGH",
      preview_cost: {},
      action_type: "SEARCH",
      server_badge: card.badge,
    });
  }
  if (cardByType.has("CONDITIONAL_EXTRACT") && !ids.has("conditional-extract-local")) {
    const card = cardByType.get("CONDITIONAL_EXTRACT")!;
    (choices as Record<string, unknown>[]).push({
      id: "conditional-extract-local",
      label: "《条件撤离》",
      hint: "消耗保险丝，换更稳的出路。",
      risk: "LOW",
      preview_cost: {},
      action_type: "SEARCH",
      server_badge: card.badge,
    });
  }
  if (cardByType.has("RARE_LOOT")) {
    const card = cardByType.get("RARE_LOOT")!;
    const hasRare = choices.some(
      (c) => (c as Record<string, unknown>).server_badge === "稀有机会" || (c as Record<string, unknown>).badge === "稀有机会"
    );
    if (!hasRare) {
      const win = (card.payload?.window as string) ?? "w1";
      (choices as Record<string, unknown>[]).push({
        id: `rare-loot-${win}`,
        label: "稀有机会拾取",
        hint: card.hint,
        risk: "MID",
        preview_cost: {},
        action_type: "SEARCH",
        server_badge: card.badge,
      });
    }
  }

  let scene_blocks = res.scene_blocks;
  if (cardByType.has("EXTRACT_PRESSURE")) {
    const first = scene_blocks[0] as Record<string, unknown> | undefined;
    const content = (isString(first?.content) ? first.content : "") as string;
    if (content && !content.includes("撤离") && !content.includes("越拖")) {
      scene_blocks = [
        { ...first, content: content.trimEnd() + " 撤离窗口已出现，越拖代价越高。" },
        ...scene_blocks.slice(1),
      ] as TurnResponse["scene_blocks"];
    }
  }

  return {
    ...res,
    scene_blocks,
    choices,
  };
}

async function callDeepSeek(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1600,
      temperature: 0.7,
      presence_penalty: 0.2,
      frequency_penalty: 0.3,
    }),
  });
  if (!res.ok) {
    const err = (await res.text()).slice(0, 200);
    throw new Error(`DeepSeek ${res.status}: ${err}`);
    
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek returned empty content");
  return content;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const apiKey = (env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const state = body.state as GameState | undefined;
  const actionType = resolveAction(body);
  if (!state || !isObject(state)) {
    return new Response(JSON.stringify({ error: "Missing or invalid state" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runId = (isString(body.runId) ? body.runId : (state as unknown as Record<string, unknown>).runId) as string | undefined;
  const clientTurnIndex = typeof body.clientTurnIndex === "number" ? body.clientTurnIndex : state.turn_index;
  const slice = buildStableStateSlice(state, body);
  const balanceProfile: BalanceProfile = parseBalanceProfile(
    request.headers.get("X-Balance-Profile"),
    new URL(request.url || "", "http://localhost").searchParams.get("balance")
  );
  const turnKey = runId
    ? await computeTurnKey(runId, clientTurnIndex, actionType, slice)
    : "";

  const cacheStorage = typeof caches !== "undefined" ? (caches as { default?: Cache }) : null;
  const cacheAvailable = !!cacheStorage?.default && balanceProfile === "prod";
  const cacheRequest =
    turnKey && request.url
      ? new Request(new URL(`/api/turn?turnKey=${turnKey}`, request.url).href, { method: "GET" })
      : null;

  if (cacheAvailable && cacheRequest && cacheStorage) {
    const cached = await cacheStorage.default!.match(cacheRequest);
    if (cached) {
      const res = new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: new Headers(cached.headers),
      });
      res.headers.set("X-Turn-Cache", "HIT");
      res.headers.set("X-Turn-Key", turnKey.slice(0, 12));
      res.headers.set("X-Balance-Profile", balanceProfile);
      return res;
    }
  }

  const cards_used = parseCardsUsed(state as unknown as Record<string, unknown>, body);
  const cardsInput = {
    turn_index: state.turn_index,
    variantId: slice.variantId,
    evac_available: slice.evacAvailable,
    darkness: slice.darkness,
    bag_len: (state.bag as unknown[]).length,
    has_fuse: (state.bag as unknown[]).some(
      (b) => isObject(b) && (b as Record<string, unknown>).name === "保险丝"
    ),
    runId: runId ?? "",
    cards_used,
  };
  const cards = getPlayabilityCards(cardsInput, balanceProfile);
  const userPrompt = buildUserPrompt(state, actionType, body, cards);
  const tryOnce = async (): Promise<{ ok: true; data: TurnResponse } | { ok: false; reason: string }> => {
    try {
      const raw = await callDeepSeek(apiKey, SYSTEM_INSTRUCTION, userPrompt);
      const parsed = JSON.parse(raw) as unknown;
      if (validateTurnResponse(parsed)) return { ok: true, data: parsed as TurnResponse };
      return { ok: false, reason: "validate fail" };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      if (err.startsWith("DeepSeek ")) return { ok: false, reason: err };
      return { ok: false, reason: "parse fail" };
    }
  };

  let attempt = await tryOnce();
  if (!attempt.ok) attempt = await tryOnce();
  const result = attempt.ok
    ? attempt.data
    : safetyFallbackResponse(state, (attempt as { ok: false; reason: string }).reason);
  let normalized = normalizeForFrontend(result);
  if (cards.length > 0) normalized = patchChoicesForCards(normalized, cards);
  const payload = {
    ...normalized,
    meta: { cards: cards.map((c) => c.type) },
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
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });

  if (cacheAvailable && cacheRequest && cacheStorage) {
    try {
      await cacheStorage.default!.put(cacheRequest, response.clone());
    } catch {
      /* ignore cache write failure */
    }
  }

  return response;
};
