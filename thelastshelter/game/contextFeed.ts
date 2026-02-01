/**
 * 本局上下文流：最近 N 条“决策 + 结果 + 差量”，持久化到 localStorage。
 * key: m_apoc_context_feed_v1
 */

const STORAGE_KEY = "m_apoc_context_feed_v1";

export interface TurnSummary {
  id: string;
  turn: number;
  decisionText: string;
  outcomeText: string;
  deltas: {
    batDelta: number | null;
    hpDelta: number | null;
    bagDelta: number | null;
    pointsDelta: number | null;
  };
  statusBefore: string;
  statusAfter: string;
}

function parseFeed(raw: string | null): TurnSummary[] {
  if (raw == null) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 读取持久化的上下文流。 */
export function loadContextFeed(): TurnSummary[] {
  try {
    return parseFeed(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

const MAX_FEED_ITEMS = 50;

/** 追加一条并写回，裁剪为最多 50 条；返回裁剪后的新数组。 */
export function pushContextFeed(item: TurnSummary): TurnSummary[] {
  const list = [...loadContextFeed(), item].slice(-MAX_FEED_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

/** 新开一局时清空本局记录。 */
export function clearContextFeed(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const OUTCOME_MAX_LEN = 32;

/** 压缩结果文案：去换行、截到约 24–36 字并加省略号。 */
export function compressOutcome(content: string | undefined, maxLen: number = OUTCOME_MAX_LEN): string {
  if (content == null || typeof content !== "string") return "";
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + "…";
}
