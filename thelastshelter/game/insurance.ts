/**
 * 保险袋：死亡时保留一件物品的选择规则与存储。
 * localStorage key: m_apoc_insurance_kept_v1
 */

import type { BagItem } from "../types";

const STORAGE_KEY = "m_apoc_insurance_kept_v1";

function itemValue(item: BagItem): number {
  const v = item?.value;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 1;
}

function isQuestLike(item: BagItem): boolean {
  if (item?.tag === 'quest') return true;
  if (item?.name && String(item.name).includes("任务")) return true;
  return false;
}

/** 从背包中选出“保留一件”：优先 tag==='quest'，否则 value 最大；无 value 按 1。 */
export function pickKeptItem(bag: BagItem[]): BagItem | null {
  const filled = bag.filter(Boolean);
  if (filled.length === 0) return null;
  const quest = filled.find(isQuestLike);
  if (quest) return quest;
  let best = filled[0];
  let bestVal = itemValue(best);
  for (let i = 1; i < filled.length; i++) {
    const v = itemValue(filled[i]);
    if (v > bestVal) {
      best = filled[i];
      bestVal = v;
    }
  }
  return best;
}

export interface StoredKeptItemPayload {
  ts: number;
  item: BagItem;
}

/** 读取最近一次保险袋保住的物品。 */
export function getStoredKeptItem(): StoredKeptItemPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const ts = typeof o.ts === "number" ? o.ts : 0;
    const item = o.item as BagItem | undefined;
    if (!item || !item.id || !item.name) return null;
    return { ts, item };
  } catch {
    return null;
  }
}

/** 写入本次保险袋保住的物品。 */
export function setStoredKeptItem(item: BagItem): void {
  try {
    const payload: StoredKeptItemPayload = { ts: Date.now(), item };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 忽略
  }
}
