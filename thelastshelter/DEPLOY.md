# 一键部署到 Cloudflare Pages / Workers

本项目使用 **Cloudflare Pages + Functions**：前端静态资源 + `POST /api/turn` 同源部署，API Key 仅存在 Cloudflare 环境变量中，绝不暴露到前端。

---

## 方式一：Cloudflare Pages（推荐）

### 1. 安装 Wrangler（如未安装）

```bash
npm install -g wrangler
wrangler login
```

### 2. 构建前端

```bash
npm install
npm run build
```

输出目录为 `dist/`。**Cloudflare Pages 的 Build output directory 必须设置为 `dist`**，否则静态资源路径会错误。

### 3. 在 Cloudflare Dashboard 创建 Pages 项目

1. 打开 **https://dash.cloudflare.com** → 左侧 **Workers & Pages**。
2. 点击 **Create application** → 选择 **Pages**。
3. 选择 **Connect to Git**（推荐）或 **Direct Upload**：
   - **Connect to Git**：选仓库，分支（如 `main`），构建命令填 `npm run build`，输出目录填 `dist`。**重要**：在 **Settings → Functions** 中确认 **Functions directory** 为 `functions`（或留空，默认会识别项目根目录下的 `functions`；若用 Git 部署，需确保仓库根目录有 `functions` 文件夹并一起提交）。
   - **Direct Upload**：用 Wrangler 上传（见下方「用 Wrangler 上传」）。

### 4. 配置环境变量（必须）

1. 在 **Workers & Pages** 中进入你的 **Pages 项目**。
2. 点击 **Settings** → **Environment variables**。
3. 点击 **Add variable**（或 **Add**）：
   - **Variable name**：`DEEPSEEK_API_KEY`
   - **Value**：你的 DeepSeek API Key（从 https://platform.deepseek.com 获取）
   - 选择 **Encrypt**，并勾选 **Production**（以及如需要 **Preview**）。
4. 保存。重新部署一次后，`POST /api/turn` 会使用该 Key 调用 DeepSeek，前端永远拿不到 Key。

### 5. 部署

- **Git 方式**：推送代码后，Cloudflare 会自动构建并部署；每次 push 会触发新部署。
- **Direct Upload**：在项目根目录执行：
  ```bash
  npx wrangler pages deploy dist --project-name=你的项目名
  ```
  注意：Direct Upload 时，**Functions 需要单独配置**。若使用 Git 连接，`functions` 目录会随仓库一起部署；若只用 Direct Upload，需在 Dashboard 里为该 Pages 项目绑定 **Functions**（同一仓库或包含 `functions` 的目录），具体见 [Pages Functions 文档](https://developers.cloudflare.com/pages/functions/)。

### 6. 确认 Functions 目录

- 使用 **Git 部署** 时，确保仓库根目录有 **`functions`** 文件夹，且内有 **`api/turn.ts`**（即 `functions/api/turn.ts`）。这样 Cloudflare 会自动将 `POST /api/turn` 路由到该 Function。
- 在 **Pages 项目 → Settings → Functions** 中可查看/设置 **Functions directory**（一般为 `functions`）。

---

## 方式二：仅部署为 Cloudflare Worker（只提供 API）

若你只想把 `POST /api/turn` 部署为独立 Worker（例如前端放在别处）：

1. 在项目根目录创建 **wrangler.toml**（若还没有），例如：

```toml
name = "thelastshelter-api"
main = "functions/api/turn.ts"
compatibility_date = "2024-01-01"

[vars]
# 不要在这里写 API Key！用 Secret
```

2. 在 **Workers & Pages** 中 **Create application** → **Worker**，或本地执行：

```bash
npx wrangler deploy
```

3. 在 Dashboard 中进入该 Worker → **Settings** → **Variables and Secrets** → **Add** → **Encrypt**，名称 `DEEPSEEK_API_KEY`，值为你的 Key。

4. 前端需将请求发到该 Worker 的 URL，例如：`https://thelastshelter-api.你的子域.workers.dev/api/turn`。此时前端不要用相对路径 `/api/turn`，而是用完整 Worker 地址（或通过你自己的前端代理转发）。

---

## 本地联调（前端 + /api/turn）

- **只跑前端**：`npm run dev`。若未配置代理，`/api/turn` 会 404；可设置 `.env.local` 中 `VITE_API_PROXY=https://你已部署的 Pages 地址`，并在 `vite.config.ts` 中已配置 `proxy` 时，将 `/api` 转发到该地址。
- **同时跑前端 + Functions**：在仓库根目录执行：
  ```bash
  npm run build
  npx wrangler pages dev dist --compatibility-date=2024-01-01
  ```
  浏览器访问 Wrangler 给出的本地地址（如 `http://localhost:8788`），即可同时使用静态页和 `POST /api/turn`。在 **Pages 项目 → Settings → Environment variables** 里配置的变量，需在本地用 `.dev.vars` 模拟（在项目根目录创建 `.dev.vars`，内容一行：`DEEPSEEK_API_KEY=你的key`，不要提交到 Git）。

---

## 小结：点哪里

| 操作           | 位置 |
|----------------|------|
| 创建 Pages     | **Workers & Pages** → **Create application** → **Pages** |
| 配置 API Key   | **你的 Pages 项目** → **Settings** → **Environment variables** → **Add variable** → 名称 `DEEPSEEK_API_KEY` |
| 查看/设置 Functions 目录 | **你的 Pages 项目** → **Settings** → **Functions** → **Functions directory**（如 `functions`） |
| Worker 单独配置 Key | **你的 Worker 项目** → **Settings** → **Variables and Secrets** → **Add** |

部署完成后，前端访问你的 Pages 域名，`POST /api/turn` 会由 Cloudflare 在后端调用 DeepSeek，Key 仅存在于 Cloudflare 环境变量中，不会出现在前端代码或网络中。
