
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, TurnResponse, ActionType, SceneBlock, Choice } from './types';
import { createInitialState, applyAction, applyBagDelta } from './engine';
import { fetchTurnResponse } from './geminiService';
import { GRID_SIZE, MAX_TURNS, MILESTONES, BAG_CAPACITY } from './constants';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(createInitialState());
  const [lastResponse, setLastResponse] = useState<TurnResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial prompt
  useEffect(() => {
    handleTurn('INIT');
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastResponse]);

  const handleTurn = async (action: ActionType) => {
    if (gameState.status !== 'PLAYING' && action !== 'INIT') return;
    
    setIsProcessing(true);
    
    // 1. Get narrative and delta suggestion from Gemini
    const response = await fetchTurnResponse(gameState, action);
    setLastResponse(response);

    // 2. Update local engine (authority)
    setGameState(prev => {
      let newState = prev;
      if (action !== 'INIT') {
        newState = applyAction(prev, action, response.suggestion.delta);
      }
      if (response.ui.bag_delta) {
        newState = applyBagDelta(newState, response.ui.bag_delta.add, response.ui.bag_delta.remove);
      }
      return newState;
    });

    setIsProcessing(false);
  };

  const restartGame = () => {
    setGameState(createInitialState());
    setLastResponse(null);
    handleTurn('INIT');
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#0a0a0a] text-[#d1d1d1] selection:bg-red-900/40 p-2 md:p-6 overflow-hidden relative">
      {/* Background Ambience */}
      <div className="absolute inset-0 opacity-5 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/asfalt-dark.png')]"></div>
      
      {/* Header / Progress */}
      <div className="flex flex-col mb-4 relative z-10">
        <div className="flex justify-between items-end mb-2">
          <h1 className="text-xl md:text-2xl font-bold italic text-white font-['Playfair_Display']">THE LAST SHELTER <span className="text-xs font-mono text-gray-500 uppercase not-italic tracking-tighter ml-2">CH-01: THE COLD VOID</span></h1>
          <div className="flex space-x-4 text-xs">
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
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden relative z-10">
        
        {/* Left: Map */}
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
                    className={`
                      relative flex items-center justify-center text-[8px] transition-all duration-700
                      ${isFog ? 'bg-[#080808]' : 'bg-[#1a1a1a]'}
                    `}
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

        {/* Center: Narrative & Actions */}
        <div className="flex-1 flex flex-col bg-[#111] border border-gray-800 shadow-2xl overflow-hidden relative">
          
          <div className="p-3 border-b border-gray-800 flex justify-between items-center text-[10px] bg-[#0d0d0d]">
             <span className="text-orange-500">TERMINAL.LOG</span>
             {isProcessing && <span className="animate-pulse text-blue-400 italic">TRANSMITTING...</span>}
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
                  {gameState.status === 'WIN' ? 'MISSION SUCCESS' : 'SYSTEM FAILURE'}
                </h3>
                <p className="text-xs text-gray-400">{gameState.logs[gameState.logs.length - 1]}</p>
                <button 
                  onClick={restartGame}
                  className="px-6 py-2 border border-white text-white hover:bg-white hover:text-black transition uppercase text-xs font-bold"
                >
                  REBOOT CORE
                </button>
              </div>
            )}
          </div>

          {/* Action Pad */}
          <div className="p-4 bg-[#0d0d0d] border-t border-gray-800 space-y-3">
            {gameState.status === 'PLAYING' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {lastResponse?.choices.map((choice, i) => (
                  <button
                    key={i}
                    disabled={isProcessing}
                    onClick={() => handleTurn(choice.action_type)}
                    className="group relative p-3 bg-gray-900 hover:bg-white/5 border border-gray-800 hover:border-gray-500 text-left transition disabled:opacity-50"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-bold text-orange-400 group-hover:text-orange-300 uppercase tracking-tighter">{choice.label}</span>
                      <span className={`text-[8px] px-1 border ${
                        choice.risk === 'HIGH' ? 'border-red-900 text-red-600' :
                        choice.risk === 'MID' ? 'border-yellow-900 text-yellow-600' :
                        'border-green-900 text-green-700'
                      }`}>
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

        {/* Right: Bag & Stats */}
        <div className="w-full md:w-64 flex flex-col gap-4">
          
          {/* Status Indicators */}
          <div className="bg-[#111] p-3 border border-gray-800">
            <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">BIOS.DATA</h4>
            <div className="grid grid-cols-2 gap-y-2 text-[10px]">
               <div className="flex flex-col">
                 <span className="text-blue-500 text-[8px]">WATER</span>
                 <span className="font-bold text-white">{gameState.water.toFixed(1)}L</span>
               </div>
               <div className="flex flex-col">
                 <span className="text-orange-500 text-[8px]">FOOD</span>
                 <span className="font-bold text-white">{gameState.food.toFixed(1)}kg</span>
               </div>
               <div className="flex flex-col">
                 <span className="text-yellow-600 text-[8px]">FUEL</span>
                 <span className="font-bold text-white">{gameState.fuel} unit</span>
               </div>
               <div className="flex flex-col">
                 <span className="text-red-400 text-[8px]">MEDS</span>
                 <span className="font-bold text-white">{gameState.med} pack</span>
               </div>
            </div>
          </div>

          {/* Inventory */}
          <div className="flex-1 bg-[#111] p-3 border border-gray-800 flex flex-col shadow-2xl">
            <h4 className="text-[10px] font-bold text-gray-500 mb-2 uppercase border-b border-gray-800 pb-1">CARGO_BAY</h4>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: BAG_CAPACITY }).map((_, i) => {
                const item = gameState.bag[i];
                return (
                  <div key={i} className={`h-12 border ${item ? 'border-gray-600 bg-gray-900' : 'border-dashed border-gray-800'} flex items-center justify-center relative group`}>
                    {item ? (
                      <div className="text-[10px] text-center p-1 font-bold truncate w-full">
                        {item.name}
                      </div>
                    ) : (
                      <span className="text-[8px] text-gray-800 uppercase">EMPTY</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-auto pt-4 text-[8px] text-gray-600 italic">
               * Capacity: {gameState.bag.length}/{BAG_CAPACITY} Slots
            </div>
          </div>
        </div>

      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.4s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default App;
