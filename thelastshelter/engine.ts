
import { GameState, ActionType, ResourceDelta, BagItem } from "./types";
import { GRID_SIZE, MAX_TURNS, INITIAL_RESOURCES, BAG_CAPACITY, BATTERY_MAX, BATTERY_COST_MOVE, BATTERY_COST_SEARCH, DARK_MODE_EXTRA_MOVE, DARK_MODE_EXTRA_SEARCH, DARK_MODE_EXTRA_EXPOSURE } from "./constants";

export function createInitialState(): GameState {
  const player_x = 0;
  const player_y = 0;
  // Random exit pos far away
  let exit_x = Math.floor(Math.random() * 4) + 5;
  let exit_y = Math.floor(Math.random() * 4) + 5;

  const fog = new Array(GRID_SIZE * GRID_SIZE).fill(true);
  const grid_type = new Array(GRID_SIZE * GRID_SIZE).fill('EMPTY');

  const state: GameState = {
    ...INITIAL_RESOURCES,
    battery: BATTERY_MAX,
    turn_index: 0,
    player_pos: { x: player_x, y: player_y },
    exit_pos: { x: exit_x, y: exit_y },
    bag: [],
    fog,
    grid_type,
    status: 'PLAYING',
    logs: ['醒来在废墟中。寒风凛冽。'],
    history: []
  };

  revealFog(state, player_x, player_y);
  return state;
}

function revealFog(state: GameState, x: number, y: number) {
  const neighbors = [
    [x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
    [x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]
  ];
  neighbors.forEach(([nx, ny]) => {
    if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
      state.fog[ny * GRID_SIZE + nx] = false;
    }
  });
}

export function applyAction(state: GameState, actionType: ActionType, suggestionDelta?: ResourceDelta): GameState {
  const nextState = { ...state, logs: [...state.logs], bag: [...state.bag] };

  // 1. Move logic
  if (actionType.startsWith('MOVE_')) {
    const dir = actionType.split('_')[1];
    let dx = 0, dy = 0;
    if (dir === 'N') dy = -1;
    if (dir === 'S') dy = 1;
    if (dir === 'E') dx = 1;
    if (dir === 'W') dx = -1;

    const nx = nextState.player_pos.x + dx;
    const ny = nextState.player_pos.y + dy;

    if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
      nextState.player_pos = { x: nx, y: ny };
      revealFog(nextState, nx, ny);
      nextState.logs.push(`你移动到了 (${nx}, ${ny})。`);
    } else {
      nextState.logs.push(`撞到了废墟墙壁。`);
    }
  } else if (actionType === 'SEARCH' || (actionType as string).startsWith('SEARCH_') || actionType === 'LOOT' || actionType === 'SCAN') {
    nextState.logs.push(`你在瓦砾中翻找。`);
  }

  // 1.5 Battery cost (引擎权威)：搜索类用搜索扣电，其它（含 SILENCE）默认按移动扣电；黑暗模式额外扣电；clamp 到 [0, BATTERY_MAX]
  const prevBattery = nextState.battery ?? BATTERY_MAX;
  const actionKey = String(actionType);
  const isSearchLike = actionKey === 'SEARCH' || actionKey.startsWith('SEARCH_') || actionKey === 'LOOT' || actionKey === 'SCAN';
  const inDark = prevBattery <= 0;
  const cost = isSearchLike
    ? BATTERY_COST_SEARCH + (inDark ? DARK_MODE_EXTRA_SEARCH : 0)
    : BATTERY_COST_MOVE + (inDark ? DARK_MODE_EXTRA_MOVE : 0);
  nextState.battery = Math.max(0, Math.min(BATTERY_MAX, prevBattery - cost));
  if (prevBattery > 0 && nextState.battery <= 0) {
    nextState.logs.push(`电量耗尽，进入黑暗模式。`);
  }

  // 2. Resource updates (Cost of action + Suggestion)
  nextState.turn_index += 1;
  nextState.exposure += 5; // Passive cold
  if (nextState.battery <= 0) {
    nextState.exposure += DARK_MODE_EXTRA_EXPOSURE;
  }
  nextState.water -= 0.2;
  nextState.food -= 0.2;

  if (suggestionDelta) {
    if (suggestionDelta.hp) nextState.hp += suggestionDelta.hp;
    if (suggestionDelta.exposure) nextState.exposure += suggestionDelta.exposure;
    if (suggestionDelta.water) nextState.water += suggestionDelta.water;
    if (suggestionDelta.food) nextState.food += suggestionDelta.food;
    if (suggestionDelta.fuel) nextState.fuel += suggestionDelta.fuel;
    if (suggestionDelta.med) nextState.med += suggestionDelta.med;
  }

  // 3. Clamping
  nextState.hp = Math.min(100, Math.max(0, nextState.hp));
  nextState.exposure = Math.min(100, Math.max(0, nextState.exposure));
  nextState.battery = Math.min(BATTERY_MAX, Math.max(0, nextState.battery ?? BATTERY_MAX));
  nextState.water = Math.max(0, nextState.water);
  nextState.food = Math.max(0, nextState.food);
  nextState.fuel = Math.max(0, nextState.fuel);
  nextState.med = Math.max(0, nextState.med);

  // 4. Check status
  if (nextState.player_pos.x === nextState.exit_pos.x && nextState.player_pos.y === nextState.exit_pos.y) {
    nextState.status = 'WIN';
    nextState.logs.push('到达避难所。大门在你身后缓缓关上。你得救了。');
  } else if (nextState.hp <= 0 || nextState.exposure >= 100 || nextState.turn_index >= MAX_TURNS) {
    nextState.status = 'LOSS';
    if (nextState.hp <= 0) nextState.logs.push('你的身体无法支撑，倒在了雪地里。');
    else if (nextState.exposure >= 100) nextState.logs.push('辐射指数爆表，你的意识逐渐模糊。');
    else nextState.logs.push('时限已到。最后一班补给车已经开走。');
  }

  return nextState;
}

/** 计算当前背包空位数（0..BAG_CAPACITY）。 */
export function getEmptyBagSlots(state: GameState): number {
  const used = (state.bag || []).filter(Boolean).length;
  return Math.max(0, Math.min(BAG_CAPACITY, BAG_CAPACITY - used));
}

export function applyBagDelta(state: GameState, add: BagItem[], remove: string[]): GameState {
  let newBag = [...state.bag];
  remove.forEach(id => {
    newBag = newBag.filter(i => i.id !== id);
  });
  add.forEach(item => {
    if (newBag.length < BAG_CAPACITY) {
      newBag.push(item);
    }
  });
  return { ...state, bag: newBag };
}
