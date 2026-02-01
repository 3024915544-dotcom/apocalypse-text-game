/**
 * 固定 3 条挑战（Contracts）：局前可选，局内追踪进度，结算按完成情况发奖励（幂等）。
 */

import type { GameState } from "../types";
import type { TurnSummary } from "./contextFeed";
import { getItemTier } from "./itemsCatalog";
import { evaluateTurnValue } from "./turnValue";

export const CONTRACT_IDS = ["KEY_ITEM", "EXTRACT_BEFORE_DEAD", "GAIN_COUNT_2"] as const;
export type ContractId = (typeof CONTRACT_IDS)[number];

export const CONTRACT_LABELS: Record<ContractId, string> = {
  KEY_ITEM: "带出至少 1 件【关键】物",
  EXTRACT_BEFORE_DEAD: "电量见底前完成撤离",
  GAIN_COUNT_2: "本局至少 2 次「赚到了」",
};

/** 每完成 1 条奖励生存点（小额）；结算时与 runId 幂等一并发放。 */
export const CONTRACT_REWARD_POINTS = 1;

export interface ContractProgress {
  id: ContractId;
  label: string;
  completed: boolean;
  progressText: string;
}

/** 单条是否完成（不依赖 selectedContracts）。 */
export function isContractCompleted(
  id: ContractId,
  gameState: GameState,
  contextFeed: TurnSummary[]
): boolean {
  if (id === "KEY_ITEM") {
    if (gameState.status !== "WIN") return false;
    return gameState.bag.some((item) => getItemTier(item.name) === "关键" || getItemTier(item.name) === "救命");
  }
  if (id === "EXTRACT_BEFORE_DEAD") {
    return gameState.status === "WIN" && (gameState.battery ?? 0) > 0;
  }
  if (id === "GAIN_COUNT_2") {
    const gainCount = contextFeed.filter((s) => evaluateTurnValue(s) === "GAIN").length;
    return gainCount >= 2;
  }
  return false;
}

/** 单条进度文案（局内展示）。 */
export function getContractProgress(
  id: ContractId,
  gameState: GameState,
  contextFeed: TurnSummary[]
): ContractProgress {
  const label = CONTRACT_LABELS[id];
  const completed = isContractCompleted(id, gameState, contextFeed);
  let progressText: string;
  if (id === "KEY_ITEM") {
    const keyCount = gameState.bag.filter((i) => getItemTier(i.name) === "关键" || getItemTier(i.name) === "救命").length;
    progressText = completed ? "已完成" : `${keyCount}/1`;
  } else if (id === "EXTRACT_BEFORE_DEAD") {
    progressText = completed ? "已完成" : gameState.status === "WIN" ? "未完成（电量已见底）" : "进行中";
  } else {
    const gainCount = contextFeed.filter((s) => evaluateTurnValue(s) === "GAIN").length;
    progressText = completed ? "已完成" : `${gainCount}/2`;
  }
  return { id, label, completed, progressText };
}

/** 在已选合约中，完成了几条；用于结算奖励（与 runId 幂等一起发）。 */
export function getCompletedContractIds(
  gameState: GameState,
  contextFeed: TurnSummary[],
  selectedIds: string[]
): ContractId[] {
  const ids = selectedIds.filter((s): s is ContractId => CONTRACT_IDS.includes(s as ContractId));
  return ids.filter((id) => isContractCompleted(id, gameState, contextFeed));
}

/** 合约奖励总生存点（仅对已选且已完成的条数 × CONTRACT_REWARD_POINTS）。 */
export function getContractBonus(
  gameState: GameState,
  contextFeed: TurnSummary[],
  selectedIds: string[]
): number {
  const completed = getCompletedContractIds(gameState, contextFeed, selectedIds);
  return completed.length * CONTRACT_REWARD_POINTS;
}
