/**
 * 物品用途一行：拾取/替换弹窗、详情抽屉、结算带出清单用。
 * 最小映射表，覆盖 V1 核心 6–10 个物品。
 */

const PURPOSE_MAP: Record<string, string> = {
  "备用电池": "延长行动，关键时救命。",
  "保险丝": "解锁条件撤离，换更稳的出路。",
  "导线": "装备升级材料。",
  "药包": "保命阀，顶一次硬伤。",
  "密封药包": "保命阀，顶一次硬伤。",
  "军规电池": "延长行动，关键时救命。",
  "便携电源": "延长行动，关键时救命。",
  "绝缘胶带": "装备升级材料。",
  "破损零件": "低价值零件，可丢弃。",
};

/** 用途一行，无则 null（不显示）。 */
export function getItemPurpose(name: string): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const key = name.trim();
  return PURPOSE_MAP[key] ?? null;
}

/** 是否为材料/关键件（计入升级库存）。 */
export const MATERIAL_NAMES = new Set<string>([
  "备用电池",
  "保险丝",
  "导线",
  "军规电池",
  "密封药包",
  "便携电源",
  "绝缘胶带",
]);

export function isMaterialItem(name: string): boolean {
  return MATERIAL_NAMES.has(String(name).trim());
}

/** 价值档位：救命 / 关键 / 值钱 / 普通（不展示具体币值）。 */
export type ItemTier = "救命" | "关键" | "值钱" | "普通";

const TIER_MAP: Record<string, ItemTier> = {
  "备用电池": "救命",
  "军规电池": "关键",
  "便携电源": "救命",
  "保险丝": "关键",
  "药包": "救命",
  "密封药包": "救命",
  "导线": "值钱",
  "绝缘胶带": "值钱",
  "破损零件": "普通",
};

/** 物品价值档位；无映射或普通则返回「普通」，不显示时可当 null 用。 */
export function getItemTier(name: string): ItemTier {
  if (typeof name !== "string" || !name.trim()) return "普通";
  const key = name.trim();
  return TIER_MAP[key] ?? "普通";
}

/** 短句价值提示（用于 badge 旁）；普通/无映射可返回 null 不显示。 */
export function getItemShortValueHint(name: string): string | null {
  const tier = getItemTier(name);
  if (tier === "普通") return null;
  return tier;
}
