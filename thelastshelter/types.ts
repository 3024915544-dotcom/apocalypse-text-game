
export type ActionType = 'MOVE_N' | 'MOVE_S' | 'MOVE_E' | 'MOVE_W' | 'SEARCH' | 'SILENCE' | 'INIT' | 'LOOT' | 'SCAN';

export enum RiskLevel {
  LOW = 'LOW',
  MID = 'MID',
  HIGH = 'HIGH'
}

export enum DirectionHint {
  NONE = 'NONE',
  N = 'N',
  NE = 'NE',
  E = 'E',
  SE = 'SE',
  S = 'S',
  SW = 'SW',
  W = 'W',
  NW = 'NW'
}

export interface ResourceDelta {
  hp?: number;
  exposure?: number;
  water?: number;
  food?: number;
  fuel?: number;
  med?: number;
}

export interface BagItem {
  id: string;
  name: string;
  type: 'FOOD' | 'WATER' | 'FUEL' | 'MED' | 'MISC';
  value: number;
  tag?: 'quest' | 'loot';
  rarity?: 'common' | 'rare' | 'epic';
}

export interface SceneBlock {
  type: 'TITLE' | 'EVENT' | 'RESULT' | 'AFTERTASTE';
  content: string;
}

export interface Choice {
  id: string;
  label: string;
  hint: string;
  risk: RiskLevel;
  preview_cost: ResourceDelta;
  action_type: ActionType;
  /** 服务端牌面强制 badge（孤注一掷/稀有机会/条件撤离/更危险等） */
  server_badge?: string;
}

export interface TurnResponse {
  scene_blocks: SceneBlock[];
  choices: Choice[];
  ui: {
    progress: {
      turn_index: number;
      milestones_hit: number[];
    };
    map_delta: {
      reveal_indices: number[];
      direction_hint: DirectionHint;
    };
    bag_delta: {
      add: BagItem[];
      remove: string[];
    };
  };
  suggestion: {
    delta: ResourceDelta;
  };
  memory_update: string;
  safety_fallback?: string;
  /** 本回合生效的牌面类型（服务端注入） */
  meta?: { cards?: string[] };
}

export interface GameState {
  runId: string;
  hp: number;
  exposure: number;
  battery: number;
  water: number;
  food: number;
  fuel: number;
  med: number;
  turn_index: number;
  player_pos: { x: number; y: number };
  exit_pos: { x: number; y: number };
  bag: BagItem[];
  fog: boolean[]; // 9x9 flattened
  grid_type: string[]; // 9x9 flattened labels
  status: 'PLAYING' | 'WIN' | 'LOSS';
  logs: string[];
  history: string[];
}
