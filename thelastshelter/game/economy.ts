/**
 * 生存点货币：本局结算后累加写入 localStorage。
 * key: m_apoc_currency_survival_points_v1
 */

import type { GameState } from "../types";

const STORAGE_KEY = "m_apoc_currency_survival_points_v1";

function parsePoints(raw: string | null): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** 读取累计生存点。 */
export function getSurvivalPoints(): number {
  try {
    return parsePoints(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 0;
  }
}

/** 增加生存点并写入 localStorage。 */
export function addSurvivalPoints(delta: number): void {
  if (delta <= 0) return;
  try {
    const current = getSurvivalPoints();
    localStorage.setItem(STORAGE_KEY, String(current + Math.floor(delta)));
  } catch {
    // 忽略写入失败
  }
}

/** 根据本局终态背包带出物计算本局生存点（不入账，仅用于展示与传入 addSurvivalPoints）。 */
export function computeRunPoints(state: GameState): number {
  if (state.status === "PLAYING") return 0;
  const lootValue = state.bag.filter(Boolean).length;
  if (state.status === "WIN") return lootValue;
  return Math.floor(lootValue * 0.2);
}
