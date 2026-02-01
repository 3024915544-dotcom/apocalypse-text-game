/**
 * 每局至少 2 次“明确收益窗口”：前端注入，零后端。
 * 窗口：stepIndex 3–5（w1）、8–10（w2）；背包未满且该窗口未触发时投放一件。
 * localStorage key: m_apoc_reward_moments_v1
 */

import type { BagItem } from "../types";
import type { RunConfigVariantId } from "./runConfig";
import { BAG_CAPACITY } from "../constants";

const STORAGE_KEY = "m_apoc_reward_moments_v1";

interface WindowState {
  w1: boolean;
  w2: boolean;
}

function loadState(): Record<string, WindowState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    const o = JSON.parse(raw);
    return typeof o === "object" && o !== null ? o : {};
  } catch {
    return {};
  }
}

function saveState(state: Record<string, WindowState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function isWindowTriggered(runId: string, window: "w1" | "w2"): boolean {
  const state = loadState();
  return state[runId]?.[window] === true;
}

export function markWindowTriggered(runId: string, window: "w1" | "w2"): void {
  const state = loadState();
  const run = state[runId] ?? { w1: false, w2: false };
  run[window] = true;
  state[runId] = run;
  saveState(state);
}

export function clearRewardMoments(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const REWARD_POOL_W1: { name: string; type: BagItem["type"]; value: number }[] = [
  { name: "备用电池", type: "MISC", value: 15 },
  { name: "保险丝", type: "MISC", value: 12 },
  { name: "导线", type: "MISC", value: 10 },
];

const REWARD_POOL_W2: { name: string; type: BagItem["type"]; value: number }[] = [
  { name: "备用电池", type: "MISC", value: 18 },
  { name: "便携电源", type: "MISC", value: 20 },
  { name: "绝缘胶带", type: "MISC", value: 8 },
];

function pickForVariant(
  pool: { name: string; type: BagItem["type"]; value: number }[],
  variantId: RunConfigVariantId
): { name: string; type: BagItem["type"]; value: number } {
  if (variantId === "battery_crisis" || variantId === "night") {
    const battery = pool.find((p) => p.name.includes("电池") || p.name.includes("电源"));
    if (battery) return battery;
  }
  return pool[0];
}

/** 返回该窗口应投放的物品（唯一 id），若不应投放则返回 null。 */
export function getRewardItemForWindow(
  window: "w1" | "w2",
  variantId: RunConfigVariantId,
  runId: string,
  currentBagLength: number
): BagItem | null {
  if (currentBagLength >= BAG_CAPACITY) return null;
  if (isWindowTriggered(runId, window)) return null;
  const pool = window === "w1" ? REWARD_POOL_W1 : REWARD_POOL_W2;
  const picked = pickForVariant(pool, variantId);
  return {
    id: `reward-${window}-${runId}-${Date.now()}`,
    name: picked.name,
    type: picked.type,
    value: picked.value,
    tag: "loot",
  };
}

/** 当前步数是否落在窗口内（1-based stepIndex）。 */
export function isInRewardWindow(stepIndex: number, window: "w1" | "w2"): boolean {
  if (window === "w1") return stepIndex >= 3 && stepIndex <= 5;
  return stepIndex >= 8 && stepIndex <= 10;
}
