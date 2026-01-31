<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1RE2-3YDp-Sy5XyPRTmdIrjQwnCcDnftc

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Run the app: `npm run dev`

**说明：** 回合叙事由后端 `POST /api/turn` 提供（DeepSeek），API Key 仅配置在 Cloudflare 环境变量 `DEEPSEEK_API_KEY` 中，前端不接触 Key。本地开发时如需调用真实 API，可部署到 Cloudflare Pages 后，在 `.env.local` 中设置 `VITE_API_PROXY=https://你的 Pages 地址`，将 `/api` 代理到线上；或使用 `npx wrangler pages dev dist` 在本地运行 Functions（需在项目根目录创建 `.dev.vars`，内容 `DEEPSEEK_API_KEY=你的key`，勿提交）。

部署步骤见 [DEPLOY.md](DEPLOY.md)。
