/**
 * 回合结构化日志摘要：成功/失败都记录，不写入完整叙事文本。
 * console 输出 + 可选 localStorage 环缓冲（最多 50 条）。
 */

import type { TurnResponse } from "../types";

const TRACE_STORAGE_KEY = "m_apoc_turn_trace_v1";
const TRACE_RING_MAX = 50;
const QUICK_STATS_TAKE = 20;

export interface TurnTrace {
  ts: number;
  runId: string;
  clientTurnIndex: number;
  action: string;
  ok: boolean;
  errType?: string;
  httpStatus?: number;
  isFallback?: boolean;
  batBefore: number | null;
  batAfter: number | null;
  hpBefore: number | null;
  hpAfter: number | null;
  bagCountBefore: number;
  bagCountAfter: number;
  statusBefore: string;
  statusAfter: string;
  /** 本回合生效的牌面类型（服务端 meta.cards） */
  cards?: string[];
}

/** 尽量可靠地判定是否为兜底响应（不改后端）。优先明确字段，否则启发式。 */
export function detectFallback(response: TurnResponse | null): boolean {
  if (!response) return false;
  const r = response as TurnResponse & { meta?: { isFallback?: boolean }; ui?: { is_fallback?: boolean }; debug?: { fallback?: boolean } };
  if (r.meta?.isFallback === true || r.ui?.is_fallback === true || (r as any).debug?.fallback === true) return true;
  if (typeof response.safety_fallback === "string" && response.safety_fallback.length > 0) return true;
  const firstContent = response.scene_blocks?.[0]?.content ?? "";
  if (typeof firstContent === "string" && (firstContent.includes("连接异常") || firstContent.includes("通信中断") || firstContent.includes("通讯"))) return true;
  return false;
}

function pushToRing(trace: TurnTrace): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(TRACE_STORAGE_KEY);
    let arr: TurnTrace[] = [];
    if (raw) {
      try {
        arr = JSON.parse(raw) as TurnTrace[];
        if (!Array.isArray(arr)) arr = [];
      } catch {
        arr = [];
      }
    }
    arr.push(trace);
    if (arr.length > TRACE_RING_MAX) arr = arr.slice(-TRACE_RING_MAX);
    localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

export function logTurnTrace(trace: TurnTrace): void {
  if (trace.ok) {
    console.info("[TurnTrace]", trace);
  } else {
    if (trace.errType === "HTTP" || trace.errType === "PARSE") {
      console.error("[TurnTrace]", trace);
    } else {
      console.warn("[TurnTrace]", trace);
    }
  }
  pushToRing(trace);
}

/** 读取最近 N 条 trace（用于 Debug 快速统计）。 */
export function getTurnTraceRing(take: number = QUICK_STATS_TAKE): TurnTrace[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(TRACE_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as TurnTrace[];
    if (!Array.isArray(arr)) return [];
    return arr.slice(-take);
  } catch {
    return [];
  }
}

export interface QuickStats {
  total: number;
  rareLoot: number;
  gamble: number;
  conditionalExtract: number;
  extractPressure: number;
  fallback: number;
}

/** 从最近 N 条 trace 汇总牌面与 fallback 次数。 */
export function getQuickStatsFromTraces(traces: TurnTrace[]): QuickStats {
  let rareLoot = 0;
  let gamble = 0;
  let conditionalExtract = 0;
  let extractPressure = 0;
  let fallback = 0;
  for (const t of traces) {
    if (t.isFallback) fallback += 1;
    const cards = t.cards ?? [];
    if (cards.includes("RARE_LOOT")) rareLoot += 1;
    if (cards.includes("GAMBLE")) gamble += 1;
    if (cards.includes("CONDITIONAL_EXTRACT")) conditionalExtract += 1;
    if (cards.includes("EXTRACT_PRESSURE")) extractPressure += 1;
  }
  return {
    total: traces.length,
    rareLoot,
    gamble,
    conditionalExtract,
    extractPressure,
    fallback,
  };
}
