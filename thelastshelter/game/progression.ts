/**
 * 结算页「下一档提升」锚点：材料进度 + 达成奖励文案。
 * 材料库存：m_apoc_material_inventory_v1（localStorage）
 * 仅统计材料类物品，结算时幂等计入带出物（与 runId 结算同步，不重复加）。
 */

import { isMaterialItem } from "./itemsCatalog";

const INVENTORY_KEY = "m_apoc_material_inventory_v1";

export interface MaterialCount {
  name: string;
  current: number;
  need: number;
}

export interface NextRigGoal {
  materials: MaterialCount[];
  rewardText: string;
}

function loadInventory(): Record<string, number> {
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    if (raw == null) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof k === "string" && typeof v === "number" && Number.isFinite(v) && v >= 0)
        out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

function saveInventory(inv: Record<string, number>): void {
  try {
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(inv));
  } catch {
    /* ignore */
  }
}

/** 读取当前材料库存（用于展示）。 */
export function getMaterialInventory(): Record<string, number> {
  return loadInventory();
}

/** 结算时把带出物品计入材料库存；仅在入账逻辑里调用一次（与 runId 幂等同步，不重复）。 */
export function addCarriedToMaterialInventory(bag: { name: string }[]): void {
  const inv = loadInventory();
  let changed = false;
  for (const item of bag) {
    const name = item?.name?.trim();
    if (!name || !isMaterialItem(name)) continue;
    inv[name] = (inv[name] ?? 0) + 1;
    changed = true;
  }
  if (changed) saveInventory(inv);
}

/** 下一档目标：level 1→2 保险丝×2；2→3 导线×3。默认 level 1。 */
export function getNextRigGoal(currentRigLevel: number): NextRigGoal {
  if (currentRigLevel < 1) return { materials: [], rewardText: "" };
  if (currentRigLevel === 1) {
    return {
      materials: [{ name: "保险丝", current: 0, need: 2 }],
      rewardText: "达成后：电量上限 +1",
    };
  }
  if (currentRigLevel === 2) {
    return {
      materials: [{ name: "导线", current: 0, need: 3 }],
      rewardText: "达成后：解锁应急火花",
    };
  }
  return { materials: [], rewardText: "已满档" };
}

/** 用当前库存填充 materials[].current；返回副本。 */
export function fillGoalWithInventory(
  goal: NextRigGoal,
  inventory: Record<string, number>
): NextRigGoal {
  return {
    ...goal,
    materials: goal.materials.map((m) => ({
      ...m,
      current: Math.min(m.need, inventory[m.name] ?? 0),
    })),
  };
}

/** 当前档位（V1 简化：按库存推断，未存 rigLevel 则 1）。 */
export function getCurrentRigLevel(): number {
  try {
    const raw = localStorage.getItem("m_apoc_rig_level_v1");
    if (raw == null) return 1;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? Math.min(3, n) : 1;
  } catch {
    return 1;
  }
}
