import React, { useState, useEffect, useRef } from 'react';
import { GameState, TurnResponse, ActionType, RiskLevel, DirectionHint, BagItem } from './types';
import { createInitialState, applyAction, applyBagDelta, getEmptyBagSlots } from './engine';
import { fetchTurnResponse } from './geminiService';
import { GRID_SIZE, MAX_TURNS, MILESTONES, BAG_CAPACITY, BATTERY_MAX } from './constants';
import { getSurvivalPoints, addSurvivalPoints, computeRunPoints } from './game/economy';
import { getRunConfig } from './game/runConfig';
import { pickKeptItem, setStoredKeptItem } from './game/insurance';
import ShelterHome from './ShelterHome';

type LogTurn = {
  id: string;
  turn_index: number;
  action: string;
  scene_blocks: TurnResponse['scene_blocks'];
  at: number;
};

function actionLabel(action: ActionType): string {
  if (action === 'INIT') return '开始';
  if (action === 'MOVE_N' || action === 'MOVE_E' || action === 'MOVE_S' || action === 'MOVE_W') return '移动';
  if (action === 'SEARCH') return '搜索';
  return String(action);
}

/** 局内界面：现有局内 UI/逻辑原封不动。 */
function RunScreen() {
  const [gameState, setGameState] = useState<GameState>(createInitialState());
  const [lastResponse, setLastResponse] = useState<TurnResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [settlementRunPoints, setSettlementRunPoints] = useState<number | null>(null);
  const [lastActionType, setLastActionType] = useState<ActionType | null>(null);
  const [pendingAdds, setPendingAdds] = useState<BagItem[]>([]);
  const [isBagModalOpen, setIsBagModalOpen] = useState(false);
  const [pendingAddItem, setPendingAddItem] = useState<BagItem | null>(null);
  const [replaceSlotMode, setReplaceSlotMode] = useState(false);
  const [insuranceKeptName, setInsuranceKeptName] = useState<string | null>(null);
  const [logbook, setLogbook] = useState<LogTurn[]>([]);
  const [isLogbookOpen, setIsLogbookOpen] = useState(false);
  const [logbookOpenSet, setLogbookOpenSet] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCreditedRef = useRef(false);
  const devPickupCounterRef = useRef(0);

  useEffect(() => {
    handleTurn('INIT');
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastResponse]);

  // 结算入账：仅在本局首次变为非 PLAYING 时执行一次；死亡且保险时按保住的一件计分
  useEffect(() => {
    if (gameState.status === 'PLAYING') return;
    if (hasCreditedRef.current) return;
    hasCreditedRef.current = true;
    const runConfig = getRunConfig();
    let points: number;
    if (gameState.status === 'LOSS' && runConfig.insurancePurchased === true) {
      const keptItem = pickKeptItem(gameState.bag);
      if (keptItem) {
        setStoredKeptItem(keptItem);
        setInsuranceKeptName(keptItem.name);
        points = computeRunPoints(gameState, keptItem);
      } else {
        points = computeRunPoints(gameState);
      }
    } else {
      points = computeRunPoints(gameState);
    }
    addSurvivalPoints(points);
    setSettlementRunPoints(points);
  }, [gameState.status]);

  /** 通信失败时使用的 fallback，保证回合推进与扣电。 */
  const buildFallbackResponse = (): TurnResponse => ({
    scene_blocks: [
      { type: 'TITLE', content: '通信中断' },
      { type: 'EVENT', content: '你只能靠直觉行动。' },
    ],
    choices: [
      { id: 'fb-n', label: '向北', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_N' },
      { id: 'fb-e', label: '向东', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_E' },
      { id: 'fb-search', label: '搜索', hint: '翻找', risk: RiskLevel.MID, preview_cost: {}, action_type: 'SEARCH' },
      { id: 'fb-s', label: '向南', hint: '移动', risk: RiskLevel.LOW, preview_cost: {}, action_type: 'MOVE_S' },
    ],
    ui: {
      progress: { turn_index: gameState.turn_index, milestones_hit: [] },
      map_delta: { reveal_indices: [], direction_hint: DirectionHint.NONE },
      bag_delta: { add: [], remove: [] },
    },
    suggestion: { delta: {} },
    memory_update: '',
  });

  const handleTurn = async (action: ActionType) => {
    setLastActionType(action);
    if (gameState.status !== 'PLAYING' && action !== 'INIT') return;
    setIsProcessing(true);
    try {
      if (action !== 'INIT') {
        setGameState(prev => applyAction(prev, action, {} as Parameters<typeof applyAction>[2]));
      }
      const snapshotState = action !== 'INIT' ? applyAction(gameState, action, {} as Parameters<typeof applyAction>[2]) : gameState;
      let response: TurnResponse;
      try {
        response = await fetchTurnResponse(snapshotState, action);
      } catch {
        response = buildFallbackResponse();
      }
      setLastResponse(response);
      const turnIdx = snapshotState.turn_index;
      const logEntry: LogTurn = {
        id: `${turnIdx}-${Date.now()}`,
        turn_index: turnIdx,
        action: String(action),
        scene_blocks: response.scene_blocks ?? [],
        at: Date.now(),
      };
      setLogbook(prev => [...prev, logEntry]);
      setLogbookOpenSet(prev => ({
        ...prev,
        [turnIdx]: true,
        [turnIdx - 1]: true,
      }));
      const adds = response.ui?.bag_delta?.add ?? [];
      const removes = response.ui?.bag_delta?.remove ?? [];
      if (response.ui?.bag_delta) {
        if (adds.length > 0) {
          const emptySlots = getEmptyBagSlots(gameState);
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
    } finally {
      setIsProcessing(false);
    }
  };

  const restartGame = () => {
    hasCreditedRef.current = false;
    setSettlementRunPoints(null);
    setInsuranceKeptName(null);
    setGameState(createInitialState());
    setLastResponse(null);
    setPendingAdds([]);
    setIsBagModalOpen(false);
    setPendingAddItem(null);
    setReplaceSlotMode(false);
    setLogbook([]);
    setLogbookOpenSet({});
    handleTurn('INIT');
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
    setGameState(prev => applyBagDelta(prev, [current], [item.id]));
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

  /** DEV-only: 拾取一件测试物品，走真实满包/队列路径。 */
  const devPickupOneItem = () => {
    devPickupCounterRef.current += 1;
    const n = devPickupCounterRef.current;
    const testItem: BagItem = {
      id: `dev-pickup-${Date.now()}-${n}`,
      name: `测试物品 #${n}`,
      type: 'MISC',
    };
    if (isBagModalOpen) {
      setPendingAdds(prev => [...prev, testItem]);
      return;
    }
    const emptySlots = getEmptyBagSlots(gameState);
    if (emptySlots >= 1) {
      setGameState(prev => applyBagDelta(prev, [testItem], []));
    } else {
      setPendingAdds(prev => [...prev, testItem]);
      setPendingAddItem(testItem);
      setIsBagModalOpen(true);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#0a0a0a] text-[#d1d1d1] selection:bg-red-900/40 p-2 md:p-6 overflow-hidden relative">
      <div className="absolute inset-0 opacity-5 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/asfalt-dark.png')]"></div>
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
                    type: 'MISC',
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
              拾取一件物品（测试）
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden relative z-10">
        <div className="w-full md:w-1/3 h-64 md:h-auto flex flex-col">
          <div className="bg-[#111] p-3 border border-gray-800 h-full flex flex-col shadow-2xl">
            <div className="flex justify-between items-center mb-2 text-[10px] font-bold text-gray-400">
               <span>MAP.VIEWER</span>
               <span>({gameState.player_pos.x}, {gameState.player_pos.y})</span>
            </div>
            <div className="flex-1 grid grid-cols-9 grid-rows-9 gap-px bg-gray-800">
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
        <div className="flex-1 flex flex-col bg-[#111] border border-gray-800 shadow-2xl overflow-hidden relative">
          <div className="p-3 border-b border-gray-800 flex justify-between items-center gap-2 text-[10px] bg-[#0d0d0d]">
             <span className="text-orange-500">TERMINAL.LOG</span>
             <div className="flex items-center gap-2">
               {isProcessing && <span className="animate-pulse text-blue-400 italic">TRANSMITTING...</span>}
               <button
                 type="button"
                 className="px-2 py-1 border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white transition text-[10px]"
                 onClick={() => setIsLogbookOpen(true)}
               >
                 日志簿
               </button>
             </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6">
            {lastResponse?.scene_blocks.map((block, i) => (
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
                  {insuranceKeptName != null && (
                    <p className="text-sm text-gray-300">保险袋保住：『{insuranceKeptName}』</p>
                  )}
                </div>
                <div className="flex flex-wrap justify-center gap-3">
                  <button onClick={() => { window.location.hash = '#/'; }} className="px-6 py-2 border border-gray-500 text-gray-300 hover:bg-gray-700 hover:text-white transition text-sm font-medium">
                    返回避难所
                  </button>
                  <button onClick={restartGame} className="px-6 py-2 border border-white text-white hover:bg-white hover:text-black transition text-sm font-bold">
                    再来一局
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="p-4 bg-[#0d0d0d] border-t border-gray-800 space-y-3">
            {gameState.status === 'PLAYING' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lastResponse?.choices.map((choice, i) => (
                  <button
                    key={i}
                    disabled={isProcessing}
                    onClick={() => {
                      setLastActionType(choice.action_type);
                      handleTurn(choice.action_type);
                    }}
                    className="group relative p-3 bg-gray-900 hover:bg-white/5 border border-gray-800 hover:border-gray-500 text-left transition disabled:opacity-50"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-bold text-orange-400 group-hover:text-orange-300 uppercase tracking-tighter">{choice.label}</span>
                      <span className={`text-[8px] px-1 border ${choice.risk === 'HIGH' ? 'border-red-900 text-red-600' : choice.risk === 'MID' ? 'border-yellow-900 text-yellow-600' : 'border-green-900 text-green-700'}`}>
                        {choice.risk} RISK
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 line-clamp-1">{choice.hint}</p>
                  </button>
                ))}
              </div>
            )}
            {!lastResponse && isProcessing && <div className="text-center py-4 text-xs italic text-gray-600">Initializing environment...</div>}
          </div>
        </div>
        <div className="w-full md:w-64 flex flex-col gap-4">
          <div className="bg-[#111] p-3 border border-gray-800">
            <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">BIOS.DATA</h4>
            <div className="grid grid-cols-2 gap-y-2 text-[10px]">
               <div className="flex flex-col"><span className="text-blue-500 text-[8px]">WATER</span><span className="font-bold text-white">{gameState.water.toFixed(1)}L</span></div>
               <div className="flex flex-col"><span className="text-orange-500 text-[8px]">FOOD</span><span className="font-bold text-white">{gameState.food.toFixed(1)}kg</span></div>
               <div className="flex flex-col"><span className="text-yellow-600 text-[8px]">FUEL</span><span className="font-bold text-white">{gameState.fuel} unit</span></div>
               <div className="flex flex-col"><span className="text-red-400 text-[8px]">MEDS</span><span className="font-bold text-white">{gameState.med} pack</span></div>
            </div>
          </div>
          <div className="flex-1 bg-[#111] p-3 border border-gray-800 flex flex-col shadow-2xl">
            <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">CARGO_BAY</h4>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: BAG_CAPACITY }).map((_, i) => {
                const item = gameState.bag[i];
                return (
                  <div key={i} className={`h-12 border ${item ? 'border-gray-600 bg-gray-900' : 'border-dashed border-gray-800'} flex items-center justify-center relative group`}>
                    {item ? <div className="text-[10px] text-center p-1 font-bold truncate w-full">{item.name}</div> : <span className="text-[8px] text-gray-800 uppercase">EMPTY</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-auto pt-4 text-[8px] text-gray-600 italic">* Capacity: {gameState.bag.length}/{BAG_CAPACITY} Slots</div>
          </div>
        </div>
      </div>

      {isBagModalOpen && pendingAddItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" role="dialog" aria-modal="true" aria-labelledby="bag-modal-title">
          <div className="w-full max-w-sm bg-[#111] border border-gray-700 shadow-2xl rounded-sm p-5 space-y-4">
            <h2 id="bag-modal-title" className="text-lg font-bold text-white">背包已满</h2>
            <p className="text-sm text-gray-300">你发现了『{pendingAddItem.name}』，要怎么处理？</p>
            {!replaceSlotMode ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="w-full py-3 border border-gray-600 text-gray-300 hover:bg-gray-800 transition text-sm font-medium"
                  onClick={handleBagDiscard}
                >
                  丢弃新物品
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
                <p className="text-xs text-gray-500">点选一个格子替换为该物品：</p>
                <div className="grid grid-cols-4 gap-2">
                  {Array.from({ length: BAG_CAPACITY }).map((_, i) => {
                    const item = gameState.bag[i];
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={!item}
                        className={`h-12 border text-[10px] truncate p-1 transition ${item ? 'border-gray-600 bg-gray-900 hover:border-orange-500 hover:bg-orange-900/30' : 'border-dashed border-gray-800 bg-transparent opacity-40 cursor-not-allowed'}`}
                        onClick={() => item && handleBagReplaceSlot(i)}
                      >
                        {item ? item.name : '—'}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logbook-title"
          onClick={(e) => e.target === e.currentTarget && setIsLogbookOpen(false)}
        >
          <div className="w-[90%] max-w-xl h-[80vh] flex flex-col bg-[#111] border border-gray-700 shadow-2xl rounded-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-3 border-b border-gray-800 bg-[#0d0d0d] shrink-0">
              <h2 id="logbook-title" className="text-base font-bold text-white">日志簿</h2>
              <button type="button" className="px-2 py-1 text-xs text-gray-400 hover:text-white border border-gray-600 hover:bg-gray-800 transition" onClick={() => setIsLogbookOpen(false)}>关闭</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {[...logbook].reverse().map((entry) => {
                const maxT = logbook.length ? Math.max(...logbook.map(l => l.turn_index)) : -1;
                const isRecent2 = entry.turn_index === maxT || entry.turn_index === maxT - 1;
                const isOpen = logbookOpenSet[entry.turn_index] ?? isRecent2;
                return (
                  <div key={entry.id} className="border border-gray-800 rounded overflow-hidden bg-[#0d0d0d]">
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-800/80 flex justify-between items-center"
                      onClick={() => setLogbookOpenSet(prev => ({ ...prev, [entry.turn_index]: !(prev[entry.turn_index] ?? isRecent2) }))}
                    >
                      <span>第 {entry.turn_index} 回合 · {actionLabel(entry.action as ActionType)}</span>
                      <span className="text-[10px] text-gray-500">{isOpen ? '▼' : '▶'}</span>
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
        </div>
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
