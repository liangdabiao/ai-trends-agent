# AI 硬件趋势日报

> 一个每天早上 9 点自动运行的信息助手：从全球公开渠道抓取 **AI 硬件** 行业动态（机器人、芯片、智能眼镜、端侧设备等），自动筛选、摘要、打分，最后生成一份结构化的中文 Markdown 日报。全程通过网页实时直播采集过程。

**技术栈：** OpenAI Agents SDK + EdgeOne Makers · TypeScript

[![部署到 EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://console.cloud.tencent.com/edgeone/makers/new?template=ai-trends-scheduled-summary&from=within&fromAgent=1&agentLang=typescript)

---

## 它能干什么？

每天自动帮你做 4 件事，全程不用人工干预：

1. **采集** — 从多个信息渠道抓取最新 AI 硬件资讯
2. **筛选** — 用决策模型判断哪些内容真的和 AI 硬件相关，去掉招聘帖、软文、垃圾信息
3. **分析** — 给每条资讯打 0-100 的推荐分，按领域分组，挑出最值得深读的 2-3 条
4. **写报告** — 生成一份《AI 硬件趋势日报》，含今日要点、热门动态、新出现、持续活跃、深度分析等章节

打开网页点一下「手动生成」，就能实时看到整个流水线的进度：资讯一条条进来、被筛选、被打分、报告逐字打出来。

## 数据从哪来？

| 渠道 | 说明 | 费用 |
|------|------|------|
| Hacker News | 官方 API，抓取当前热帖 | 免费 |
| Dev.to | 官方 API，AI 标签文章 | 免费 |
| 36kr AI 频道 | 沙箱浏览器抓取（自动降级：沙箱不可用就跳过） | 免费 |
| X（Twitter）搜索 | 经 TikHub 数据服务，搜索 AI 硬件关键词 | 约 $0.001-0.01/次 |
| Reddit | r/robotics、r/MachineLearning 等子版块热帖 | 约 $0.001-0.01/次 |
| 微博热搜 | 热搜榜（AI 硬件相关条目会被模型自动筛出） | 约 $0.001-0.01/次 |
| YouTube 搜索 | AI 硬件相关视频（默认关闭，可开启） | 约 $0.001-0.01/次 |

> 免费源配置好就能用；TikHub 付费源需要自己注册账号拿 Token（见下方环境变量），不配置也不影响其他源运行。

## 内容分成哪几类？

每条资讯会被自动归类到 6 个 AI 硬件领域：

| 分类 | 覆盖内容 |
|------|----------|
| **Robotics** | 人形机器人、具身智能、四足/工业/服务机器人、无人机 |
| **AI Chips** | GPU/NPU/芯片、半导体、先进制程、算力集群 |
| **Wearables & XR** | AI 眼镜、AR/VR 头显、智能手表/耳机 |
| **Edge AI** | 端侧模型、AI PC、AI 手机、智能驾驶 |
| **Smart Devices** | 智能家居、IoT、AI 玩具/陪伴机器人 |
| **AI Hardware Industry** | 融资并购、供应链、展会等行业动态 |

## 工作原理

```
定时任务（每天 9:00）或手动点击
        │
        ▼
┌─ 采集 ────────────────────────────────┐
│ HN / Dev.to / 36kr / X / Reddit / 微博 │
└──────────────┬────────────────────────┘
               ▼
┌─ jev 决策模型（结构化判断，非聊天模型）─┐
│  ① 和 AI 硬件相关吗？（0-1 概率）      │
│  ② 内容质量过关吗？（非招聘/非软文）    │
│  ③ 归入哪个分类？（6 选 1）            │
└──────────────┬────────────────────────┘
               ▼
┌─ Summarizer（大模型）+ Analyst（大模型）─┐
│  中文摘要 ∥ 分组 / 深度分析 / 核心洞察   │
│  0-100 推荐分也由 jev 并行完成           │
└──────────────┬────────────────────────┘
               ▼
┌─ Writer（大模型，逐字流式输出）──────────┐
│  生成《AI 硬件趋势日报》Markdown        │
└───────────────────────────────────────┘
```

几个值得一提的设计：

- **跨天去重**：每条资讯有唯一指纹，连续出现会被标记为「持续活跃」，首次出现标记为「新出现」
- **失败兜底**：任何一环出错都会自动降级（比如 TikHub 没配 Token 就跳过、jev 挂了退回关键词过滤、大模型挂了用代码拼一份兜底报告），保证每天一定有产出
- **实时直播**：整条流水线通过 SSE 推送到前端，报告是逐字打出来的

## 快速开始（本地运行）

需要 Node.js ≥ 18。

```bash
npm install
cp .env.example .env   # 填入环境变量（见下表）
edgeone makers dev     # 启动本地开发服务
```

> 小贴士：已登录 edgeone CLI 的话，首次运行 `edgeone makers dev` 会**自动把控制台的 AI 网关 Key 写进 .env**，你只需要手动补一行 `TIKHUB_TOKEN`（如果要用付费源）。

打开 `http://localhost:8088` 点击「手动生成」即可看到效果。

## 部署到 EdgeOne Makers

1. 点击上方「部署到 EdgeOne Makers」按钮，或推送本仓库后在 Makers 控制台导入
2. 在控制台的 **环境变量** 中配置下表变量
3. 部署完成后，定时任务自动生效（每天 9:00 运行）

## 「每日 9:00 自动采集」是怎么实现的？

这是 **EdgeOne Makers 平台层的定时任务**，不依赖你的电脑开机，原理分三步：

**① 部署时注册**：`edgeone.json` 里声明了定时计划，部署成功后平台自动在云端注册这个 cron 任务：

```json
"schedules": [
  {
    "name": "ai-trends-periodic",
    "cron": "0 9 * * *",          // 标准 5 段 cron：每天 9 点
    "path": "/ai-trends/run",     // 到点后平台请求这个接口
    "payload": {
      "_schedule": true,
      "trigger": "schedule",
      "sources": ["hackernews", "devto", "web", "tikhub"],
      "limit": 30
    },
    "timeout": 1200               // 单次运行最长 20 分钟
  }
]
```

**② 到点自动触发**：每天到点后，平台向生产环境的 `/ai-trends/run` 发一个带上面 payload 的 HTTP POST——**本质上就是平台替你点了一次「手动生成」**。代码里通过 `trigger = 'schedule'` 识别定时来源，报告上会显示「定时」角标。

**③ 结果落库**：定时运行时没有人在看直播，但报告会自动存入平台存储。你之后打开网站，首页直接加载当天最新日报（调 `/ai-trends/latest`），和手动生成的完全一样。

```
平台调度器（云端常驻，电脑关机不影响）
   │  每天 9:00 发 POST /ai-trends/run
   ▼
run.ts → 完整流水线 → 报告写入平台存储
   ▼
你打开网页 → 首页直接看到当天日报（角标「定时」）
```

> **⚠️ 时区提示**：cron 按**平台调度器的时区**解释。如果发现实际触发时间不是北京时间早上 9 点（比如按 UTC 解释则 `0 9 * * *` 是北京时间 17:00），把 cron 改成 `"0 1 * * *"` 即为北京时间 9:00。判断方法：看报告详情页的 `generatedAt` 生成时间，或控制台的执行记录。


## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | ✅ | 模型网关 Key。用 **Makers Models API Key**（控制台 Makers → Models → API Key 创建），或任何 OpenAI 兼容服务的 Key |
| `AI_GATEWAY_BASE_URL` | ✅ | 网关地址。Makers Models 填 `https://ai-gateway.edgeone.link/v1` |
| `AI_GATEWAY_MODEL` | ❌ | 模型 ID，默认 `@makers/minimax-m2.7`（内置模型有免费额度） |
| `TIKHUB_TOKEN` | ❌ | [TikHub](https://tikhub.io) 的 API Token，启用 X/Reddit/微博/YouTube 数据源。注册送约 50 次免费请求，最低充值 $5 |
| `TIKHUB_SOURCES` | ❌ | 启用哪些付费源，逗号分隔：`x,reddit,weibo,youtube`，默认 `x,reddit,weibo` |
| `TIKHUB_X_QUERY` | ❌ | X 搜索关键词，默认搜 AI 硬件相关英文词 |
| `TIKHUB_REDDIT_SUBS` | ❌ | Reddit 子版块（最多 3 个），默认 `robotics,MachineLearning,LocalLLaMA,hardware` |
| `TIKHUB_YOUTUBE_QUERY` | ❌ | YouTube 搜索词，默认 `AI hardware robot` |

**怎么拿 TikHub Token：** 到 [tikhub.io](https://tikhub.io) 注册 → 用户中心 → API Token → 创建。每次请求 $0.001-0.01，本项目每天定时跑一次，一天花费约几分钱。

## 成本大概多少？

以默认配置（每天 1 次定时运行、`limit=30`）估算，消耗全部来自实测数据：

### 模型 Token ≈ 4.5 万/天（约 135 万/月）

**jev 决策模型**（实测单次调用用量）：

| 环节 | 调用次数 | 单次 Token | 小计 |
|---|---|---|---|
| 策展（相关性 + 质量 + 分类，3 个问题） | 30 条 | ≈ 410 | ≈ 12,300 |
| 打分（5 档 score，1 个问题） | ~30 条 | ≈ 450 | ≈ 13,500 |
| **jev 日计** | | | **≈ 26,000** |

**大模型 minimax-m2.7**（按实测报告体量推算）：

| 环节 | 小计 |
|---|---|
| Summarizer（30 条中文摘要） | ≈ 5,000 |
| Analyst（分组 + 深度分析 + 工具调用） | ≈ 6,500 |
| Writer（日报全文约 5000 字） | ≈ 7,000 |
| **LLM 日计** | **≈ 18,500** |

### TikHub 数据 ≈ $0.005~0.05/天

每天定时跑一次 = 5 个请求（X 搜索 1 + Reddit 3 个子版块 + 微博热搜 1；开 YouTube 是 6 个），按 $0.001~0.01/次计。

### 费用总结

| 项目 | 日 | 月 | 说明 |
|---|---|---|---|
| 内置模型（jev + minimax） | ¥0 | ¥0 | 走 Makers 免费额度（限频），是否够用以控制台为准 |
| 模型（改绑自己的 Key BYOK） | ≈ ¥0.1 | ¥2~5 | 按 DeepSeek/MiniMax 价位（¥1~2/百万 token） |
| TikHub | ¥0.04~0.4 | ¥1~11 | 从充值余额扣 |
| 平台运行 | — | 套餐内 | EdgeOne Makers 套餐包含 |

**结论：每月成本 ≈ TikHub 的几块钱 + 平台套餐，模型侧基本免费。**

省钱提示：`limit` 从 30 改成 20（`edgeone.json` 的 schedule payload + `src/api.ts` 两处），模型 token 直接省 1/3；TikHub 请求数不变。

### 在哪看真实账单

- **模型用量**：Makers 控制台 → Models 概览 →「模型用量数据总览」
- **TikHub 用量**：[tikhub.io 用户中心](https://tikhub.io) → 每日用量 / 余额（支持按端点查单价）
- 每点一次「手动生成」= 再消耗上面一整份（模型 token + 5 个 TikHub 请求）

## 项目结构

```
├── agents/ai-trends/          # Agent 后端（核心流水线）
│   ├── run.ts                 # 主入口：采集→流水线→存储→SSE 推送
│   ├── stop.ts                # 停止正在运行的流水线
│   ├── _model.ts              # Summarizer / Analyst / Writer 三个大模型 Agent
│   ├── _jev.ts                # @makers/jev 决策模型客户端（筛选+打分）
│   ├── _tikhub.ts             # TikHub 数据源采集（X/Reddit/微博/YouTube）
│   ├── _sources.ts            # 免费数据源采集 + 关键词粗筛
│   ├── _items.ts              # 条目库：指纹、去重、跨天合并
│   ├── _memory.ts / _storage.ts  # 持久化（平台 store / 文件兜底）
│   ├── _report.ts             # 兜底报告生成
│   └── tests/                 # 流水线单元测试（npm test）
├── cloud-functions/ai-trends/ # 数据查询接口（latest/history/detail/delete/health）
├── src/                       # 前端（React + Vite，中英双语）
└── edgeone.json               # Agent 运行时 + 定时任务配置
```

## 常见问题

**Q：没配 TikHub Token 能跑吗？**
能。X/Reddit/微博/YouTube 会自动跳过，只用免费源。

**Q：某次运行失败了怎么办？**
流水线每一环都有兜底：jev 挂了退回关键词过滤，大模型挂了用代码拼报告，报告头部会标注降级原因。

**Q：日志里出现 402 Insufficient remaining quota 怎么办？**
内置模型的免费额度用完了（或触发限频）。去 Makers 控制台 → Models → 用量 看剩余额度：等额度重置，或在控制台绑定自己的模型 Key（BYOK，任何 OpenAI 兼容服务商都行）。此时流水线不会中断——jev 筛选自动降级为保守保留，报告照常生成，只是内容可能混入少量不相关条目。

**Q：怎么调整每天几点运行？**
改 `edgeone.json` 里 `schedules[0].cron`（标准 5 段 cron，服务器本地时区）。

**Q：想改成别的主题（比如只盯机器人）可以吗？**
可以，改三个地方即可：`_sources.ts` 的关键词表、`_jev.ts` 的分类定义（`HW_CATEGORIES` 和 criteria）、`_model.ts` 里三个 Agent 的提示词。

## 免责声明

- 资讯全部来自公开渠道，报告由 AI 自动生成，关键事实请点击原文链接核验
- X/Reddit 等数据经第三方服务（TikHub）获取，仅建议用于个人研究/内部监控，对外分发数据前请确认相关平台条款

## License

MIT


致谢： https://linux.do 佬友支持