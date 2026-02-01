import React, { useState, useEffect, useRef } from 'react';
import { GameState, TurnResponse, ActionType, RiskLevel, DirectionHint, BagItem, SceneBlock } from './types';
import { createInitialState, applyAction, applyBagDelta, getEmptyBagSlots } from './engine';
import { fetchTurnResponse, type TurnRequestMeta, type TurnError } from './geminiService';
import { GRID_SIZE, MAX_TURNS, MILESTONES, BAG_CAPACITY, BATTERY_MAX } from './constants';
import { logTurnTrace, detectFallback } from './game/turnTrace';
import { loadFeatureFlags } from './game/featureFlags';
import { loadHintsSeen, markHintSeen, type TutorialHintKey } from './game/tutorialHints';
import { getSurvivalPoints, addSurvivalPoints, computeRunPoints, getCurrentRunId, setCurrentRunId, isRunSettled, markRunSettled } from './game/economy';
import { getRunConfig, setRunConfig } from './game/runConfig';
import { pickKeptItem, setStoredKeptItem } from './game/insurance';
import ShelterHome from './ShelterHome';

type LogbookEntry = {
  id: string;
  turn: number;
  action: ActionType;
  timestamp: number;
  scene_blocks: SceneBlock[];
  battery?: number;
  hp?: number;
  exposure?: number;
  status: GameState['status'];
};

function actionLabel(action: ActionType): string {
  if (action === 'INIT') return '开始';
  if (action === 'MOVE_N') return '向北';
  if (action === 'MOVE_S') return '向南';
  if (action === 'MOVE_E') return '向东';
  if (action === 'MOVE_W') return '向西';
  if (action === 'SEARCH') return '搜索';
  return String(action);
}

/** 局内界面：现有局内 UI/逻辑原封不动。 */
function RunScreen() {
  const [gameState, setGameState] = useState<GameState>(() => {
    const state = createInitialState();
    const persistedRunId = getCurrentRunId();
    if (persistedRunId) state.runId = persistedRunId;
    return state;
  });
  const [lastResponse, setLastResponse] = useState<TurnResponse | null>(null);
  const [turnInFlight, setTurnInFlight] = useState(false);
  const [turnError, setTurnError] = useState<TurnError | null>(() => {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('m_apoc_init_failed_v1') === '1')
        return { type: 'UNKNOWN', message: '上次通讯异常，请返回避难所后重新进入。' };
    } catch {
      /* ignore */
    }
    return null;
  });
  /** 仅请求失败时写入；成功时清空；重试时用此 envelope 重发。 */
  const [lastFailedTurn, setLastFailedTurn] = useState<{
    snapshotState: GameState;
    action: ActionType;
    meta: TurnRequestMeta;
    createdAt: number;
  } | null>(null);
  const [settlementRunPoints, setSettlementRunPoints] = useState<number | null>(null);
  const [lastActionType, setLastActionType] = useState<ActionType | null>(null);
  const [pendingAdds, setPendingAdds] = useState<BagItem[]>([]);
  const [isBagModalOpen, setIsBagModalOpen] = useState(false);
  const [pendingAddItem, setPendingAddItem] = useState<BagItem | null>(null);
  const [replaceSlotMode, setReplaceSlotMode] = useState(false);
  const [insuranceKeptName, setInsuranceKeptName] = useState<string | null>(null);
  const [insuranceSettlementMessage, setInsuranceSettlementMessage] = useState<string | null>(null);
  const [logbook, setLogbook] = useState<LogbookEntry[]>([]);
  const [isLogbookOpen, setIsLogbookOpen] = useState(false);
  const [logbookOpenSet, setLogbookOpenSet] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCreditedRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const devPickupCounterRef = useRef(0);
  const [settlementButtonsDisabled, setSettlementButtonsDisabled] = useState(false);
  const [featureFlags] = useState(() => loadFeatureFlags());
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false);
  const [activeHint, setActiveHint] = useState<{ key: TutorialHintKey; text: string } | null>(null);
  const batteryHintShownRef = useRef(loadHintsSeen().BAT_LOW === true);
  const extractHintShownRef = useRef(loadHintsSeen().EXTRACT_CHOICES === true);

  useEffect(() => {
    setCurrentRunId(gameState.runId);
  }, [gameState.runId]);

  /** 仅局内且未初始化过时自动 INIT；结算/非 PLAYING、已失败 INIT 或刷新恢复的失败态不自动发。 */
  useEffect(() => {
    if (gameState.status !== 'PLAYING') return;
    if (hasInitializedRef.current) return;
    if (lastFailedTurn?.action === 'INIT') return;
    try {
      if (sessionStorage.getItem('m_apoc_init_failed_v1') === '1') return;
    } catch {
      /* ignore */
    }
    hasInitializedRef.current = true;
    submitTurn('INIT');
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastResponse]);

  /** 提示 A：背包满 — 出现背包满弹窗时且未看过则显示一次。 */
  useEffect(() => {
    if (!isBagModalOpen || !pendingAddItem || !featureFlags.tutorialHintsEnabled) return;
    if (loadHintsSeen().BAG_FULL === true) return;
    setActiveHint({ key: 'BAG_FULL', text: '背包满了：你需要替换或丢弃一件物品。' });
  }, [isBagModalOpen, pendingAddItem, featureFlags.tutorialHintsEnabled]);

  /** 提示 B：电量见底 — 电量首次降到阈值以下时显示一次。 */
  useEffect(() => {
    if (!featureFlags.tutorialHintsEnabled) return;
    if (batteryHintShownRef.current || loadHintsSeen().BAT_LOW === true) return;
    const bat = gameState.battery ?? BATTERY_MAX;
    if (bat > 2) return;
    batteryHintShownRef.current = true;
    setActiveHint({ key: 'BAT_LOW', text: '电量见底：再耗尽会进入「黑暗模式」，尽量考虑撤离。' });
  }, [gameState.battery, featureFlags.tutorialHintsEnabled]);

  /** 提示 C：双撤离点首次出现 — choices 中首次出现撤离-近/撤离-远时显示一次。 */
  useEffect(() => {
    if (!featureFlags.tutorialHintsEnabled) return;
    if (extractHintShownRef.current || loadHintsSeen().EXTRACT_CHOICES === true) return;
    const choices = lastResponse?.choices ?? [];
    const hasExtract = choices.some((c) => (c.label && (c.label.includes('撤离-近') || c.label.includes('撤离-远'))));
    if (!hasExtract) return;
    extractHintShownRef.current = true;
    setActiveHint({ key: 'EXTRACT_CHOICES', text: '撤离有两种：近撤离要等一回合更危险；远撤离更耗电但更稳。' });
  }, [lastResponse?.choices, featureFlags.tutorialHintsEnabled]);

  /** 提示条自动消失（8 秒）。 */
  useEffect(() => {
    if (!activeHint) return;
    const t = setTimeout(() => {
      markHintSeen(activeHint.key);
      setActiveHint(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [activeHint]);

  // 结算入账：仅在本局首次变为非 PLAYING 时执行一次；死亡且保险时保留 1 格并计分；幂等防重复入账
  useEffect(() => {
    if (gameState.status === 'PLAYING') return;
    if (hasCreditedRef.current) return;
    if (isRunSettled(gameState.runId)) {
      hasCreditedRef.current = true;
      const points = computeRunPoints(gameState);
      setSettlementRunPoints(points);
      return;
    }
    hasCreditedRef.current = true;
    const runConfig = getRunConfig();
    let points: number;
    if (gameState.status === 'LOSS') {
      if (runConfig.insurancePurchased === true && runConfig.insuranceUsed !== true) {
        const keptItem = pickKeptItem(gameState.bag);
        setGameState(prev => ({ ...prev, bag: keptItem ? [keptItem] : [] }));
        setRunConfig({ insuranceUsed: true });
        if (keptItem) {
          setStoredKeptItem(keptItem);
          setInsuranceKeptName(keptItem.name);
          setInsuranceSettlementMessage('保险袋保住：' + keptItem.name);
          points = computeRunPoints(gameState, keptItem);
        } else {
          setInsuranceKeptName(null);
          setInsuranceSettlementMessage('你什么也没带出来。');
          points = computeRunPoints(gameState);
        }
      } else {
        setGameState(prev => ({ ...prev, bag: [] }));
        setInsuranceKeptName(null);
        setInsuranceSettlementMessage('你什么也没带出来。');
        points = computeRunPoints(gameState);
      }
    } else {
      points = computeRunPoints(gameState);
      setInsuranceSettlementMessage(null);
    }
    addSurvivalPoints(points);
    markRunSettled(gameState.runId);
    setSettlementRunPoints(points);
  }, [gameState.status]);

  /** 通信失败时使用的 fallback，保证回合推进与扣电；choices 使用真实 ActionType。 */
  const buildFallbackResponse = (): TurnResponse => ({
    scene_blocks: [
      { type: 'TITLE', content: '通信中断' },
      { type: 'EVENT', content: '你只能靠直觉行动。' },
    ],
    choices: [
      { id: 'fb-n', label: '向北', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_N' },
      { id: 'fb-e', label: '向东', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_E' },
      { id: 'fb-s', label: '向南', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_S' },
      { id: 'fb-w', label: '向西', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_W' },
      { id: 'fb-search', label: '搜索', hint: '翻找', risk: RiskLevel.MID, preview_cost: {}, action_type: 'SEARCH' },
    ],
    ui: {
      progress: { turn_index: gameState.turn_index, milestones_hit: [] },
      map_delta: { reveal_indices: [], direction_hint: DirectionHint.NONE },
      bag_delta: { add: [], remove: [] },
    },
    suggestion: { delta: {} },
    memory_update: '',
  });

  /** 唯一入口：推进回合。单飞锁 + 返回一致性校验，失败不写档。 */
  const submitTurn = async (action: ActionType) => {
    if (turnInFlight) return;
    setLastActionType(action);
    if (gameState.status !== 'PLAYING' && action !== 'INIT') return;
    setTurnInFlight(true);
    setTurnError(null);
    const clientTurnIndex = gameState.turn_index;
    const runId = gameState.runId;
    const snapshotState = action !== 'INIT' ? applyAction(gameState, action, {} as Parameters<typeof applyAction>[2]) : gameState;
    const meta: TurnRequestMeta = { runId, clientTurnIndex };
    const batBefore = snapshotState.battery ?? null;
    const hpBefore = snapshotState.hp ?? null;
    const bagCountBefore = snapshotState.bag.length;
    const statusBefore = snapshotState.status;
    try {
      const response = await fetchTurnResponse(snapshotState, action, meta);
      const respTurnIndex = response.ui?.progress?.turn_index;
      if (respTurnIndex != null) {
        const expectedNext = clientTurnIndex + 1;
        if (respTurnIndex !== expectedNext) {
          setTurnError({ type: 'UNKNOWN', message: '回合同步异常，已取消本次推进，请重试' });
          logTurnTrace({
            ts: Date.now(),
            runId,
            clientTurnIndex,
            action: String(action),
            ok: false,
            errType: 'UNKNOWN',
            batBefore,
            batAfter: null,
            hpBefore,
            hpAfter: null,
            bagCountBefore,
            bagCountAfter: bagCountBefore,
            statusBefore,
            statusAfter: statusBefore,
          });
          return;
        }
      }
      setLastFailedTurn(null);
      try {
        sessionStorage.removeItem('m_apoc_init_failed_v1');
      } catch {
        /* ignore */
      }
      if (action !== 'INIT') {
        setGameState(prev => applyAction(prev, action, {} as Parameters<typeof applyAction>[2]));
      }
      setLastResponse(response);
      const addCount = response.ui?.bag_delta?.add?.length ?? 0;
      const removeCount = response.ui?.bag_delta?.remove?.length ?? 0;
      const bagCountAfter = snapshotState.bag.length + addCount - removeCount;
      if (loadFeatureFlags().turnTraceEnabled) {
        logTurnTrace({
          ts: Date.now(),
          runId,
          clientTurnIndex,
          action: String(action),
          ok: true,
          isFallback: detectFallback(response),
          batBefore,
          batAfter: snapshotState.battery ?? null,
          hpBefore,
          hpAfter: snapshotState.hp ?? null,
          bagCountBefore,
          bagCountAfter,
          statusBefore,
          statusAfter: snapshotState.status,
        });
      }
      const turnIdx = snapshotState.turn_index;
      const logEntry: LogbookEntry = {
        id: `${turnIdx}-${Date.now()}`,
        turn: turnIdx,
        action,
        timestamp: Date.now(),
        scene_blocks: response.scene_blocks ?? [],
        battery: snapshotState.battery,
        hp: snapshotState.hp,
        exposure: snapshotState.exposure,
        status: snapshotState.status,
      };
      setLogbook(prev => [...prev, logEntry]);
      setLogbookOpenSet(prev => ({
        ...prev,
        [turnIdx]: true,
        [turnIdx - 1]: true,
        [turnIdx - 2]: true,
      }));
      const rawAdds = response.ui?.bag_delta?.add ?? [];
      const adds: BagItem[] = rawAdds.map((a): BagItem => ({
        id: a.id,
        name: a.name,
        type: (a.type as BagItem['type']) || 'MISC',
        value: typeof a.value === 'number' && Number.isFinite(a.value) ? Math.floor(a.value) : 10,
        tag: a.tag,
        rarity: a.rarity,
      }));
      const removes = response.ui?.bag_delta?.remove ?? [];
      if (response.ui?.bag_delta) {
        if (adds.length > 0) {
          const emptySlots = getEmptyBagSlots(snapshotState);
          if (emptySlots >= adds.length) {
            setGameState(prev => applyBagDelta(prev, adds, removes));
          } else {
            const fillFirst = adds.slice(0, emptySlots);
            const rest = adds.slice(emptySlots);
            if (fillFirst.length > 0) {
              setGameState(prev => applyBagDelta(prev, fillFirst, removes));
            }
            setPendingAdds(prev => [...prev, ...rest]);
            setPendingAddItem(rest[0] ?? null);
            setIsBagModalOpen(true);
          }
        } else {
          setGameState(prev => applyBagDelta(prev, [], removes));
        }
      }
    } catch (err) {
      const te: TurnError =
        err != null && typeof err === 'object' && 'type' in err && 'message' in err
          ? (err as TurnError)
          : { type: 'UNKNOWN', message: '请求失败，请重试或返回避难所', debug: err instanceof Error ? err.message : String(err) };
      setTurnError(te);
      setLastFailedTurn({ snapshotState, action, meta, createdAt: Date.now() });
      if (loadFeatureFlags().turnTraceEnabled) {
        logTurnTrace({
          ts: Date.now(),
          runId,
          clientTurnIndex,
          action: String(action),
          ok: false,
          errType: te.type,
          httpStatus: te.status,
          batBefore,
          batAfter: null,
          hpBefore,
          hpAfter: null,
          bagCountBefore,
          bagCountAfter: bagCountBefore,
          statusBefore,
          statusAfter: statusBefore,
        });
      }
      if (action === 'INIT') {
        try {
          sessionStorage.setItem('m_apoc_init_failed_v1', '1');
        } catch {
          /* ignore */
        }
      }
    } finally {
      setTurnInFlight(false);
    }
  };

  /** 用上次失败时的 envelope 重发；走单飞锁，成功清 envelope 并应用，失败不写档。 */
  const retryLastFailedTurn = async () => {
    if (!lastFailedTurn || turnInFlight) return;
    setTurnInFlight(true);
    setTurnError(null);
    const { snapshotState, action, meta } = lastFailedTurn;
    const clientTurnIndex = meta.clientTurnIndex;
    const runId = meta.runId;
    const batBefore = snapshotState.battery ?? null;
    const hpBefore = snapshotState.hp ?? null;
    const bagCountBefore = snapshotState.bag.length;
    const statusBefore = snapshotState.status;
    try {
      const response = await fetchTurnResponse(snapshotState, action, meta);
      const respTurnIndex = response.ui?.progress?.turn_index;
      if (respTurnIndex != null) {
        const expectedNext = clientTurnIndex + 1;
        if (respTurnIndex !== expectedNext) {
          setTurnError({ type: 'UNKNOWN', message: '回合同步异常，已取消本次推进，请重试' });
          if (loadFeatureFlags().turnTraceEnabled) {
            logTurnTrace({
              ts: Date.now(),
              runId,
              clientTurnIndex,
              action: String(action),
              ok: false,
              errType: 'UNKNOWN',
              batBefore,
              batAfter: null,
              hpBefore,
              hpAfter: null,
              bagCountBefore,
              bagCountAfter: bagCountBefore,
              statusBefore,
              statusAfter: statusBefore,
            });
          }
          return;
        }
      }
      setLastFailedTurn(null);
      try {
        sessionStorage.removeItem('m_apoc_init_failed_v1');
      } catch {
        /* ignore */
      }
      if (action !== 'INIT') {
        setGameState(prev => applyAction(prev, action, {} as Parameters<typeof applyAction>[2]));
      }
      setLastResponse(response);
      const addCount = response.ui?.bag_delta?.add?.length ?? 0;
      const removeCount = response.ui?.bag_delta?.remove?.length ?? 0;
      const bagCountAfter = snapshotState.bag.length + addCount - removeCount;
      if (loadFeatureFlags().turnTraceEnabled) {
        logTurnTrace({
          ts: Date.now(),
          runId,
          clientTurnIndex,
          action: String(action),
          ok: true,
          isFallback: detectFallback(response),
          batBefore,
          batAfter: snapshotState.battery ?? null,
          hpBefore,
          hpAfter: snapshotState.hp ?? null,
          bagCountBefore,
          bagCountAfter,
          statusBefore,
          statusAfter: snapshotState.status,
        });
      }
      const turnIdx = snapshotState.turn_index;
      const logEntry: LogbookEntry = {
        id: `${turnIdx}-${Date.now()}`,
        turn: turnIdx,
        action,
        timestamp: Date.now(),
        scene_blocks: response.scene_blocks ?? [],
        battery: snapshotState.battery,
        hp: snapshotState.hp,
        exposure: snapshotState.exposure,
        status: snapshotState.status,
      };
      setLogbook(prev => [...prev, logEntry]);
      setLogbookOpenSet(prev => ({
        ...prev,
        [turnIdx]: true,
        [turnIdx - 1]: true,
        [turnIdx - 2]: true,
      }));
      const rawAdds = response.ui?.bag_delta?.add ?? [];
      const adds: BagItem[] = rawAdds.map((a): BagItem => ({
        id: a.id,
        name: a.name,
        type: (a.type as BagItem['type']) || 'MISC',
        value: typeof a.value === 'number' && Number.isFinite(a.value) ? Math.floor(a.value) : 10,
        tag: a.tag,
        rarity: a.rarity,
      }));
      const removes = response.ui?.bag_delta?.remove ?? [];
      if (response.ui?.bag_delta) {
        if (adds.length > 0) {
          const emptySlots = getEmptyBagSlots(snapshotState);
          if (emptySlots >= adds.length) {
            setGameState(prev => applyBagDelta(prev, adds, removes));
          } else {
            const fillFirst = adds.slice(0, emptySlots);
            const rest = adds.slice(emptySlots);
            if (fillFirst.length > 0) {
              setGameState(prev => applyBagDelta(prev, fillFirst, removes));
            }
            setPendingAdds(prev => [...prev, ...rest]);
            setPendingAddItem(rest[0] ?? null);
            setIsBagModalOpen(true);
          }
        } else {
          setGameState(prev => applyBagDelta(prev, [], removes));
        }
      }
    } catch (err) {
      const te: TurnError =
        err != null && typeof err === 'object' && 'type' in err && 'message' in err
          ? (err as TurnError)
          : { type: 'UNKNOWN', message: '请求失败，请重试或返回避难所', debug: err instanceof Error ? err.message : String(err) };
      setTurnError(te);
      if (loadFeatureFlags().turnTraceEnabled) {
        logTurnTrace({
          ts: Date.now(),
          runId,
          clientTurnIndex,
          action: String(action),
          ok: false,
          errType: te.type,
          httpStatus: te.status,
          batBefore,
          batAfter: null,
          hpBefore,
          hpAfter: null,
          bagCountBefore,
          bagCountAfter: bagCountBefore,
          statusBefore,
          statusAfter: statusBefore,
        });
      }
      if (action === 'INIT') {
        try {
          sessionStorage.setItem('m_apoc_init_failed_v1', '1');
        } catch {
          /* ignore */
        }
      }
    } finally {
      setTurnInFlight(false);
    }
  };

  /** 退出局内：清理错误态与本局态，保留 runConfig，不触发入账/INIT。 */
  const exitToShelter = () => {
    setTurnError(null);
    setTurnInFlight(false);
    setLastFailedTurn(null);
    setLastActionType(null);
    try {
      sessionStorage.removeItem('m_apoc_init_failed_v1');
    } catch {
      /* ignore */
    }
    setRunConfig({ insuranceUsed: false });
    const newState = createInitialState();
    setCurrentRunId(newState.runId);
    setGameState(newState);
    setLastResponse(null);
    setPendingAdds([]);
    setIsBagModalOpen(false);
    setPendingAddItem(null);
    setReplaceSlotMode(false);
    setLogbook([]);
    setLogbookOpenSet({});
    window.location.hash = '#/';
  };

  const restartGame = () => {
    hasCreditedRef.current = false;
    setSettlementRunPoints(null);
    setInsuranceKeptName(null);
    setInsuranceSettlementMessage(null);
    setSettlementButtonsDisabled(false);
    setTurnError(null);
    setRunConfig({ insuranceUsed: false });
    const newState = createInitialState();
    setCurrentRunId(newState.runId);
    setGameState(newState);
    setLastResponse(null);
    setPendingAdds([]);
    setIsBagModalOpen(false);
    setPendingAddItem(null);
    setReplaceSlotMode(false);
    setLogbook([]);
    setLogbookOpenSet({});
    submitTurn('INIT');
  };

  const handleBagDiscard = () => {
    setPendingAdds(prev => {
      const next = prev.slice(1);
      if (next.length === 0) {
        setIsBagModalOpen(false);
        setPendingAddItem(null);
      } else {
        setPendingAddItem(next[0]);
      }
      return next;
    });
  };

  const handleBagReplaceSlot = (slotIndex: number) => {
    const item = gameState.bag[slotIndex];
    const current = pendingAddItem;
    if (!item || !current) return;
    setGameState(prev => {
      const next = applyBagDelta(prev, [current], [item.id]);
      return { ...next, logs: [...next.logs, `你用${current.name}替换了${item.name}`] };
    });
    setPendingAdds(prev => {
      const next = prev.slice(1);
      if (next.length === 0) {
        setIsBagModalOpen(false);
        setPendingAddItem(null);
        setReplaceSlotMode(false);
      } else {
        setPendingAddItem(next[0]);
        setReplaceSlotMode(false);
      }
      return next;
    });
  };

  /** DEV-only: +1 测试物品，未满直接入包并 log，已满弹替换弹窗。 */
  const devPickupOneItem = () => {
    devPickupCounterRef.current += 1;
    const n = devPickupCounterRef.current;
    const testItem: BagItem = {
      id: `dev-pickup-${Date.now()}-${n}`,
      name: `测试物品 #${n}`,
      type: 'MISC',
      value: 10,
      tag: 'loot',
    };
    if (isBagModalOpen) {
      setPendingAdds(prev => [...prev, testItem]);
      return;
    }
    const emptySlots = getEmptyBagSlots(gameState);
    if (emptySlots >= 1) {
      setGameState(prev => {
        const next = applyBagDelta(prev, [testItem], []);
        return { ...next, logs: [...next.logs, '获得：' + testItem.name] };
      });
    } else {
      setPendingAdds(prev => [...prev, testItem]);
      setPendingAddItem(testItem);
      setIsBagModalOpen(true);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#0a0a0a] text-[#d1d1d1] selection:bg-red-900/40 p-2 md:p-6 overflow-hidden relative">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/asfalt-dark.png')]" aria-hidden="true" />
      <div className="flex flex-col mb-4 relative z-10">
        <div className="flex justify-between items-end mb-2">
          <h1 className="text-xl md:text-2xl font-bold italic text-white font-['Playfair_Display']">THE LAST SHELTER <span className="text-xs font-mono text-gray-500 uppercase not-italic tracking-tighter ml-2">CH-01: THE COLD VOID</span></h1>
          <div className="flex flex-wrap items-center gap-3 text-xs">
             <div className="flex items-center gap-1">
               <span className="text-gray-500">HP</span>
               <div className="w-16 md:w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                 <div className="h-full bg-red-600 transition-all duration-500" style={{ width: `${gameState.hp}%` }}></div>
               </div>
             </div>
             <div className="flex items-center gap-1">
               <span className="text-gray-500">EXPO</span>
               <div className="w-16 md:w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                 <div className="h-full bg-yellow-500 transition-all duration-500" style={{ width: `${gameState.exposure}%` }}></div>
               </div>
             </div>
             <div className="flex items-center gap-1">
               <span className="text-gray-500">电量</span>
               <div className="w-16 md:w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
                 <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, (gameState.battery ?? BATTERY_MAX) / BATTERY_MAX * 100))}%` }}></div>
               </div>
               <span className="text-[10px] font-mono text-gray-400 tabular-nums">{gameState.battery ?? BATTERY_MAX}/{BATTERY_MAX}</span>
             </div>
             {(gameState.battery ?? BATTERY_MAX) <= 0 && (
               <span className="px-2 py-0.5 text-[10px] font-bold text-red-500 border border-red-700 bg-black/60">黑暗模式</span>
             )}
             {import.meta.env.DEV && (
               <div className="text-[10px] text-gray-500">
                 DEV turn={gameState.turn_index} action={String(lastActionType)} battery={gameState.battery}
               </div>
             )}
          </div>
        </div>
        <div className="relative w-full h-1.5 bg-gray-900 rounded-full overflow-hidden flex items-center">
          {MILESTONES.map(m => (
            <div key={m} className={`absolute h-3 w-3 rounded-full z-20 border border-black ${gameState.turn_index >= m ? 'bg-orange-500' : 'bg-gray-700'}`} style={{ left: `${(m / MAX_TURNS) * 100}%` }}></div>
          ))}
          <div className="h-full bg-orange-800 transition-all duration-500" style={{ width: `${(gameState.turn_index / MAX_TURNS) * 100}%` }}></div>
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-gray-600 font-mono tracking-widest">
          <span>START</span>
          <span>TURN {gameState.turn_index}/{MAX_TURNS}</span>
          <span>END</span>
        </div>
        {import.meta.env.DEV && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="px-2 py-1 text-[10px] font-mono text-gray-500 bg-black/60 border border-gray-700 rounded">
              电量: {gameState.battery ?? BATTERY_MAX}/{BATTERY_MAX} · 上次操作: {lastActionType ?? '-'} · logbook={logbook.length}
            </div>
            <button
              type="button"
              className="px-2 py-1 text-[10px] font-mono text-amber-500 border border-amber-700 bg-black/60 hover:bg-amber-900/30 rounded"
              onClick={() => {
                setGameState(prev => ({
                  ...prev,
                  bag: Array.from({ length: BAG_CAPACITY }, (_, i) => ({
                    id: `dev-fill-${i}`,
                    name: `测试物品${i + 1}`,
                    type: 'MISC' as const,
                    value: 10,
                  })),
                }));
              }}
            >
              一键填满背包（测试）
            </button>
            <button
              type="button"
              className="px-2 py-1 text-[10px] font-mono text-emerald-500 border border-emerald-700 bg-black/60 hover:bg-emerald-900/30 rounded"
              onClick={devPickupOneItem}
            >
              +1 测试物品
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-row overflow-hidden relative z-10 min-h-0">
        {featureFlags.mapPanelEnabled && (
          <div className="w-[260px] shrink-0 h-full flex flex-col hidden md:flex">
            <div className="bg-[#111] p-3 border border-gray-800 h-full flex flex-col">
              <div className="flex justify-between items-center mb-2 text-[10px] font-bold text-gray-400">
                <span>MAP.VIEWER</span>
                <span>({gameState.player_pos.x}, {gameState.player_pos.y})</span>
              </div>
              <div className="flex-1 grid grid-cols-9 grid-rows-9 gap-px bg-gray-800 min-h-0">
                {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => {
                  const x = i % GRID_SIZE;
                  const y = Math.floor(i / GRID_SIZE);
                  const isFog = gameState.fog[i];
                  const isPlayer = gameState.player_pos.x === x && gameState.player_pos.y === y;
                  const isExit = gameState.exit_pos.x === x && gameState.exit_pos.y === y;
                  return (
                    <div
                      key={i}
                      className={`relative flex items-center justify-center text-[8px] transition-all duration-700 ${isFog ? 'bg-[#080808]' : 'bg-[#1a1a1a]'}`}
                    >
                      {!isFog && isExit && <i className="fa-solid fa-person-shelter text-green-500 animate-pulse"></i>}
                      {isPlayer && <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white] z-10"></div>}
                      {!isFog && !isPlayer && !isExit && <div className="w-0.5 h-0.5 rounded-full bg-gray-700"></div>}
                      {isFog && <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent"></div>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[8px] text-gray-600 flex justify-between uppercase">
                <span>Sensor Signal: Nominal</span>
                <span className="text-orange-900 animate-pulse">Radar Offline</span>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col bg-[#111] border border-gray-800 overflow-hidden relative">
          <div className="p-2 md:p-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-2 text-[10px] bg-[#0d0d0d] shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-orange-500 font-medium">TERMINAL.LOG</span>
              <span className="text-gray-500 font-mono">TURN {gameState.turn_index}/{MAX_TURNS}</span>
              {turnInFlight && <span className="animate-pulse text-blue-400 italic">处理中…</span>}
              {(gameState.battery ?? BATTERY_MAX) <= 0 && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold text-red-500 border border-red-700 bg-black/60">黑暗模式</span>
              )}
              {featureFlags.fallbackBadgeEnabled && lastResponse && detectFallback(lastResponse) && (
                <span className="text-amber-500/90 italic" title="记录简化">通讯不稳</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="md:hidden px-2 py-1.5 border border-gray-600 text-gray-400 hover:bg-gray-800 transition text-[10px]"
                onClick={() => setIsRightDrawerOpen(true)}
              >
                状态/背包
              </button>
              <button
                type="button"
                className="px-2 py-1 border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white transition text-[10px]"
                onClick={() => setIsLogbookOpen(true)}
              >
                日志簿
              </button>
            </div>
          </div>
          {featureFlags.tutorialHintsEnabled && activeHint && (
            <div className="px-3 py-2 bg-amber-950/50 border-b border-amber-900/50 flex items-center justify-between gap-2 text-[10px] text-amber-200 shrink-0">
              <span className="flex-1 min-w-0">{activeHint.text}</span>
              <button
                type="button"
                className="shrink-0 w-5 h-5 flex items-center justify-center text-amber-400 hover:text-amber-200 hover:bg-amber-900/40 rounded"
                onClick={() => { markHintSeen(activeHint.key); setActiveHint(null); }}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
          )}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 min-h-0">
            <div className="max-w-[860px] mx-auto space-y-6">
              {lastResponse?.scene_blocks?.map((block, i) => (
                <div key={i} className="animate-fade-in">
                  {block.type === 'TITLE' && <h2 className="text-lg font-bold text-white mb-2 uppercase tracking-widest">{block.content}</h2>}
                  {block.type === 'EVENT' && <p className="text-sm leading-relaxed text-gray-300 font-sans">{block.content}</p>}
                  {block.type === 'RESULT' && <p className="text-sm border-l-2 border-red-900 pl-3 italic text-gray-400 font-sans">{block.content}</p>}
                  {block.type === 'AFTERTASTE' && <p className="text-xs text-gray-500 mt-2 italic font-serif">"{block.content}"</p>}
                </div>
              ))}
            {gameState.status !== 'PLAYING' && (
              <div className="p-6 bg-black/40 border border-gray-700 text-center space-y-4">
                <h3 className={`text-2xl font-bold ${gameState.status === 'WIN' ? 'text-green-500' : 'text-red-600'}`}>
                  {gameState.status === 'WIN' ? '撤离成功' : '撤离失败'}
                </h3>
                <p className="text-xs text-gray-400">{gameState.logs[gameState.logs.length - 1]}</p>
                <div className="text-left border border-gray-600 bg-[#0d0d0d] p-4 space-y-2">
                  <p className="text-sm text-gray-300">本局生存点：<span className="font-bold text-orange-400">+{settlementRunPoints ?? computeRunPoints(gameState)}</span></p>
                  <p className="text-sm text-gray-300">累计生存点：<span className="font-bold text-white">{getSurvivalPoints()}</span></p>
                  {gameState.status === 'LOSS' && insuranceSettlementMessage != null && (
                    <p className="text-sm text-gray-300">{insuranceSettlementMessage}</p>
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={() => { setSettlementButtonsDisabled(true); window.location.hash = '#/'; }}
                    disabled={settlementButtonsDisabled}
                    className="px-6 py-2 border border-gray-500 text-gray-300 hover:bg-gray-700 hover:text-white transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    返回避难所
                  </button>
                  <button
                    onClick={() => { setSettlementButtonsDisabled(true); restartGame(); }}
                    disabled={settlementButtonsDisabled}
                    className="px-6 py-2 border border-white text-white hover:bg-white hover:text-black transition text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    再来一局
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
          <div className="p-4 bg-[#0d0d0d] border-t border-gray-800 space-y-3 shrink-0">
            {gameState.status === 'PLAYING' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-[860px] mx-auto">
                {lastResponse?.choices?.map((choice, i) => (
                  <button
                    key={i}
                    type="button"
                    disabled={turnInFlight}
                    onClick={() => {
                      setLastActionType(choice.action_type);
                      submitTurn(choice.action_type);
                    }}
                    className="group relative p-3 min-h-[44px] bg-gray-900 hover:bg-white/5 border border-gray-800 hover:border-gray-500 text-left transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-bold text-orange-400 group-hover:text-orange-300 uppercase tracking-tighter">{turnInFlight ? '处理中…' : choice.label}</span>
                      <span className={`text-[8px] px-1 border ${choice.risk === 'HIGH' ? 'border-red-900 text-red-600' : choice.risk === 'MID' ? 'border-yellow-900 text-yellow-600' : 'border-green-900 text-green-700'}`}>
                        {choice.risk} RISK
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 line-clamp-1">{choice.hint}</p>
                  </button>
                ))}
              </div>
            )}
            {!lastResponse && turnInFlight && <div className="text-center py-4 text-xs italic text-gray-600">Initializing environment...</div>}
            {turnError && (
              <div className="p-3 bg-red-950/60 border border-red-800 rounded space-y-2">
                <p className="text-xs font-bold text-red-200">
                  {turnError.type === 'NETWORK' && '通讯中断'}
                  {turnError.type === 'TIMEOUT' && '通讯超时'}
                  {turnError.type === 'HTTP' && '服务暂不可用'}
                  {turnError.type === 'PARSE' && '记录异常，已启用保护'}
                  {turnError.type === 'UNKNOWN' && (turnError.message || '请求异常')}
                </p>
                <p className="text-[10px] text-red-300/90">
                  {turnError.type === 'NETWORK' || turnError.type === 'TIMEOUT'
                    ? '网络或信号异常，并非你的操作问题。'
                    : turnError.type === 'HTTP' || turnError.type === 'PARSE'
                      ? '服务端暂时异常，已保护当前进度。'
                      : '请重试或返回避难所后重新进入。'}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!lastFailedTurn || turnInFlight}
                    className="px-3 py-1.5 text-[10px] border border-red-700 text-red-300 hover:bg-red-900/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={retryLastFailedTurn}
                  >
                    重试
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-[10px] border border-gray-600 text-gray-300 hover:bg-gray-800 transition"
                    onClick={exitToShelter}
                  >
                    返回避难所
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <aside className="w-[280px] lg:w-[320px] xl:w-[360px] shrink-0 hidden md:flex flex-col gap-4 overflow-y-auto border-l border-gray-800 pl-4">
          <div className="bg-[#111] p-3 border border-gray-800 rounded">
            <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">BIOS.DATA</h4>
            <div className="grid grid-cols-2 gap-y-2 text-[10px]">
              <div className="flex flex-col"><span className="text-blue-500 text-[8px]">WATER</span><span className="font-bold text-white">{gameState.water.toFixed(1)}L</span></div>
              <div className="flex flex-col"><span className="text-orange-500 text-[8px]">FOOD</span><span className="font-bold text-white">{gameState.food.toFixed(1)}kg</span></div>
              <div className="flex flex-col"><span className="text-yellow-600 text-[8px]">FUEL</span><span className="font-bold text-white">{gameState.fuel} unit</span></div>
              <div className="flex flex-col"><span className="text-red-400 text-[8px]">MEDS</span><span className="font-bold text-white">{gameState.med} pack</span></div>
            </div>
          </div>
          <div className="bg-[#111] p-3 border border-gray-800 flex flex-col rounded min-h-0">
            <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">CARGO_BAY</h4>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: BAG_CAPACITY }).map((_, i) => {
                const item = gameState.bag[i];
                return (
                  <div key={i} className={`h-12 border ${item ? 'border-gray-600 bg-gray-900' : 'border-dashed border-gray-800'} flex items-center justify-center relative group rounded-sm`}>
                    {item ? <div className="text-[10px] text-center p-1 font-bold truncate w-full">{item.name}</div> : <span className="text-[8px] text-gray-800 uppercase">EMPTY</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-auto pt-4 text-[8px] text-gray-600 italic">* Capacity: {gameState.bag.length}/{BAG_CAPACITY} Slots</div>
          </div>
        </aside>
      </div>

      {isRightDrawerOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" role="presentation" aria-hidden="true" onClick={() => setIsRightDrawerOpen(false)} />
          <div className="fixed right-0 top-0 z-50 h-full w-[320px] max-w-[85vw] flex flex-col bg-[#111] border-l border-gray-800 shadow-2xl md:hidden" role="dialog" aria-modal="true" aria-label="状态与背包">
            <div className="flex justify-between items-center p-3 border-b border-gray-800 bg-[#0d0d0d] shrink-0">
              <h3 className="text-sm font-bold text-gray-300">状态与背包</h3>
              <button type="button" className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded" onClick={() => setIsRightDrawerOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <div className="bg-[#0d0d0d] p-3 border border-gray-800 rounded">
                <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">BIOS.DATA</h4>
                <div className="grid grid-cols-2 gap-y-2 text-[10px]">
                  <div className="flex flex-col"><span className="text-blue-500 text-[8px]">WATER</span><span className="font-bold text-white">{gameState.water.toFixed(1)}L</span></div>
                  <div className="flex flex-col"><span className="text-orange-500 text-[8px]">FOOD</span><span className="font-bold text-white">{gameState.food.toFixed(1)}kg</span></div>
                  <div className="flex flex-col"><span className="text-yellow-600 text-[8px]">FUEL</span><span className="font-bold text-white">{gameState.fuel} unit</span></div>
                  <div className="flex flex-col"><span className="text-red-400 text-[8px]">MEDS</span><span className="font-bold text-white">{gameState.med} pack</span></div>
                </div>
              </div>
              <div className="bg-[#0d0d0d] p-3 border border-gray-800 flex flex-col rounded">
                <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">CARGO_BAY</h4>
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: BAG_CAPACITY }).map((_, i) => {
                    const item = gameState.bag[i];
                    return (
                      <div key={i} className={`h-12 border ${item ? 'border-gray-600 bg-gray-900' : 'border-dashed border-gray-800'} flex items-center justify-center rounded-sm`}>
                        {item ? <div className="text-[10px] text-center p-1 font-bold truncate w-full">{item.name}</div> : <span className="text-[8px] text-gray-800 uppercase">EMPTY</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-[8px] text-gray-600 italic">* Capacity: {gameState.bag.length}/{BAG_CAPACITY} Slots</div>
              </div>
            </div>
          </div>
        </>
      )}

      {isBagModalOpen && pendingAddItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true" aria-labelledby="bag-modal-title">
          <div className="w-full max-w-sm bg-[#111] border border-gray-700 shadow-2xl rounded-sm p-5 space-y-4">
            <h2 id="bag-modal-title" className="text-lg font-bold text-white">背包已满</h2>
            <p className="text-sm text-gray-300">新物品：{pendingAddItem.name}（价值 {pendingAddItem.value}）</p>
            {!replaceSlotMode ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full py-3 border border-gray-600 text-gray-300 hover:bg-gray-800 transition text-sm font-medium"
                  onClick={handleBagDiscard}
                >
                  丢弃
                </button>
                <button
                  type="button"
                  className="w-full py-3 border border-orange-600 text-orange-400 hover:bg-orange-900/40 transition text-sm font-medium"
                  onClick={() => setReplaceSlotMode(true)}
                >
                  替换背包物品
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500">点选一格替换为该物品：</p>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: BAG_CAPACITY }).map((_, i) => {
                    const item = gameState.bag[i];
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={!item}
                        className={`h-14 border text-[10px] truncate p-1 flex flex-col items-center justify-center transition ${item ? 'border-gray-600 bg-gray-900 hover:border-orange-500 hover:bg-orange-900/30' : 'border-dashed border-gray-800 bg-transparent opacity-40 cursor-not-allowed'}`}
                        onClick={() => item && handleBagReplaceSlot(i)}
                      >
                        {item ? <><span className="truncate w-full">{item.name}</span><span className="text-gray-500">价值 {item.value}</span></> : '—'}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="w-full py-2 text-xs text-gray-500 hover:text-gray-300"
                  onClick={() => setReplaceSlotMode(false)}
                >
                  取消
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {isLogbookOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" role="presentation" aria-hidden="true" onClick={() => setIsLogbookOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] h-[70vh] flex flex-col bg-[#111] border-t border-gray-700 rounded-t-xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="logbook-title">
            <div className="flex justify-between items-center p-3 border-b border-gray-800 bg-[#0d0d0d] shrink-0">
              <h2 id="logbook-title" className="text-base font-bold text-white">日志簿</h2>
              <button type="button" className="px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 hover:bg-gray-800 transition rounded" onClick={() => setIsLogbookOpen(false)}>关闭</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {[...logbook].reverse().map((entry) => {
                const maxT = logbook.length ? Math.max(...logbook.map(l => l.turn)) : -1;
                const isRecent3 = entry.turn >= maxT - 2;
                const isOpen = logbookOpenSet[entry.turn] ?? isRecent3;
                const batteryStr = entry.battery != null ? `${entry.battery}/${BATTERY_MAX}` : '—';
                return (
                  <div key={entry.id} className="border border-gray-800 rounded overflow-hidden bg-[#0d0d0d]">
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-800/80 flex justify-between items-center gap-2"
                      onClick={() => setLogbookOpenSet(prev => ({ ...prev, [entry.turn]: !(prev[entry.turn] ?? isRecent3) }))}
                    >
                      <span className="flex-1 min-w-0 truncate">第 {entry.turn} 回合 · {actionLabel(entry.action)} · 电量 {batteryStr}</span>
                      <span className="text-[10px] text-gray-500 shrink-0" aria-hidden>{isOpen ? '▼' : '▶'}</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-800">
                        {entry.scene_blocks.map((block, i) => (
                          <div key={i}>
                            {block.type === 'TITLE' && <h3 className="text-sm font-bold text-white mb-1 uppercase tracking-widest">{block.content}</h3>}
                            {block.type === 'EVENT' && <p className="text-xs leading-relaxed text-gray-300 font-sans">{block.content}</p>}
                            {block.type === 'RESULT' && <p className="text-xs border-l-2 border-red-900 pl-2 italic text-gray-400 font-sans">{block.content}</p>}
                            {block.type === 'AFTERTASTE' && <p className="text-[11px] text-gray-500 mt-1 italic font-serif">"{block.content}"</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {logbook.length === 0 && <p className="text-xs text-gray-500 text-center py-4">暂无记录</p>}
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.4s ease-out forwards; }
      `}</style>
    </div>
  );
}

/** 根据 hash 在首页 #/ 与局内 #/run 之间切换；刷新保持当前视图。 */
const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'run'>(() => {
    const h = window.location.hash.replace(/^#\/?/, '') || '';
    return h === 'run' ? 'run' : 'home';
  });

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#\/?/, '') || '';
      setView(h === 'run' ? 'run' : 'home');
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return view === 'run' ? <RunScreen /> : <ShelterHome />;
};

export default App;
