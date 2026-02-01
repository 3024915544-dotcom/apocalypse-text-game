/**
 * 失败结算「本局遗憾」：取 1 条短句。
 * 候选：撤离窗口出现但未选择、关键物/背包取舍影响结局。
 */

import type { GameState } from "../types";
import type { TurnSummary } from "./contextFeed";
import { BAG_CAPACITY } from "../constants";

/** 取 1 条遗憾。 */
export function getRunRegret(_gameState: GameState, contextFeed: TurnSummary[]): string | null {
  const hadExtractButChoseOther = contextFeed.some((s) => s.choseNonExtractWhenExtractAvailable);
  const hadBagGainBeforeLoss = contextFeed.some((s) => (s.deltas.bagDelta ?? 0) > 0);
  const bagNearFull = _gameState.bag.length >= BAG_CAPACITY - 1;

  if (hadExtractButChoseOther) {
    return "撤离窗口出现但未选择。";
  }
  if (bagNearFull && hadBagGainBeforeLoss) {
    return "关键物因背包满被丢弃或未带出。";
  }
  return null;
}
