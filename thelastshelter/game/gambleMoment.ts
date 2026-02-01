/**
 * 每局 1 次“高风险高收益窗口”：前端注入，不请求 /api/turn。
 * 触发窗口 stepIndex ∈ [6, 11]，持久化防刷新重复。
 * localStorage key: m_apoc_gamble_moment_v1
 */

import type { GameState } from "../types";
import type { BagItem } from "../types";
import type { Choice } from "../types";
import type { SceneBlock } from "../types";
import type { TurnSummary } from "./contextFeed";
import { BAG_CAPACITY, BATTERY_MAX } from "../constants";

const STORAGE_KEY = "m_apoc_gamble_moment_v1";

const GAMBLE_STEP_MIN = 6;
const GAMBLE_STEP_MAX = 11;

const WIN_BAT_THRESHOLD = 3;
const WIN_HP_THRESHOLD = 40;

function loadTriggered(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return {};
    const o = JSON.parse(raw);
    return typeof o === "object" && o !== null ? o : {};
  } catch {
    return {};
  }
}

function saveTriggered(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function isGambleTriggered(runId: string): boolean {
  return loadTriggered()[runId] === true;
}

export function setGambleTriggered(runId: string): void {
  const state = loadTriggered();
  state[runId] = true;
  saveTriggered(state);
}

export function clearGambleMoments(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 是否处于赌感窗口且未触发过、非黑暗、背包未满。 */
export function shouldShowGamble(runId: string, state: GameState): boolean {
  const step = state.turn_index;
  if (step < GAMBLE_STEP_MIN || step > GAMBLE_STEP_MAX) return false;
  if (isGambleTriggered(runId)) return false;
  const bat = state.battery ?? BATTERY_MAX;
  if (bat <= 0) return false;
  if (state.bag.length >= BAG_CAPACITY) return false;
  return true;
}

const GAMBLE_CHOICE_ID = "gamble-local";

export function getGambleChoice(): Choice {
  return {
    id: GAMBLE_CHOICE_ID,
    label: "摸黑翻进去（赌一把）",
    hint: "高风险高收益，成败在此一举。",
    risk: "HIGH" as import("../types").RiskLevel,
    preview_cost: {},
    action_type: "SEARCH",
  };
}

export function isGambleChoice(c: Choice): boolean {
  return c.id === GAMBLE_CHOICE_ID;
}

const WIN_ITEMS: BagItem[] = [
  { id: "gamble-win-1", name: "军规电池", type: "MISC", value: 25, tag: "loot" },
  { id: "gamble-win-2", name: "密封药包", type: "MED", value: 22, tag: "loot" },
];

const LOSE_ITEM: BagItem = { id: "gamble-lose-1", name: "破损零件", type: "MISC", value: 5, tag: "loot" };

export interface GambleResult {
  nextState: GameState;
  sceneBlocks: SceneBlock[];
  summary: TurnSummary;
  addedItem: BagItem | null;
  batDelta: number;
  hpDelta: number;
  bagDelta: number;
  won: boolean;
}

/** 确定性结果：电量≥阈值且生命＞阈值 → 赚；否则亏。不讲概率。 */
export function resolveGamble(state: GameState): GambleResult {
  const bat = state.battery ?? BATTERY_MAX;
  const hp = state.hp ?? 100;
  const won = bat >= WIN_BAT_THRESHOLD && hp > WIN_HP_THRESHOLD;

  let nextState: GameState = { ...state, logs: [...state.logs], bag: [...state.bag] };
  nextState.turn_index += 1;

  let sceneBlocks: SceneBlock[];
  let addedItem: BagItem | null = null;
  let batDelta = 0;
  let hpDelta = 0;

  if (won) {
    nextState.battery = Math.max(0, bat - 2);
    nextState.exposure = Math.min(100, (nextState.exposure ?? 0) + 8);
    batDelta = -2;
    const winItem = WIN_ITEMS[nextState.turn_index % WIN_ITEMS.length];
    const itemWithId = { ...winItem, id: `gamble-${state.runId}-${Date.now()}` };
    if (nextState.bag.length < BAG_CAPACITY) {
      nextState.bag = [...nextState.bag, itemWithId];
      addedItem = itemWithId;
    }
    nextState.logs.push(`你摸黑翻进去，摸到了${itemWithId.name}。代价是电量和暴露。`);
    sceneBlocks = [
      { type: "EVENT", content: "你决定赌一把，摸黑翻进废墟深处。" },
      { type: "RESULT", content: `找到了${itemWithId.name}。电量与暴露上升，但值得。` },
    ];
  } else {
    nextState.hp = Math.max(0, hp - 2);
    hpDelta = -2;
    if (nextState.bag.length < BAG_CAPACITY) {
      const low = { ...LOSE_ITEM, id: `gamble-lose-${state.runId}-${Date.now()}` };
      nextState.bag = [...nextState.bag, low];
      addedItem = low;
    }
    nextState.logs.push("你摸黑翻进去，险些出事。身体受了伤，只摸到一点破烂。");
    sceneBlocks = [
      { type: "EVENT", content: "你决定赌一把，摸黑翻进废墟深处。" },
      { type: "RESULT", content: "险些出事，身体受了伤，只摸到一点破烂。赌输了。" },
    ];
  }

  const bagCountBefore = state.bag.length;
  const bagCountAfter = nextState.bag.length;
  const bagDelta = bagCountAfter - bagCountBefore;

  const summary: TurnSummary = {
    id: `cf-gamble-${state.turn_index}-${Date.now()}`,
    turn: state.turn_index,
    decisionText: "摸黑翻进去（赌一把）",
    outcomeText: won ? `找到高价值物，代价是电量与暴露。` : `赌输了，身体受伤，只摸到破烂。`,
    deltas: {
      batDelta: batDelta || null,
      hpDelta: hpDelta || null,
      bagDelta: bagDelta !== 0 ? bagDelta : null,
      pointsDelta: null,
    },
    statusBefore: state.status,
    statusAfter: nextState.status,
    sceneBlocks: sceneBlocks.map((b) => ({ content: b.content })),
    enteredDarkMode: (nextState.battery ?? BATTERY_MAX) <= 0,
    isGamble: true,
    gainedItemNames: addedItem ? [addedItem.name] : undefined,
  };

  return {
    nextState,
    sceneBlocks,
    summary,
    addedItem,
    batDelta,
    hpDelta,
    bagDelta,
    won,
  };
}
