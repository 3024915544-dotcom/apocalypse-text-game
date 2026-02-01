/**
 * 本步关注点提示：纯前端推导，不靠 AI。
 * 优先级：黑暗模式 > 撤离窗口 > 电量见底 > 背包接近满 > 变体默认。
 */

import type { GameState } from "../types";
import type { TurnResponse } from "../types";
import type { RunConfigVariantId } from "./runConfig";
import { BATTERY_MAX, BAG_CAPACITY } from "../constants";

const BATTERY_LOW_THRESHOLD = 2;

/** 当前局内状态推导出一条关注点（1 行短句）。variantId 用于变体专属默认文案。 */
export function getFocusHint(
  gameState: GameState,
  lastResponse: TurnResponse | null,
  variantId?: RunConfigVariantId
): string {
  const battery = gameState.battery ?? BATTERY_MAX;
  const bagCount = gameState.bag.length;
  const isDark = battery <= 0;

  if (isDark) {
    return "关注：黑暗模式，避免搜索，优先脱离。";
  }

  const choices = lastResponse?.choices ?? [];
  const hasExtract = choices.some(
    (c) => c.label && (c.label.includes("撤离-近") || c.label.includes("撤离-远"))
  );
  if (hasExtract) {
    return "关注：撤离窗口已出现，尽快决定撤离方式。";
  }

  if (battery <= BATTERY_LOW_THRESHOLD) {
    return "关注：电量见底，优先省电或撤离。";
  }

  if (bagCount >= BAG_CAPACITY - 1) {
    return "关注：背包接近满格，准备取舍。";
  }

  if (bagCount >= 7) {
    return "关注：背包接近满格，准备取舍。";
  }

  if (variantId === "night") {
    return "关注：视野差，别把电量耗在空处。";
  }
  if (variantId === "battery_crisis") {
    return "关注：电量更紧，能省就省。";
  }
  return "关注：摸清方向，别把电量花在空处。";
}
