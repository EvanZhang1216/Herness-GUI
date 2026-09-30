# Herness GUI

独立维护的 Windows Hermes Agent 桌面发行版，不依赖旧 Hermes 的 Python 环境。

- 源码：https://github.com/EvanZhang1216/Herness-GUI
- 安装与更新：https://github.com/EvanZhang1216/Herness-GUI/releases
- 上游：https://github.com/NousResearch/hermes-agent
- 对话中的思考、搜索和工具执行记录集中在默认收起的“处理过程”中；点击展开，正文、交互请求与错误独立显示。
- 当前版本：0.2.4；初始源码包 2026.9.7，后端版本 0.21.1。来源记录见 upstream.json。

## 安装与离线范围

下载 Release 中的 `Herness-GUI-Setup-0.2.4-x64.exe`，双击选择安装目录。目标平台 Windows 10/11 x64，其他系统和架构尚未验证。

安装包包含 Electron 界面、Hermes 后端、便携 Python 3.11.15、锁定的核心/Web/MCP/Anthropic 依赖、Node/npm、Git/Bash、uv、ripgrep。安装机不必预装开发环境；Python 所需 VC runtime DLL 随便携发行版提供。安装时不会再下载 Hermes 或 Python。

**离线可以安装、启动界面、配置模型、查看和管理已有记录。云端模型回复、搜索、下载插件/模型和 GitHub 更新需要网络。没有内置本地大模型。**

这是未做商业 Authenticode 签名的独立构建，不是 Nous Research 官方安装包。

首次安装可在“用户数据目录”页面选择空文件夹；允许与安装目录同级且名称有相同前缀，例如 `D:\Hermes-GUI` 与 `D:\Hermes-GUI-data`，但不能选择安装目录本身或其子目录；升级安装保留现有目录。新目录中 `hermes` 保存聊天数据库、配置、密钥、记忆和技能，`desktop` 保存 Electron 本地界面设置、连接和浏览器存储。旧版本数据位置保持兼容，不自动搬动。

设置 → 关于 → **用户数据位置** 可浏览或输入新的空目录，点击“迁移并重启”。先结束任务并关闭独立网关；程序正常退出后复制全部文件，逐文件 SHA-256 校验成功才切换，原目录保留作备份。失败继续使用原目录，错误框会提示原因；目标中的不完整副本不覆盖、也不自动删除。迁移期间请勿启动其他 Hermes 实例，目录含符号链接时需先处理链接。

外部项目工作区、远程服务器数据及其他独立 Hermes 安装不在迁移范围内。`%LOCALAPPDATA%\HernessGUI-bootstrap` 只保存目录指针和迁移事务记录。自定义磁盘不可用时明确报错，不创建空白历史。显式 HERMES_HOME / HERMES_DESKTOP_USER_DATA_DIR 仍优先，但这种启动方式禁用设置迁移，需移除环境覆盖后使用。

## 统一模型配置

左侧“新建会话”下方常驻高亮的 **模型设置** 入口，一次点击打开主模型和子模型设置。页面顶部提供 **自定义 API · 地址 / 模型 / Key** 与 **API 密钥** 直达按钮，无需展开多层设置菜单。

设置 → 模型中配置主模型、子智能体模型及对应提供方的 Base URL、模型名称和 API Key。同一账号及配置档案的所有桌面会话统一使用这组设置，包括旧会话和云端恢复的记录。聊天框模型选择也修改共享主模型，不再固定某一会话的模型。菜单标明共享范围；本轮正在运行时仍可显示实际运行模型，下一轮切换。

修改后正在回复的轮次先完成，所有会话从下一轮使用新设置；仅修改端点地址或密钥也会生效。保留现有聊天历史和系统提示词，不通过重建会话切换模型。子智能体在下次创建时读取当前委派配置；已经运行的子任务继续完成。不同账号、服务器及独立配置档案仍隔离；密钥不云同步，每台电脑各自配置。CLI/TUI 保留上游会话配置行为。

## 搜索工具与打包完整性

本版本补齐对应上游源码的 `plugins/web`。可在技能与工具的 Web 配置中选择 Tavily 并保存 API Key；密钥写入当前数据空间的 `.env`。也可配置 `TAVILY_API_KEY` 和 `web.search_backend: tavily`。新增工具或修改工具启用状态后开启新会话，避免改变已有对话的工具缓存。

每次打包使用包内 Python 实际导入全部内置工具模块，检查 Web 插件声明与注册结果，并通过本地 HTTP 服务验证 Tavily 搜索及认证。缺失导入会阻止生成发布包。该检查不代表每个外部服务都已联网验证：需要账号、额外依赖或外部程序的工具仍需分别配置。

## 可选账号与多设备同步

首次启动可选“暂不登录，使用本地模式”。设置 → 账号与同步可填写同步服务器地址，用用户名、密码、邮箱注册；邮箱仅登记，预留验证字段，暂不发送验证码或提供邮箱找回密码。

登录账号使用独立数据空间，访客记录只在显式勾选导入后上传。每个账号及服务器相互隔离，完整数据目录迁移包含这些账号空间。登录令牌使用 Windows 系统凭据加密；模型 API Key 不上传，每台设备分别配置模型。

登录后自动同步聊天及内嵌附件，也可手动同步；云端下载在重启时应用，避免改变进行中的对话。两台离线设备修改同一会话时保留冲突分支。外部文件路径、项目工作区、技能和运行中的工具不随聊天同步。

**云端会话自最初创建起保留 180 天，整段会话、消息及上下文到期删除；继续聊天不延长期限。** 数据库备份保留 7 天，删除的数据可能在备份中额外留存至多 7 天。现有本地备份不会递归删除。

服务端使用 PostgreSQL 16，默认每账号 256 MiB 配额。当前 ECS 服务仅监听回环地址，维护者可通过 SSH 隧道联调。**尚无公网 HTTPS 域名，普通用户暂时不能直接联网注册；本地模式正常可用。** 域名和证书就绪后可配置公网入口，客户端已保留地址设置。部署、表结构、清理与备份见 [server/README.md](server/README.md)。

## Hermes 能力覆盖

使用真正的 Hermes 核心；“后端具备能力”“有专门图形入口”“离线零依赖”并不相同。

| 能力 | 本产品情况 | 条件 |
|---|---|---|
| 历史记录、搜索、继续会话、项目与归档 | 原生桌面入口 | 本地记录可离线查看 |
| 主模型、辅助模型、委派子智能体 | 后端完整保留及设置入口 | 云端模型需网络和凭据 |
| 技能、记忆、压缩、工具调用 | 保留后端和相关桌面入口 | 单项技能可能需要附加依赖 |
| 文件、终端、Git | 保留，并附带 Git/Bash/rg | 受操作权限与 Windows 限制 |
| MCP | 入口及 Python 依赖包含 | 具体服务另配；npm 服务包须提前下载才可离线运行 |
| 浏览器、搜索、网页读取 | 保留工具与相关入口 | 按所选后端配置网络、浏览器桥、凭据 |
| 定时任务 | 后端保留 | 桌面关闭后所属进程不会常驻；常驻网关须另行部署 |
| Telegram/Discord/Slack 等 | 适配器源码及配置入口保留 | 网络、Token、平台依赖与常驻网关 |
| 图片生成、语音、额外记忆后端 | 原有插件/设置保留 | 大模型和所有可选依赖没有全部内置 |
| Docker/SSH/云运行环境 | 原有对接能力保留 | 对应服务必须另外存在 |
| TUI、浏览器 Dashboard 前端 | 不作为本产品独立前端打包 | 本产品使用 Electron 原生聊天界面 |
| 第三方 CLI、Linux 专用插件 | 不承诺干净 Windows 上即装即用 | 需按各工具系统要求配置 |

不能声称所有 Hermes 功能在任何 Windows 电脑上都零配置、离线可用。

## 配置主模型和子模型

1. 设置 → Custom Endpoints，新建主模型端点，填写 Provider ID（如 main-api）、Base URL、模型名称和 API Key，设为默认。
2. 新建子模型端点（如 child-api），填写独立 URL、模型名、Key，保存时不要设为默认。
3. 设置 → 模型，把“子智能体提供方”设为 child-api，并填写子模型名称。留空则继承主模型。
4. 其他辅助模型用于视觉、压缩等任务，与委派子智能体不同。

建议配置变更后新建会话，以保持既有会话缓存稳定。自定义端点面向 OpenAI 兼容接口；内置服务商使用对应设置。

借鉴 QuickModel，增加常用服务商 URL 预设、误粘贴完整 /chat/completions 或 /models 地址时提取 Base URL。模型名仍自由填写，切换预设清空草稿 Key，防止跨服务商误用。没有读取 QuickModel 私人配置，也没有复制另一套 Agent 循环。

## 一键更新

设置 → 关于 → 检查更新 / 更新。只使用本仓库稳定 GitHub Release，下载完整 NSIS 包并校验清单散列，通过正常退出流程安装。失败不覆盖当前版本，不自动降级、不安装预发布版，不直接改写官方 main 源码。界面和后端作为匹配的一套一起更新。

维护者先适配并验证上游，再发布本项目新版本。同版本不提示升级。当前没有商业代码签名；HTTPS、GitHub 账号与 Actions 发布权限构成更新链信任边界。

## 源码与构建

- apps/desktop：Electron + React；apps/shared：共享协议。
- vendor/hermes：后端、技能、插件，保留上游许可与区域 AGENTS.md。
- runtime/requirements.lock.txt：从上游 uv.lock 导出的带哈希依赖。
- runtime/python、node、git、bin：打包运行时，不提交 Git。
- scripts：构建、发布、上游检查和 ECS 同步；.github/workflows：持续集成。

构建机需要 Node 22.23.1、npm、uv 0.11.29、Git for Windows、ripgrep；准备阶段联网。安装机不需要预装这些。

```powershell
npm ci
./scripts/prepare-runtime.ps1
npm run test:focused
npm run build
npm run package
npm run test:packaged
```

产物位于 apps/desktop/release。prepare-runtime 下载独立 Python 到项目缓存，按哈希锁安装依赖，不读取旧 venv；其他工具从构建机复制，实际版本写入 runtime/manifest.json，升级需审核。

打包测试运行真实 EXE，在隔离数据目录中连接本地模拟模型，验证聊天、重启恢复及续聊；移除宿主 Python/Node/Git PATH 和 Hermes 环境变量，并将外部 HTTP(S) 指向不可达代理。不调用真实 Key，不修改用户记录。这不是针对所有硬件或全新 Windows 虚拟机的兼容性认证。

Python 上游测试用 scripts/run_tests.sh，不用裸 pytest。未复制上游庞大的 tests、网站、TUI/Web 前端；上游适配时应在完整源码 checkout 中跑相应测试。

## 提交与自动上传

每次更新完成并验证后，修改必要文档，执行：

```powershell
./scripts/publish.ps1 -Message "feat: 描述用户可见变化与验证"
```

它提交修改、推送 main，再用部署密钥同步已提交源码到 ECS。每次 main push 也会触发 Actions 同步，覆盖其他维护者的提交。不是对每次编辑器保存自动生成提交。AI 后续维护约定写在根目录 AGENTS.md。

ECS：`/srv/herness-gui/current`；实际快照：`/srv/herness-gui/releases/<commit>`；提交标识：`/srv/herness-gui/REVISION`。仅用 git archive 上传已提交源码，不传用户记录、.env、私钥、node_modules 和运行时二进制。旧快照保留便于回退；服务器不运行 Windows EXE。

账号服务单独运行于 `/opt/herness-sync/current`，数据和受限备份在 `/srv/herness-sync`。服务端变更通过真实 PostgreSQL 测试后，源码同步完成再执行 `scripts/deploy-sync-service.ps1`，部署同一提交并检查健康状态。数据库凭据放在服务器 `/etc/herness-sync/server.env`，不进入源码镜像。

本地部署密钥位于用户目录 `.ssh/herness_gui_deploy`。Actions Secrets：ECS_HOST、ECS_USER、ECS_SSH_KEY、ECS_KNOWN_HOSTS。密码和私钥绝不写入仓库。

## 上游适配与发布

```powershell
npm run upstream:check
```

只报告官方最新 Release。下载明确版本到独立目录，比较更新 vendor/hermes、apps/desktop、apps/shared，保留本发行版入口与更新器。刷新 upstream.json、依赖锁与测试，不盲目覆盖后端。

更新 apps/desktop/package.json 版本及 npm lock，构建验证、提交同步后：

```powershell
./scripts/release.ps1 -Version 0.2.0
```

v* 标签触发 Windows 构建、测试及 Release 发布。EXE、blockmap、latest.yml 必须来自同一次构建。Actions 手动触发只生成产物，不发布正式版。不要覆盖已有版本标签。

## 许可

Hermes 上游 MIT 许可和作者署名保留。QuickModel 是本地提供的设计参考，本版功能独立实现。运行时许可证见 THIRD_PARTY_NOTICES.md、runtime/licenses 及各组件安装目录。
