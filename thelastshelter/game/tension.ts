/**
 * 局势等级：对玩家隐藏回合数，用“平稳→升温→危险→临界”表达压力。
 * turnIndex 仍用于引擎与 Debug，仅 UI 文案替换。
 */

export type TensionLabel = "平稳" | "升温" | "危险" | "临界";

/** 根据 turnIndex 返回局势等级（1–4 平稳，5–8 升温，9–12 危险，13+ 临界）。 */
export function getTensionLabel(turnIndex: number): TensionLabel {
  if (turnIndex <= 4) return "平稳";
  if (turnIndex <= 8) return "升温";
  if (turnIndex <= 12) return "危险";
  return "临界";
}

/** 局势升温提示文案（5/9/13 触发，不出现回合数字）。 */
export const TENSION_HINT_AT_5 = "局势开始变得不对劲。动静更近了。";
export const TENSION_HINT_AT_9 = "街区像在收紧。每一步都更贵。";
export const TENSION_HINT_AT_13 = "临界。再犹豫，你可能走不出去。";

export function getTensionHintForTurn(turnIndex: number): string | null {
  if (turnIndex === 5) return TENSION_HINT_AT_5;
  if (turnIndex === 9) return TENSION_HINT_AT_9;
  if (turnIndex === 13) return TENSION_HINT_AT_13;
  return null;
}
