import { onRequestPost as __api_turn_ts_onRequestPost } from "D:\\MiniGame\\thelastshelter\\apocalypse-text-game\\thelastshelter\\functions\\api\\turn.ts"

export const routes = [
    {
      routePath: "/api/turn",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_turn_ts_onRequestPost],
    },
  ]