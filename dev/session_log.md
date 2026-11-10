# 会话记录 — account-center

> 格式：每个阶段一段摘要（固定 6 段）。详见 [可复制项目指南.md](./可复制项目指南.md) §5.1。
> 红线：不写密钥 / token / 隐私。

---

## 2026-10-23 会话条目：新项目「account-center」骨架搭建（已完成）

- **目标**：按《统一账户_方案分析》落地，把「统一账户中心」从分析稿变成可开工的独立项目骨架（目录 + 规则 + 起步文档 + 工作区），暂不写业务代码。
- **已做**：① 用 `new-project-scaffold` 脚本建 `account-center`（类型 `web`）：目录骨架、5 个技能副本、可复制项目指南、两份规则、`.gitignore`；② 改写 `.trae/rules/general_rules.md` 头部（项目名 + frontmatter，正文与母本一致）、按母本「范例」派生 `project_rules.md`；③ 写 `README.md` / `usage/Running.md` / `plan/RPD_需求文档.md` / 本文件；④ 把方案分析从 `personal-site/plan/` 迁到本项目 `plan/`；⑤ 建 `account-center.code-workspace`；⑥ 预留 `cloud/functions/accountCenter/lib`、`sdk/` 目录；⑦ 登记 `_分发清单.md` 与规划库 README §10。
- **关键结论/决定**：账户中心**独立成项目**、**首期复用微信悦读 CloudBase 环境**（只用 `ac_*` 集合 + 单云函数 `accountCenter`）、页面计划走 `account.chesterlee.cn`（待确认）；身份模型定为「uid 是人，email / deviceId / openid / 6 位码 都是钥匙」；第三方 Key 与业务数据不进本项目。
- **产出物（文件/链接）**：`account-center/README.md`、`plan/RPD_需求文档.md`、`plan/统一账户_方案分析.md`、`usage/Running.md`、`.trae/rules/{general_rules,project_rules}.md`、`account-center.code-workspace`。
- **待办**：① 用户确认 3 件事（项目位置 / 域名 / 邮件通道）；② 写《统一账户规范》与《接入契约》；③ 再进入 MVP 开发（登录 + 我的账户 + 我的作品）。
- **风险/注意事项**：复用环境靠 `ac_*` + 独立云函数 + 接口契约隔离，勿改 `wre_*`；账户码等同密码需严格限流；`.trae/` 是母本副本，改规则先改母本再同步。

---

## 2026-10-23 会话条目：确定环境与域名，落地两份契约（阶段 0 完成）

- **目标**：把「骨架」推进到「可照着写代码」——先定运行环境与域名，再把身份规则和接口口径写死，避免后面接作品时返工。
- **已做**：① 核对高驰（腾讯云 CloudBase）与微信悦读（微信云开发）的现有实现，确认邮箱验证码登录在高驰已跑通；② 与用户确认：首期**新开独立 CloudBase 环境**、**先用默认域名**、**CloudBase 自带邮箱验证码**；③ 新写 `plan/统一账户规范.md`（uid / 钥匙 / 会话 / Token / 数据归属 / 安全 / 集合字段）；④ 新写 `plan/接入契约.md`（传输方式、统一响应、错误码、10 个 MVP 接口、SDK 契约、上线检查）；⑤ 回灌 `RPD_需求文档.md` 升 v0.2（技术方案、阶段 0 勾选、待确认 → 已确认）；⑥ 更新 `README.md` 状态、目录、下一步。
- **关键结论/决定**：uid 格式 `u_` + 16 位 hex；钥匙 ID `email:` / `device:` / `wx:`；Token 不透明、服务端只存 sha256、30 天有效、不用 Cookie；账户码等同密码需严格限流；注销后同邮箱再登录 = 新 uid；作品准入首期「登录即可用」。
- **产出物（文件/链接）**：`plan/统一账户规范.md`、`plan/接入契约.md`、`plan/RPD_需求文档.md`（v0.2）、`README.md`。
- **待办**：① 在 CloudBase 控制台新建独立环境 + 7 个 `ac_*` 集合 + 邮箱验证码 + HTTP 访问服务；② 写云函数 `accountCenter` 与 `lib/`，跑通邮箱登录与账户码登录落到同一 uid；③ 写 `login.html` / `account.html`；④ `sdk/ps-auth.js` 与作品接入。
- **风险/注意事项**：新环境与微信悦读分离后，读 `wre_users` 需跨环境调接口，惰性绑定放阶段 4；邮箱验证码在**新环境**是否可直接开通需在控制台实测；密钥只放环境变量。

---

## 2026-10-23 会话条目：后端核心闭环（阶段 1 后端部分完成）

- **目标**：把契约变成可运行代码，先跑通「邮箱登录 → Token → me」「账户码登录 → 同一 uid」，并覆盖 6 位码、退出、注销、限流。
- **已做**：① 写 `cloud/functions/accountCenter/app.js`（10 个 action，依赖注入 store / sendMail / pepper / now）；② 写 `lib/`：`errors` / `validate` / `token` / `rateLimit` / `store-json`；③ 写 `dev-server.js` 本地 HTTP 入口（验证码打印终端，数据落 `.data/store.json`）；④ 写 `test/account.test.js` 8 项测试并全部通过；⑤ 起本地服务用 curl 实测「发码 → 验码 → me」链路；⑥ 更新 README / Running.md / .gitignore。
- **关键结论/决定**：核心逻辑与部署平台解耦（store 只暴露 get/set/update/remove/query 等值查询），本地用 JSON 文件；邮件通过 `sendMail` 注入，本地打印、线上再接真实通道；Token 只存 sha256；限流用进程内固定窗口（多实例时需换共享存储）。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/app.js`、`lib/{errors,validate,token,rateLimit,store-json}.js`、`dev-server.js`、`test/account.test.js`。
- **待办**：① 定部署方式后接真实邮件通道 + 生产入口；② 前端三页；③ `sdk/ps-auth.js` 与作品接入。
- **风险/注意事项**：JSON 存储只适合单机个人规模，多实例/云函数环境需换数据库适配；进程内限流重启即清零；`TOKEN_PEPPER` 未设置时的开发默认值绝不能用线上。

---

## 2026-10-25 会话条目：部署定型为奶茶同台轻量服务器（生产入口 + SMTP 落地）

- **目标**：把「跑在哪」定下来——不新开 CloudBase 环境，账户中心与奶茶项目同台一台腾讯云轻量服务器；同时把生产入口、真实邮件通道和部署文档补齐。
- **已做**：① 查证 CloudBase 免费体验版能力（2025 年起不含静态网站托管、自定义域名需个人版 + 备案）并更正此前判断；② 与用户确认部署位置 = 奶茶那台轻量服务器；③ 删掉 CloudBase 入口 `index.js` 与 `lib/store-cloudbase.js`，把 `package.json` 改为单机服务版（只依赖 nodemailer）；④ 写 `server.js` 生产入口（`POST /accountCenter`、`GET /healthz`、413 限长、SIGTERM 优雅关闭、缺 `TOKEN_PEPPER`/SMTP 拒绝启动）；⑤ 写 `lib/mail-smtp.js`（nodemailer + SMTP_* 环境变量，复用迅光口径）；⑥ 测试扩到 9 项（新增 HTTP 入口 / CORS 预检）并全通过；⑦ 回灌 `RPD_需求文档.md` 升 v0.3、`README.md`、`usage/Running.md`（新增 §4 生产部署）、`统一账户规范.md`、`接入契约.md`、`统一账户_方案分析.md`（标注旧结论作废）。
- **关键结论/决定**：部署 = 轻量服务器 + systemd + Nginx/Caddy 反代 + HTTPS；存储首期单机 JSON（`DATA_FILE`，可换 SQLite）；邮件自建 SMTP；`ALLOWED_ORIGINS` 线上白名单不用 `*`；2 核 2G 足够账户中心与奶茶同台，腾讯云「升配」改套餐即可（通常关机重启几分钟），带宽与数据盘可单独加。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/server.js`、`lib/mail-smtp.js`、`package.json`、`test/account.test.js`（9 项）、`usage/Running.md` §4。
- **待办**：① 前端三页 `web/login.html` / `web/account.html` + `ac-` 样式；② 拿到服务器与 SMTP 账号后按 Running §4 部署；③ `sdk/ps-auth.js` 与作品接入；④ `.trae/rules/project_rules.md` 仍写 CloudBase，需先改母本再同步。
- **风险/注意事项**：多项目同台要约定端口与反代路径，避免互相占用；JSON 存储必须做每日备份；`TOKEN_PEPPER` 一旦上线不可更换（换了全员掉线）。

---

## 2026-10-25 会话条目：前端三页初版（阶段 1b 完成，待视觉验收）

- **目标**：让账户中心从「只有接口」变成「能在浏览器里走完整个流程」——登录 → 我的账户 → 跨设备登录 → 退出 / 注销。
- **已做**：① 写 `web/assets/ac.css`（`ac-` 前缀、手机优先、零依赖）；② 写 `web/assets/ac.js`（`AC.call` 统一请求、Token 存 `ps_token`、本机自动指向 8940 接口）；③ 写 `web/login.html`（邮箱验证码 + 60 秒冷却 / 32 位账户码 / 6 位码三选一）；④ 写 `web/account.html`（身份、登录钥匙、我的作品、生成 6 位码倒计时、退出当前 / 全部、输入「注销」二次确认）；⑤ 写 `web/index.html`（有登录态进账户页，否则进登录页）；⑥ 本地起 8940 接口 + 18830 静态页，用 curl 跑通「发码 → 验码 → me → me.products → code.start → logout」，返回结构与页面字段一致；⑦ 回灌 README / RPD / Running §2。
- **关键结论/决定**：页面只依赖同源 `/accountCenter`，本机自动改指 8940（生产同域不用改）；Token 与将来 SDK 共用 `ps_token`；账户码只接受 32 位 hex，前端过滤非法字符；作品链接只放行 `http(s)://`，名字与掩码一律用 `textContent` 渲染防注入。
- **产出物（文件/链接）**：`web/index.html`、`web/login.html`、`web/account.html`、`web/assets/ac.css`、`web/assets/ac.js`。
- **待办**：① 用户视觉验收后按反馈微调；② `sdk/ps-auth.js` 与官网/微信悦读接入；③ 服务器准备好后按 Running §4 部署。
- **风险/注意事项**：本机 8930 / 8941 已被其它项目占用，预览换端口即可（页面会自动指向 8940）；`account.html` 的 6 位码只显示在生成它的设备上，刷新即丢，需重新生成。

---

## 2026-10-26 会话条目：按参考图改版账户页 + 多登录入口 + 协议隐私页

- **目标**：参考 `inbox/` 的五张截图（世界之窗账户 / 登录 / 条款 / 隐私），把账户中心从通用蓝白卡片改成「纸张底色 + 黑色细线 + 大标题」的编辑风；同时把可用的登录方式做全、把未接入的方式摆出入口，并补齐用户协议与隐私政策。
- **已做**：① 重写 `web/assets/ac.css` 为设计系统（纸色 `#f2f0e9`、黑线、红色 eyebrow、直角卡片、登录左文右卡、响应式）；② 重做 `login.html`：微信（黑）、Google（白）+ 其他方式四宫格（短信 / 邮箱 / GitHub / Microsoft），保留可用的邮箱 / 账户码 / 6 位码流程；未接入方式点击给出「需配置什么」的说明，不做假跳转；③ 重做 `account.html`：账户状态（创建时间 / uid / 生成凭证）、登录方式（已连接 / 未连接）、我的装置（纯 CSS 封面网格，超过 5 个可展开）、跨设备 6 位码、隐私与安全（协议入口 / 退出全部 / 注销）；④ 新增 `terms.html`、`privacy.html`（含 `#security` 锚点），四页互链；⑤ 账户凭证图片改为同一套配色；⑥ 回灌 RPD v0.6、统一账户规范 v0.2、接入契约 P1 预留、README、Running。
- **关键结论/决定**：未配置的第三方登录与短信只做入口与说明，**不伪造授权跳转**；第三方登录统一落到 `oauth:<provider>:<id>`、短信落到 `phone:`，沿用「钥匙 → uid → 会话」模型；作品封面用 CSS 图形，不引入外部图片与占位图；账户页的「会员资格」改为「账户状态」，不虚构会员有效期。
- **产出物（文件/链接）**：`web/login.html`、`web/account.html`、`web/terms.html`、`web/privacy.html`、`web/index.html`、`web/assets/ac.css`。
- **待办**：① 用户视觉验收与微调；② 按需配置微信 / Google / GitHub / Microsoft / 短信，落地 `auth.oauth.*` / `auth.sms.*`；③ 我的足迹（P0）与 SDK 接入；④ 服务器就绪后部署。
- **风险/注意事项**：协议页文案须与代码实际行为一致（第三方登录尚未接入、Token 存 localStorage、IP 只存哈希）；本机预览端口 8930 被占，本次用 18930；不要为了让入口「看起来能用」而执行假登录。

---

## 2026-10-27 会话条目：我的足迹（阶段 1d 完成，待视觉验收）

- **目标**：把「行为记录」这条 P0 做完——后端能收作品上报、能查能清，账户页能看到自己的足迹；做完后作品侧才可正式上报。
- **已做**：① `app.js`：`ac_audit_logs` 扩展为统一事件表（新增 `scope` / `source` / `platform` / `productId` / `title` / `detail` / `visibleToUser`，`audit()` 按 `EVENT_META` 自动推导口径）；② 三个登录入口补 `auth.login.failed` / `auth.locked` / `auth.login.newDevice` 安全事件，`email.send` 标 `visibleToUser:false` 只留审计；③ 新增 `track`（30 分钟内同作品同标题去重）、`me.activity`（7/30/90 天 + scope 筛选 + cursor 翻页，单页上限 50）与 `me.activity.clear`（只清 `product` / `browse`）；④ `cleanup()` 清 90 天前记录，`server.js` / `dev-server.js` 启动跑一次 + 每日定时；⑤ `account.html` 新增「我的足迹」卡片（4 个筛选 / 查看全部 / 加载更多 / 清除浏览），进页自动记一条 `browse`；⑥ `ac.css` 补足迹样式；⑦ `dev-server` 默认端口 8940 → **8942**（8940 被他人项目占用），`ac.js` 本机接口端口同步 + localStorage 键改 `ps_api_base_v2`；⑧ 测试 10 → **14 项**全绿；⑨ 回灌 RPD v0.8（决策 13）、接入契约 §4.12 + 变更记录、Running。
- **关键结论/决定**：`track` 的行为类型字段定为 **`event`**（`open` / `use` / `browse`），因为 `action` 已被用来选路由，这是本轮最重要的契约变更；足迹复用 `ac_audit_logs`，不新增第 8 个集合；安全类记录本人不可删且不回 `method`；留存 90 天，启动 + 每日各清一次。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/app.js`、`server.js`、`dev-server.js`、`web/account.html`、`web/assets/ac.css`、`web/assets/ac.js`、`test/account.test.js`、`plan/RPD_需求文档.md`（v0.8）、`plan/接入契约.md`、`usage/Running.md`。
- **待办**：① 用户视觉验收「我的足迹」卡片（`http://localhost:18830/account.html`）；② 在 `ac_products` 登记首批作品（`personal-site` / `wxread`），再做官网入口接入；③ 服务器就绪后按 Running §4 部署并回填部署台账。
- **风险/注意事项**：本机接口改 8942，旧 localStorage 里的 `ps_api_base` 已弃用（键改为 `ps_api_base_v2`），如请求仍打旧端口可清一次站点数据；`track` 字段用 `event` 不是 `action`，写 SDK 时勿用错；足迹接口每次最多扫 2000 条本人记录，数据量大了要换分页查询。

---

## 2026-10-27 会话条目：SDK + 跨域 ticket 落地

- **目标**：让作品侧真正能接上账户中心——补 `sdk/ps-auth.js`，并把「不同域名怎么共享登录态」从文档预留变成可跑的「跳转登录 + 一次性票据回跳」。
- **已做**：① 后端新增 `auth.ticket.issue`（5 分钟、32 位 hex、只存哈希，校验作品登记域名 / `ALLOWED_ORIGINS`，回 `redirectUrl`）与 `auth.ticket.redeem`（一次一用，换 30 天会话，`appId` 绑定作品）；② `lib/token.js` 增加 `newTicket / hashTicket`；③ 登录页支持 `productId + returnUrl`，登录（或已登录）后自动签票跳回；④ 写 `sdk/ps-auth.js`（`init` 自动换票并抹掉 `ps_ticket`，`getUser / requireLogin / logout / track`，零依赖）；⑤ 测试扩到 16 项并全通过；⑥ 回灌接入契约（§4.15/4.16、SDK 契约、上线检查）、RPD、README、Running、方案分析、本文件。
- **关键结论/决定**：跨域不用 Cookie、不做 iframe；票据只在 URL 上停留一次，SDK 拿到即用 `history.replaceState` 抹掉；**票据域名必须可信**——已登记作品按 `ac_products.url` 同域校验，未登记作品必须命中 `ALLOWED_ORIGINS`（白名单为 `*` 时只放行 localhost），防止票据被当成开放跳转 / 账号接管；`PSAuth.track` 的行为类型字段统一用 `event`（`action` 固定为 `track`）。
- **产出物（文件/链接）**：`sdk/ps-auth.js`、`cloud/functions/accountCenter/app.js`、`lib/token.js`、`web/login.html`、`test/account.test.js`（16 项）、`plan/接入契约.md`、`plan/RPD_需求文档.md`、`usage/Running.md`、`README.md`。
- **待办**：① 在 `ac_products` 登记首批作品（如 `wxread`）与线上 `ALLOWED_ORIGINS`；② 把 SDK 接到官网 / 微信悦读 H5 / 插件，验证真实跨域回跳；③ 服务器就绪后部署并联调 HTTPS 票据回跳。
- **风险/注意事项**：`ALLOWED_ORIGINS` 线上必须写具体域名，不能用 `*`（否则跨域票据不可用）；票据走 URL query 会短暂出现在作品侧访问日志里，换票后立即抹除，票据本身 5 分钟且一次一用；`ps_token` 按域各存各的，退出只影响当前域。

---

## 2026-10-27 会话条目：官网入口接入（阶段 2 完成）

- **目标**：把 SDK 从「写好了但没人用」变成真接入——个人官网顶栏显示登录态，未登录跳账户中心登录并带票据回跳，登录后点作品卡能出现在「我的足迹」。
- **已做**：① 新增 `tools/register-product.js`（登记 / 更新 `ac_products`，支持 `DATA_FILE` 指到线上数据文件）；② 在账户中心本机数据里登记 `personal-site`（`http://localhost:5181`）；③ 把 `sdk/ps-auth.js` 复制到 personal-site 的 `web/assets/js/`；④ personal-site `site.js` 改为按需加载 SDK：未登录入口显示「登录」（`requireLogin` 跳登录页）、已登录显示「我的」（进账户页），接口不可用时保留「账户」入口；⑤ 点 `.ps-card` 作品卡时上报 `track({ event:'open', title })`，失败静默；⑥ curl 验证：登录 → `me.products` 返回 personal-site → `auth.ticket.issue` 回 `http://localhost:5181/works.html?ps_ticket=...`；⑦ 测试 16 项全绿；⑧ 回灌 README / RPD v0.9 / Running §5 / 本文件，personal-site 侧 README / RPD v0.67 / Running / session_log 同步。
- **关键结论/决定**：作品必须先在 `ac_products` 登记地址，票据才允许回到该域名（登记后要重启服务，数据在内存）；本机联调统一用 `localhost:5181`（登记地址按 origin 严格比对，`127.0.0.1` 会被拒）；SDK 用动态加载挂在 `site.js` 里，避免逐页改 20 多个 HTML；官网 `PS_ACCOUNT.prod` 仍为空串，线上继续不显示入口，等账户中心部署后再填。
- **产出物（文件/链接）**：`tools/register-product.js`、`cloud/functions/accountCenter/.data/store.json`（本机登记数据，不入库）、`plan/RPD_需求文档.md`（v0.9）、`README.md`、`usage/Running.md`；personal-site 侧：`web/assets/js/ps-auth.js`、`web/assets/js/site.js`、`README.md`、`plan/RPD_需求文档.md`（v0.67）、`usage/Running.md`。
- **待办**：① 用户按 Running 走一遍真实浏览器回跳（登录 → 回站 → 看「我的」→ 点作品 → 查足迹）；② 账户中心部署后把 personal-site 的 `PS_ACCOUNT.prod` 改回正式域名，并重新登记作品地址；③ 微信悦读 H5 / 插件接入（阶段 3）。
- **风险/注意事项**：登记地址与访问地址必须同源（`localhost` vs `127.0.0.1` 算不同）；`ps-auth.js` 在 personal-site 是副本，改 SDK 要回母本 `account-center/sdk/ps-auth.js` 再同步；`site.js` 动态加载 SDK 依赖 `document.currentScript`（脚本未被 async/defer 时有效），文章页如改成 `defer` 需复核；未登录点作品卡不会上报（无 Token），这是预期行为。

---

## 2026-10-28 会话条目：SDK 支持独立登录页地址 + math-classics 接入

- **目标**：把账户中心接到第二个作品（math-classics），并解决「作品页面、登录页、接口三者不同端口/域名」时 SDK 拼不出登录页地址的问题。
- **已做**：① `sdk/ps-auth.js` 新增 `loginUrl` 配置（`init` 可传；不传仍用 `apiBase + loginPath`），`requireLogin` 优先用它拼 `productId` / `returnUrl`；② 用 `tools/register-product.js` 登记 `math-classics`（`http://localhost:4321`）并重启 dev-server；③ 接入契约 §5 补 `loginUrl` 约定、修正 `track` 示例为 `event`；④ README 下一步第 3 条更新接入现状；⑤ 本文件与 math 侧 session_log 同步。
- **关键结论/决定**：`loginUrl` 与 `apiBase` 拆开是必须的——本机是「页面 4321 / 登录页 18830 / 接口 8942」三个不同 origin，线上虽同域也应允许分别配置；SDK 请求失败时作品侧只隐藏入口，不影响主功能。
- **产出物（文件/链接）**：`sdk/ps-auth.js`、`plan/接入契约.md`、`README.md`、`cloud/functions/accountCenter/.data/store.json`（本机数据，不入库）。
- **验证**：`node test/account.test.js` 16 项全绿；API 级走通 `accountCode.login → auth.ticket.issue（回 http://localhost:4321/?ps_ticket=…） → auth.ticket.redeem（同一 uid） → me`；票据复用 `CODE_EXPIRED`；未登记 origin 拒签；math 侧 `npm run build` 通过并含 SDK 产物。
- **待办**：① 用户在 Chrome 亲手完成一次真实登录，确认按钮从「登录」变「已登录」；② 线上登记 `https://math.chesterlee.cn` 并配 `ALLOWED_ORIGINS` 具体域名；③ 账户服务部署后复验 HTTPS 回跳。
- **风险/注意事项**：`sdk/ps-auth.js` 在 math 侧是副本，以后改 SDK 要回母本再同步；本机登记的是 `localhost:4321`，线上换域名必须重新登记（或写 `DATA_FILE` 指向线上数据）；未 `git commit`、未部署。

---

## 2026-10-28 会话条目：线上部署完成（阶段 1c 结束，`account.chesterlee.cn` 可用）

- **目标**：把账户中心真正跑在 `account.chesterlee.cn` 上——后端不再 502、邮件能发、官网入口能跨域换票，并把阶段 1c 收尾。
- **已做**：① 填 `/etc/account-center.env` 的 `SMTP_USER` / `SMTP_PASS`（QQ 邮箱 SMTP 授权码，用户生成）/ `MAIL_FROM`，`ALLOWED_ORIGINS` 扩为 `account` + 裸域 + `www`；② `rsync` 最新 `cloud/`（含我的足迹 / 90 天清理）与 `web/` 到 `/srv/chesterlee/account`，`sudo systemctl restart account-center`（服务实际以 `ubuntu` 运行、数据在 `/var/lib/account-center/store.json`）；③ 线上登记作品 `personal-site` → `https://chesterlee.cn`；④ 代码新增 `isSameSiteOrigin`（登记裸域允许 `www` 变体）+ 1 条测试；⑤ 五个页面页脚按部署台账 §2.3 挂 `© 2026 Chester · 备案号`；⑥ personal-site `PS_ACCOUNT.prod` 切正式域名并 `rsync` 上线；⑦ 回填部署台账（§二 域名表 / §2.1 部署位置 / §2.2 子域分配 / §六 变更记录）、RPD v1.0、Running §4、接入契约。
- **关键结论/决定**：`ALLOWED_ORIGINS` 必须含官网裸域与 `www`，否则浏览器 CORS 直接拦掉；票据域名校验不能只比 `origin` 全等，否则裸域登记后 `www` 用户无法登录；服务用户是 `ubuntu`（不是文档里原先写的 `www-data`），数据目录属主必须一致。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/app.js`（`isSameSiteOrigin`）、`test/account.test.js`（+1 用例）、`web/*.html`（页脚）、`usage/Running.md`（§4 改为实际配置 + 日常更新命令）、`plan/RPD_需求文档.md`（v1.0）、`plan/接入契约.md`、`/Users/Admin/Knowledge/Coding/部署上线备案/README.md`。
- **验证**：`node --test test/account.test.js` 16 项全绿；`https://account.chesterlee.cn/healthz` 200；`POST /accountCenter {"action":"me"}` 回 `UNAUTHORIZED`（服务在跑）；`auth.email.send` 200（SMTP 发信成功）；CORS 预检对 `https://chesterlee.cn` 回 204 + 正确 `access-control-allow-origin`；`health.sh account.chesterlee.cn chesterlee.cn` 双域全绿（备案号 / 版权均 ✅，证书剩 88-89 天）。
- **待办**：① 用户浏览器实测：`https://chesterlee.cn` 顶栏「登录」→ 邮箱验证码 → 回站变「我的」→ 点作品卡 → 账户页「我的足迹」出现「打开作品」；② 微信悦读 H5 / 插件接入（阶段 3）。
- **风险/注意事项**：SMTP 授权码只存在服务器 `/etc/account-center.env`（600），不入库不写日志；`TOKEN_PEPPER` 一旦设定不可更换，换了所有人登录态失效；仓库里的 `dev/session_log` 与线上代码需保持一致，后续改代码记得按 Running §4 的 rsync 命令更新；本次未 `git commit`。

---

## 2026-10-28 会话条目：线上全链路自测 + math / wxread 登记 + 微信悦读 H5 接统一账户（阶段 3 起步）

- **目标**：把「官网点登录」这条线上链路由我这边跑通（不再靠用户手测）；把剩余两个作品登记上线；开始阶段 3（微信悦读接入）。
- **已做**：① 线上自测：`auth.email.send` 发到本人 QQ 邮箱 → 用 IMAP（QQ 授权码）自动取 6 位码 → `auth.email.verify` 登录成功（新 uid）→ `me` / `me.products` 正常 → `auth.ticket.issue` 裸域与 `www` 各签一张 → `auth.ticket.redeem` 换票成功且 uid 一致 → `track` 上报后 `me.activity` 出现「个人网站 / 打开作品」；② 负向：`returnUrl` 指向外域被拒（`INVALID_PARAM`）、未带 Token 调 `me` 回 `UNAUTHORIZED`；③ 线上登记 `math-classics`（算经小课 / `https://math.chesterlee.cn`）与 `wxread`（微信悦读 / `https://reader.chesterlee.cn`），`ALLOWED_ORIGINS` 同步加这两个域名并重启服务，CORS 预检对两域均 204；④ SMTP 授权码备份到本机 `~/.config/account-center/smtp.env`（600，仓库外）；⑤ 阶段 3 起步：微信悦读 H5 侧引入 `ps-auth.js`（`h5/assets/`）、`config.js` 增 `ACCOUNT`、`index.html` 加载 SDK、`views/me.js`「我的账户」新增「统一账户」卡（未登录→登录、已登录→uid 掩码 + 退出，进入页面时上报 `track({event:'open', title:'我的账户', platform:'h5'})`），`wre_*` 与账户码逻辑一行未改。
- **关键结论/决定**：自测可以用「发到本人邮箱 + IMAP 取码」闭环，不必再让用户手点；作品登记必须同时改 `ALLOWED_ORIGINS`，否则浏览器 CORS 先拦；H5 侧卡片只重绘自身容器（`#meUnified`），避免异步回来把用户正在填的 Key 输入框刷掉；统一账户与微信悦读账户码**并存、互不替代**，旧用户数据与 Key 托管完全不受影响。
- **产出物（文件/链接）**：`plan/RPD_需求文档.md`（v1.1）、`dev/session_log.md`；微信悦读侧：`h5/assets/ps-auth.js`、`h5/src/config.js`、`h5/index.html`、`h5/src/views/me.js`。
- **验证**：线上 curl 全链路通过（见「已做」①）；`node --test test/account.test.js` 16 项仍全绿；H5 侧 `node --check`（me.js / config.js）通过，本机静态服务 `http://localhost:18841/#/me` 可加载（SDK 与页面均 200）。
- **待办**：① 微信悦读 H5 改动尚未上生产（需 `web/build.py` 重建 `dist/app/` 再发布），上线后需真实登录一次看「统一账户」卡；② 插件侧与小程序侧（openid → uid）待接；③ 用户如介意授权码曾出现在对话里，可去 QQ 邮箱重置后替换服务器 `SMTP_PASS`。
- **风险/注意事项**：授权码只在本机 `~/.config/account-center/smtp.env` 与服务器 `/etc/account-center.env`，两者都不入库；`ALLOWED_ORIGINS` 变更后必须重启服务才生效；H5 生产站有真实用户，发布前应先用本机预览确认卡片样式；本次未 `git commit`、未发布 H5。

---

## 2026-10-28 会话条目：第三方登录落地（GitHub + Gitee + Microsoft，方案 A）

- **目标**：让「第三方账号登录」从 P1 预留变成可用——用户选定 GitHub / Gitee / Microsoft 三家，并确定走**方案 A**（第三方只作登录方式 + 主动绑定，**不自动合并**同邮箱账户）。
- **已做**：① 新建 `lib/oauth.js`（三平台授权地址、token 交换、资料归一为 `{id, login, name, avatar, email, emailVerified}`，10 秒超时，错误不回传响应正文）；② `app.js` 新增 `auth.oauth.providers` / `auth.oauth.start` / `auth.oauth.exchange`，state 32 位 hex 哈希存 `ac_login_codes`（`kind=oauth_state`，10 分钟一次性），回页面只带一次性 `oauth_code`（5 分钟），Token 不进地址栏；③ `handleOAuthCallback` 处理 login / bind 两种模式，`account.bind` 写入审计，`resolveIdentity` 增加 `extras` 存 `provider`；④ `parsePageReturnUrl` 限 origin 白名单 + 只允许 `login.html` / `account.html` 并清除敏感参数，防开放跳转；⑤ `server.js` / `dev-server.js` 增加 `GET /oauth/<provider>/callback` 路由与 `oauth: configFromEnv(process.env)`；⑥ `login.html` 渲染第三方按钮并处理回跳 code / 错误，`account.html` 展示第三方钥匙 + 「添加登录方式」绑定入口；⑦ 未配 Client ID/Secret 的平台自动不出现在接口与页面（避免死按钮）；⑧ 测试 16 → **24 项**全绿（新增 7 项，全部走伪造 fetch，不联网）；⑨ 同步 `privacy.html` / `terms.html` / RPD（决策 17）/ 接入契约（§4.18 定稿、§4.19 预留）/ 统一账户规范 / README / Running（新增 §5 平台配置）。
- **关键结论/决定**：三平台协议差异集中在 `lib/oauth.js`，`app.js` 只认统一资料结构；**已验证邮箱已注册 → `oauth_error=email_exists`，不建号不合并**，绑定只能由已登录用户在账户页主动发起；一把钥匙只属一个 uid，被他人占用回 `key_taken`；GitHub 邮箱私有，额外查 `/user/emails` 取 primary+verified，拿不到不阻塞登录；**配置即开关**，没配密钥的平台连按钮都不出现。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/lib/oauth.js`（新建）、`app.js`、`server.js`、`dev-server.js`、`web/login.html`、`web/account.html`、`web/assets/ac.css`、`web/privacy.html`、`web/terms.html`、`test/account.test.js`、`plan/RPD_需求文档.md`、`plan/接入契约.md`、`plan/统一账户规范.md`、`README.md`、`usage/Running.md`。
- **验证**：`node --test test/account.test.js` → 24 项全过（含原登录 / 票据 / 足迹回归）；覆盖项：未配置不出按钮、GitHub 首登建号与二次登录同 uid、state 一次性 / 伪造 / 过期、同邮箱不合并、绑定与 `key_taken`、绑定必须登录且 `returnUrl` 拒绝外域、Gitee / Microsoft 同流程。
- **待办**：① 用户在 GitHub / Gitee / Azure 建应用，把 `Client ID/Secret` 写进 `/etc/account-center.env`（含 `OAUTH_REDIRECT_BASE`）；② Caddy 增加 `handle /oauth/* { reverse_proxy 127.0.0.1:8940 }` 并重载；③ 平台回调地址填 `https://account.chesterlee.cn/oauth/<provider>/callback`；④ 配好后线上实测三家登录与绑定（步骤见 Running §5）。
- **风险/注意事项**：`OAUTH_REDIRECT_BASE` 必须与实际回调域名完全一致，否则平台报 `redirect_uri_mismatch`；三家的 Client Secret 只进 systemd EnvironmentFile，不入库不写日志；`returnUrl` 白名单改动会放宽跳转面，新增页面时必须同步收紧；Microsoft 默认用 `common` 租户接受个人号，若只允许企业账号需改 `MICROSOFT_TENANT`；本次未 `git commit`、未部署。

---

## 2026-10-28 会话条目：第三方应用全自动创建 + 密钥上线（GitHub / Gitee 已可用）

- **目标**：不靠手点，由脚本驱动本机真实 Chrome 在 GitHub / Gitee（Azure 本轮跳过）建好 OAuth 应用，把 Client ID/Secret 写进服务器 `/etc/account-center.env`，补 `OAUTH_REDIRECT_BASE`，让线上第三方登录真正可用。
- **已做**：① 新建 `tools/oauth-setup.js`（CDP 接管本机可见 Chrome，独立 profile 保留登录态，子命令 `open/state/shot/click/type/tab/github/github-secret/gitee/gitee-read`）；② GitHub 建应用成功（App id 3972427，回调 `https://account.chesterlee.cn/oauth/github/callback`），拿到 Client ID 与 40 位 secret；③ Gitee 建应用成功（App id 58686，Logo 为必填，先本地生成 256×256 PNG 再上传），详情页密钥在 `#uid` / `#secret` 两个 input 里，改脚本直读；④ 密钥落本机 `.autoshot/oauth-*.json`（600）+ 服务器 env（600），Caddy 补 `handle /oauth/*` 并重载，服务重启；⑤ `usage/Running.md` §5 补线上状态与 Microsoft「需 Azure 订阅」前提。
- **关键结论/决定**：GitHub 密码可代填但会撞**设备验证**（邮箱码必须用户本人一次性输入），脚本改为轮询等待；Gitee 密码本缺但 profile 已登录，可全自动；**Microsoft 需 Azure 订阅**，只有个人账号时无法建应用，页面自动隐藏按钮（代码不动）；密钥只存两处，终端只打印 Client ID 与 secret 长度。
- **产出物（文件/链接）**：`tools/oauth-setup.js`（新建）、`.gitignore`（新增 `.autoshot/`）、`usage/Running.md`（§5 状态 + §5.3 前提）。
- **验证**：`/healthz` 200；`auth.oauth.providers` → `[{github,GitHub},{gitee,Gitee}]`；`auth.oauth.start`（两家）分别返回带正确 `client_id`、`redirect_uri`、`scope`、32 位 `state` 的授权地址；`/oauth/github/callback` 与 `/oauth/gitee/callback` 传伪造 state 均 302 → `login.html?oauth_error=state`；`systemctl is-active account-center` = active。
- **待办**：① 用户在登录页亲手点一次「GitHub / Gitee 登录」完成真实建号（涉及注册账号，按规则不代做）；② 想接 Microsoft 时开通 Azure 订阅后按 Running §5.3 建应用，只填 env 即可；③ 本轮未 `git commit`。
- **风险/注意事项**：`OAUTH_REDIRECT_BASE` 与平台回调必须完全一致；`.autoshot/` 含 Chrome profile 与平台密钥，已 gitignore，别打包外传；Gitee Client Secret 在详情页明文可见，若怀疑泄露可在 Gitee 重置后重跑 `gitee-read` 再推 env。

---

## 2026-10-29 会话条目：账户页登录方式总览 + 解绑

- **目标**：让用户一眼看到「哪些登录平台已绑定」，并能解绑不再使用的方式；避免只有一个绑定方式的账号被解绑后失联。
- **已做**：① 后端新增 `account.unbind`（需登录，`kind` = `email` / `device` / `oauth` + `provider`，同 uid 10 次 / 分钟），只删目标钥匙，不删 uid、不撤销会话；② 兜底规则：`keys.length <= 解绑数量` 时回 `LAST_KEY`，保证至少保留一种登录方式；③ 账户页「登录方式」改为固定列出 邮箱 / 账户码 / 已启用的第三方，右侧绿色「已连接」/ 灰色「未连接」，已绑定的前置「解绑」文字链（二次确认，只剩一种时禁用），未绑定的第三方给绿色「连接」；④ 合并原「添加登录方式」区块（删除 `#bind-list` 与 `loadBindOptions`），并处理绑定回跳 `oauth_bound` / `oauth_error` 提示后清理地址栏参数；⑤ CSS 删除 `.ac-bind*`，新增 `.ac-key-side`、绿色状态与连接文字链样式。
- **关键结论/决定**：解绑是「删钥匙」而非「销号」，因此不改 `ac_users`、不动会话；邮箱 / 账户码即使未绑定也占一行展示状态，第三方只列后端已配置的平台（沿用「配置即开关」）；只剩一种登录方式时前端禁用 + 后端 `LAST_KEY` 双保险。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/app.js`、`web/account.html`、`web/assets/ac.css`、`test/account.test.js`、`plan/RPD_需求文档.md`（决策 18）、`plan/接入契约.md`（§4.21 + §4.6 补 `provider`）、`README.md`。
- **验证**：`node --test test/account.test.js` → 26 项全过（新增「至少保留一种」「解绑第三方不影响邮箱」两项）；`account.html` 内联脚本用 `new Function` 做语法检查通过；`ac-bind` / `loadBindOptions` 残留引用已清零。
- **待办**：① 线上部署后实测一次解绑与「只剩一种时禁用」；② 若后续要支持解绑邮箱后再绑新邮箱，需要另做「验证码验证新邮箱」的绑定流程（本轮不做）。
- **风险/注意事项**：解绑邮箱会让该邮箱不再能登录（用户自选，二次确认已提示）；`LAST_KEY` 为新增错误码，作品侧若统一处理错误码需允许未知码；本轮未 `git commit`、未部署。

---

## 2026-10-29 会话条目：手机号验证码登录（阿里云短信认证）

- **目标**：在邮箱 / 账户码 / 第三方之外，增加「手机号 + 短信验证码」登录；用户先要求评估接入流程与费用，拍板后按「阿里云短信认证 + 独立建号/账户页绑定 + 图形验证码+限流」落地。
- **已做**：① 新建 `lib/sms.js`：`createAliyunSms`（`SendSmsVerifyCode` / `CheckSmsVerifyCode`，`verifyResult === 'PASS'`）、`createConsoleSms`（本地把码打印终端）、`createSmsFromEnv`（四项环境变量缺一返回 `null`）；② 新建 `lib/captcha.js`：4 位数字、5×7 点阵画成 SVG `<rect>`（无文字节点）、答案只存哈希、2 分钟一次性、错 5 次作废；③ `lib/validate.js` 增 `normalizePhone` / `isChinaPhone` / `maskPhone`；④ `app.js` 新增 `auth.methods` / `auth.captcha` / `auth.sms.send` / `auth.sms.verify`（默认登录建号，`bind: true` 绑定当前账户，冲突 `PHONE_TAKEN`），钥匙 `phone:<11 位>`；`me` 补 `phoneMasked`；`account.unbind` 支持 `kind=phone`；审计新增 `sms.send`；⑤ 登录页新增手机号面板（手机号 / 图形验证码 / 短信码 + 冷却倒计时），未配置短信时入口不出现；⑥ 账户页「登录方式」新增手机号行：已绑显示掩码 + 解绑，未绑显示「连接」并展开绑定表单（同样要过图形验证码）；⑦ 隐私政策 / 用户协议补充手机号与短信服务商说明。
- **关键结论/决定**：2025-09-18 起腾讯云 / 阿里云通用短信不再给个人认证用户签发自有签名，故走阿里云「短信认证」（系统预置签名 + 模板，个人实名可用，核验免费，0.06 元/条起）；手机号与邮箱**独立建号、账户页主动绑定，不自动合并**；防刷按「图形验证码 → 手机号 1/分、5/时、10/天 → IP 20/时、50/天」分层；未配置即隐藏，与第三方登录同一套「配置即开关」。
- **产出物（文件/链接）**：`cloud/functions/accountCenter/lib/sms.js`（新建）、`lib/captcha.js`（新建）、`lib/validate.js`、`app.js`、`server.js`、`dev-server.js`、`web/login.html`、`web/account.html`、`web/assets/ac.css`、`web/privacy.html`、`web/terms.html`、`test/account.test.js`、`plan/接入契约.md`（§4.19 定稿）、`plan/RPD_需求文档.md`、`plan/统一账户规范.md`、`README.md`、`usage/Running.md`（§4.1 + §5.6）。
- **验证**：`node --test test/account.test.js` → 34 项全过（新增：未配置拒绝、手机号首登建号与二次同 uid、绑定 / `PHONE_TAKEN` / 解绑、错码与图形码拦截、图形码哈希与 5 次作废）；`account.html` / `login.html` 内联脚本 `new Function` 语法检查通过；`lib/sms.js` 用假 AK 调通 SDK（回 `InvalidAccessKeyId.NotFound`，链路正常）。
- **待办**：① 在阿里云开通「短信认证」并拿到签名名称 / 模板 CODE，把 `ALIYUN_SMS_*` 四项写进 `/etc/account-center.env` 后重启（步骤见 Running §5.6）；② 线上验收发码、登录、绑定、解绑；③ 本轮未 `git commit`、未部署。
- **风险/注意事项**：短信按条计费，被刷是唯一实质成本风险（限流与图形码已内置，必要时再收紧）；`ALIYUN_SMS_*` 只进 systemd EnvironmentFile，不入库不写日志；图形验证码答案与短信码都不回传前端；本地调试默认走控制台短信，验证码只在终端可见。

---

## 2026-11-10 会话条目：Microsoft 登录上线（免费 Entra 租户，跳过 Azure 绑卡）

- **目标**：接通 Microsoft 账户登录/绑定——原计划走 Azure 免费账户，但银联借记卡无法通过国际在线支付 $1 预授权（"无法验证你提供的信用卡信息"），改为**免费 Microsoft Entra 租户**建应用，拿到 Client ID / Secret 后写服务器 env 并线上实测。
- **已做**：① 用本机真实 Chrome（CDP 9445）+ Playwright 脚本在 <https://entra.microsoft.com> 创建免费目录并注册应用 `account-center`（账户类型「任何 Entra ID 租户 + 个人 Microsoft 帐户」，重定向 URI `https://account.chesterlee.cn/oauth/microsoft/callback`）；② 新建客户端密码 `account-center-prod`（730 天，截止 2028-11-09）；③ 用 `.autoshot/entra-read-secret.js` 从页面 DOM 读回完整秘密值，写入本机 `~/.config/account-center/microsoft.env`（600），并 `sudo tee -a` 追加到服务器 `/etc/account-center.env`（600），重启 `account-center`；④ 线上确认 `auth.oauth.providers` 返回 github / gitee / microsoft 三家；⑤ 实测授权链路：`auth.oauth.start` 生成的 `login.microsoftonline.com/common/oauth2/v2.0/authorize` 返回 200，走完同意页后回调成功，账户页显示已绑定 `Microsoft · 17693433974@163.com`。
- **关键结论/决定**：不需要 Azure 订阅、不需要绑卡——个人 Microsoft 账号登录 Entra 管理中心即可免费建租户并注册应用，`User.Read`（Delegated）为新注册默认自带、无需管理员同意；`MICROSOFT_TENANT=common` 同时覆盖组织账号与个人 MSA；首次微软登录按「第三方登录独立建号」规则新建了 uid `u_ea3d5492106e2f97`（与邮箱账户不自动合并）。
- **产出物（文件/链接）**：`usage/Running.md`（§5 状态行 + §5.3 改写为免绑卡路径）、`.autoshot/entra-read-secret.js`（新建）、`.autoshot/entra-perms.js`（新建）、`.autoshot/entra-reg4.js`（注册应用）。
- **验证**：`curl /accountCenter {"action":"auth.oauth.providers"}` 含 microsoft；`systemctl is-active account-center` = active、`/healthz` = `{"ok":true}`；store 内 `oauth:microsoft:57d45699aa2f5dc9` → uid 绑定正确；浏览器实测登录后账户页显示 Microsoft 登录方式。
- **待办**：① 若希望微软账号与既有邮箱账户合并，需先登录既有账户在账户页点「添加登录方式」再绑；② 秘密 730 天后到期（2028-11-09），到期前轮换；③ 本轮未 `git commit`。
- **风险/注意事项**：`MICROSOFT_CLIENT_SECRET` 只存两处（本机 `~/.config/account-center/microsoft.env` 与服务器 `/etc/account-center.env`，均 600），不入库不写日志；Entra 页面关闭后秘密值不再显示，丢失只能重建；免费租户无 Azure 资源但不影响 OAuth。
