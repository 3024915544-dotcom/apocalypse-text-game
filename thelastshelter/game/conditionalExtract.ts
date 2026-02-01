/**
 * 材料驱动的《条件撤离》：持有『保险丝』时出现选项，消耗 1 个换更稳撤离。
 * 本地 resolve，不请求 /api/turn。持久化本局已用：m_apoc_conditional_extract_used_v1
 */

import type { GameState } from "../types";
import type { Choice } from "../types";
import type { SceneBlock } from "../types";
import type { TurnSummary } from "./contextFeed";
import { applyBagDelta } from "../engine";

const USED_KEY = "m_apoc_conditional_extract_used_v1";
const FUSE_NAME = "保险丝";

function loadUsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(USED_KEY);
    if (raw == null) return {};
    const o = JSON.parse(raw) as unknown;
    return typeof o === "object" && o !== null ? (o as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveUsed(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(USED_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function isConditionalExtractUsed(runId: string): boolean {
  return loadUsed()[runId] === true;
}

export function setConditionalExtractUsed(runId: string): void {
  const state = loadUsed();
  state[runId] = true;
  saveUsed(state);
}

export function clearConditionalExtract(): void {
  try {
    localStorage.removeItem(USED_KEY);
  } catch {
    /* ignore */
  }
}

export function bagHasFuse(bag: { name: string }[]): boolean {
  return bag.some((i) => (i.name || "").trim() === FUSE_NAME);
}

export const CONDITIONAL_EXTRACT_CHOICE_ID = "conditional-extract-local";

export function getConditionalExtractChoice(): Choice {
  return {
    id: CONDITIONAL_EXTRACT_CHOICE_ID,
    label: "《条件撤离》",
    hint: "消耗『保险丝』，换更稳的出路。",
    risk: "LOW" as import("../types").RiskLevel,
    preview_cost: {},
    action_type: "SEARCH",
  };
}

export function isConditionalExtractChoice(c: Choice): boolean {
  return c.id === CONDITIONAL_EXTRACT_CHOICE_ID;
}

export interface ConditionalExtractResult {
  nextState: GameState;
  sceneBlocks: SceneBlock[];
  summary: TurnSummary;
}

/** 消耗 1 个保险丝，立即 WIN。 */
export function resolveConditionalExtract(state: GameState): ConditionalExtractResult | null {
  const fuse = state.bag.find((i) => (i.name || "").trim() === FUSE_NAME);
  if (!fuse) return null;

  const nextState = applyBagDelta(state, [], [fuse.id]);
  nextState.status = "WIN";
  nextState.logs = [...nextState.logs, "你把保险丝塞进断口，电流一闪，通道开了。你得救了。"];

  const sceneBlocks: SceneBlock[] = [
    { type: "EVENT", content: "你把保险丝塞进断口，电流一闪，通道开了。" },
    { type: "RESULT", content: "你没再回头。更稳的出路，值这一根保险丝。" },
  ];

  const summary: TurnSummary = {
    id: `cf-cond-${state.turn_index}-${Date.now()}`,
    turn: state.turn_index,
    decisionText: "条件撤离",
    outcomeText: "消耗保险丝，更稳撤离。",
    deltas: {
      batDelta: null,
      hpDelta: null,
      bagDelta: -1,
      pointsDelta: null,
    },
    statusBefore: state.status,
    statusAfter: "WIN",
    sceneBlocks: sceneBlocks.map((b) => ({ content: b.content })),
    conditionalExtract: true,
  };

  return { nextState, sceneBlocks, summary };
}
