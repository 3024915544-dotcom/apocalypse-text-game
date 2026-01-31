/**
 * 前端只调用同源 POST /api/turn，不接触任何 API Key。
 * Key 仅配置在 Cloudflare 环境变量 DEEPSEEK_API_KEY 中。
 */

import { TurnResponse, GameState, ActionType, DirectionHint, RiskLevel } from "./types";

const DEFAULT_PREVIEW_COST = {
  water: 0,
  food: 0,
  fuel: 0,
  med: 0,
  exposure: 0,
};

function normalizeSceneBlocks(blocks: unknown[]): Array<{ type: string; content: string; text: string }> {
  return blocks.map((b) => {
    const block = b as Record<string, unknown>;
    const text = (typeof block?.text === "string" ? block.text : typeof block?.content === "string" ? block.content : "") as string;
    return { type: (block?.type as string) || "EVENT", content: text, text };
  });
}

function normalizeChoices(choices: unknown[]): Array<{
  id: string;
  label: string;
  hint: string;
  risk: RiskLevel;
  preview_cost: { water: number; food: number; fuel: number; med: number; exposure: number; [k: string]: number };
  action_type: ActionType;
}> {
  return choices.map((c) => {
    const choice = c as Record<string, unknown>;
    const actionType = (typeof choice?.action_type === "string"
      ? choice.action_type
      : typeof choice?.action === "string"
        ? choice.action
        : "SILENCE") as ActionType;
    const pc = (choice?.preview_cost as Record<string, unknown>) || {};
    const preview_cost = { ...DEFAULT_PREVIEW_COST, ...pc } as typeof DEFAULT_PREVIEW_COST & Record<string, number>;
    return {
      id: (choice?.id as string) || "",
      label: (choice?.label as string) || "",
      hint: (choice?.hint as string) || "",
      risk: (choice?.risk as RiskLevel) || RiskLevel.MID,
      preview_cost,
      action_type: actionType,
    };
  });
}

function normalizeTurnResponse(data: Record<string, unknown>): TurnResponse {
  const rawBlocks = Array.isArray(data.scene_blocks) ? data.scene_blocks : [];
  const rawChoices = Array.isArray(data.choices) ? data.choices : [];
  const ui = (data.ui as Record<string, unknown>) || {};
  const progress = (ui.progress as Record<string, unknown>) || {};
  const map_delta = (ui.map_delta as Record<string, unknown>) || {};
  const bag_delta = (ui.bag_delta as Record<string, unknown>) || {};
  const suggestion = (data.suggestion as Record<string, unknown>) || {};
  return {
    scene_blocks: normalizeSceneBlocks(rawBlocks),
    choices: normalizeChoices(rawChoices),
    ui: {
      progress: {
        turn_index: typeof progress.turn_index === "number" ? progress.turn_index : 0,
        milestones_hit: Array.isArray(progress.milestones_hit) ? (progress.milestones_hit as number[]) : [],
      },
      map_delta: {
        reveal_indices: Array.isArray(map_delta.reveal_indices) ? (map_delta.reveal_indices as number[]) : [],
        direction_hint: (map_delta.direction_hint as DirectionHint) ?? DirectionHint.NONE,
      },
      bag_delta: {
        add: Array.isArray(bag_delta.add) ? (bag_delta.add as TurnResponse["ui"]["bag_delta"]["add"]) : [],
        remove: Array.isArray(bag_delta.remove) ? (bag_delta.remove as string[]) : [],
      },
    },
    suggestion: { delta: (suggestion.delta as Record<string, unknown>) || {} },
    memory_update: typeof data.memory_update === "string" ? data.memory_update : "",
    safety_fallback: typeof data.safety_fallback === "string" ? data.safety_fallback : undefined,
  };
}

export async function fetchTurnResponse(
  state: GameState,
  actionType: ActionType
): Promise<TurnResponse> {
  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, action: typeof actionType === "string" ? actionType : String(actionType) }),
    });
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`API ${res.status}: ${rawText.slice(0, 200)}`);
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error(`JSON 解析失败: ${rawText.slice(0, 200)}`);
    }
    if (data.error != null || data.detail != null) {
      const msg = typeof data.detail === "string" ? data.detail : typeof data.error === "string" ? data.error : "backend error";
      throw new Error(msg);
    }
    let out = normalizeTurnResponse(data);
    if (out.safety_fallback && out.scene_blocks.length > 0) {
      const reason = out.safety_fallback;
      out = {
        ...out,
        scene_blocks: out.scene_blocks.map((b, i) =>
          i === 0 ? { ...b, content: `连接异常：${reason}`, text: `连接异常：${reason}` } : b
        ),
      };
    }
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Turn API Error:", error);
    const fallbackReason = message || "未知错误";
    return {
      scene_blocks: [{ type: "EVENT", content: `连接异常：${fallbackReason}`, text: `连接异常：${fallbackReason}` }],
      choices: [
        {
          id: "fallback-retry",
          label: "尝试继续",
          hint: "信号不稳定",
          risk: RiskLevel.MID,
          preview_cost: { ...DEFAULT_PREVIEW_COST },
          action_type: "SILENCE",
        },
      ],
      ui: {
        progress: { turn_index: state.turn_index, milestones_hit: [] },
        map_delta: { reveal_indices: [], direction_hint: DirectionHint.NONE },
        bag_delta: { add: [], remove: [] },
      },
      suggestion: { delta: {} },
      memory_update: "",
      safety_fallback: fallbackReason,
    };
  }
}
