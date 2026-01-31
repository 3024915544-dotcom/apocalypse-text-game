import React, { useState, useEffect } from "react";
import { getRunConfig, setRunConfig, defaultRunConfig, type RunConfigVariantId } from "./game/runConfig";

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

  useEffect(() => {
    const cfg = getRunConfig();
    setRegionId(cfg.regionId);
    setVariantId(cfg.variantId);
  }, []); // 仅挂载时跑一次，不依赖 variantId，避免覆盖用户选择

  const handleStart = () => {
    setRunConfig({ regionId, variantId, ts: Date.now() });
    window.location.hash = "#/run";
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0a] text-[#d1d1d1] p-4 md:p-8">
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
          className="w-full py-4 border-2 border-white text-white font-bold text-lg hover:bg-white hover:text-black transition uppercase tracking-wider"
          onClick={handleStart}
        >
          开始探索
        </button>
      </div>
    </div>
  );
};

export default ShelterHome;
