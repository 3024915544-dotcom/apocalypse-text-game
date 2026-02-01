/**
 * 应急火花：每局最多 1 次，电量将归零时拉回 1。
 * 持久化本局已触发：m_apoc_spark_used_v1 按 runId 记录。
 */

import type { TurnSummary } from "./contextFeed";

const STORAGE_KEY = "m_apoc_spark_used_v1";

function loadUsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    const o = JSON.parse(raw) as unknown;
    return typeof o === "object" && o !== null ? (o as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveUsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function isSparkUsed(runId: string): boolean {
  return loadUsed()[runId] === true;
}

export function setSparkUsed(runId: string): void {
  const state = loadUsed();
  state[runId] = true;
  saveUsed(state);
}

export function clearSparkUsed(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 生成火花触发的系统 TurnSummary，用于 Recap/Feed。 */
export function buildSparkSummary(
  turnIndex: number,
  batBefore: number
): TurnSummary {
  return {
    id: `cf-spark-${turnIndex}-${Date.now()}`,
    turn: turnIndex,
    decisionText: "系统提示",
    outcomeText: "应急火花炸亮了一瞬，你捡回一步。",
    deltas: {
      batDelta: 1,
      hpDelta: null,
      bagDelta: null,
      pointsDelta: null,
    },
    statusBefore: "PLAYING",
    statusAfter: "PLAYING",
    sceneBlocks: [{ content: "应急火花炸亮了一瞬，你捡回一步。" }],
    isSpark: true,
  };
}
