/**
 * 失败归因：纯前端推导，基于 contextFeed + 最终 gameState。
 * 用于 LOSS 结算页「这次栽在：」卡片。
 */

import type { GameState } from "../types";
import type { TurnSummary } from "./contextFeed";
import { BATTERY_MAX, BAG_CAPACITY } from "../constants";

export interface DiagnosisResult {
  causes: string[];
  suggestion: string;
}

/** 归因优先级：黑暗模式停留 > 错过撤离窗口 > 生命过低冒进 > 背包取舍失误。取前 2–3 条。 */
export function diagnoseLoss(gameState: GameState, contextFeed: TurnSummary[]): DiagnosisResult {
  const causes: string[] = [];
  const bat = gameState.battery ?? BATTERY_MAX;
  const isDark = bat <= 0;
  const lowHp = gameState.hp <= 30;
  const bagNearFull = gameState.bag.length >= BAG_CAPACITY - 1;

  if (isDark && contextFeed.some((s) => s.enteredDarkMode)) {
    causes.push("电量耗尽后仍停留，风险暴涨。");
  }

  const extractFirstIndex = contextFeed.findIndex(
    (s) => (s.decisionText ?? "").includes("撤离")
  );
  if (extractFirstIndex >= 0) {
    const afterExtract = contextFeed.length - 1 - extractFirstIndex;
    if (afterExtract >= 2) {
      causes.push("错过撤离窗口，越拖越贵。");
    }
  } else if (contextFeed.length >= 3) {
    causes.push("未及时撤离，越拖越贵。");
  }

  if (lowHp && contextFeed.some((s) => (s.decisionText ?? "").includes("搜索"))) {
    causes.push("状态不稳仍冒进。");
  } else if (lowHp) {
    causes.push("生命过低仍冒进。");
  }

  if (bagNearFull && contextFeed.some((s) => (s.deltas.bagDelta ?? 0) > 0)) {
    causes.push("背包取舍失误，收益被挤掉。");
  }

  const topCauses = causes.slice(0, 3);
  let suggestion = "下次注意电量与撤离时机，优先省电与撤离。";
  if (topCauses.length > 0) {
    if (topCauses[0].includes("电量")) {
      suggestion = "电量见底就找撤离，不要硬搜。";
    } else if (topCauses[0].includes("撤离窗口")) {
      suggestion = "撤离出现就尽快选近/远其一。";
    } else if (topCauses[0].includes("状态") || topCauses[0].includes("生命")) {
      suggestion = "血量低就收手，优先撤离或省电。";
    } else if (topCauses[0].includes("背包")) {
      suggestion = "提前留空位给电池/关键件。";
    }
  }

  if (topCauses.length === 0) {
    topCauses.push("局势失控，未及时撤离或省电。");
  }

  return { causes: topCauses, suggestion };
}
