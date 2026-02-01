/**
 * 生存点货币：本局结算后累加写入 localStorage。
 * key: m_apoc_currency_survival_points_v1
 * runId 持久化：m_apoc_currentRunId_v1
 * 已结算集合：m_apoc_settledRunIds_v1
 */

import type { GameState } from "../types";

const STORAGE_KEY = "m_apoc_currency_survival_points_v1";
const RUN_ID_KEY = "m_apoc_currentRunId_v1";
const SETTLED_RUNS_KEY = "m_apoc_settledRunIds_v1";

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

/** 扣除生存点并写回 localStorage；足够则扣并返回 true，不够返回 false。 */
export function spendSurvivalPoints(cost: number): boolean {
  if (cost <= 0) return true;
  try {
    const current = getSurvivalPoints();
    if (current < cost) return false;
    localStorage.setItem(STORAGE_KEY, String(Math.floor(current - cost)));
    return true;
  } catch {
    return false;
  }
}

/** 单件物品价值（用于保险袋结算）；无 value 按 1。 */
function itemValue(item: { value?: number }): number {
  const v = item?.value;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 1;
}

/** 根据本局终态背包带出物计算本局生存点（不入账，仅用于展示与传入 addSurvivalPoints）。死亡且保险时传 keptItem，仅按该件价值计。 */
export function computeRunPoints(state: GameState, keptItem?: { value?: number } | null): number {
  if (state.status === "PLAYING") return 0;
  if (state.status === "WIN") {
    const lootValue = state.bag.filter(Boolean).length;
    return lootValue;
  }
  if (keptItem != null) return Math.floor(itemValue(keptItem) * 0.2);
  const lootValue = state.bag.filter(Boolean).length;
  return Math.floor(lootValue * 0.2);
}

/** 读取当前 runId（刷新后仍能拿到同一局的 runId）。 */
export function getCurrentRunId(): string | null {
  try {
    return localStorage.getItem(RUN_ID_KEY);
  } catch {
    return null;
  }
}

/** 写入当前 runId（每次开新局时调用）。 */
export function setCurrentRunId(runId: string): void {
  try {
    localStorage.setItem(RUN_ID_KEY, runId);
  } catch {
    // 忽略
  }
}

function getSettledRunIds(): Record<string, true> {
  try {
    const raw = localStorage.getItem(SETTLED_RUNS_KEY);
    if (raw == null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

function saveSettledRunIds(settled: Record<string, true>): void {
  try {
    localStorage.setItem(SETTLED_RUNS_KEY, JSON.stringify(settled));
  } catch {
    // 忽略
  }
}

/** 检查某 runId 是否已结算入账。 */
export function isRunSettled(runId: string): boolean {
  const settled = getSettledRunIds();
  return settled[runId] === true;
}

/** 标记某 runId 已结算（幂等，多次调用无副作用）。 */
export function markRunSettled(runId: string): void {
  const settled = getSettledRunIds();
  if (settled[runId] === true) return;
  settled[runId] = true;
  saveSettledRunIds(settled);
}
