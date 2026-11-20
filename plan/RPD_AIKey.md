# RPD 需求文档 · AI 调用错误提示优化

> **归档说明**：2026-11-10 组件已并入 `account-center/web/assets/ai-key/v1/`，独立项目 `AI Key 集成/` 已删除。本文中的 `component/`、`proxy/`、`publish.sh` 等路径仅作历史记录，当前实现以 `web/assets/ai-key/v1/ai-client.js` 为准。

- 版本：v0.2
- 日期：2026-11-04
- 范围：`ai-client.js`（组件层统一错误）
- 状态：需求已确认并实现（2026-11-04）；**CDN 发布与已接入站回归待做**

---

## 1 项目概述

### 定位

`AI Key 集成` 是各作品共用的代码资产：一张厂商注册表 + 一个填写面板 + 一层存储适配 + 统一调用客户端 `AIKeyClient`。本需求只解决**「AI 调用失败时用户看到什么」**，不改调用链路、不改 Key 存储、不改业务功能。

### 目标用户

| 角色 | 关心什么 |
|---|---|
| 最终用户（各站访客） | 失败时看懂「为什么失败、我下一步该做什么」，而不是看到 `HTTP 401`、JSON 或英文报错 |
| 接入方（各站前端/云函数） | 不改代码或只改一行，就能拿到统一、可展示的错误信息 |

### 当前状态（已核对的代码事实）

| 位置 | 现状 | 问题 |
|---|---|---|
| [ai-client.js](file:///Users/Admin/Knowledge/Coding/AI%20Key%20集成/component/ai-client.js#L40-L44) | 网络异常统一成 `网络请求失败：<原始 message>`；超时统一成「请求超时」 | 断网、DNS、跨域、证书、服务端 500 全混在一起；`fetch` 成功但返回非 JSON 时也会被当成「网络请求失败」 |
| [ai-client.js](file:///Users/Admin/Knowledge/Coding/AI%20Key%20集成/component/ai-client.js#L79-L87) | 上游 `{ ok:false, code, error }` 原样透传 | 用户直接看到 `上游返回 HTTP 401`、`模型服务返回错误：...`、`Account service...`；无下一步建议 |
| [ai-client.js](file:///Users/Admin/Knowledge/Coding/AI%20Key%20集成/component/ai-client.js#L77) | `call('aiChat', payload)` 抛错时**没有 catch** | 走账户中心（方式 C）时异常直接冒到业务页，可能变成未捕获 Promise、控制台红字、页面无提示 |
| [ai-proxy.js](file:///Users/Admin/Knowledge/Coding/AI%20Key%20集成/proxy/ai-proxy.js#L340) | 失败返回 `{ ok:false, code:'upstream_failed', error:'上游返回 HTTP 401' }` | 只有粗颗粒 code，具体原因在中文长句里，客户端要靠文本猜 |
| [account-center app.js](file:///Users/Admin/Knowledge/Coding/account-center/cloud/functions/accountCenter/app.js#L1503-L1516) | 抛 `AppError`：`AI_NO_KEY` / `KEY_UNREADABLE` / `AI_UPSTREAM` / `RATE_LIMITED` / `UNAUTHORIZED` 等 | 通过 `PSAuth.aiKeyCall` 变成带 `code` 的 `Error`（`status` 不保留），客户端目前未识别 |

### 本次假设（如不符请指出）

- **假设 A**：业务页面的改造意愿很低，最好「不改代码就能变好」——因此优化必须发生在 `AIKeyClient` 内部，且保留原有 `{ ok:false, error }` 字段。
- **假设 B**：不要求接入方传厂商计费页 URL；「去充值」类建议只给文案，不强制跳转。
- **假设 C**：错误文案以简体中文、口语化、单句 ≤ 40 字为准；不出现状态码、英文术语、Key 片段。
- **假设 D**：`ai-proxy`、`account-center`、各业务站的错误结构**本次不动**（它们作为上游来源被识别即可）；改动它们另立需求。

---

## 2 核心功能需求（总览）

| 模块 | 描述 | 优先级 |
|---|---|---|
| 统一错误结构 | 失败统一返回 `{ ok:false, code, title, error, hint, retryable, action }`，旧字段全部保留 | P0 |
| 错误归一化 | 把 `{ok:false}`、带 `code` 的 `Error`、`fetch` 异常、超时统一映射成人话 | P0 |
| 缺 Key / 未登录 | `AI_NO_KEY` / `UNAUTHORIZED` → 提示去设置或重新登录 | P0 |
| Key 无效 / 无权限 | 401 / 403 / `KEY_UNREADABLE` → 提示重填 Key 或确认权限 | P0 |
| 额度不足 / 订阅过期 | 402 / 余额、额度、欠费类文本 → 提示充值；订阅、续费类文本 → 提示续费 | P0 |
| 限流 | 429 / `RATE_LIMITED` → 提示稍后再试，可重试 | P0 |
| 模型 / 地址错误 | 404 / 模型不存在、非法模型 → 提示检查模型名或走「测试连接」 | P0 |
| 内容过长 / 被拦截 | 413 / 上下文超长 / 审核拦截 → 提示精简或换说法 | P0 |
| 上游异常 / 超时 / 断网 | 5xx、非 JSON、`AbortError`、`Failed to fetch` → 提示服务不可用并可重试 | P0 |
| 敏感信息清洗 | 去掉 `Bearer xxx`、`sk-xxx`、URL、超长文本，禁止回显 Key | P0 |
| `call` 通道兜底 | `PSAuth.aiKeyCall` 抛错时也归一，不再裸冒异常 | P0 |
| 展示辅助 | `AIKeyClient.explain()` 纯映射 + `renderError()` 统一错误卡片（组件自带） | P0 |
| 面板文案复用 | `key-panel` 保存 / 测试失败复用同一份文案表 | P0 |

---

## 3 详细功能需求

### 3.1 统一返回结构（P0）

**需求**：`chat()` 失败时一律返回同一形状，不改成功分支。

```js
{
  ok: false,
  code: 'invalid_key',        // 稳定的机器码，见 3.2
  title: 'API Key 无效',       // 短标题（≤12 字），可用于加粗
  error: 'API Key 无效或已失效，请重新填写。',  // 一句话人话（旧字段，保留）
  hint: '重新粘贴 Key（注意前后别带空格），或到厂商控制台确认 Key 未被删除。',
  retryable: false,           // 调用方据此决定要不要给「重试」按钮
  action: 'open_settings',    // 可选：open_settings / login / retry / none
  cause: undefined            // 仅开发态（AIKeyClient.debug = true）保留脱敏后的原始信息
}
```

**交互**：业务页面维持现有写法 `if (!r.ok) 提示 r.error` 也能变好；想给「重试」按钮就多读 `r.retryable`。

**参数**：`AIKeyClient.debug`（布尔，默认 `false`）——开启后 `cause` 带脱敏原文，便于排查；生产默认不带。

**边界**：
- 旧字段 `ok` / `code` / `error` 语义不变，只**新增** `title` / `hint` / `retryable` / `action`。
- 不返回 `messages`、不返回 Key、不返回 prompt 正文。
- 同一次失败只返回一个对象，不抛异常（`chat()` 永不 reject）。

### 3.2 错误映射表（P0）

匹配顺序：**精确 code → HTTP status（能拿到时）→ message 关键字（短语白名单）→ 兜底**。关键字大小写不敏感，按短语匹配（避免 `monkey` 命中 `key`）。

| code | 触发条件（来源） | title | error | hint | retryable | action |
|---|---|---|---|---|---|---|
| `no_key` | `AI_NO_KEY`、`ai_nokey`、`还没有保存 AI Key` | 还没配置 Key | 还没有配置 AI Key。 | 到设置页选平台、粘贴 Key 保存后回来重试。 | false | `open_settings` |
| `login_required` | `UNAUTHORIZED`、`ACCOUNT_DELETED`、401 + 登录/Token 语境 | 登录已失效 | 登录状态已失效，需要重新登录。 | 重新登录后再试；Key 不会被清除。 | false | `login` |
| `invalid_key` | 401/403、`KEY_UNREADABLE`、`invalid api key`、`incorrect api key`、`authentication` | API Key 无效 | API Key 无效或已失效，请重新填写。 | 重新粘贴 Key（前后别带空格），或到厂商控制台确认 Key 未删除。 | false | `open_settings` |
| `forbidden` | 403 且非 Key 语境、`permission denied`、`not authorized` | 没有权限 | 当前账号没有调用该模型的权限。 | 确认账号已开通该模型；不确定就换一个平台试。 | false | `none` |
| `quota_insufficient` | 402、`insufficient_quota`、`balance`、`欠费`、`余额`、`额度` | 额度不足 | 这个 Key 的额度已用完。 | 到厂商控制台充值，或换一个可用的 Key。 | false | `none` |
| `subscription_expired` | `subscription`、`plan_expired`、`trial_expired`、订阅、续费、会员过期 | 订阅已过期 | 这个 Key 的订阅已过期。 | 到厂商控制台续费，或换一个可用的 Key。 | false | `none` |
| `rate_limit` | 429、`RATE_LIMITED`、`too many requests`、`rate limit` | 请求太频繁 | 请求太频繁，稍等一下再试。 | 等 30–60 秒再点；连续触发可换时段。 | true | `retry` |
| `bad_model` | 404、`model not found`、`model_not_found`、`invalid model`、`模型不存在`、`模型名` | 模型不可用 | 模型名或服务地址不正确。 | 点「测试连接」确认；或换回该平台默认模型。 | false | `open_settings` |
| `too_long` | 413、`context length`、`maximum context`、`too long`、`内容过长` | 内容太长 | 这次内容太长了，模型装不下。 | 精简后再试，或减少引用/历史对话。 | true | `retry` |
| `blocked` | `content_filter`、`safety`、`审核`、`风险内容` | 内容被拦截 | 这段内容被模型服务拦截了。 | 换个说法，或删掉可能敏感的表述后重试。 | true | `retry` |
| `upstream` | 5xx、`AI_UPSTREAM`、`upstream_failed`、非 JSON 响应、`连接模型服务失败` | 服务暂时不可用 | AI 服务暂时不可用，请稍后重试。 | 稍后重试；连续失败请点「测试连接」检查 Key 与地址。 | true | `retry` |
| `timeout` | `AbortError`、`模型响应超时`、`上游超时`、`请求超时` | 响应超时 | 等了太久没有回应。 | 稍后重试；长文可先缩短再试。 | true | `retry` |
| `network` | `NETWORK`、`Failed to fetch`、`NetworkError`、`连不上` | 网络连接失败 | 网络连接失败，请检查网络后重试。 | 检查网络/代理；若是跨域问题，确认已走自己的服务端转发。 | true | `retry` |
| `param` | 空 messages、`INVALID_PARAM`、`缺少对话内容` | 请求不完整 | 这次请求缺少内容，没法发送。 | 重新输入后再试。 | false | `none` |
| `empty` | 上游返回空、没有 `text`、空响应体 | 没有返回内容 | AI 服务没有返回内容，请重试。 | 稍后重试；若持续出现，点「测试连接」确认配置。 | true | `retry` |
| `unknown` | 其余全部 | 生成失败 | 生成失败，请稍后重试。 | 若持续失败，到设置页点「测试连接」确认配置。 | true | `retry` |

**边界**：
- 同一错误同时命中多行时，按表中**从上到下第一行**返回（`login_required` 优先于 `invalid_key`，避免把登录失效说成 Key 坏了）。
- 上游原文只作为识别依据，**不直接展示**；清洗后仅在 `debug` 模式的 `cause` 中出现。
- `retryable=true` 不等于自动重试；组件不擅自重发请求（避免重复扣费）。

### 3.3 `call` 通道兜底（P0）

**需求**：`AIKeyClient.create({ call })` 模式下，`call` 抛错（`PSAuth.aiKeyCall` 失败会 reject 带 `code` 的 `Error`）时，捕获并归一，不再让异常冒到业务页。

**交互**：业务页拿到与 HTTP 通道完全一致的失败对象。

**边界**：
- 只识别 `err.code` / `err.message` / `err.status`（若有），不依赖堆栈。
- `call` 返回 `{ ok:true, ... }` 时行为不变；返回 `null` 仍走「服务没有返回内容」。
- 捕获范围只包住 `call('aiChat', payload)`，不吞业务侧代码异常。

### 3.4 非 JSON / HTTP 状态识别（P0）

**需求**：`post()` 先看 HTTP 状态再解析 JSON；解析失败不判成「网络错误」。

**交互**：502/504 归 `upstream`，401 归 `invalid_key`，404 归 `bad_model`，429 归 `rate_limit`，402 归 `quota`。

**边界**：
- 响应体为空 → `upstream`，不报 `Unexpected token`。
- 二进制/HTML 错误页 → 不解析内容，按状态码归类。
- 状态码与 code 冲突时，**code 优先**。

### 3.5 敏感信息清洗（P0）

**需求**：任何进入 `error` / `hint` / `cause` 的文本都要过清洗：删除 `Bearer xxx`、`sk-` 开头的长串、URL 与 query、换行压缩，并截断到 160 字。

**边界**：清洗只作用于错误展示；不改变日志策略（日志本来就不许写 Key 与正文）。

### 3.6 `explain()` / `renderError()`（P0）

**需求**：
- `AIKeyClient.explain(input)`：传入旧的 `{ ok:false, error }`、`Error` 或字符串，返回 3.1 的统一结构——给还没升级调用方式的页面用。
- `AIKeyClient.renderError(el, result, { onRetry })`：渲染「标题 + 说明 + 建议 + 重试按钮」的小卡片；不传 `el` 时返回 HTML 字符串。

**交互**：错误就地显示，不弹 `alert`；重试点击后清空错误、按钮进入 loading。

**边界**：
- 零依赖、无框架；样式只加类名（`aik-err` / `aik-err__title` / `aik-err__hint` / `aik-err__retry`），颜色走现有 CSS 变量；项目没引 `key-panel.css` 时降级为纯文本，保证可读。
- 不传 `onRetry` 就不渲染按钮。
- 不改动业务页现有布局。

### 3.7 面板文案复用（P0）

**需求**：`key-panel.js` 的「保存 / 测试连接」失败时，复用 3.2 的文案表（仅文案，不改交互与流程）。

**边界**：面板只展示，不自动重试；测试失败时保留用户已填内容，不清空输入框。

---

## 4 UI·UX 需求

**错误卡三层信息**（缺一不可）：

1. 结论：一句话说清发生了什么（≤20 字，如「API Key 无效」）。
2. 说明：一句人话解释（≤40 字）。
3. 下一步：可执行动作（「重新粘贴 Key」/「稍后重试」/「去设置页」）。

**展示规则**：

- 就地展示在功能模块下方或结果区，**不弹窗、不用 `alert`**。
- 同一次请求只显示一条错误；重试时先清旧错误，不堆叠。
- 失败不清空用户已生成的内容。
- 请求中：按钮 loading + 禁用；失败后恢复按钮可用并显示错误。
- `retryable=true` 才出现「重试」按钮；最多一键重试，用户点一次发一次。

**文案规范**：

- 简体中文口语，不用「错误码」「status」「token」「CORS」这类词。
- 不指责用户（不写「你填错了」），改为「请重新填写」。
- 不显示 Key 的任何片段（连掩码都不回显）。
- 不出现厂商原始英文报错。

**视觉**：

- 错误文字用现有 `--aik-accent` 之外的告警色（若项目有 `--aik-danger` 用之，否则 `#c0392b`）；不做整块红底。
- 标题加粗一行，说明与建议同字号、次要色；行高与面板一致。
- 无障碍：容器 `role="status"`、`aria-live="polite"`（沿用面板 `aik-msg` 的做法）。

---

## 5 技术实现方案

### 技术栈

原生 ES5 写法（与现有 `ai-client.js` 一致）、`Promise`、零依赖、零构建；随 CDN `v1` 发布，浏览器缓存策略不变。

### 文件结构（仅动这些）

```text
AI Key 集成/
├── component/
│   ├── ai-client.js        # 已改：MAP + normalize + explain + renderError
│   ├── key-panel.js        # 已改：保存 / 测试失败复用同一文案
│   └── key-panel.css       # 已改：.aik-err 错误卡样式 + --aik-danger
├── demo.html               # 已加：错误提示演示（6 种场景）
├── README.md               # 已改：§三·补 错误码与文案表 + 接入示例
└── plan/
    └── RPD_需求文档.md      # 本文档
```

不改：`key-store.js`、`providers.js`、`proxy/ai-proxy.js`、`account-center`、各业务站。

### 关键点

1. **单一映射源**：`MAP` 只写一份，`normalize`、`explain`、面板复用都读它，禁止各站自写文案。
2. **输入归一**：支持四种输入——`{ ok:false, code, error }`、`Error`（含 `code` / `status`）、字符串、`fetch` 异常（`name=AbortError` / `TypeError`）。
3. **HTTP 状态先于 JSON**：`post()` 改为 `r.text()` → 尝试 `JSON.parse` → 统一交给 `normalize`，避免非 JSON 被误判为网络失败。
4. **`call` 包一层 catch**：只包 `call('aiChat', payload)`，成功路径零改动。
5. **默认行为不变**：成功返回、`ok`/`error` 字段、`endpoint`/`owner` 属性都不变。
6. **发布与生效**：`bash publish.sh --deploy` 后，CDN 引用的站自动生效；本地副本站点重跑 `install.sh`。
7. **版本策略**：仍是 `v1`（只加字段，`mount` 签名与 `AIKeyStore` 方法名不变），不做 `v2`。
8. **调试开关**：`AIKeyClient.debug = true` 时才带脱敏 `cause`；默认关闭，避免把上游原文带到页面。

---

## 6 分阶段规划

### 阶段 1 · 归一化核心（P0）— 已完成

- [x] `ai-client.js` 建立 `ERROR_MAP`（覆盖 3.2 全部 16 类）
- [x] 实现 `normalize(input)`：code → status → 关键字 → 兜底
- [x] `post()` 改为先判 HTTP 状态、再安全解析 JSON
- [x] 网络 / 超时两条路径接入归一化
- [x] `call('aiChat')` 加 catch 并归一
- [x] 敏感信息清洗 + 160 字截断（含 `Bearer`、`sk-`、URL）
- [x] 保留旧字段，`chat()` 永不 reject
- [x] 自测：16 类映射 + 6 种 HTTP / 网络路径全部通过（Node 本地跑通）

### 阶段 2 · 展示辅助（P0）— 已完成

- [x] `AIKeyClient.explain(input)` 公开
- [x] `AIKeyClient.renderError(el, r, { onRetry })`（无 `el` 返回字符串）
- [x] `.aik-err` 错误卡样式（就地显示，不弹窗）
- [x] `key-panel.js` 保存 / 测试失败文案复用映射表

### 阶段 3 · 文档与发布（P0 收尾）

- [x] README 增「错误码与文案表」+「接入示例（含重试按钮）」
- [x] `bash publish.sh --deploy`（2026-11-04 已上线 v1，线上文件校验通过）
- [ ] 已接入站回归：`account-center`、`coros-run`、`微信读书插件`（各跑一次正常对话 + 一次故意错 Key）
- [x] `demo.html` 加「模拟报错」入口（6 种场景，已浏览器验证）

---

## 7 成功标准

1. 用 6 种真实错误复现（Key 无效 401、额度不足 402、限流 429、模型不存在 404、断网、超时），页面**都**显示「结论 + 说明 + 下一步」，不出现原始 JSON、URL、英文报错、Key 片段。
2. 现有接入方**零改动**：只展示 `r.error` 的页面，文案已经变成人话；想加「重试」按钮的，只多读 `r.retryable`。
3. 走账户中心 `call` 通道时，失败不再出现未捕获 Promise 或控制台红字。
4. 任何失败路径下，控制台、DOM、错误对象里都没有明文 Key。
5. 正常路径回归通过：对话成功、测试连接成功、保存 / 清除 Key、显示明文，行为与现在一致。
6. CDN `--deploy` 后，3 个已接入站抽查通过。

---

## 8 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 各厂商错误文案不统一，关键字误判 | 提示张冠李戴（把额度不足说成 Key 无效） | 严格「code → status → 短语白名单」顺序；未知一律走 `unknown` 兜底；不猜 |
| 三套错误结构（proxy / account-center / 宿主 `call`）字段不同 | 部分错误识别不到 | 先覆盖已知 code（`ai_nokey` / `upstream_failed` / `AI_NO_KEY` / `KEY_UNREADABLE` / `AI_UPSTREAM` / `RATE_LIMITED` / `UNAUTHORIZED`）；README 写清契约 |
| 组件改动影响所有接入站 | 兼容性风险 | 只加字段、不改语义；保留 `error`；发布前跑 6 类错误 + 正常路径回归；出问题 revert 后重发 CDN |
| 上游把 Key 或完整 URL 写进错误信息 | 泄露风险 | 统一清洗 `Bearer` / `sk-` / URL；不展示 `cause`（除非 `debug`） |
| 各业务站继续自写错误文案 | 长期漂移，又变回不一致 | README 明确「错误文案只在 `ai-client.js` 维护」；面板复用同一张表 |
| 长错误文本撑破布局 | 页面错乱 | 文案固定 ≤40 字；`cause` 只进控制台；卡片支持换行 |
| 把「可重试」当自动重试 | 重复扣费 | 组件永不自动重发；`retryable` 只控制按钮是否出现 |

---

## 确认结果（2026-11-04）

1. 错误粒度：**要细分**「额度不足」与「订阅过期」→ 已拆成 `quota_insufficient` / `subscription_expired`，共 16 类。
2. 错误卡片：**组件自带**（`renderError` + `.aik-err` 样式）→ 已从 P1 提升为 P0 并实现。
3. 面板文案：**本轮复用** → `key-panel` 保存 / 测试失败已改为读同一份映射表。
