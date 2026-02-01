/**
 * 新手提示：3 条一次性提示，localStorage 持久化，跨刷新不重复。
 */

const STORAGE_KEY = "m_apoc_tutorial_hints_seen_v1";

export type TutorialHintKey = "BAG_FULL" | "BAT_LOW" | "EXTRACT_CHOICES";

export type TutorialHintsSeen = Partial<Record<TutorialHintKey, true>>;

const DEFAULT_SEEN: TutorialHintsSeen = {};

function parseSeen(raw: string | null): TutorialHintsSeen {
  if (raw == null) return { ...DEFAULT_SEEN };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SEEN };
    const o = parsed as Record<string, unknown>;
    const out: TutorialHintsSeen = {};
    if (o.BAG_FULL === true) out.BAG_FULL = true;
    if (o.BAT_LOW === true) out.BAT_LOW = true;
    if (o.EXTRACT_CHOICES === true) out.EXTRACT_CHOICES = true;
    return out;
  } catch {
    return { ...DEFAULT_SEEN };
  }
}

export function loadHintsSeen(): TutorialHintsSeen {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_SEEN };
    return parseSeen(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SEEN };
  }
}

export function markHintSeen(key: TutorialHintKey): void {
  try {
    if (typeof localStorage === "undefined") return;
    const prev = parseSeen(localStorage.getItem(STORAGE_KEY));
    prev[key] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
  } catch {
    /* ignore */
  }
}
