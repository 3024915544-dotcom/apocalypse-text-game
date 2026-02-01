/**
 * 本回合价值走向：赚到了 / 亏了 / 白忙一场（不引入精确数值）。
 */

import type { TurnSummary } from "./contextFeed";
import { getItemTier } from "./itemsCatalog";

export type TurnValueFeel = "GAIN" | "LOSS" | "NEUTRAL";

/** 纯函数：从 TurnSummary 判定本回合价值走向。 */
export function evaluateTurnValue(summary: TurnSummary): TurnValueFeel {
  const d = summary.deltas;
  const hasHpDrop = d.hpDelta != null && d.hpDelta < 0;
  const hasBatDrop = d.batDelta != null && d.batDelta < 0;
  const enteredDark = summary.enteredDarkMode === true;
  const gotKeyItem =
    (summary.gainedItemNames?.length ?? 0) > 0 &&
    summary.gainedItemNames!.some((n) => getItemTier(n) === "关键" || getItemTier(n) === "救命" || getItemTier(n) === "值钱");
  const win = summary.statusAfter === "WIN";
  const pointsUp = d.pointsDelta != null && d.pointsDelta > 0;
  const conditionalExtract = summary.conditionalExtract === true;
  const isSpark = summary.isSpark === true;
  const bagGain = (d.bagDelta ?? 0) > 0;

  if (win || pointsUp || gotKeyItem || isSpark) return "GAIN";
  if (conditionalExtract && !bagGain) return "GAIN"; // 条件撤离算“换到稳出路”
  if ((enteredDark || (hasHpDrop && (hasBatDrop || summary.choseNonExtractWhenExtractAvailable))) && !gotKeyItem && !isSpark)
    return "LOSS";
  if (conditionalExtract) return "GAIN"; // 消耗保险丝但换撤离成功
  if (hasHpDrop && !gotKeyItem) return "LOSS";
  if (summary.choseNonExtractWhenExtractAvailable && !gotKeyItem) return "LOSS";

  return "NEUTRAL";
}

export const TURN_VALUE_LABELS: Record<TurnValueFeel, string> = {
  GAIN: "赚到了",
  LOSS: "亏了",
  NEUTRAL: "白忙一场",
};
