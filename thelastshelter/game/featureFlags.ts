/**
 * Feature flags：本地可配置、localStorage 持久化，控制风险功能显示与启用。
 * 仅通过 Debug 模式入口修改，不暴露给普通玩家。
 */

const STORAGE_KEY = "m_apoc_feature_flags_v1";
const DEBUG_KEY = "m_apoc_debug";

export interface FeatureFlags {
  contractsEnabled: boolean;
  insurancePayEnabled: boolean;
  turnTraceEnabled: boolean;
  fallbackBadgeEnabled: boolean;
  shelterHealthCheckEnabled: boolean;
  tutorialHintsEnabled: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  contractsEnabled: false,
  insurancePayEnabled: true,
  turnTraceEnabled: true,
  fallbackBadgeEnabled: true,
  shelterHealthCheckEnabled: true,
  tutorialHintsEnabled: true,
};

function mergeWithDefaults(partial: Partial<FeatureFlags> | null): FeatureFlags {
  if (!partial || typeof partial !== "object") return { ...DEFAULT_FLAGS };
  return {
    contractsEnabled: typeof partial.contractsEnabled === "boolean" ? partial.contractsEnabled : DEFAULT_FLAGS.contractsEnabled,
    insurancePayEnabled: typeof partial.insurancePayEnabled === "boolean" ? partial.insurancePayEnabled : DEFAULT_FLAGS.insurancePayEnabled,
    turnTraceEnabled: typeof partial.turnTraceEnabled === "boolean" ? partial.turnTraceEnabled : DEFAULT_FLAGS.turnTraceEnabled,
    fallbackBadgeEnabled: typeof partial.fallbackBadgeEnabled === "boolean" ? partial.fallbackBadgeEnabled : DEFAULT_FLAGS.fallbackBadgeEnabled,
    shelterHealthCheckEnabled: typeof partial.shelterHealthCheckEnabled === "boolean" ? partial.shelterHealthCheckEnabled : DEFAULT_FLAGS.shelterHealthCheckEnabled,
    tutorialHintsEnabled: typeof partial.tutorialHintsEnabled === "boolean" ? partial.tutorialHintsEnabled : DEFAULT_FLAGS.tutorialHintsEnabled,
  };
}

export function loadFeatureFlags(): FeatureFlags {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_FLAGS };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_FLAGS };
    const parsed = JSON.parse(raw) as Partial<FeatureFlags> | null;
    return mergeWithDefaults(parsed);
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export function saveFeatureFlags(flags: FeatureFlags): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeWithDefaults(flags)));
  } catch {
    /* ignore */
  }
}

/** Debug 模式：URL ?debug=1 或 sessionStorage m_apoc_debug=1（如连点版本号 5 次）。 */
export function isDebugMode(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") return true;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(DEBUG_KEY) === "1") return true;
    return false;
  } catch {
    return false;
  }
}

export function setDebugMode(on: boolean): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (on) sessionStorage.setItem(DEBUG_KEY, "1");
    else sessionStorage.removeItem(DEBUG_KEY);
  } catch {
    /* ignore */
  }
}
