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

打开 `http://localhost:8088` 点击「手动生成」即可看到效果。

## 部署到 EdgeOne Makers

1. 点击上方「部署到 EdgeOne Makers」按钮，或推送本仓库后在 Makers 控制台导入
2. 在控制台的 **环境变量** 中配置下表变量
3. 部署完成后，定时任务自动生效（每天 9:00 运行）

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

| 项目 | 费用 |
|------|------|
| 内置模型（minimax / jev） | Makers 送免费 token 额度，日常用量基本够 |
| TikHub 数据 | 每天一次约 8-10 个请求 ≈ $0.01-0.05/天 |
| 运行 | EdgeOne Makers 平台费用 |

## 项目结构

```
├── agents/ai-trends/          # Agent 后端（核心流水线）
│   ├── run.ts                 # 主入口：采集→流水线→存储→SSE 推送
│   ├── stop.ts                # 停止正在运行的流水线
│   ├── _model.ts              # Summarizer / Analyst / Writer 三个大模型 Agent
│   ├── _jev.ts                # @makers/jev 决策模型客户端（筛选+打分）
│   ├── _tikhub.ts             # TikHub 数据源采集（X/Reddit/微博/YouTube）
│   ├── _sources.ts            # 免费数据源采集 + jev 过滤入口
│   ├── _items.ts              # 条目库：指纹、去重、跨天合并
│   ├── _memory.ts / _storage.ts  # 持久化（平台 store / 文件兜底）
│   └── _report.ts             # 兜底报告生成
├── cloud-functions/ai-trends/ # 数据查询接口（latest/history/detail/delete/health）
├── src/                       # 前端（React + Vite，中英双语）
├── edgeone.json               # Agent 运行时 + 定时任务配置
└── tests/                     # 流水线单元测试（npm test）
```

## 常见问题

**Q：没配 TikHub Token 能跑吗？**
能。X/Reddit/微博/YouTube 会自动跳过，只用免费源。

**Q：某次运行失败了怎么办？**
流水线每一环都有兜底：jev 挂了退回关键词过滤，大模型挂了用代码拼报告，报告头部会标注降级原因。

**Q：怎么调整每天几点运行？**
改 `edgeone.json` 里 `schedules[0].cron`（标准 5 段 cron，服务器本地时区）。

**Q：想改成别的主题（比如只盯机器人）可以吗？**
可以，改三个地方即可：`_sources.ts` 的关键词表、`_jev.ts` 的分类定义（`HW_CATEGORIES` 和 criteria）、`_model.ts` 里三个 Agent 的提示词。

## 免责声明

- 资讯全部来自公开渠道，报告由 AI 自动生成，关键事实请点击原文链接核验
- X/Reddit 等数据经第三方服务（TikHub）获取，仅建议用于个人研究/内部监控，对外分发数据前请确认相关平台条款

## License

MIT
