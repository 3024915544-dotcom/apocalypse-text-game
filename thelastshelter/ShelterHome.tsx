import React, { useState, useEffect } from "react";
import { getRunConfig, setRunConfig, defaultRunConfig, type RunConfigVariantId } from "./game/runConfig";
import { getSurvivalPoints, spendSurvivalPoints } from "./game/economy";
import { INSURANCE_COST, APP_VERSION } from "./constants";

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
  const [insuranceChecked, setInsuranceChecked] = useState(false);
  const [survivalPoints, setSurvivalPoints] = useState(0);

  useEffect(() => {
    const cfg = getRunConfig();
    setRegionId(cfg.regionId);
    setVariantId(cfg.variantId);
  }, []);

  useEffect(() => {
    setSurvivalPoints(getSurvivalPoints());
  }, []);

  const handleStart = () => {
    if (insuranceChecked) {
      if (!spendSurvivalPoints(INSURANCE_COST)) return;
      setRunConfig({ regionId, variantId, ts: Date.now(), insurancePurchased: true, insuranceUsed: false });
    } else {
      setRunConfig({ regionId, variantId, ts: Date.now(), insurancePurchased: false, insuranceUsed: false });
    }
    setSurvivalPoints(getSurvivalPoints());
    window.location.hash = "#/run";
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

        <button
          type="button"
          className="w-full py-4 border-2 border-white text-white font-bold text-lg hover:bg-white hover:text-black transition uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleStart}
          disabled={insuranceChecked && survivalPoints < INSURANCE_COST}
        >
          开始探索
        </button>
      </div>
      <div className="absolute bottom-3 right-3 z-10">
        <button
          type="button"
          className="text-[10px] text-gray-500 hover:text-gray-400 font-mono select-all cursor-pointer"
          onClick={() => {
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
