# WeChat Codex Bridge

<p align="center">
  <strong>在微信里和 Codex 聊天，用微信指挥你电脑上的 Codex 干活</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License: MIT"></a>
</p>

扫码绑定微信后，你的微信里会多出一个"好友"。给它发消息，消息会自动转发给你电脑上运行的 [Codex CLI](https://github.com/openai/codex)，回复实时推送回微信。支持文字、图片、文件的收发，会话上下文持续保持。

> 本项目移植自 [dizhu/wechat-claude-code](https://github.com/dizhu/wechat-claude-code)（安全加固版微信 ↔ Claude Code 桥接），把驱动层从 `claude` CLI 换成了 `codex` CLI，微信侧的多 bot / 多成员 / 安全加固全部保留。**使用前请先读下方 [⚠️ 安全须知](#-安全须知)。**

## 核心亮点

| | |
|---|---|
| **扫码即用** | 不用注册账号、不用部署服务器。微信扫码绑定，凭证全在本地。 |
| **指挥 Codex 干活** | 在微信里发需求，Codex 在你电脑上读写文件、跑命令、改代码，结果推回微信。 |
| **会话连续** | 基于 `codex exec resume` 保持上下文，多轮对话不丢记忆。`/compact` 可压缩、`/clear` 可重开。 |
| **多人 / 团队** | 一个守护进程可同时服务多名成员，每人各绑自己的 bot，会话与工作目录互相隔离。 |
| **消息不刷屏** | 默认只推 Codex 的最终回复；中间的思考、命令执行噪音自动过滤（可选开启命令进度）。 |
| **"对方正在输入中..."** | Codex 处理任务时，微信顶部显示输入状态。超过 5 分钟无响应自动安抚。 |
| **文件双向收发** | 发图片 / Word / PDF 给 Codex 分析；Codex 生成的文件也会自动推送回微信。 |
| **Grok Bot** | 可为一个微信机器人接入 Grok Bot Routine，使用 `/grok` 或 `COO` 显式派单并接收文字回复。 |

## 前置条件

- Node.js >= 18
- macOS 或 Linux
- 个人微信账号（每名成员各需一个）
- 已安装并登录的 [Codex CLI](https://github.com/openai/codex)（`codex login` 完成认证；命令行能直接跑 `codex exec` 即可）

## 快速安装

```bash
git clone https://github.com/Randy0609/wechat-codex-code.git ~/Code/wechat-codex-code
cd ~/Code/wechat-codex-code && npm install
```

> `npm install` 会自动 `npm run build` 编译 TypeScript。

## 快速开始（单人）

### 1. 扫码绑定

```bash
npm run setup
```

弹出二维码，用微信扫码确认，并设置一个默认工作目录。

### 2. 启动服务

```bash
npm run daemon -- start
```

macOS 下自动注册 launchd（开机自启、崩溃自动重启）；Linux 用 systemd（无 systemd 时回退到 nohup）。启动后会打印当前服务的 bot 数量。

### 3. 开始聊天

打开微信，给你新出现的那个"好友"发条消息试试。

### 管理服务

```bash
npm run daemon -- status    # 查看运行状态
npm run daemon -- stop      # 停止服务
npm run daemon -- restart   # 重启服务（更新代码或新增成员后使用）
npm run daemon -- logs      # 查看日志
```

## 可选接入 Grok Bot

普通消息继续走 Codex。启用后，指定微信机器人的绑定者可以发送
`/grok 帮我摘要这段话：…`，或使用 `COO`、`@COO` 加空格或冒号。桥接只向
Grok Bot 发送本条命令的正文和任务编号。附件和语音走原有路径。

1. 在 Grok Bot 桌面端给目标 Bot 创建专用 [Webhook Routine](https://docs.x.ai/grok-bot/skills-routines-and-automations#webhooks)。
2. 在桥接宿主机的 `~/.wechat-codex-code/grok-bot/`（目录权限 `0700`）内创建
   `config.json`（权限 `0600`）。使用 `umask 077` 后再创建文件。在本机编辑器中将占位符替换为实际值。
   使用 `WCX_DATA_DIR` 时，服务和回传命令应使用同一个数据目录。

   ```json
   {
     "accountId": "<微信桥启动时显示的目标 Bot ID>",
     "webhookUrl": "<Routine 的 POST to>",
     "webhookKey": "<Routine 的 key>"
   }
   ```

3. 让 Routine 读取 webhook JSON 中的 `text` 和 `task_id`，按你授予的范围处理。
   完成后使用 Grok Bot 桌面端的本机执行能力，在**运行微信桥的机器**上执行
   `node /你的路径/wechat-codex-code/dist/tools/grok-reply.js`。
   以 JSON 通过标准输入传入原始 `task_id` 和最多 3900 字符的 `text`。
   用 JSON 序列化生成输入，避免把消息正文当作 shell 代码。按当前本机审批设置批准这条回传命令。
   桥接使用派单时捕获的原微信会话，Routine 无需接触微信 ID、Token 或任何对外监听端口。
4. 构建并从实际部署目录重启服务。用一条不含私密信息的 `/grok` 消息试跑，
   分别核对 Routine 运行记录、回传命令和手机收到的回复。

Webhook HTTP 200 表示 Routine 已启动。回传命令提示已入队后，桥接仍需向微信提交回复。
宿主机、微信桥和有效微信登录需要在同一次请求的 30 分钟内可用。重启会丢失在途任务的
微信回复上下文，需在查过旧任务运行记录后发送新请求。网络结果不明确时桥接保留回复窗口，
同一条微信消息不会自动再次派单。`/stop` 控制本机 Codex，已经启动的 Routine 由 Grok Bot 管理。
任务元数据保留在私有目录中，方便按任务编号查找派单和回传状态。

## Codex 版本升级与连接排障

微信桥接通过后台服务的 `PATH` 启动独立的 `codex` CLI。桌面应用能正常使用，不能证明桥接调用的 CLI 也已更新。

如果微信回复 `The 'gpt-6-astra' model requires a newer version of Codex`，先检查后台服务实际使用的 CLI 路径和版本。2026-09-10 的本机排障中，CLI 0.144.5 遇到此错误，升级到 0.154.0 后，新建对话和继续对话均通过 gpt-6-astra 调用测试。这是已验证的版本组合，不代表最低版本要求。

对于通过 npm 全局安装的 CLI，在桥接所在机器执行：

```bash
command -v codex
codex --version
npm install -g @openai/codex@latest
codex --version
```

如果机器安装了多份 CLI，应同时检查 macOS LaunchAgent 或 Linux systemd 服务里的 `PATH`，确保更新的是后台服务实际调用的那一份。只更新桥接仓库的 npm 依赖不会升级全局 Codex CLI。

更新桥接代码后，在仓库目录执行：

```bash
git pull --ff-only
npm ci
npm test
npm run daemon -- restart
npm run daemon -- logs
```

`npm ci` 会通过 `postinstall` 编译源码。此版本修复了沙箱与审批参数在 `exec` / `exec resume` 中的顺序，并将已知的实验功能提示和技能描述缩短提示作为非致命通知处理；认证失败、模型版本错误等真实错误仍会报告。

最终验收应从手机微信发送一条唯一的测试消息，并确认收到相应回复。仅进程运行或本地模型测试成功，不算完成微信端到端验收。无需为此删除账号、会话或同步游标。

## 多人 / 团队使用

ilink bot 是 **1:1 设计**——每个 bot 只能绑定一个微信号。多人的正确做法是：**每名成员各扫一次码、绑定自己的独立 bot，由同一个守护进程统一服务。** 每人的会话上下文、聊天历史、工作目录完全隔离，请求并发执行、互不阻塞。

新增一名成员：

1. `npm run setup` 生成一张绑定二维码（`~/.wechat-codex-code/qrcode.png`）。
2. 把二维码发给该成员，让他**用自己的手机微信扫码确认**。bot 出现在**他的**微信里，凭证保存到宿主机 `~/.wechat-codex-code/accounts/<新id>.json`。
3. `npm run daemon -- restart` 重启，守护进程自动加载并服务新增 bot。

> 每名成员默认有独立工作目录 `<workingDirectory>/<用户短ID>`，自动创建；成员可用 `/cwd` 自行切换（非 owner 被限制在自己的工作区内）。

## 微信端命令

直接在微信聊天中发送即可：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/clear` | 清除当前会话，开始新对话（保留工作目录/模型/提示词） |
| `/stop` | 停止当前任务，并清空排队消息 |
| `/model <名称>` | 切换 Codex 模型（如 `gpt-5-codex`） |
| `/prompt <内容>` | 设置系统提示词（**仅对你自己生效**，如"用中文回答"） |
| `/cwd <路径>` | 切换你自己的工作目录 |
| `/prompts [full]` | 列出 `~/.codex/prompts/` 下的自定义 prompt |
| `/status` | 查看当前会话状态 |
| `/history [数量]` | 查看最近对话记录 |
| `/compact` | 压缩上下文，开始新的 Codex 会话 |
| `/reset` | 完全重置（包括工作目录等设置） |
| `/undo [数量]` | 撤销最近几条对话 |
| `/send <路径>` | 把本地文件发到微信 |
| `/<prompt> [参数]` | 触发 `~/.codex/prompts/<prompt>.md` 自定义 prompt（支持 `$ARGUMENTS`、`$1`…替换） |

## 工作原理

```
成员A 微信 ─┐
成员B 微信 ─┼─→ ilink Bot API ─→ Node.js 守护进程 ─→ codex exec --json（本地，逐成员独立会话）
成员C 微信 ─┘                         （每 bot 一个轮询循环 + 独立游标）
```

守护进程为每个绑定的 bot 启动一条独立的长轮询循环，收到消息后按发送人路由到隔离的会话，spawn 本地 `codex exec`（首轮）或 `codex exec resume <thread_id>`（续接）处理，解析 `--json` 事件流，把 Codex 的 `agent_message` 实时推回微信。全程跑在你自己电脑上。

`codex` 以 `--dangerously-bypass-approvals-and-sandbox` 启动（无审批弹窗，因为微信端无法回应弹窗），工作根目录为该成员的工作目录，`--skip-git-repo-check` 允许在非 git 目录运行。

## ⚠️ 安全须知

**请务必理解：本工具让微信消息能在宿主机上以全权限执行任意命令。**

- **全权限运行**：`codex` 默认以 `--dangerously-bypass-approvals-and-sandbox` 启动，无任何确认。**能给某个 bot 发消息 ≈ 能在宿主机上执行任意命令**——读写文件、跑 shell、联网。可用 [`WCX_SANDBOX`](#沙箱配置wcx_sandbox) 把 Codex 关进沙箱来收紧权限。
- **共享机器、共享凭证**：所有成员的 Codex 都在**同一台机器、同一个系统账号**下运行。会话上下文隔离了，但**机器没有隔离**——任何成员的 Codex 都能读到这台机器上的文件、SSH key、各类 token。👉 **强烈建议把守护进程跑在一台专用的、不存放敏感凭证的机器上。**
- **凭证安全**：bot token 存在 `~/.wechat-codex-code/accounts/`（权限 `0600`）。不要把任何 bot 好友推荐给无关的人，不要外泄 accounts 目录。
- **账号封禁风险**：这是架在个人微信上的非官方桥接，多 bot、持续流量更容易触发微信风控。请留意账号状态。
- **鉴权机制**：默认只有绑定的 owner 本人能驱动各自的 bot；启动时若账号缺少绑定用户会 fail-closed 拒绝该 bot。额外授权用户需手动加入 `config.json` 的 `authorizedUsers`。

## 沙箱配置（WCX_SANDBOX）

默认 `codex` 以 `--dangerously-bypass-approvals-and-sandbox` 运行，**完全无沙箱、无审批**——这样远程编码代理才能装依赖、跑构建、联网，开箱即用。如果你更看重安全（比如把 daemon 跑在有敏感数据的机器上，或开放了 `authorizedUsers`），用 `WCX_SANDBOX` 把 Codex 关进真正的沙箱：

| 取值 | Codex 行为 |
|------|-----------|
| *（不设置，默认）* | `--dangerously-bypass-approvals-and-sandbox`：完全权限，无沙箱无审批 |
| `read-only` | 只读沙箱：可读工作区与系统，**禁止任何写入和命令副作用** |
| `workspace-write` | 可写工作区：能读系统、读写**当前工作目录**，但禁止工作区外写入与网络访问 |
| `danger-full-access` | 不限制文件系统/网络（仍走沙箱框架，效果等同关沙箱） |

设为前三者时会自动附加 `--ask-for-approval never`——微信端没有终端可交互审批，保留审批会让请求一直卡住。**设了非法值（如拼错成 `readonly`）会告警并 fail-safe 到最严格的 `read-only`**，而不是退回绕过模式——避免"以为开了沙箱、实际仍是完全权限"。不设置该变量才是默认的绕过模式。

> **推荐**：除非确实需要 Codex 自由联网 / 装包，否则设 `workspace-write` 把它限制在工作目录内（注意：此模式下 `npm install`、`git push`、访问外网等会被拦截，需要时再临时放开）。

**怎么设置**

直接前台运行：

```bash
WCX_SANDBOX=workspace-write node dist/main.js start
```

通过 daemon 托管（launchd / systemd）：daemon 会把当前 shell 里的 `WCX_SANDBOX` 写进服务配置，所以先 `export` 再启动；改了值后用 `restart` 让新值生效：

```bash
export WCX_SANDBOX=workspace-write
npm run daemon -- restart
```

## 数据目录

所有数据存储在 `~/.wechat-codex-code/`：

```
~/.wechat-codex-code/
├── accounts/       # 各 bot 的微信账号凭证（每 bot 一个 <accountId>.json，0600）
├── config.json     # 全局配置（工作目录、模型、系统提示词、授权用户等）
├── sessions/       # 会话数据（按 <accountId>__<用户> 分文件，每成员独立）
├── sync/           # 长轮询游标（每 bot 一个 <accountId>.json，互不覆盖）
└── logs/           # 运行日志（每日轮转，保留 30 天）
```

> Codex 自身的会话记录存在 `~/.codex/sessions/`（由 `codex` CLI 管理，本桥接通过 `thread_id` 续接）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `WCX_DATA_DIR` | 覆盖数据目录（默认 `~/.wechat-codex-code`） |
| `WCX_SHOW_COMMANDS=1` | 把 Codex 每条 shell 命令作为进度推到微信（默认关，避免刷屏 / 限频） |
| `WCX_STREAM_TEXT=1` | 边生成边推送部分回复（默认关：等回复完整后一次性发送，更省条数 / 不易触发限频） |
| `WCX_SANDBOX` | Codex 沙箱策略：`read-only` / `workspace-write` / `danger-full-access`（配 `--ask-for-approval never`）。**默认不设 = 绕过沙箱与审批**（完全权限，等同历史行为）。注重安全可设为 `workspace-write` 把 Codex 限制在工作区内 |
| `WCX_MIN_SEND_INTERVAL_MS` | 同一用户两条消息之间的最小间隔（默认 `10000`，即 10s，防微信限频） |
| `WCX_SEND_MAX_RETRIES` | 发送遇限频（ret:-2）时的最大重试次数（默认 `4`） |
| `WCX_SEND_INITIAL_BACKOFF_MS` | 发送重试的初始退避（默认 `15000`，每次翻倍） |
| `WCX_SEND_MAX_BACKOFF_MS` | 发送重试退避上限（默认 `120000`） |
| `WCX_LOG_FULL_BODY=1` | 调试：完整打印 ilink API 请求体 |
| `OPENAI_API_KEY` / `CODEX_HOME` | 透传给 daemon（若你用 API key 方式而非 `codex login`） |

## License

[MIT](LICENSE) · 移植自 [dizhu/wechat-claude-code](https://github.com/dizhu/wechat-claude-code)
