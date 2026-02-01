/**
 * 风险 badge 策略：仅特殊选项显示中文 badge，普通选项不标风险。
 * 孤注一掷 | 稀有机会 | 条件撤离 | 更危险 | 更稳｜更耗电
 */

import type { Choice } from "../types";
import type { GameState } from "../types";
import { isGambleChoice } from "./gambleMoment";
import { isConditionalExtractChoice } from "./conditionalExtract";

export type ChoiceBadgeKind = "孤注一掷" | "稀有机会" | "条件撤离" | "更危险" | "更稳｜更耗电";

/** 仅特殊选项返回 badge；优先使用服务端牌面 server_badge。 */
export function getChoiceBadge(choice: Choice, _state: GameState): ChoiceBadgeKind | null {
  const serverBadge = (choice as Choice & { server_badge?: string }).server_badge;
  if (serverBadge && ["孤注一掷", "稀有机会", "条件撤离", "更危险", "更稳｜更耗电"].includes(serverBadge))
    return serverBadge as ChoiceBadgeKind;
  const label = choice.label ?? "";
  if (isGambleChoice(choice)) return "孤注一掷";
  if (isConditionalExtractChoice(choice)) return "条件撤离";
  if (label.includes("撤离-近")) return "更危险";
  if (label.includes("撤离-远")) return "更稳｜更耗电";
  return null;
}
