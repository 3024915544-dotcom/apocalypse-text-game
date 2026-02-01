/**
 * Power Rig 策略配置：局前可选 续航 vs 应急火花。
 * localStorage key: m_apoc_rig_loadout_v1
 */

const STORAGE_KEY = "m_apoc_rig_loadout_v1";

export type RigLoadoutId = "ENDURANCE" | "SPARK";

const DEFAULT: RigLoadoutId = "ENDURANCE";

function parse(raw: string | null): RigLoadoutId {
  if (raw === "ENDURANCE" || raw === "SPARK") return raw;
  return DEFAULT;
}

/** 读取当前配置；缺省 ENDURANCE。 */
export function getRigLoadout(): RigLoadoutId {
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT;
  }
}

/** 写入配置。 */
export function setRigLoadout(id: RigLoadoutId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export const RIG_LOADOUT_LABELS: Record<RigLoadoutId, string> = {
  ENDURANCE: "续航模块",
  SPARK: "应急火花",
};

export const RIG_LOADOUT_HINTS: Record<RigLoadoutId, string> = {
  ENDURANCE: "更适合深搜与多走几步。",
  SPARK: "更适合临界时保命撤离。",
};
