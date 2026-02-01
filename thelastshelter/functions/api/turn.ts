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
const DEEPSEEK_TIMEOUT_MS = 8000;
const MAX_TURNS = 16;
const MILESTONES = [5, 10, 15];
const CACHE_MAX_AGE_NORMAL = 3600;
const CACHE_MAX_AGE_FALLBACK = 30;

export type FailReason = "DEEPSEEK_TIMEOUT" | "DEEPSEEK_HTTP" | "DEEPSEEK_PARSE" | "INTERNAL";

const DEFAULT_PROMPT_PROFILE = "fast";

/** FAST 硬规约：主屏 1 段 ≤28字，可选补充 ≤20字，最多 3 选项、每 label ≤10 字；输出 json，突出决策与收益。 */
const FAST_SYSTEM_INSTRUCTION = `你是末日生存文字冒险的回合生成器。输出必须是合法 json，不要任何非 json 前后缀。

最小 json 骨架：
{"scene_blocks":[{"type":"EVENT","content":""}],"choices":[{"id":"","label":"","hint":"","risk":"LOW","preview_cost":{},"action_type":""}],"ui":{"progress":{"turn_index":0,"milestones_hit":[]},"map_delta":{"reveal_indices":[],"direction_hint":"NONE"},"bag_delta":{"add":[],"remove":[]}},"suggestion":{"delta":{}},"memory_update":""}

FAST 硬规约（短槽位，必须遵守）：
1) scene_blocks[0].content：一段，≤28 字，只写「局势+结果倾向」。必须点明本回合关键矛盾（电量/背包/撤离/黑暗之一）。不写长篇、不写世界观、不写对话。
2) scene_blocks[1]（可选）：仅当以下任一成立时出现，且 ≤20 字：黑暗模式、撤离窗口出现、稀有机会/孤注一掷/条件撤离（牌面）。否则只输出 1 条 scene_blocks。
3) choices：最多 3 条；每条 label ≤10 个汉字；策略差异明显（省电/搜索/撤离/赌/保命）；不得同义重复。
4) direction_hint 为 NONE/N/NE/E/SE/S/SW/W/NW 之一；risk 为 LOW/MID/HIGH。
5) 规则与数值由引擎决定，你只包装短文案。`;

/** 兼容旧版：较长槽位。 */
const SYSTEM_INSTRUCTION_LEGACY = `你是一个"末日生存文字冒险"的回合叙事与选项生成器。你输出的是 json（严格 JSON，符合下述 schema），不要任何非 JSON 的前后缀。

极简 JSON 骨架示例：
{"scene_blocks":[{"type":"EVENT","content":"短句"}],"choices":[{"id":"","label":"","hint":"","risk":"LOW","preview_cost":{},"action_type":""}],"ui":{"progress":{"turn_index":0,"milestones_hit":[]},"map_delta":{"reveal_indices":[],"direction_hint":"NONE"},"bag_delta":{"add":[],"remove":[]}},"suggestion":{"delta":{}},"memory_update":""}

硬性规约：
1) scene_blocks[0].content：最多 2 段，每段 ≤40 字；只写"局势+结果倾向"。
2) choices：每条 label ≤10 个汉字；不得同义重复，必须体现不同策略（省电/搜索/撤离/赌/保命）。
3) direction_hint 必须为 NONE/N/NE/E/SE/S/SW/W/NW 之一；risk 为 LOW/MID/HIGH。

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
  TURN_PROMPT_PROFILE?: string;
}

function getPromptProfile(env: Env): string {
  const v = (env as unknown as Record<string, unknown>).TURN_PROMPT_PROFILE;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : DEFAULT_PROMPT_PROFILE;
}

function getSystemInstruction(profile: string): string {
  return profile === "fast" ? FAST_SYSTEM_INSTRUCTION : SYSTEM_INSTRUCTION_LEGACY;
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
  cards: PlayabilityCard[],
  profile: string
): string {
  const signals = buildExperienceSignals(state, body);
  const signalsJson = JSON.stringify(signals, null, 0);
  const cardsJson = JSON.stringify(cards, null, 0);
  const cardsConstraint = cards.length > 0
    ? `
【本回合牌面 cards】（你必须原样使用，不得新增或删除）
${cardsJson}
规则：cards 中某 type 必须在 choices 中呈现对应选项或 scene_blocks 中点明。GAMBLE=孤注一掷；RARE_LOOT=稀有机会；CONDITIONAL_EXTRACT=《条件撤离》消耗保险丝；EXTRACT_PRESSURE=点明撤离窗口越拖越贵。
`
    : "";

  if (profile === "fast") {
    const lastSummary =
      (typeof body.lastSummary === "string" && (body.lastSummary as string).trim().length <= 20
        ? (body.lastSummary as string).trim()
        : "") || "";
    return `【experience_signals】
${signalsJson}
${cardsConstraint}
turn_index: ${state.turn_index} / ${MAX_TURNS}
action.type: ${actionType}
${lastSummary ? `last_result: ${lastSummary}` : ""}`.trim();
  }

  const fogCount = (state.fog as boolean[]).filter((f) => !f).length;
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

【最近局势】（仅 1 条，供模型参考）
${(Array.isArray(state.logs) ? (state.logs as string[]).slice(-1)[0] : "") ?? ""}
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

/** 可玩的降级回合：短提示 + 2–3 个基础选项（移动/谨慎搜索/撤离若可用）。 */
function safetyFallbackResponse(state: GameState, _reason: string, body: Record<string, unknown>): TurnResponse {
  const evacAvailable = (isString(body.evacAvailable) ? body.evacAvailable : "none") as string;
  const hasEvac = evacAvailable !== "none" && evacAvailable !== "";
  const choices: Array<Record<string, unknown>> = [
    { id: "fallback-move", label: "向安全方向移动", hint: "省电前进", risk: "LOW", preview_cost: {}, action_type: "MOVE_N" },
    { id: "fallback-search", label: "谨慎搜索", hint: "耗电探查", risk: "MID", preview_cost: {}, action_type: "SEARCH" },
  ];
  if (hasEvac) {
    choices.push({ id: "fallback-extract", label: "撤离-近", hint: "尽快脱离", risk: "LOW", preview_cost: {}, action_type: "SILENCE" });
  }
  return {
    scene_blocks: [{ type: "EVENT", content: "通讯不稳，你凭经验摸索前进。" }],
    choices,
    ui: {
      progress: { turn_index: state.turn_index, milestones_hit: [] },
      map_delta: { reveal_indices: [], direction_hint: "NONE" },
      bag_delta: { add: [], remove: [] },
    },
    suggestion: { delta: {} },
    memory_update: "",
    safety_fallback: _reason,
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

const FAST_SCENE_BLOCK0_MAX = 28;
const FAST_SCENE_BLOCK1_MAX = 20;
const FAST_CHOICES_MAX = 3;
const FAST_LABEL_MAX = 10;

/** 按句号/逗号尽量不截断词地截断到 max 字。 */
function truncateContentTo(s: string, max: number): string {
  if (typeof s !== "string") return "";
  const t = s.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const lastComma = head.lastIndexOf("，");
  const lastPeriod = head.lastIndexOf("。");
  const cut = Math.max(lastComma, lastPeriod);
  if (cut > max * 0.5) return head.slice(0, cut + 1);
  return head;
}

/** FAST 输出长度收口：scene_blocks 最多 2 条、首条 ≤28 字；choices 最多 3、label ≤10。 */
function applyFastLengthGuard(data: TurnResponse, cards: PlayabilityCard[]): TurnResponse {
  let scene_blocks = data.scene_blocks.slice(0, 2);
  if (scene_blocks.length > 0) {
    const b0 = scene_blocks[0] as Record<string, unknown>;
    const c0 = (isString(b0.content) ? b0.content : isString(b0.text) ? b0.text : "") as string;
    const firstTrunc = truncateContentTo(c0, FAST_SCENE_BLOCK0_MAX);
    const firstBlock: TurnResponse["scene_blocks"][0] = { ...scene_blocks[0], content: firstTrunc };
    const rest = scene_blocks.slice(1).map((b) => {
      const rec = b as Record<string, unknown>;
      const c = (isString(rec.content) ? rec.content : isString(rec.text) ? rec.text : "") as string;
      return { ...b, content: truncateContentTo(c, FAST_SCENE_BLOCK1_MAX) } as TurnResponse["scene_blocks"][0];
    });
    scene_blocks = [firstBlock, ...rest];
  }
  let choices = data.choices.slice(0, FAST_CHOICES_MAX);
  const evacOrCard = (c: Record<string, unknown>) => {
    const label = (c.label as string) ?? "";
    return (
      label.includes("撤离") ||
      label.includes("条件") ||
      (c.server_badge as string)?.length > 0 ||
      (c.badge as string)?.length > 0
    );
  };
  if (choices.length > FAST_CHOICES_MAX) {
    const priority = choices.filter((c) => evacOrCard(c as Record<string, unknown>));
    const rest = choices.filter((c) => !evacOrCard(c as Record<string, unknown>));
    choices = [...priority, ...rest].slice(0, FAST_CHOICES_MAX);
  }
  choices = choices.map((c) => {
    const rec = c as Record<string, unknown>;
    const label = truncateLabel((rec.label as string) ?? "", FAST_LABEL_MAX);
    return { ...rec, label };
  }) as TurnResponse["choices"];
  return { ...data, scene_blocks, choices };
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

const FAST_MAX_TOKENS = 700;
const LEGACY_MAX_TOKENS = 1600;

async function callDeepSeek(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { signal?: AbortSignal; max_tokens?: number }
): Promise<string> {
  const { signal, max_tokens = LEGACY_MAX_TOKENS } = opts;
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
      max_tokens,
      temperature: 0.7,
      presence_penalty: 0.2,
      frequency_penalty: 0.3,
    }),
    signal,
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
  const metaIn = body.meta as Record<string, unknown> | undefined;
  const clientTurnIndex =
    typeof body.clientTurnIndex === "number"
      ? body.clientTurnIndex
      : typeof metaIn?.clientTurnIndex === "number"
        ? metaIn.clientTurnIndex
        : typeof state.turn_index === "number"
          ? state.turn_index
          : 0;
  const slice = buildStableStateSlice(state, body);
  const balanceProfile: BalanceProfile = parseBalanceProfile(
    request.headers.get("X-Balance-Profile"),
    new URL(request.url || "", "http://localhost").searchParams.get("balance")
  );
  const promptProfile = getPromptProfile(env as Env);
  const turnKey = runId
    ? await computeTurnKey(runId, clientTurnIndex, actionType, slice)
    : "";

  const cacheStorage = typeof caches !== "undefined" ? (caches as { default?: Cache }) : null;
  const cacheAvailable = !!cacheStorage?.default && balanceProfile === "prod";
  const cacheRequest =
    turnKey && request.url
      ? new Request(new URL(`/api/turn?turnKey=${turnKey}`, request.url).href, { method: "GET" })
      : null;

  const serverTurnIndex = clientTurnIndex + 1;
  function enforceServerTurnIndex(payload: Record<string, unknown>): void {
    if (!isObject(payload.ui)) payload.ui = {};
    const ui = payload.ui as Record<string, unknown>;
    if (!isObject(ui.progress)) ui.progress = { turn_index: 0, milestones_hit: [] };
    (ui.progress as Record<string, unknown>).turn_index = serverTurnIndex;
    payload.meta = {
      ...(isObject(payload.meta) ? (payload.meta as Record<string, unknown>) : {}),
      runId: runId ?? "",
      clientTurnIndex,
      serverTurnIndex,
    };
  }

  if (cacheAvailable && cacheRequest && cacheStorage) {
    const cached = await cacheStorage.default!.match(cacheRequest);
    if (cached) {
      let cachedPayload: Record<string, unknown>;
      try {
        cachedPayload = (await cached.json()) as Record<string, unknown>;
      } catch {
        cachedPayload = {};
      }
      enforceServerTurnIndex(cachedPayload);
      const res = new Response(JSON.stringify(cachedPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Turn-Cache": "HIT",
          "X-Turn-Key": turnKey.slice(0, 12),
          "X-Prompt-Profile": promptProfile,
          "X-Balance-Profile": balanceProfile,
        },
      });
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
  const systemInstruction = getSystemInstruction(promptProfile);
  const userPrompt = buildUserPrompt(state, actionType, body, cards, promptProfile);
  const maxTokens = promptProfile === "fast" ? FAST_MAX_TOKENS : LEGACY_MAX_TOKENS;

  function toFailReason(reason: string): FailReason {
    if (reason === "DEEPSEEK_TIMEOUT") return "DEEPSEEK_TIMEOUT";
    if (reason.startsWith("DeepSeek ") && /^\d+/.test(reason.slice(9).trim())) return "DEEPSEEK_HTTP";
    if (reason === "parse fail" || reason.includes("empty content") || reason.includes("JSON")) return "DEEPSEEK_PARSE";
    return "INTERNAL";
  }

  const tryOnce = async (signal: AbortSignal): Promise<{ ok: true; data: TurnResponse } | { ok: false; reason: string; failReason: FailReason }> => {
    try {
      const raw = await callDeepSeek(apiKey, systemInstruction, userPrompt, { signal, max_tokens: maxTokens });
      const parsed = JSON.parse(raw) as unknown;
      if (!validateTurnResponse(parsed)) return { ok: false, reason: "validate fail", failReason: "INTERNAL" };
      let data = parsed as TurnResponse;
      if (promptProfile === "fast") data = applyFastLengthGuard(data, cards);
      return { ok: true, data };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort) return { ok: false, reason: "DEEPSEEK_TIMEOUT", failReason: "DEEPSEEK_TIMEOUT" };
      if (err.startsWith("DeepSeek ")) return { ok: false, reason: err, failReason: "DEEPSEEK_HTTP" };
      if (err.includes("JSON") || err.includes("empty content")) return { ok: false, reason: "parse fail", failReason: "DEEPSEEK_PARSE" };
      return { ok: false, reason: err, failReason: toFailReason(err) };
    }
  };

  const startMs = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
  let attempt: Awaited<ReturnType<typeof tryOnce>>;
  try {
    attempt = await tryOnce(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
  const latencyMs = Date.now() - startMs;

  const result = attempt.ok
    ? attempt.data
    : safetyFallbackResponse(state, (attempt as { ok: false; reason: string }).reason, body);
  let normalized = normalizeForFrontend(result);
  if (cards.length > 0) normalized = patchChoicesForCards(normalized, cards);

  const isFallback = !attempt.ok;
  const failReason: FailReason | undefined = !attempt.ok ? (attempt as { ok: false; failReason: FailReason }).failReason : undefined;
  const payload: Record<string, unknown> = {
    ...normalized,
    meta: {
      cards: cards.map((c) => c.type),
      ...(isFallback && { isFallback: true, fail_reason: failReason ?? "INTERNAL", latency_ms: latencyMs }),
    },
  };
  enforceServerTurnIndex(payload);
  const maxAge = isFallback ? CACHE_MAX_AGE_FALLBACK : CACHE_MAX_AGE_NORMAL;

  const response = new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Turn-Cache": "MISS",
      "X-Turn-Key": turnKey.slice(0, 12),
      "X-Turn-Mode": isFallback ? "FALLBACK" : "OK",
      "X-Fail-Reason": isFallback ? (failReason ?? "INTERNAL") : "",
      "X-Latency-MS": String(latencyMs),
      "X-Prompt-Profile": promptProfile,
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
