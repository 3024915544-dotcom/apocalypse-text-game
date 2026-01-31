/**
 * Cloudflare Pages Function: POST /api/turn
 * Calls DeepSeek OpenAI-compatible API, enforces JSON mode, validates TurnResponse.
 * DEEPSEEK_API_KEY must be set in Cloudflare dashboard (never exposed to frontend).
 */

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

const SYSTEM_INSTRUCTION = `你是一个"末日生存文字冒险"的回合叙事与选项生成器。游戏为章节制，第1章为 2D 网格迷雾探索（9x9），总计 16 回合，里程碑回合固定为第 5/10/15 回合。玩家目标：到达安全屋（出口格）。失败条件：HP<=0 或 Exposure>=100 或 回合耗尽。

你必须严格遵守以下规则：
1) 你只负责生成：分段叙事(scene_blocks)、可选动作(choices)、以及对UI的建议(map_delta/bag_delta/方向提示)；你不能执行或改变游戏引擎规则。
2) 你必须输出严格 JSON，且必须符合下述 TurnResponse schema，不要输出任何非 JSON 的说明或前缀后缀。
3) 文风：末日生存、紧凑、偏现实的生存细节；每个文本块不超过 280 字；每回合 2-6 段。
4) 叙事要与玩家本回合 action 相呼应。里程碑回合（5/10/15）要给出方向线索或局势变化；direction_hint 必须为 NONE/N/NE/E/SE/S/SW/W/NW 之一。
5) choices 必须包含 2-4 个，每个 choice 的 label/hint 简短清晰，risk 为 LOW/MID/HIGH。
6) 不得在叙事中断言已发生的具体引擎结果，只用"你打算…你感觉…"描述，具体变化放在 suggestion / ui.map_delta / ui.bag_delta 里。

TurnResponse schema（你必须严格遵循，输出合法 JSON）：
{
  "scene_blocks": [{"type":"TITLE"|"EVENT"|"RESULT"|"AFTERTASTE","content":"string"}],
  "choices": [{"id":"string","label":"string","hint":"string","risk":"LOW"|"MID"|"HIGH","preview_cost":{},"action_type":"string"}],
  "ui": {
    "progress":{"turn_index":number,"milestones_hit":number[]},
    "map_delta":{"reveal_indices":number[],"direction_hint":"NONE"|"N"|"NE"|"E"|"SE"|"S"|"SW"|"W"|"NW"},
    "bag_delta":{"add":[{"id":"string","name":"string","type":"string"}],"remove":string[]}
  },
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

function buildUserPrompt(state: GameState, actionType: string): string {
  const fogCount = (state.fog as boolean[]).filter((f) => !f).length;
  return `
chapter_id: 1
turn_index: ${state.turn_index} / ${MAX_TURNS}
milestone_turns: ${MILESTONES.join(",")}
objective: reach exit tile (safehouse)

【玩家动作】
action.type: ${actionType}

【当前状态】
hp: ${state.hp}
exposure: ${state.exposure}
resources: water=${state.water}, food=${state.food}, fuel=${state.fuel}, med=${state.med}
bag.capacity: 8
bag.slots: ${(state.bag as unknown[]).length}

【地图】
grid: 9x9
player_pos: (${(state.player_pos as { x: number; y: number }).x}, ${(state.player_pos as { x: number; y: number }).y})
exit_pos: (hidden)
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

async function callDeepSeek(apiKey: string, systemPrompt: string, userPrompt: string): Promise<string> {
  // Authorization 必须严格为 Bearer ${apiKey}，不加其他前缀，key 不放 querystring
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
      max_tokens: 2048,
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

  const userPrompt = buildUserPrompt(state, actionType);
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
  const result = attempt.ok ? attempt.data : safetyFallbackResponse(state, attempt.reason);
  const normalized = normalizeForFrontend(result);

  return new Response(JSON.stringify(normalized), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
