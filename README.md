# dsh-bot-sandbox

给 DeepSeek Harness 上的聊天机器人插件加一层「只能聊天、碰不到主机」的沙箱。
**装一次、重启一次，之后由配置里列出的机器人插件新建的会话全部变成 chat-only；
你自己从 Harness 开的新会话不受任何影响。**

## 一键安装（Harness 插件页，无需 shell）

1. 打开 DSH 侧栏 **插件（Plugins）** 页；
2. 在安装输入框粘贴仓库 URL：

   ```text
   https://github.com/learner202649/dsh-bot-sandbox
   ```

   也可以填 `github:learner202649/dsh-bot-sandbox`；
3. 启用 `dsh-bot-sandbox`，然后**完全退出并重启 DSH**。

本包没有 `prepare`/构建步骤，`lib/` 全部是已提交的 JS；URL 安装时 pnpm 会自动拉取 `js-yaml`。
首次挂载 `autoApply: true` 会读取 profile 的 `package.json` / `cordis.patch.yml`，把目标插件的
cwd 钉到 `<DSH_HOME>/untrusted-bots/<target>` 并切到 `bot-sandbox-chat-only`，
原文件备份为 `cordis.patch.yml.bak.<时间戳>-<随机后缀>`。日志会显示：

```text
[bot-sandbox] 已备份原 profile patch: ...
[bot-sandbox] 已固定 @tencent-connect/dsh-qqbot: cwd=...\untrusted-bots\qqbot preset=bot-sandbox-chat-only
[bot-sandbox] 已启用：受限根=...；受控=...；审计=...
```

> 插件页拒绝 Git URL 时，见下方「其他安装方式」。

## 应用边界（先读）

**它保护的是“模型在机器人会话里能调用什么工具”，不是操作系统级隔离。**

- ✅ **能挡**：受控插件新建会话的模型工具调用——读文件、写文件、执行命令、web 搜索/抓取、
  子 agent、发文件、审批确认，全部拒绝；普通 Harness 会话不受影响。
- ❌ **不能挡**：插件自身的后台代码和网络（qqbot 连 QQ、下载附件、模型 API 调用照常）；
  插件把账号消息/通知拼进 prompt 的入站数据；宿主用户/桌面应用读取会话日志；
  安装前已存在的旧会话（发 `/new` 才迁移）。
- **联网**：默认 chat-only preset 没有 `web_search` / `web_fetch`，模型不能搜索；
  但 qqbot 插件自身仍会联网（WebSocket、附件下载）。
- **账号**：默认没有账号工具，无法登录或运营抖音/B站；一旦 `allowTools` 放行账号工具，
  沙箱只保主机文件，不保账号行为；插件入站注入的账号数据也不会被过滤。
- **共享目录**：同一目标的所有 QQ peer 共用 `<target>` cwd；默认无工具时互相不可见，
  放行文件工具后可能互读。
- **不是 OS 沙箱**：真正的硬边界仍是独立 Windows 用户 / VM / 机器。

完整细节见下方「限制（务必阅读）」。

## 它做什么

1. 检测当前 profile 里已安装的目标机器人插件（默认 `@tencent-connect/dsh-qqbot`）；
2. 自动把该插件的 `cwd` 固定到 `<DSH_HOME>/untrusted-bots/<target>`（写 profile patch，**改前备份**），
   并把它切到 `bot-sandbox-chat-only` preset（没有任何工具插件）；
3. 注册 host 级 guard：凡是 `session.header.cwd` 等于某个受控插件被钉住的目录（默认 `<DSH_HOME>/untrusted-bots/<target>`）的会话，
   **所有工具调用一律拒绝、审批请求一律 rejected**，并写入审计日志；
4. 普通 Harness 会话的 cwd 是你选择的工作区，不等于任何受控目录，guard 直接放行。

## 全新 Harness 上的效果与外部前提

在全新的 `DSH_HOME` / profile 上，沙箱插件**自己完成**三件事，不需要外部脚本或手工改 YAML：

1. 把目标机器人插件的 `cwd` 钉到 `<DSH_HOME>/untrusted-bots/<target>`（写 profile patch，先备份）；
2. 把它切到 bundle 自带的 `bot-sandbox-chat-only` preset（没有任何工具插件）；
3. 注册 host 级 guard：该 cwd 下所有会话的模型工具调用全部拒绝、审批请求全部 rejected，并写审计。

机器人新建会话的实际效果：

| 能力 | 结果 |
|---|---|
| 正常聊天 / 人设 / 群聊 prompt | ✅ 保留 |
| 读/写文件、列目录 | ❌ 拒绝 |
| 执行 PowerShell / bash | ❌ 拒绝 |
| web 搜索 / 抓网页 | ❌ preset 里没有 web 工具 |
| 子 agent、`qqbot_send_file`、图像理解工具 | ❌ 拒绝 |
| 审批弹窗 | ❌ 本地 reject，不会发到 QQ |
| 普通 Harness 新会话 | ✅ 完全不受影响 |
| 被拒调用 | 写入审计 JSONL |

**安装顺序的小差别：**

- **先装机器人插件、再装沙箱**：首次启动沙箱会把已安装的默认目标（qqbot）自动播种并钉住，完全自动；
- **先装沙箱、再装机器人插件**：沙箱首次启动时状态文件已保存为空列表，之后装好的机器人插件会出现在
  左下角小窗口的「已安装组合包」里，需点一次 **「加入隔离」**；之后持久化，不需要再操作。

**外部前提（沙箱不代劳）：**

1. 目标插件必须支持 `cwd` 配置（qqbot 支持；不支持 cwd 的插件无法用本方案）；
2. 机器人插件已安装/启用，且能从其 bundle patch 解析 row id（识别不了时可在 UI 手动填）；
3. 模型凭据 / Provider 需要你自行配置（沙箱不安装模型）；
4. **访问控制是机器人插件自己的事**：qqbot 默认 `open`，任何人都能私聊/拉群；沙箱只保证他们只能聊天，
   不能替你决定“谁能用”，请用非空 allowlist 收紧；
5. 真正的硬隔离仍需独立 Windows 用户 / VM / 机器；沙箱只限制模型工具调用。

> 全新环境没有旧会话、通常也没有 `!!js` 的 profile patch，是最干净的路径：
> 装好机器人插件和沙箱后，确认列表并测试一次 `/bot-status` 即可。

## 其他安装方式

### CLI（npm 包名 / 本机路径）

```powershell
# 发布到 npm 后
npx.cmd @deepseek-ai/dsh plugin --profile desktop add dsh-bot-sandbox

# 本机路径（开发/离线）
npx.cmd @deepseek-ai/dsh plugin --profile desktop add "C:\path\to\dsh-bot-sandbox"
```

运行前请**完全退出桌面版**（托盘退出），否则 desktop profile 被锁。安装后确认
`dsh.profile.bundles` 里出现 `dsh-bot-sandbox`（插件管理器通常会代劳），再重启。

首次挂载会自动执行上面的钉 cwd / preset / 备份流程；日志里会看到
`[bot-sandbox] 已备份原 profile patch`、`已固定 ...`、`已启用 ...`。

## 持久性（默认一直防护）

- 受控列表保存在 `<DSH_HOME>/bot-sandbox.json`，**不是**内存态；重启、关闭/重新开启防护插件、重新开启被防护插件都会保留。
- 监听 `internal/plugin` 与 `plugin-manager/changed`：被防护插件被重新启用/重装后，插件会自动重新钉 cwd 并恢复 guard 范围。
- 只有两种方式会解除：用户在小窗口点「取消隔离」（二次确认），或把 `bot-sandbox` 插件本身停用（停用期间没有任何宿主代码能拦截，重新启用后恢复）。
- 新加入的插件从加入那一刻起，之后创建的所有会话都在沙箱里；旧会话需要 `/new`。

## 设置页：在 Harness 界面里添加受控插件

重启后：

1. **左下角**侧栏底部出现「沙箱」小按钮（`sidebar.footer.action`，和 dsh-security-watch 的审计入口同一位置），点开就是小弹窗；
2. 也可以打开 **设置 → 机器人沙箱**（同一个面板）；
3. 看到：

- **受控插件**：当前列表，逐个「取消隔离」；
- **已安装的组合包**：自动列出当前 profile 里声明了 `dsh.bundle.patch` 的包；点「加入隔离」即可；
  宿主会自动从该包的 bundle patch 里解析 loader row id（qqbot → `im-qqbot`），并固定 cwd；
- **手动添加**：填包名（可留空自动识别 row id），用于名字无法自动匹配的插件；
- **最近拦截**：读取审计日志的最后 30 条；
- **重新应用**：插件升级后 cwd 被重置时，一键重新钉一遍。

列表保存在 `<DSH_HOME>/bot-sandbox.json`，首次启动时从 `bot-sandbox` 的 `targets` 配置播种；
之后以界面为准，**不需要编辑任何 YAML**。改动立即写入 profile patch（先备份），
目标插件会因 HMR 重载；guard 的 scope 同步更新，新会话马上生效。

> 取消隔离会先二次确认；只把插件移出受控列表，已经写入的 cwd 会保留（避免误改它的其它配置），
> 之后该插件新建的会话恢复工具权限；
> 想恢复原 cwd 请用 `cordis.patch.yml.bak.*`。

## 怎么加新的受限插件（手动方式，备用）

也可以直接在 profile 的 `cordis.patch.yml` 里覆盖 `bot-sandbox` 行（**整段替换该行 config**）：

```yaml
- id: bot-sandbox
  config:
    autoApply: true
    targets:
      - package: '@tencent-connect/dsh-qqbot'
        rowId: im-qqbot
        dir: qqbot
        preset: bot-sandbox-chat-only
      - package: 'some-other-bot-plugin'
        rowId: 'other-bot'
        dir: otherbot
        preset: bot-sandbox-chat-only
    allowTools: []
    restrictedCwds: []
    auditLog: ''
```

要求：目标插件必须支持在它自己的 loader 行里配置 `cwd`（这是唯一的“来源令牌”）。
没有 cwd 的插件无法被 cwd 沙箱覆盖，请改用独立 profile/VM。

## 为什么需要 cwd

DSH 的会话创建 API 没有“创建者插件”字段，工具执行时能拿到的稳定字段只有
`session.header.cwd` / `agentPreset` / `origin`。所以本插件把「哪个插件创建的」编码成
「哪个 cwd」：每个受限插件一个专属目录，guard 按目录树拒绝。新会话无论来自新群、新用户、
`/new`、模型/preset 切换还是重启后的 resume，只要它是钉 cwd 之后创建的，就永久在沙箱里。

## 限制（务必阅读）

- **只对“安装并钉 cwd 之后新建”的会话生效**。安装前已经存在的机器人会话，resume 时保留旧 cwd，
  不会被拦；请在机器人里发 `/new`，或先清空它的会话再打开访问。
- 若目标插件升级/重装把 `cwd` 重置，新会话会回落到 `process.cwd()` 而脱离沙箱；升级后复查
  （`internal/plugin` / `plugin-manager/changed` 会自动重钉，但宿主大版本变化后仍应验证）。
- 若某个插件不支持 `cwd` 配置，本插件无法自动隔离它。
- **不是 OS 级沙箱**：guard 只能拦截模型发起的工具调用，挡不住插件自身在宿主进程里的代码。
  真正的硬边界仍是独立 Windows 用户 / VM / 机器。
- **不拦截插件的网络**：qqbot 自己连 QQ WebSocket、下载附件、模型 API 调用都照常；沙箱只限制
  “模型能调用的工具”，不是进程级防火墙。
- **不过滤入站数据**：平台插件把消息/通知拼进 prompt 的内容（账号私信、评论等）不属于工具调用，
  guard 不负责脱敏；如果插件会注入账号数据，它可能出现在对话里。
- **同一目标的所有 peer 共用一个 cwd**：默认 `allowTools: []` 时无人能读，互不可见；一旦放行
  文件类工具，同插件下的不同 QQ 用户就可能读到同一目录。
- `allowTools` 是显式逃生口；默认空 = 全部拒绝。放行会同时削弱审批拒绝的顺序保证（qqbot 也会
  prepend 审批通道），只应在完全信任所有 peer 时使用。
- **profile patch 里若包含 `!!js` 标签**，本插件用 js-yaml 无法解析，会拒绝自动改写并报错；
  请先移除/改写该标签，或设 `autoApply: false` 手动配置。
- 自动改写 profile 配置前会备份（`.bak.<时间戳>-<随机后缀>`），但请先读一遍 README 再装。
- 审计文件只追加、不轮转；面板只读取尾部 256KB，磁盘占用需自行清理。
- 受控列表是 **`<DSH_HOME>/bot-sandbox.json` 级别**的：同一个 DSH_HOME 下的多个 profile 会共享它。
  通常只在一个 profile 里启用本插件；多 profile 场景请自行确认。
- 宿主用户/桌面应用始终能读到这些会话与审计记录，本插件不对宿主加密或隐藏。

## 防护边界一句话

**保护“模型在机器人会话里能碰什么工具”，不保护“插件代码本身、插件的网络、入站数据、宿主用户”。**
默认配置（chat-only preset + 空 allowTools）下，机器人会话只能聊天：没有文件、命令、网络搜索、
子 agent、发文件、审批；代价是这些能力全部不可用，也不能用它运营账号。

## 常见问题

### 安装时报 `ERR_PNPM_EPERM rename ... dsh-bot-sandbox_tmp_... -> dsh-bot-sandbox`

原因：之前用 `link:` / 本机路径装过本插件，`profiles\desktop\node_modules\dsh-bot-sandbox`
是一个 junction（目录链接）。pnpm 把新包解压到临时目录后，无法用 rename 覆盖一个已存在的
junction，于是报 EPERM。

处理：

```powershell
# 1. 完全退出 DSH（托盘退出）
# 2. 只删除链接，不会动你的源码目录
cmd /c rmdir "C:\Users\lenovo\.dsh\profiles\desktop\node_modules\dsh-bot-sandbox"

# 3. 清理可能的临时目录
Get-ChildItem "C:\Users\lenovo\.dsh\profiles\desktop\node_modules" -Filter "dsh-bot-sandbox_tmp_*" -Force |
  Remove-Item -Recurse -Force

# 4. 确认真实源码还在
Test-Path "C:\Users\lenovo\Documents\deepseek-harness\default-workspace\dsh-bot-sandbox\package.json"
```

然后重新打开 DSH，从插件页安装 URL 即可。以后固定用一种安装方式（URL 或 link），不要混用。

### 面板显示 HTTP 404

说明宿主半个插件没有成功 apply。先看 `%TEMP%\bot-sandbox-boot.log`：

- 没有 `apply ...` 行 → 插件没有加载（检查 bundle 是否启用、重启）；
- 有 `abort: root unresolved` → 解析不到 profile，检查 `DSH_PROFILE_DIR` / `DSH_HOME`；
- 有 `apply ...` 但路由仍 404 → 看 DSH 控制台里 `[bot-sandbox]` 的报错。

### 报 `working-directory: directory does not exist`

`0.3.4` 之前不会自动创建 `<DSH_HOME>/untrusted-bots/<target>`。升级到最新版，或手动执行：

```powershell
New-Item -ItemType Directory -Force "C:\Users\lenovo\.dsh\untrusted-bots\qqbot" | Out-Null
```

### 旧 QQ 会话不受限制

沙箱只对「钉 cwd 之后创建」的会话生效；在对应 QQ 聊天里发 `/new` 后重试。

## 撤销

1. 把 backups 里的 `cordis.patch.yml.bak.*` 恢复，或手动删掉目标行里的 `cwd`/`preset`；
2. 从 `dsh.profile.bundles` 移除 `dsh-bot-sandbox`（或设 `autoApply: false`）；
3. 重启 DSH。

## 审计

默认写入 `<DSH_HOME>/security-watch/bot-sandbox.jsonl`，每行一条 JSON：

```json
{"ts":"2026-10-22T03:00:00.000Z","event":"tool-denied","tool":"read","cwd":"C:\\Users\\alice\\.dsh\\untrusted-bots\\qqbot"}
```

## 发布前检查

- `package.json` 的 `name` 在 npm 上是否可用（GitHub URL 安装则不依赖 npm）；
- 把 `repository` / `homepage` 改成你的仓库地址（可选，但便于溯源）；
- 不要提交 `node_modules/`（`.gitignore` 已排除），仓库根目录必须有 `package.json` 和 `cordis.patch.yml`；
- 运行 `npm pack --dry-run`，确认包含 `lib/index.js`、`lib/client.js`、`cordis.patch.yml`、README、LICENSE；
- 第一次发布后在干净 profile 里按“URL 安装”流程走一遍，再按本 README 的验收清单测试。

## 开发与测试

```powershell
node test/policy.test.mjs
node test/patch.test.mjs
node test/detect.test.mjs
node test/state.test.mjs
node test/bundles.test.mjs
node test/apply.test.mjs   # 需要先安装依赖：npm i
node test/routes.test.mjs  # 同上
node test/profile.test.mjs # 同上：验证宿主无 DSH_HOME 时能从 ctx.baseUrl 找回 profile
node test/client.test.mjs
```

（在 DSH 沙箱里 `node --test` 可能因 `spawn EPERM` 失败；直接执行测试文件是同样的断言，不经过 spawn。）

## 发布

- npm 包名 `dsh-bot-sandbox`，MIT；`dsh.bundle.patch` 指向 `cordis.patch.yml`；
- 依赖仅 `js-yaml`，不执行子进程、不联网、不读取任何凭据；
- 建议发布前跑一遍 `npm pack --dry-run` 检查 `files` 白名单。
