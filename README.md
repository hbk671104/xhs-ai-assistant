# 🌸 小红书 AI 粉丝互动助手

自动化管理小红书粉丝互动 — 主动去粉丝的帖子下评论，让粉丝感受到你在关注他们的动态，形成良性互动机制。由 DeepSeek AI 驱动评论生成，支持飞书通知与多架构 Docker 部署。

## 功能特性

- **主动粉丝互动** — 自动识别评论过你帖子的粉丝，访问其主页浏览最新笔记并留下真诚评论
- **AI 智能评论** — 调用 DeepSeek-v4-flash 基于笔记内容生成自然、相关的评论，杜绝千篇一律
- **持久化登录** — 自动加载 Session，失效时截图二维码通过飞书推送，扫码后自动保存
- **智能过滤** — AI 自动跳过广告、低质或无法理解的笔记内容
- **智能调度** — 仅在 09:00–23:00 运行，每日上限 40–50 条，批处理间强制休息
- **熔断保护** — 检测"操作频繁"提示、连续失败或频繁重定向时自动告警并安全退出
- **飞书通知** — 运行报告、登录二维码、异常告警全部推送到飞书机器人

## 技术栈

| 层 | 技术 |
|---|---|
| Runtime | Node.js 22+ (ESM) |
| Automation | Playwright + playwright-extra + Stealth 插件 |
| AI 大脑 | DeepSeek-v4-flash（OpenAI 兼容格式） |
| 通知 | 飞书自定义 Webhook 机器人 |
| 部署 | Docker，支持 `linux/amd64` + `linux/arm64` |

## 快速开始

### 1. 克隆项目

```bash
git clone <repo-url>
cd xhs-ai-assistant
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入以下必要配置：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
```

### 4. 本地运行

```bash
npm start
```

首次运行若无有效 Session，脚本会截图登录二维码并通过飞书推送，扫码后自动继续。

## Docker 部署

### 单架构构建

```bash
docker compose up -d
```

### 多架构构建（amd64 + arm64，适用于 R5S）

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t xhs-ai-assistant:latest \
  --push .
```

### 数据持久化

容器内 `/app/data` 挂载到宿主机 `./data`，包含：
- `auth_state.json` — 登录 Session（自动生成，请勿提交到 Git）
- `screenshots/` — 登录二维码截图

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | **必填** DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 基础地址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 使用的模型 |
| `FEISHU_WEBHOOK_URL` | — | **必填** 飞书 Webhook 地址 |
| `DAILY_REPLY_MIN` | `40` | 每日评论下限 |
| `DAILY_REPLY_MAX` | `50` | 每日评论上限 |
| `ACTIVE_HOUR_START` | `9` | 活跃时段开始（时） |
| `ACTIVE_HOUR_END` | `23` | 活跃时段结束（时） |
| `BATCH_SIZE` | `5` | 批处理每批数量 |
| `BATCH_REST_MIN_MINUTES` | `10` | 批间休息最小分钟 |
| `BATCH_REST_MAX_MINUTES` | `15` | 批间休息最大分钟 |
| `HEADLESS` | `true` | 无头模式（Docker 必须为 true） |

## 项目结构

```
src/
├── index.js           # 主入口 & 主循环
├── config.js          # 环境变量配置与校验
├── browser.js         # Playwright + Stealth 浏览器管理
├── auth.js            # 持久化登录 & 二维码扫码流程
├── interactions.js    # 粉丝互动：访问粉丝主页并评论其笔记
├── ai.js              # DeepSeek AI 评论生成
├── feishu.js          # 飞书 Webhook 通知
├── human.js           # 拟人化操作（逐字输入/随机延迟）
├── scheduler.js       # 时段调度 & 每日限额
└── circuit-breaker.js # 熔断器
```

## 防封策略说明

| 策略 | 实现方式 |
|---|---|
| 环境伪装 | Stealth 插件 + 覆盖 `navigator.webdriver` 等指纹属性 |
| 随机身份 | 从包含移动端/桌面端的 UA 池中随机选择 |
| 拟人输入 | 每字符 50–200ms 随机延迟，禁止 `fill()` |
| 操作间隔 | 页面跳转/点击前 3–10 秒随机等待 |
| 批间休息 | 每 5 条评论强制休息 10–15 分钟 |
| 运行限制 | 单日 40–50 条上限，09:00–23:00 时段限制 |
| 熔断退出 | 检测频率限制提示 / 连续失败 / 频繁重定向后告警并退出 |

## 注意事项

- `data/auth_state.json` 包含登录凭证，已加入 `.gitignore`，请勿泄露
- 本项目仅供学习研究，使用时请遵守小红书用户协议
