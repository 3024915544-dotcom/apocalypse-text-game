/**
 * 特殊牌面确定性生成：赌一把、稀有机会、条件撤离、撤离窗口张力。
 * 基于 runId + stepIndex + signals 计算，无随机；客户端传 cards_used 防刷新重复。
 * 窗口/保底/上限从 balanceConfig 读取，支持 balanceProfile（prod/high/low）。
 */

import { getBalanceConfig, type BalanceProfile } from "./balanceConfig";

export type CardType =
  | "GAMBLE"
  | "RARE_LOOT"
  | "CONDITIONAL_EXTRACT"
  | "EXTRACT_PRESSURE";

export interface PlayabilityCard {
  type: CardType;
  id: string;
  title: string;
  badge: string;
  hint: string;
  payload?: Record<string, unknown>;
}

export interface CardsUsed {
  rare_loot?: boolean;
  gamble?: boolean;
  extract_pressure?: boolean;
  conditional_extract_used?: boolean;
}

export interface CardsInput {
  turn_index: number;
  variantId: string;
  evac_available: string;
  darkness: string;
  bag_len: number;
  has_fuse: boolean;
  runId: string;
  cards_used: CardsUsed;
}

const BAG_CAPACITY = 8;

/** 确定性触发规则（无随机）；窗口/上限/保底从 config 读取。 */
export function getPlayabilityCards(
  input: CardsInput,
  profile: BalanceProfile = "prod"
): PlayabilityCard[] {
  const config = getBalanceConfig(profile);
  const cards: PlayabilityCard[] = [];
  const {
    turn_index,
    variantId,
    evac_available,
    darkness,
    bag_len,
    has_fuse,
    runId,
    cards_used,
  } = input;

  const { rareLoot, gamble, extractPressure } = config;
  const rareLootWindows = rareLoot.windows;
  const rareLootWindow =
    variantId === "battery_crisis"
      ? { start: rareLootWindows[1]![0], end: rareLootWindows[1]![1] }
      : { start: rareLootWindows[0]![0], end: rareLootWindows[0]![1] };

  if (
    !cards_used.rare_loot &&
    turn_index >= rareLootWindow.start &&
    turn_index <= rareLootWindow.end &&
    bag_len < BAG_CAPACITY
  ) {
    cards.push({
      type: "RARE_LOOT",
      id: `rare_${runId}_${turn_index}`,
      title: "稀有机会",
      badge: "稀有机会",
      hint: "高价值拾取窗口，仅此一次。",
      payload: { window: variantId === "battery_crisis" ? "w2" : "w1" },
    });
  }

  const [gambleStart, gambleEnd] = gamble.window;
  const bagOk = !gamble.minConditions.bagNotFull || bag_len < BAG_CAPACITY;
  const notDark = !gamble.minConditions.notInDark || darkness !== "in_dark";

  if (
    !cards_used.gamble &&
    turn_index >= gambleStart &&
    turn_index <= gambleEnd &&
    notDark &&
    bagOk
  ) {
    cards.push({
      type: "GAMBLE",
      id: `gamble_${runId}`,
      title: "孤注一掷",
      badge: "孤注一掷",
      hint: "高风险高收益，成败在此一举。",
    });
  }

  if (
    (evac_available === "near" || evac_available === "near+far") &&
    (extractPressure.showOncePerRun ? !cards_used.extract_pressure : true)
  ) {
    cards.push({
      type: "EXTRACT_PRESSURE",
      id: `extract_pressure_${runId}`,
      title: "撤离窗口张力",
      badge: "更危险",
      hint: "撤离窗口出现，越拖代价越高。",
    });
  }

  if (
    (evac_available === "near" || evac_available === "near+far") &&
    has_fuse &&
    !cards_used.conditional_extract_used
  ) {
    cards.push({
      type: "CONDITIONAL_EXTRACT",
      id: `conditional_extract_${runId}`,
      title: "条件撤离",
      badge: "条件撤离",
      hint: "消耗保险丝，换更稳的出路。",
      payload: { consume: "保险丝" },
    });
  }

  return cards;
}

/** 从 state/body 解析已使用牌面（客户端回传）。 */
export function parseCardsUsed(
  state: Record<string, unknown>,
  body: Record<string, unknown>
): CardsUsed {
  const from = (state.cards_used ?? body.cards_used) as Record<string, unknown> | undefined;
  if (!from || typeof from !== "object") return {};
  return {
    rare_loot: from.rare_loot === true,
    gamble: from.gamble === true,
    extract_pressure: from.extract_pressure === true,
    conditional_extract_used: from.conditional_extract_used === true,
  };
}
