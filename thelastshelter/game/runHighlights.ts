/**
 * 成功结算「本局亮点」：从 contextFeed 推导 1–2 条短句。
 * 候选：电量见底前撤离、背包取舍、赌感拿关键物、黑暗模式下脱离。
 */

import type { GameState } from "../types";
import type { TurnSummary } from "./contextFeed";
import { getItemTier } from "./itemsCatalog";

/** 取最强 1–2 条亮点。 */
export function getRunHighlights(gameState: GameState, contextFeed: TurnSummary[]): string[] {
  const out: string[] = [];
  const hadDark = contextFeed.some((s) => s.enteredDarkMode);
  const hadGambleWin = contextFeed.some((s) => s.isGamble && (s.deltas.bagDelta ?? 0) > 0);
  const lastBat = gameState.battery ?? 0;

  if (hadDark && gameState.status === "WIN") {
    out.push("黑暗模式下成功脱离。");
  }
  if (lastBat > 0 && gameState.status === "WIN" && !hadDark) {
    out.push("在电量见底前选择撤离。");
  }
  if (hadGambleWin) {
    out.push("赌感窗口中拿到关键物。");
  }
  if (out.length < 2 && gameState.bag.length >= 6) {
    out.push("背包满时做出关键取舍。");
  }

  return out.slice(0, 2);
}

/** 结算页「本局价值亮点」：1–2 条短句（带出关键件、电量见底前撤离、条件撤离、应急火花等）。 */
export function getSettlementValueHighlights(
  gameState: GameState,
  contextFeed: TurnSummary[]
): string[] {
  const out: string[] = [];
  const keyItems = gameState.bag.filter((i) => getItemTier(i.name) === "关键" || getItemTier(i.name) === "救命");
  if (keyItems.length > 0 && gameState.status === "WIN") {
    out.push("带出关键件：" + keyItems.map((i) => i.name).join("、"));
  }
  if ((gameState.battery ?? 0) > 0 && gameState.status === "WIN") {
    out.push("电量见底前撤离。");
  }
  if (contextFeed.some((s) => s.conditionalExtract)) {
    out.push("用条件撤离换稳出路。");
  }
  if (contextFeed.some((s) => s.isSpark)) {
    out.push("应急火花救回一步。");
  }
  return out.slice(0, 2);
}

/** 带出清单：最多 4 条物品名，超过显示「等X件」。 */
export function getCarriedList(bag: { name: string }[], maxShow: number = 4): { names: string[]; overflow: number } {
  const names = bag.slice(0, maxShow).map((b) => b.name);
  const overflow = Math.max(0, bag.length - maxShow);
  return { names, overflow };
}
