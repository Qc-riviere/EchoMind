# EchoMind MVP 汇报报告

> 版本：v0.1
> 报告日期：2026-05-12
> 阶段：技术 MVP 已完成，准备进入灰度测试

---

## 执行摘要（一页）

**做了什么**：EchoMind 是一款定位"灵感备忘录"的本地优先桌面应用 + 微信 Bot + 可选 VPS 桥服务三件套，3 个月内完成从 0 到 v0.1 的核心功能闭环（全局速记热键、托盘徽标、本地语义检索、AI 自动 enrich、多选总结导出、微信 ClawBot 互通、用户选定子集上云）。

**为什么做**：当前笔记市场被 Notion / Obsidian / Flomo 三足分割，但**没有任何产品同时做到「本地优先 + 微信原生 + 用户控制上云子集 + 内置 AI」**。这个交集在中文市场是真空，且 2026 年 AI 笔记赛道正在从"云端 AI 协作"向"本地 AI + 隐私优先"迁移，窗口期 12–18 个月。

**做给谁**：重度笔记用户、独立开发者、技术博主、知识工作者；典型画像是"现在用 Flomo 但嫌弃没桌面深度"或"用 Obsidian 但没有微信无缝集成"的人。

**模式**：明确对标 Obsidian Sync 的「永久免费核心 + 可选付费扩展 + 明确隐私代价」三层架构（L1 Core 免费 / L2 Bridge 订阅 ¥20-30 月 / L3 Sync 未实现），用户自带 LLM Key（BYO Key），平台不承担 token 成本。

**当前状态**：L1 Core + L2 Bridge Phase 1–3 已完成，Phase 4（部署稳定性）剩三项；公开发布前 P0 阻断卡点（自动 Release / Docker 镜像 / bridge capture 路由 / 新手引导）**已全部清零**（见 `docs/architecture-hybrid-cloud.md` §13）。下一步进入 Closed Alpha 验证 H1（用户需求）+ H7（付费意愿）。

**核心数字**：
- 单人开发约 3 个月
- 8 个核心功能模块全部跑通
- 47 条竞品事实经过来源核实，已识别 6 家直接/间接竞品
- 9 项核心假设已结构化，3 项可立即开始验证
- 灰度计划三阶段，目标 10 → 50 → 300 用户

---

## 一、v0.1 已交付的功能

按三层架构维度盘点：

### L1 Core（永久免费，本地为主）

| 功能 | 状态 | 说明 |
|---|---|---|
| 全局速记热键 `Ctrl+Shift+I` | ✅ | 任何场景秒级唤出无边框小窗，Enter 保存，Esc/失焦自动隐藏；窗口常驻不可见，热键响应即时 |
| 系统托盘徽标 | ✅ | 鼠标悬停显示「今日新增 N」，点击聚焦主窗，60s 自动刷新 |
| 灵感置顶 | ✅ | 单条置顶到首页"最重要的事"区块，对应 GTD 的 MIT 概念 |
| 首页双列表 | ✅ | 「最近 5」+「对话最多 5」覆盖时间维度与注意力维度 |
| AI 自动 enrich | ✅ | 录入即触发：自动补 context / domain / tags |
| 多选 AI 总结 + 导出 | ✅ | 勾 2-20 条，AI 归纳为中心论点 + 要点；可保存为新灵感或导出 MD/DOCX/PDF |
| 本地语义检索 | ✅ | 基于 sqlite-vec 向量检索 + 关键词；本地数据库零外发 |
| 单条对话深挖 | ✅ | 任意灵感可开 AI 对话，结构化拷问框架；对话历史本地存储 |
| 多 LLM 提供商 | ✅ | OpenAI / Claude / Gemini / DeepSeek / 智谱 等可切换；BYO Key |

### L2 Bridge（可选订阅，VPS 桥服务）

| Phase | 功能 | 状态 |
|---|---|---|
| Phase 1 | VPS 服务端（axum + rusqlite + sqlite-vec + AES-256-GCM 加密 + 配对码 + 管理接口） | ✅ |
| Phase 2 | 本地对接（Bridge 客户端 + Cloud Bridge 配对页 + 子集规则引擎 + 生命周期钩子 + 初始全量同步） | ✅ |
| Phase 3 | `/chat` LLM 转发（可选推送 Key 至 VPS + 三家 LLM 远程执行 + 预算硬上限默认 $1/天 + UI 状态面板） | ✅ |
| Phase 4 | Docker Compose + nginx TLS / `/bridge/thoughts/capture` / `/chat` 速率限制 / Budget 通知 / 断线重连 | 🟡 进行中 |

### 微信 Bot 集成

- 基于 **微信 ClawBot**（2026 腾讯官方放开的个人号 Bot API，npm 包 `@tencent-weixin/openclaw-weixin` / 入口 `ilinkai.weixin.qq.com`）
- 支持命令：`/list`、`/search <词>`、`/view <ID>`、`/chat <ID>`、`/archive <ID>`、`/status`、`/help`
- `/chat` 回复带耗时尾注（`⏱ 1.8s`）
- 直接发文字 = 新建灵感，桌面端 30s 内拉到并系统通知
- 桌面在线 / 离线两种模式：在线走本地 daemon，离线走 VPS daemon（独立运行）

### L3 Sync（未实现，未来订阅）

多桌面端 E2E 加密同步，对标 Obsidian Sync 主功能。**MVP 阶段不做**。

---

## 二、为什么这样设计：架构关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Tauri 2 + React | 包体小、内存低、Rust 生态；vs Electron 的关键差异 |
| 数据存储 | 本地 SQLite + sqlite-vec | 单文件可移植；向量检索与关系数据共库；对标 Obsidian 的"用户掌控"叙事 |
| 隐私模型 | "上云子集" + 知情同意 | 不假装零知识；明确告诉用户「上云的部分会经腾讯 iLink 服务器 + VPS」；其余永不出本地 |
| LLM 接入 | BYO Key + 可选推送 VPS | 平台不承担 token 成本；用户对 Key 始终掌控 |
| 微信协议 | 微信 ClawBot / iLink 协议（腾讯官方 npm `@tencent-weixin/openclaw-weixin`） | 无封号风控；无商用风险；bot 账号独立于主号；可上云不依赖客户端 |
| 三层架构 | L1 Core / L2 Bridge / L3 Sync 模块化 | 直接对标 Obsidian Sync 已验证商业模式 |
| 配对方式 | 设备码（无账号系统） | 零运营成本；停止订阅自动销毁 |
| 预算保护 | VPS 端原子停用 + 默认 $1/天 | 防 Key 被劫持烧钱 |

---

## 三、假设验证进展

继承自 [`EchoMind_补充分析.md`](EchoMind_补充分析.md) 的 9 项核心假设。本表为当前状态快照：

| ID | 假设 | 当前判断 | 验证进度 | 下一动作 |
|---|---|---|---|---|
| H1 | 用户对现有笔记摩擦痛点强到愿意切换 | ⭐⭐ | 仅作者样本 | Closed Alpha 阶段访谈 10-15 人 |
| H2 | 「本地优先 + 微信原生 + 上云子集」三角差异化 | ⭐⭐⭐ | 技术全实现，市场未验证 | 写 4 方对比测评（vs Obsidian / Notion / Flomo / 语雀小记） |
| H3 | BYO Key + ¥20-30 订阅能闭环 | ⭐⭐⭐⭐ | 架构锁定，单价格段未实测 | 200 条样本计价模拟 + 种子用户 30 天实测 |
| H4 | sqlite-vec 在 5K-10K 量级达标 | ⭐⭐⭐⭐ | 技术信心高，未做规模验证 | 合成 10K 数据跑 1000 次查询基准 |
| H5 | AI enrich 输出可让用户信任不修改 | ⭐⭐⭐ | 主观感觉好，缺定量 | 100 条多样化样本人工评估 |
| H6 | 单人维护节奏可持续 | ⭐⭐⭐ | 当前节奏健康，3 月样本短 | 持续每月底回顾 |
| H7 | L2 订阅 ¥20-30 付费意愿足够 | ⭐⭐ | 价格段有锚定，付费转化无外部信号 | Landing page + 14 天试用 + AB 对照 |
| H8 | 微信 ClawBot（腾讯官方 iLink 协议）长期可用性可控 | ⭐⭐⭐⭐⭐ | 已澄清为腾讯官方 npm 包，无商用风险 | 阅读官方限流文档 + 跟踪 npm 包大版本 |
| H9 | Phase 4 部署收尾能在 4-6 周完成 | ⭐⭐⭐ | 范围明确、技术可控 | 拆 5 张 issue + staging VPS 跑 14 天 |

**解读**：
- **优势项（⭐⭐⭐⭐）**：H3 H4 —— 技术与商业模型层面信心强
- **观察项（⭐⭐⭐）**：H2 H5 H6 H9 —— 方向对，需数据支撑
- **风险项（⭐⭐）**：H1 H7 —— 需求与付费意愿是 Beta 阶段必须证伪/证实的两条
- **已澄清（⭐⭐⭐⭐⭐）**：H8 —— 接入的是 2026 腾讯官方放开的协议，从风险项降级为常规依赖管理
- **完整路线图**：详见 [`EchoMind_补充分析.md`](EchoMind_补充分析.md) 第一章

---

## 四、竞品定位与差异化

完整竞品调研详见 [`竞品调研报告-EchoMind.md`](竞品调研报告-EchoMind.md)。本节仅汇总 MVP 汇报相关结论：

### 6 家精选竞品威胁排序

| 竞品 | 一句话定位 | 威胁等级 | 我们的应对 |
|---|---|---|---|
| Flomo | 中文微信卡片笔记心智占有者 | 🔴 高 | 用「桌面深度 + AI 整理 + 本地控制」差异化，不拼极简文化 |
| Obsidian | 本地优先 PKM 隐形冠军 | 🔴 高 | 用「微信原生 + 内置 AI + 中文场景」差异化，不拼插件生态 |
| Notion | 协作云端工作台巨头 | 🟡 中 | 不拼协作；强调单用户深度个人体验 |
| 语雀小记 | 阿里系平台轻量入口 | 🟡 中 | 共存：用户用语雀做团队，用 EchoMind 做个人 |
| Reflect.app | 最纯 AI 笔记 | 🟢 低 | 无中文/微信，威胁低 |
| Capacities | PKM 对象模型实验 | 🟢 低 | 无中文/微信，威胁低 |

### EchoMind 唯一占据的市场空白

「本地优先 + 微信 ClawBot 原生（腾讯官方 iLink 协议）+ 用户控制上云子集 + 内置 AI（enrich/总结/对话）」四点同时存在，6 家竞品没有任何一家覆盖。

### 仅在中国市场可实现的优势

- 微信 ClawBot 集成（腾讯官方放开的 iLink 协议）—— 海外竞品根本不会做
- DeepSeek / 智谱 / 通义本地化 LLM 接入 —— 中文用户成本敏感
- 境内 VPS 部署 + PIPL 合规 —— Obsidian / Notion 受跨境数据政策约束

### 行业窗口期

2026 年 AI 笔记赛道转向"本地 AI + 隐私优先"（84% 专业人士因隐私改变行为），与 EchoMind 三层架构定位完全契合。窗口期估 12–18 个月。

---

## 五、关键指标与初步信号

### 已有数据

| 指标 | 数值 | 说明 |
|---|---|---|
| 开发周期 | ~3 个月（单人 5-10 小时/周） | 从 0 到 v0.1 |
| 代码量 | 已实现完整 L1 + L2 Phase 1-3 | 详见 [`README.md`](README.md) 项目结构 |
| 提交数（近 30 天） | 见 `git log` | 月度迭代节奏稳定 |
| 自用频次 | 作者日均 5-10 条灵感 | 验证场景真实性 |
| LLM 单次 enrich 成本 | 约 1-3K tokens（DeepSeek/Gemini Flash） | 折合 ¥0.01-0.03 |

### 待获取信号（灰度阶段）

| 指标 | 阈值 | 重要性 |
|---|---|---|
| Closed Alpha 7 天留存 | ≥ 60% | 验证 H1（需求强度） |
| Friends & Family 30 天留存 | ≥ 40% | 验证 H1（粘性） |
| Open Beta 试用→订阅转化 | ≥ 5% | 验证 H7（付费意愿） |
| BYO Key 用户月成本中位数 | ≤ ¥8 | 验证 H3（BYO Key 经济性） |
| Enrich 字段实际修改率 | ≤ 30% | 验证 H5（AI 质量） |
| L2 Bridge 50 并发 P95 延迟 | ≤ 500ms | 验证 H9（部署稳定性） |

---

## 六、下一阶段路线图

### Now → 4 周内（Phase 4 收尾 + Closed Alpha 准备）

✅ 已清（2026-05-12 收尾）：
- [x] `desktop-release.yml` GHA workflow（tag `v*` → Win .msi + macOS universal .dmg → Release）— v0.1.0-rc1 实跑通过
- [x] `docker-publish.yml`（bridge + wechat 镜像推 ghcr.io）— 早已存在
- [x] `/bridge/thoughts/capture` 路由 — 复盘发现已实现（gap：bridge 端无 enrich/embed，挪 P1 #11b）
- [x] 测试 LLM 连接按钮 — SettingsPage 已存在 + Onboarding Step 2 复用
- [x] 新手 4 步引导（`src/components/Onboarding.tsx`）

🚧 仍待办：
- [ ] Phase 4 剩余三项：`/chat` 速率限制 + Budget Tauri 事件 + 断线重连
- [ ] 部署 staging VPS 跑 14 天压力测试（模拟 50 用户并发）
- [ ] 阅读 OpenClaw 官方文档与 `@tencent-weixin/openclaw-weixin` README，记录限流上限（轻量任务，0.5 天）
- [ ] 申请 Apple Developer ID + 准备 Mac 签名（Windows 暂缓）
- [ ] 自己 e2e 走完 onboarding + 微信桥扫码（P1 #8），找漏修补
- [ ] 错误信息翻译层（P1 #7，API 报错 → 人类可读）
- [ ] 建 Closed Alpha 申请表（Tally / 飞书表单）+ 微信反馈群

### 5-8 周（Closed Alpha + Phase 4 验证）

- [ ] 邀请 10-15 名种子用户加入 Closed Alpha（朋友圈 + 技术群）
- [ ] 提供 EchoMind 托管 VPS 名额（每人独立 bridge token）
- [ ] 收集 H1（需求）+ H5（enrich 质量）+ H9（稳定性）数据
- [ ] 写 4 方对比测评草稿（vs Obsidian / Notion / Flomo / 语雀小记）
- [ ] 跑 H4 sqlite-vec 10K 规模 benchmark
- [ ] 跑 H3 200 条样本计价模拟

### 9-16 周（Friends & Family + 公开 Landing Page）

- [ ] 扩大到 30-50 用户（开放申请码制度）
- [ ] 上线 Landing Page（Vercel 部署，含付费意向调研表单）
- [ ] 推 4 方对比测评到小红书 / 即刻 / X / 少数派
- [ ] 收集 H7 付费意愿数据（含 BYO Key vs 含费 AB 对照）
- [ ] 准备订阅支付通道（Stripe 国际 + 国内支付如 Pingxx / 易支付）

### 17-24 周（Open Beta + 公开发布）

- [ ] 扩大到 100-300 用户
- [ ] 启动 14 天试用 → ¥199/年（早鸟首年 5 折锁定 = ¥99）
- [ ] 公开发布（GitHub Release + Landing Page + 各社区帖子）
- [ ] 持续跟踪 H6（维护负担）+ H7（试用→订阅转化）

---

## 七、灰度发布操作清单

具体怎么把项目分享出去做灰度：

### 7.1 阶段一：Closed Alpha（10-15 人，2-4 周）

#### 准备（1 周）

**安装包**（已自动化）：
1. 本地打 tag：`git tag v0.1.0-alpha1 && git push origin v0.1.0-alpha1`
2. GHA `desktop-release.yml` 自动 build Win + macOS universal → 推 GitHub Release（草稿状态）
3. 检查 Release assets 有 `.msi` 和 `.dmg` 后手动 publish
4. Mac 未公证时用户首次启动需"右键 → 打开"绕 Gatekeeper（Alpha 阶段可接受；Beta 前买 Apple Dev $99/年做 notarize）
5. Windows 不签名时 SmartScreen 会提示"未识别"，告诉用户点"详细信息 → 仍要运行"

**VPS 准备**：
1. 买一台 2C2G VPS（腾讯云轻量 / 阿里云轻量 ¥40-60/月）
2. 部署 `echomind-bridge-server` 用 Docker Compose（架构 §7 Phase 4 的 docker-compose.yml）
3. 配置 nginx + Let's Encrypt 拿 TLS 证书
4. 通过 admin token 生成 15 个配对码（每个 TTL 7 天）

**安装文档**：
1. 写一份「5 分钟上手」md，覆盖：
   - 下载 + 安装（含绕 Gatekeeper / SmartScreen 步骤）
   - 申请 LLM Key（推荐 DeepSeek 最便宜，给注册链接）
   - 在设置里填 Key
   - 接入微信 ClawBot（扫码即可，见下）
   - Cloud Bridge 配对（输入服务器地址 + 配对码）
2. **微信 ClawBot 接入**（腾讯 2026 官方放开的个人号 Bot API）：
   - 在 EchoMind 设置页点「启动微信桥」，自动调起腾讯官方 CLI（`npx @tencent-weixin/openclaw-weixin-cli@latest install`）弹出二维码
   - 用户用自己的微信扫码授权，CLI 自动拿到 bot_token 并保存到本地配置
   - **无需注册新账号**；bot 作为独立 contact 加入用户微信，主号完全不受影响、无封号风险
   - 文档里直接挂出腾讯官方背书链接（让用户安心）：[npm 包](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) · [GitHub Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) · [OpenClaw 官方文档](https://docs.openclaw.ai/channels/wechat)

**反馈通道**：
1. 建 EchoMind 内测交流群（微信群 < 100 人，超过要拆群）
2. 开 GitHub Issues + 在 Settings 页加"反馈"按钮直接打开 issue 提交链接

#### 招募（直接发）

朋友圈/技术群发文案：
> EchoMind 内测招募：本地优先的灵感备忘录，桌面 + 微信双端 + 内置 AI。免费内测 4 周，名额 15 人。需要：(1) 你常用微信记灵感；(2) 自己有 LLM key（DeepSeek 即可）；(3) 愿意每周给一次反馈。报名填表：[Tally 链接]

不打公开文案，定向邀请技术圈/产品圈朋友，避免初期被吐槽放大。

#### 跑 4 周

- 每周日发问卷收集（用最简表单：3 个问题，"用了几次/最爽的功能/最劝退的功能"）
- 微信群每天看一眼，紧急 bug 当晚修
- 月底回顾会（线上语音 30 分钟），所有 Alpha 用户参加

### 7.2 阶段二：Friends & Family（30-50 人，4-8 周）

继承 Alpha 全部基础设施，新增：

- **限流式邀请码**：每个 Alpha 用户分 2 个邀请码邀请朋友
- **VPS 扩容**：升级到 4C4G，跑 50 用户压力测试
- **Telemetry 接入**：埋点（用户 opt-in，匿名上报"用了哪些功能/error stack"）；可用 Sentry（个人免费 5K errors/月）+ 自建 stats 接口
- **Landing Page 雏形**：Vercel 部署一个 1 页 site，写明产品定位 + 3 张截图 + 申请表入口

### 7.3 阶段三：Open Beta（100-300 人，8-12 周）

新增：

- **正式 Landing Page**：含详细功能页、定价页、对比页、隐私协议、用户故事
- **公开 PR**：4 方对比测评发到小红书 / 即刻 / X / V2EX / 少数派
- **支付通道**：Stripe（国际）+ 国内支付（Pingxx / 易支付）；先不开订阅，只接受"早鸟意向预付 ¥99 锁定首年"
- **签名补齐**：Mac 公证 + Windows 至少 OV 证书（约 ¥1500/年，避免 SmartScreen 拦截）
- **VPS 自部署文档**：让技术用户能自己部一台 EchoMind Bridge，作为隐私敏感用户备选

### 7.4 灰度阶段最常踩的坑（提前避坑）

| 坑 | 怎么避 |
|---|---|
| Mac 用户拒装：Gatekeeper 拦截 | Alpha 接受，Beta 前公证 |
| Windows 用户拒装：SmartScreen 警告 | Alpha 接受，Beta 前买 OV/EV 证书 |
| 用户 LLM Key 配错或忘配 | Settings 页加"测试连接"按钮，配错时弹明确报错 |
| 微信 ClawBot 扫码登录困惑 | 写图文教程，配 CLI 一键启动；强调"扫码即得 token，无需注册账号" |
| 一个用户的 LLM Key 被劫持 | 已有预算硬上限 $1/天保护 |
| 反馈量大但找不到模式 | 用 Notion / 飞书表格按"功能 / 严重度 / 频次"打分，每周整理 Top 3 |
| 灰度用户期望全部满足 | 设期望管理：明确告诉是 alpha，不保证稳定，bug 多 |
| 找不到种子用户 | 优先 1 对 1 邀请熟人，不要群发 |

---

## 八、资源 / 风险 / 决策点

### 当前资源现状

| 项 | 状态 |
|---|---|
| 开发人力 | 1 人（作者，5-10 小时/周） |
| 资金 | 自筹，VPS 月成本 ¥40-60 |
| 时间窗口 | 行业窗口 12-18 个月 |
| 已有渠道 | 朋友圈 / 技术圈 / 个人社交账号 |

### 关键风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Flomo 抄袭桌面端 + AI（H2 失守） | 高 | 用「上云子集 + 微信 ClawBot 官方集成」做技术壁垒；快速建立用户心智 |
| 单人开发节奏崩溃（H6 失守） | 高 | 每月底回顾节奏；Open Beta 前评估是否引入兼职 |
| 付费转化低于 5%（H7 失守） | 中 | 备好买断制 / L2+L3 套餐 / BYO Key 三档备选定价 |
| Mac/Win 签名劝退（灰度阶段） | 中 | Beta 前补齐签名 |
| `@tencent-weixin/openclaw-weixin` 大版本 breaking change | 低 | 跟踪 npm dist-tag（latest / legacy），按 OpenClaw 兼容矩阵升级 |

### 需立即决策的事项

1. **Closed Alpha 启动时间**：建议 4 周内（待 Phase 4 收尾完成）
2. **是否申请 Apple Developer**：建议立即申请（审核需 1-2 周）
3. **VPS 部署位置**：境内 vs 海外。建议境内（PIPL 合规友好 + 国内访问快），海外作为隐私敏感用户的可选
4. **是否引入兼职**：H6 验证未到位前不急；3 个月后回顾
5. ~~iLink 商务对接~~（已澄清为腾讯官方放开协议，移除该决策项）

---

## 九、后续报告节奏

- **每月底**：H1-H9 假设状态更新 + 关键指标快照
- **Closed Alpha 结束（4 周后）**：用户访谈 + 留存 + 关键反馈汇总
- **Friends & Family 结束（12 周后）**：付费意愿调研结果 + Landing Page 数据
- **Open Beta 启动（17 周后）**：正式公开发布前的最后一份汇报，含 Go/No-Go 决策

---

## 附录：相关文档

- 项目说明：[`README.md`](README.md)
- 架构方案：[`docs/architecture-hybrid-cloud.md`](docs/architecture-hybrid-cloud.md)
- 假设验证框架：[`EchoMind_补充分析.md`](EchoMind_补充分析.md)
- 竞品调研：[`竞品调研报告-EchoMind.md`](竞品调研报告-EchoMind.md) + [`竞品调研报告-验证日志.md`](竞品调研报告-验证日志.md)
