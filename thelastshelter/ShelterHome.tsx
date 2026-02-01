import React, { useState, useEffect, useRef } from "react";
import { getRunConfig, setRunConfig, defaultRunConfig, type RunConfigVariantId } from "./game/runConfig";
import { getRigLoadout, setRigLoadout, RIG_LOADOUT_LABELS, RIG_LOADOUT_HINTS, type RigLoadoutId } from "./game/rigLoadout";
import { CONTRACT_IDS, CONTRACT_LABELS, type ContractId } from "./game/contracts";
import { getSurvivalPoints, spendSurvivalPoints } from "./game/economy";
import { INSURANCE_COST, APP_VERSION, TURN_ENDPOINT } from "./constants";
import { createInitialState } from "./engine";
import {
  loadFeatureFlags,
  saveFeatureFlags,
  isDebugMode,
  setDebugMode,
  type FeatureFlags,
} from "./game/featureFlags";
import { getTurnTraceRing, getQuickStatsFromTraces } from "./game/turnTrace";

const VARIANT_LABELS: Record<RunConfigVariantId, string> = {
  night: "夜行",
  battery_crisis: "电量危机",
};

function readInitialConfig() {
  if (typeof window === "undefined") return defaultRunConfig;
  return getRunConfig();
}

const ShelterHome: React.FC = () => {
  const [regionId, setRegionId] = useState<string>(() => readInitialConfig().regionId);
  const [variantId, setVariantId] = useState<RunConfigVariantId>(() => readInitialConfig().variantId);
  const [rigLoadout, setRigLoadoutState] = useState<RigLoadoutId>(() => getRigLoadout());
  const [selectedContracts, setSelectedContracts] = useState<string[]>(() => readInitialConfig().selectedContracts ?? []);
  const [insuranceChecked, setInsuranceChecked] = useState(false);
  const [survivalPoints, setSurvivalPoints] = useState(0);
  const [connectionCheck, setConnectionCheck] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [flags, setFlags] = useState<FeatureFlags>(() => loadFeatureFlags());
  const [debugOn, setDebugOn] = useState(false);
  const versionClicksRef = useRef(0);

  useEffect(() => {
    const cfg = getRunConfig();
    setRegionId(cfg.regionId);
    setVariantId(cfg.variantId);
    setRigLoadoutState(getRigLoadout());
    setSelectedContracts(cfg.selectedContracts ?? []);
  }, []);

  useEffect(() => {
    setSurvivalPoints(getSurvivalPoints());
  }, []);

  const handleStart = () => {
    if (insuranceChecked) {
      if (!spendSurvivalPoints(INSURANCE_COST)) return;
      setRunConfig({ regionId, variantId, ts: Date.now(), insurancePurchased: true, insuranceUsed: false, selectedContracts });
    } else {
      setRunConfig({ regionId, variantId, ts: Date.now(), insurancePurchased: false, insuranceUsed: false, selectedContracts });
    }
    setSurvivalPoints(getSurvivalPoints());
    window.location.hash = "#/run";
  };

  const toggleContract = (id: ContractId) => {
    const next = selectedContracts.includes(id)
      ? selectedContracts.filter((c) => c !== id)
      : selectedContracts.length < 3
        ? [...selectedContracts, id]
        : selectedContracts;
    setSelectedContracts(next);
    setRunConfig({ selectedContracts: next });
  };

  const handleVersionClick = () => {
    versionClicksRef.current += 1;
    if (versionClicksRef.current >= 5) {
      setDebugMode(true);
      setDebugOn(true);
      versionClicksRef.current = 0;
    }
  };

  const handleFlagChange = (key: keyof FeatureFlags, value: boolean) => {
    const next = { ...flags, [key]: value };
    setFlags(next);
    saveFeatureFlags(next);
  };

  const checkConnection = async () => {
    setConnectionCheck("checking");
    setConnectionMessage(null);
    try {
      const state = createInitialState();
      const res = await fetch(TURN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, action: "INIT" }),
      });
      if (res.ok) {
        setConnectionCheck("ok");
        setConnectionMessage("连接正常");
      } else {
        setConnectionCheck("fail");
        setConnectionMessage("服务暂不可用");
      }
    } catch {
      setConnectionCheck("fail");
      setConnectionMessage("通讯中断");
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0a] text-[#d1d1d1] p-4 md:p-8 relative">
      <div className="absolute inset-0 opacity-5 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/asfalt-dark.png')]" />
      <div className="relative z-10 w-full max-w-md space-y-8">
        <h1 className="text-2xl md:text-3xl font-bold italic text-white font-['Playfair_Display'] text-center">
          末日避难所
        </h1>

        <div className="border border-gray-700 bg-[#111] p-5 rounded-sm shadow-xl">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-2 mb-3">
            选择区域
          </h2>
          <button
            type="button"
            className="w-full p-4 text-left border border-orange-900/60 bg-gray-900/80 hover:bg-gray-800/80 transition"
            onClick={() => {
              setRegionId("cold_block");
              setRunConfig({ regionId: "cold_block", variantId });
            }}
          >
            <span className="block text-base font-bold text-orange-400">冷寂街区</span>
            <span className="block text-xs text-gray-500 mt-1">当前唯一可进入区域</span>
          </button>
        </div>

        <div className="border border-gray-700 bg-[#111] p-5 rounded-sm shadow-xl">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-2 mb-3">
            局前物资
          </h2>
          <p className="text-sm text-gray-300 mb-3">当前生存点：<span className="font-bold text-orange-400">{survivalPoints}</span></p>
          {flags.insurancePayEnabled && (
            <>
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={insuranceChecked}
                  onChange={(e) => setInsuranceChecked(e.target.checked)}
                  disabled={survivalPoints < INSURANCE_COST}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className={survivalPoints < INSURANCE_COST ? "text-gray-500" : "text-gray-300 group-hover:text-white"}>
                  购买保险袋（本局）
                </span>
                <span className="text-xs text-gray-500">— {INSURANCE_COST} 生存点</span>
              </label>
              {survivalPoints < INSURANCE_COST && insuranceChecked === false && (
                <p className="text-xs text-amber-600/90 mt-1">生存点不足时无法勾选</p>
              )}
            </>
          )}
        </div>

        <div className="border border-gray-700 bg-[#111] p-5 rounded-sm shadow-xl">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-2 mb-3">
            Power Rig 配置
          </h2>
          <div className="space-y-2 mb-3">
            {(["ENDURANCE", "SPARK"] as const).map((id) => (
              <label key={id} className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="rigLoadout"
                  checked={rigLoadout === id}
                  onChange={() => {
                    setRigLoadout(id);
                    setRigLoadoutState(id);
                  }}
                  className="mt-1 w-4 h-4 border-gray-600 bg-gray-800 text-orange-500"
                />
                <div>
                  <span className={rigLoadout === id ? "text-orange-400 font-medium" : "text-gray-300 group-hover:text-white"}>
                    {RIG_LOADOUT_LABELS[id]}
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">{RIG_LOADOUT_HINTS[id]}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="border border-gray-700 bg-[#111] p-5 rounded-sm shadow-xl">
          <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-2 mb-3">
            剧本变体
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(["night", "battery_crisis"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`p-4 border text-sm font-medium transition ${
                  variantId === id
                    ? "border-orange-500 bg-orange-900/30 text-orange-300"
                    : "border-gray-700 bg-gray-900/50 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                }`}
                onClick={() => {
                  setVariantId(id);
                  setRunConfig({ regionId, variantId: id });
                }}
              >
                {VARIANT_LABELS[id]}
              </button>
            ))}
          </div>
        </div>

        {flags.contractsEnabled && (
          <div className="border border-gray-700 bg-[#111] p-5 rounded-sm shadow-xl">
            <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-2 mb-3">
              挑战（可选）
            </h2>
            <p className="text-xs text-gray-500 mb-3">勾选 0–3 条，完成可在结算获得额外生存点。</p>
            <div className="space-y-2">
              {CONTRACT_IDS.map((id) => (
                <label key={id} className="flex items-start gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedContracts.includes(id)}
                    onChange={() => toggleContract(id)}
                    disabled={selectedContracts.length >= 3 && !selectedContracts.includes(id)}
                    className="mt-1 w-4 h-4 rounded border-gray-600 bg-gray-800 text-orange-500 disabled:opacity-50"
                  />
                  <span className="text-sm text-gray-300 group-hover:text-white">{CONTRACT_LABELS[id]}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="w-full py-4 border-2 border-white text-white font-bold text-lg hover:bg-white hover:text-black transition uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleStart}
          disabled={insuranceChecked && survivalPoints < INSURANCE_COST}
        >
          开始探索
        </button>

        {flags.shelterHealthCheckEnabled && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 text-[10px] border border-gray-600 text-gray-400 hover:bg-gray-800 transition"
              onClick={checkConnection}
              disabled={connectionCheck === "checking"}
            >
              {connectionCheck === "checking" ? "检查中…" : "检查连接"}
            </button>
            {connectionCheck === "ok" && connectionMessage && (
              <span className="text-[10px] text-green-500">{connectionMessage}</span>
            )}
            {connectionCheck === "fail" && connectionMessage && (
              <span className="text-[10px] text-red-400">{connectionMessage}</span>
            )}
          </div>
        )}
      </div>
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
        {(isDebugMode() || debugOn) && (
          <div className="border border-gray-700 bg-[#111] p-3 rounded shadow-xl text-left min-w-[200px]">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-800 pb-1.5 mb-2">
              功能开关（Debug）
            </div>
            {[
              { key: "contractsEnabled" as const, label: "合同挑战（Contracts）" },
              { key: "insurancePayEnabled" as const, label: "保险袋付费入口" },
              { key: "turnTraceEnabled" as const, label: "行动追踪（TurnTrace）" },
              { key: "fallbackBadgeEnabled" as const, label: "兜底提示（Fallback Badge）" },
              { key: "shelterHealthCheckEnabled" as const, label: "检查连接按钮" },
              { key: "tutorialHintsEnabled" as const, label: "新手提示" },
              { key: "mapPanelEnabled" as const, label: "地图面板" },
              { key: "recapBarEnabled" as const, label: "行动结算条（RecapBar）" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer group py-0.5">
                <input
                  type="checkbox"
                  checked={flags[key]}
                  onChange={(e) => handleFlagChange(key, e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-orange-500"
                />
                <span className="text-[10px] text-gray-400 group-hover:text-gray-300">{label}</span>
              </label>
            ))}
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-t border-gray-800 pt-2 mt-2">
              快速统计（最近20条）
            </div>
            {(() => {
              const traces = getTurnTraceRing(20);
              const stats = getQuickStatsFromTraces(traces);
              const copyText = `版本: ${APP_VERSION}\n最近20条 TurnTrace:\n稀有机会 ${stats.rareLoot}\n孤注一掷 ${stats.gamble}\n条件撤离 ${stats.conditionalExtract}\n撤离压力提示 ${stats.extractPressure}\nfallback ${stats.fallback}\n总回合数 ${stats.total}`;
              return (
                <>
                  <div className="text-[10px] text-gray-400 mt-1 space-y-0.5">
                    <div>稀有机会 {stats.rareLoot} · 孤注一掷 {stats.gamble}</div>
                    <div>条件撤离 {stats.conditionalExtract} · 撤离压力 {stats.extractPressure}</div>
                    <div>fallback {stats.fallback} / {stats.total}</div>
                  </div>
                  <button
                    type="button"
                    className="mt-2 w-full py-1 text-[10px] border border-gray-600 text-gray-400 hover:text-gray-300 hover:bg-gray-800 transition"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(copyText);
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    复制统计
                  </button>
                </>
              );
            })()}
          </div>
        )}
        <button
          type="button"
          className="text-[10px] text-gray-500 hover:text-gray-400 font-mono select-all cursor-pointer"
          onClick={() => {
            handleVersionClick();
            try {
              navigator.clipboard.writeText(APP_VERSION);
            } catch {
              /* ignore */
            }
          }}
          title="点击复制版本号"
        >
          版本：{APP_VERSION}
        </button>
      </div>
    </div>
  );
};

export default ShelterHome;
