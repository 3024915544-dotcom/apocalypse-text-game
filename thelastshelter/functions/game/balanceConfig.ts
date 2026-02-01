/**
 * 牌面频率与窗口配置：窗口/保底/上限/变体偏置、撤离张力、节奏档位。
 * 牌面生成器只读此配置，不写死数字；支持 balanceProfile（prod/high/low）调频。
 */

export type BalanceProfile = "prod" | "high" | "low";

export interface RareLootConfig {
  /** 两段窗口 [start,end] 按变体选一段：夜行用 [3,5]，电量危机用 [8,10] */
  windows: [number, number][];
  guaranteePerRun: number;
  maxPerRun: number;
  /** 夜行偏电池类，电量危机偏值钱材料（仅描述，实际掉落仍由 rewardMoments 等决定） */
  variantBias: { night: string; battery_crisis: string };
}

export interface GambleConfig {
  window: [number, number];
  maxPerRun: number;
  minConditions: { bagNotFull: boolean; notInDark: boolean };
}

export interface ExtractPressureConfig {
  showOncePerRun: boolean;
  /** 出现撤离后若不撤离，隔 N 步再提醒一次，最多 2 次 */
  cooldownSteps: number;
  maxReminders: number;
}

export interface ExtractWindowConfig {
  /** 出现撤离后，N 步内必须给到一次强化提示 */
  softDeadlineSteps: number;
}

export interface TensionConfig {
  /** 用于局势提示的里程碑步数 */
  tensionMilestones: number[];
}

export interface BalanceConfig {
  rareLoot: RareLootConfig;
  gamble: GambleConfig;
  extractPressure: ExtractPressureConfig;
  extractWindow: ExtractWindowConfig;
  tension: TensionConfig;
}

const PROD: BalanceConfig = {
  rareLoot: {
    windows: [[3, 5], [8, 10]],
    guaranteePerRun: 1,
    maxPerRun: 2,
    variantBias: { night: "电池类", battery_crisis: "值钱材料" },
  },
  gamble: {
    window: [6, 11],
    maxPerRun: 1,
    minConditions: { bagNotFull: true, notInDark: true },
  },
  extractPressure: {
    showOncePerRun: true,
    cooldownSteps: 2,
    maxReminders: 2,
  },
  extractWindow: {
    softDeadlineSteps: 2,
  },
  tension: {
    tensionMilestones: [5, 9, 13],
  },
};

/** high：更密（稀有机会窗口放宽、孤注一掷窗口放宽、撤离压力可多提醒） */
const HIGH: BalanceConfig = {
  rareLoot: {
    windows: [[2, 6], [7, 11]],
    guaranteePerRun: 1,
    maxPerRun: 3,
    variantBias: { night: "电池类", battery_crisis: "值钱材料" },
  },
  gamble: {
    window: [5, 12],
    maxPerRun: 1,
    minConditions: { bagNotFull: true, notInDark: true },
  },
  extractPressure: {
    showOncePerRun: false,
    cooldownSteps: 1,
    maxReminders: 3,
  },
  extractWindow: {
    softDeadlineSteps: 2,
  },
  tension: {
    tensionMilestones: [5, 9, 13],
  },
};

/** low：更稀（窗口收窄、保底不变） */
const LOW: BalanceConfig = {
  rareLoot: {
    windows: [[4, 5], [9, 10]],
    guaranteePerRun: 1,
    maxPerRun: 1,
    variantBias: { night: "电池类", battery_crisis: "值钱材料" },
  },
  gamble: {
    window: [8, 10],
    maxPerRun: 1,
    minConditions: { bagNotFull: true, notInDark: true },
  },
  extractPressure: {
    showOncePerRun: true,
    cooldownSteps: 3,
    maxReminders: 1,
  },
  extractWindow: {
    softDeadlineSteps: 2,
  },
  tension: {
    tensionMilestones: [5, 9, 13],
  },
};

const PROFILES: Record<BalanceProfile, BalanceConfig> = {
  prod: PROD,
  high: HIGH,
  low: LOW,
};

export function getBalanceConfig(profile: BalanceProfile = "prod"): BalanceConfig {
  return PROFILES[profile] ?? PROD;
}

export function parseBalanceProfile(
  header: string | null,
  queryParam: string | null
): BalanceProfile {
  const raw = (header ?? queryParam ?? "").trim().toLowerCase();
  if (raw === "high" || raw === "low" || raw === "prod") return raw as BalanceProfile;
  return "prod";
}
