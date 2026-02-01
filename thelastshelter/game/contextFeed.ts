/**
 * 本局上下文流：最近 N 条“决策 + 结果 + 差量”，持久化到 localStorage。
 * key: m_apoc_context_feed_v1
 */

import { getItemTier } from "./itemsCatalog";

const STORAGE_KEY = "m_apoc_context_feed_v1";

const MAX_SCENE_BLOCKS = 6;
const MAX_CONTENT_LEN = 240;

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
  /** 本回合完整叙事块（已截断），用于详情抽屉回放。 */
  sceneBlocks?: { content: string }[];
  isFallback?: boolean;
  /** 本回合是否进入黑暗模式（电量 ≤ 0）。 */
  enteredDarkMode?: boolean;
  /** 电量危机变体：本回合获得电池/保险丝/导线等硬通货，recap 可强调值钱/稀缺。 */
  addedValueItem?: boolean;
  /** 撤离窗口存在时本回合选择了非撤离，recap 显示【拖延】。 */
  choseNonExtractWhenExtractAvailable?: boolean;
  /** 本步为赌感窗口（孤注一掷），recap 显示 badge。 */
  isGamble?: boolean;
  /** 本步为条件撤离（消耗保险丝），recap 显示 badge。 */
  conditionalExtract?: boolean;
  /** 本步为应急火花触发，recap 显示 badge。 */
  isSpark?: boolean;
  /** 本回合获得的物品名（用于显示价值档位 pill）。 */
  gainedItemNames?: string[];
  /** 本回合生效的牌面类型（服务端 meta.cards）。 */
  activeCards?: string[];
}

/** 截断单条 content，最多 maxLen 字。 */
function truncateContent(s: string, maxLen: number = MAX_CONTENT_LEN): string {
  if (typeof s !== "string") return "";
  const t = s.trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen) + "…";
}

const MAIN_NARRATIVE_MAX_LEN = 140;

/**
 * 主屏叙事去冗余：合并空行、轻量赘词清理、截断到 120–160 字。
 * 用于主屏只展示 scene_blocks[0] 的压缩版。
 */
export function sanitizeNarrative(text: string | undefined, maxLen: number = MAIN_NARRATIVE_MAX_LEN): string {
  if (text == null || typeof text !== "string") return "";
  let t = text
    .replace(/\n{2,}/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  const filler = /(据说|可以说|总之|话说回来|就这样|于是乎|就这样，?)/g;
  t = t.replace(filler, "").replace(/\s{2,}/g, " ").trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "…";
}

/** 将 scene_blocks 转为轻量数组并截断：最多 maxBlocks 条，每条 content 最多 maxContentLen 字。 */
export function truncateSceneBlocks(
  blocks: { content?: string }[] | undefined,
  maxBlocks: number = MAX_SCENE_BLOCKS,
  maxContentLen: number = MAX_CONTENT_LEN
): { content: string }[] {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  return blocks.slice(0, maxBlocks).map((b) => ({
    content: truncateContent(typeof b.content === "string" ? b.content : "", maxContentLen),
  }));
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

/** 写入前对条目的 sceneBlocks 做条数与长度限制，避免 localStorage 膨胀。 */
function normalizeItem(item: TurnSummary): TurnSummary {
  if (!item.sceneBlocks || item.sceneBlocks.length === 0) return item;
  return {
    ...item,
    sceneBlocks: truncateSceneBlocks(item.sceneBlocks, MAX_SCENE_BLOCKS, MAX_CONTENT_LEN),
  };
}

/** 追加一条并写回，裁剪为最多 50 条；返回裁剪后的新数组。 */
export function pushContextFeed(item: TurnSummary): TurnSummary[] {
  const normalized = normalizeItem(item);
  const list = [...loadContextFeed(), normalized].slice(-MAX_FEED_ITEMS);
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

export type DeltaPillKind = "pos" | "neg" | "neutral";

export interface DeltaPill {
  label: string;
  kind: DeltaPillKind;
}

/** 纯函数：从 TurnSummary 生成 delta pills（仅非 0 项）及状态 badge，供 RecapBar / contextFeed 复用。 */
export function formatDeltas(summary: TurnSummary): DeltaPill[] {
  const out: DeltaPill[] = [];
  const d = summary.deltas;
  if (d.batDelta != null && d.batDelta !== 0) {
    out.push({ label: `电量 ${d.batDelta > 0 ? "+" : ""}${d.batDelta}`, kind: d.batDelta < 0 ? "neg" : "pos" });
  }
  if (d.hpDelta != null && d.hpDelta !== 0) {
    out.push({ label: `生命 ${d.hpDelta > 0 ? "+" : ""}${d.hpDelta}`, kind: d.hpDelta < 0 ? "neg" : "pos" });
  }
  if (d.bagDelta != null && d.bagDelta !== 0) {
    out.push({ label: `背包 ${d.bagDelta > 0 ? "+" : ""}${d.bagDelta}`, kind: d.bagDelta < 0 ? "neg" : "pos" });
  }
  if (d.pointsDelta != null && d.pointsDelta !== 0) {
    out.push({ label: `生存点 +${d.pointsDelta}`, kind: "pos" });
  }
  if (summary.enteredDarkMode) {
    out.push({ label: "黑暗模式", kind: "neutral" });
  }
  if (summary.statusAfter === "WIN") {
    out.push({ label: "撤离成功", kind: "pos" });
  }
  if (summary.statusAfter === "LOSS") {
    out.push({ label: "撤离失败", kind: "neg" });
  }
  if (summary.isFallback) {
    out.push({ label: "记录简化", kind: "neutral" });
  }
  if (summary.addedValueItem) {
    out.push({ label: "值钱", kind: "pos" });
  }
  if (summary.gainedItemNames?.length) {
    const hasKey = summary.gainedItemNames.some((n) => getItemTier(n) === "关键" || getItemTier(n) === "救命");
    const hasWorth = summary.gainedItemNames.some((n) => getItemTier(n) === "值钱");
    if (hasKey) out.push({ label: "关键物", kind: "pos" });
    if (hasWorth && !summary.addedValueItem) out.push({ label: "值钱", kind: "pos" });
  }
  if (summary.choseNonExtractWhenExtractAvailable) {
    out.push({ label: "拖延", kind: "neutral" });
  }
  if (summary.isGamble) {
    out.push({ label: "孤注一掷", kind: "neutral" });
  }
  if (summary.conditionalExtract) {
    out.push({ label: "保险丝 -1", kind: "neutral" });
    out.push({ label: "条件撤离", kind: "pos" });
  }
  if (summary.isSpark) {
    out.push({ label: "应急火花", kind: "pos" });
  }
  if (summary.activeCards?.includes("RARE_LOOT")) {
    out.push({ label: "稀有机会", kind: "pos" });
  }
  if (summary.activeCards?.includes("GAMBLE")) {
    out.push({ label: "孤注一掷", kind: "neutral" });
  }
  if (summary.activeCards?.includes("CONDITIONAL_EXTRACT")) {
    out.push({ label: "条件撤离", kind: "pos" });
  }
  return out;
}
