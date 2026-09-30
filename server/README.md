# Herness 账号与同步服务

PostgreSQL 16 + FastAPI；客户端保留 SQLite。首次部署只监听 `127.0.0.1:18788`，不向公网暴露未加密的登录接口。现有 ECS 的其他应用和 Nginx 配置不改动。

## 已实现的用户流程

- 不登录：完整本地模式，不上传数据。
- 注册：用户名（3–32 位英文字母/数字/点/下划线/连字符）、至少 10 位密码、邮箱。邮箱只登记，`email_verified_at` 保留 NULL，不发送验证码，也不提供未验证邮箱的密码找回。
- 登录：Windows 系统安全存储加密登录令牌。访客、不同用户、不同服务器的数据分开；切换账号需正常退出并重启。账号 API Key 不随云端聊天同步。
- 用户明确勾选才导入访客聊天；导入不会上传 `.env` 或本机模型密钥。新账号需要配置本机模型。
- 自动每 60 秒同步，前台对话进行中暂停上传。消息、工具记录、压缩标记、系统提示词等上下文通过版本化适配层同步，不上传整个 SQLite 文件。
- 内嵌 data-URL 附件去重上传为私有对象并校验 SHA-256。文本内容、工具结果中的本地路径只是历史文字，不自动上传这些路径所指的外部文件；外部工作区、技能目录和正在运行的工具不属于本版跨设备同步范围。
- 下载的数据先暂存；点击“应用云端更新并重启”后在后端启动前应用，避免修改运行中会话的提示词缓存。并行修改保留冲突分支；下载后又发生的本地修改也保留为分支。
- 设备列表可撤销登录。离线退出始终可用；令牌无法及时撤销时可由其他设备撤销，最长 30 天过期。

## 数据库

`herness_sync/schema.sql` 是初始迁移，`schema_migrations` 记录版本。后续结构更新必须增加显式迁移，不依赖 `CREATE TABLE IF NOT EXISTS` 更改现有列。

| 表 | 作用 |
|---|---|
| users | 用户名/邮箱唯一约束、Argon2id 密码哈希、预留邮箱验证时间 |
| devices / auth_sessions | 设备、哈希后的不透明登录令牌、过期和撤销 |
| verification_tokens | 预留验证/重置字段；当前无签发接口 |
| conversations | 当前会话元数据及上下文、固定到期时间、版本、删除标记 |
| messages | 当前完整消息序列，包含工具/压缩/显示侧字段；不保存重复历史快照 |
| attachments / conversation_attachments | 私有附件元数据和同账号引用 |
| sync_state / sync_changes | 每账号有序版本和增量日志 |
| sync_operations | 幂等操作及请求散列，断线重试不会重复执行 |
| device_sync_cursors | 设备已接收进度 |
| rate_limits | 登录/注册限流 |

会话、消息、附件关联使用含 `user_id` 的复合约束。API 始终从令牌推导用户身份。账号状态行锁将业务修改与同步版本在同一 PostgreSQL 事务中提交。客户端不持有数据库凭据。

当前协议采用会话版本比较及冲突分支，不强迫离线设备获取在线锁。HTTP 请求/会话 16 MiB、单附件 20 MiB，初始账号配额 256 MiB，可通过服务器 `ACCOUNT_QUOTA_BYTES` 调整。没有执行 100 并发用户负载测试。

## 180 天策略

采用明确的会话级策略：**从会话最初创建时起 180 天，整段会话及保存的上下文到期**。继续聊天不会延长原会话保留期，以免压缩摘要无限保留旧内容；长期使用应新建会话。服务端使用数据库时钟，读取时立即隐藏过期会话；每天清理内容、无引用附件和旧同步日志。

删除标记留存 180 天，不保留正文，防止离线设备恢复已删除记录。超过同步日志窗口的设备重新获取云端快照。客户端本地备份不因云端保留策略被递归删除；到期事件在用户应用下载时清理该本地会话的数据库正文。

数据库每日备份一次，保留 7 天。这意味着已删除数据可能在受限备份中额外留存至多 7 天。若要求绝对 180 天内抹除所有副本，需另行调整主数据与备份策略。还原备份后应先执行 cleanup，再开放服务。

## 部署

1. 安装 PostgreSQL 16 与 Python 3.11；运行 `deploy/bootstrap.sh` 创建独立数据库/服务账号，数据库只监听回环地址。
2. 依赖由 `requirements.in` 解析成带哈希的 `requirements.txt`，用 `pip install --require-hashes -r requirements.txt` 安装。不要提交 `/etc/herness-sync/server.env`。
3. 源码已按项目发布流程同步 ECS 后，在开发电脑执行 `scripts/deploy-sync-service.ps1`，部署当前已验证提交。服务代码位于 `/opt/herness-sync/releases/<commit>`，运行数据位于 `/srv/herness-sync`。
4. systemd：`herness-sync.service`、`herness-sync-cleanup.timer`、`herness-sync-backup.timer`。初始服务未通过 Nginx 对公网发布。
5. 联调：运行 `scripts/open-sync-tunnel.ps1`，客户端填写 `http://127.0.0.1:18789`。这是维护者 SSH 隧道，不是面向普通用户的公网地址。
6. 公网启用：配置自己的域名和有效 TLS 证书，再采用 `deploy/nginx.example.conf`。反代覆写来源地址；仅信任回环代理。不能将开发 HTTP 地址替换成公网 IP 的 HTTP 地址。

配置文件 `/etc/herness-sync/server.env`：

```ini
DATABASE_URL=postgresql://<service-user>:<secret>@127.0.0.1:5432/herness_sync
BLOB_DIRECTORY=/srv/herness-sync/blobs
ACCOUNT_QUOTA_BYTES=268435456
```

默认附件在私有目录中，不由 Nginx 静态暴露。改用 OSS/S3 时设置 `S3_BUCKET`、`S3_ENDPOINT`、`AWS_DEFAULT_REGION`、`AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`；桶必须私有，并配置存储加密。数据库备份也会上传 `backups/` 前缀，应配置此前缀的 7 天生命周期。现有附件迁移到对象存储需先复制校验，不可直接切换空桶。

当前没有配置 OSS，备份只在本机，不能抵御整台 ECS 丢失；公网正式使用前应配置独立备份。聊天内容服务器可读，本版不宣称端到端加密。

## 验证

`server/run_tests.py` 强制只操作 `herness_sync_test` 数据库。API 权限、幂等、冲突、附件、过期与真实两个 Hermes SQLite 数据库的恢复使用实际 PostgreSQL 和 HTTP 路径，测试不调用付费模型。

```powershell
server/.venv/Scripts/python.exe -X utf8 server/run_tests.py .local/sync-test.env
npm run test:focused
npm run test:packaged
npm exec --workspace apps/desktop -- tsx scripts/verify-accounts.ts
```

`verify-accounts.ts` 通过私有测试服务创建临时账号，在两个独立 Windows 数据目录中验证真实安装版注册、登录、上传、下载和续聊；默认端点为 SSH 隧道地址，可用 `SYNC_TEST_ENDPOINT` 覆盖。完成后删除输出的临时账号。数据库契约测试与安装版测试不是同一个数据库清空流程。

测试凭据和设备状态必须放在 `.local` 或 `verification`，不能提交。更换数据库地址时禁止指向生产库执行数据库契约测试。
