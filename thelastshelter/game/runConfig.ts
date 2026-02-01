/**
 * 单局运行配置存储：区域、变体、时间戳。
 * localStorage key: m_apoc_runConfig_v1
 * 解析失败一律回退到默认配置，禁止白屏。
 */

const STORAGE_KEY = "m_apoc_runConfig_v1";

export type RunConfigVariantId = "night" | "battery_crisis";

export interface RunConfig {
  version: number;
  regionId: string;
  variantId: RunConfigVariantId;
  ts: number;
  insurancePurchased?: boolean;
  insuranceUsed?: boolean;
  insuranceSlotIndex?: number;
  /** 局前勾选的挑战 ID 列表，最多 3 条。 */
  selectedContracts?: string[];
}

export const defaultRunConfig: RunConfig = {
  version: 1,
  regionId: "cold_block",
  variantId: "night",
  ts: 0,
  insurancePurchased: false,
  insuranceUsed: false,
  selectedContracts: [],
};

function isVariantId(v: unknown): v is RunConfigVariantId {
  return v === "night" || v === "battery_crisis";
}

function parseRunConfig(raw: unknown): RunConfig {
  if (!raw || typeof raw !== "object") return defaultRunConfig;
  const o = raw as Record<string, unknown>;
  const version = typeof o.version === "number" ? o.version : defaultRunConfig.version;
  const regionId = typeof o.regionId === "string" ? o.regionId : defaultRunConfig.regionId;
  const variantId = isVariantId(o.variantId) ? o.variantId : defaultRunConfig.variantId;
  const ts = typeof o.ts === "number" && Number.isFinite(o.ts) ? o.ts : Date.now();
  const insurancePurchased = typeof o.insurancePurchased === "boolean" ? o.insurancePurchased : defaultRunConfig.insurancePurchased ?? false;
  const insuranceUsed = typeof o.insuranceUsed === "boolean" ? o.insuranceUsed : defaultRunConfig.insuranceUsed ?? false;
  const insuranceSlotIndex = typeof o.insuranceSlotIndex === "number" ? o.insuranceSlotIndex : undefined;
  const selectedContracts = Array.isArray(o.selectedContracts)
    ? (o.selectedContracts as string[]).filter((s) => typeof s === "string").slice(0, 3)
    : defaultRunConfig.selectedContracts ?? [];
  return { version, regionId, variantId, ts, insurancePurchased, insuranceUsed, insuranceSlotIndex, selectedContracts };
}

/** 从 localStorage 读取；解析失败或缺失时返回默认配置。 */
export function getRunConfig(): RunConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultRunConfig;
    const parsed = JSON.parse(raw) as unknown;
    return parseRunConfig(parsed);
  } catch {
    return defaultRunConfig;
  }
}

/** 写入 localStorage，自动补全 ts。传入的 cfg 字段优先，不会被 default 覆盖。 */
export function setRunConfig(cfg: Partial<RunConfig>): void {
  try {
    const merged: RunConfig = {
      ...defaultRunConfig,
      ...cfg,
      ts: typeof cfg?.ts === "number" ? cfg.ts : Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 忽略写入失败（如隐私模式）
  }
}
