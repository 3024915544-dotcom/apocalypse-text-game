/** 版本：优先 VITE_APP_VERSION，无则 'dev'（构建时注入）。 */
export const APP_VERSION = import.meta.env?.VITE_APP_VERSION ?? "dev";

export const GRID_SIZE = 9;
export const MAX_TURNS = 16;
export const BAG_CAPACITY = 8;
export const MILESTONES = [5, 10, 15];

export const BATTERY_MAX = 12;
export const BATTERY_COST_MOVE = 1;
export const BATTERY_COST_SEARCH = 2;
export const DARK_MODE_EXTRA_MOVE = 1;
export const DARK_MODE_EXTRA_SEARCH = 2;
export const DARK_MODE_EXTRA_EXPOSURE = 10;
export const INSURANCE_COST = 50;

export const INITIAL_RESOURCES = {
  hp: 100,
  exposure: 0,
  water: 3,
  food: 3,
  fuel: 1,
  med: 1
};
