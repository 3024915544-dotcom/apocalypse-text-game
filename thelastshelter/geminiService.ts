/**
 * 前端只调用同源 POST /api/turn，不接触任何 API Key。
 * Key 仅配置在 Cloudflare 环境变量 DEEPSEEK_API_KEY 中。
 */

import { TurnResponse, GameState, ActionType, DirectionHint, RiskLevel } from "./types";

export async function fetchTurnResponse(
  state: GameState,
  actionType: ActionType
): Promise<TurnResponse> {
  try {
    const res = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, action: actionType }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err}`);
    }
    const json = (await res.json()) as TurnResponse;
    return json;
  } catch (error) {
    console.error("Turn API Error:", error);
    return {
      scene_blocks: [{ type: "EVENT", content: "连接信号中断，荒野中只有风声..." }],
      choices: [
        {
          id: "fallback-move",
          label: "尝试继续前进",
          hint: "由于风暴，视线模糊",
          risk: RiskLevel.MID,
          preview_cost: { hp: -5 },
          action_type: "MOVE_N",
        },
      ],
      ui: {
        progress: { turn_index: state.turn_index, milestones_hit: [] },
        map_delta: { reveal_indices: [], direction_hint: DirectionHint.NONE },
        bag_delta: { add: [], remove: [] },
      },
      suggestion: { delta: { hp: -2, exposure: 5 } },
      memory_update: "风暴正在聚集。",
    };
  }
}
