# 会话交接 · 全站统一运营后台（account-center/admin）

> 生成日期：2026-11-16 ｜ 用途：整段复制到新会话，直接接着做
> 新会话工作区：用 `account-center/account-center.code-workspace` 打开（**不要**用父目录 Coding 当根，规则不会继承）

---

## 1. 版本 / 优先级

- **当前版本**：未立项开发，可行性分析与三项实测已完成。
- **本次重点**：在 `account-center` 内新增 `/admin/` 运营后台（方案 A）。
- **v1 优先级**：**用户管理 → 作品权益 → 总览**；备案台账、打赏台账、监控卡片随后逐个加。
- **明确不做**：自建用户体系、Web 一键部署、站内在线收款、复杂 RBAC。

---

## 2. 本会话已完成

1. 产出可行性分析：`Idea/可行性分析_统一运营后台.md`（含架构、数据模型、接口、权限、统计、合规、版本切分、验证清单）。
2. 实测账户库：`store.json` **609 KB**；用户 37 / 身份 43 / 会话 144 / 登录码 156 / 作品 7 / **权益 0** / 审计 325 / **AI Key 0** → **继续用 JSON，不迁 SQLite**。
3. 实测 Caddy：`/var/log/caddy` 为空、Caddyfile 无 `log` 指令、journal 无访问日志、未装 GoAccess → **访问日志未开启，GoAccess 路线不成立**。
4. **重要发现**：服务器已有自建匿名统计 `personal-stats.service`（`/srv/chesterlee/stats/index.js`，`127.0.0.1:8950`，`chesterlee.cn/stats/*`）；接口 `POST /stats/hit`、`GET /stats/summary`、`GET /stats/healthz`；数据 11 KB / 13 天 / 累计 259 / 今日 PV 51·UV 14；维度含 PV、UV、来源、设备、路径；保留 400 天；隐私口径已合规。
5. 结论修正：统计层**扩展 `personal-stats` 到多站点**，不新建 Caddy 日志链路。
6. 发现巡检缺口：`map.chesterlee.cn`、`persona.chesterlee.cn`、`band` 未进 `health.sh` / `monitor.sh`。
7. 用户已拍板：**沿用 account-center，不新建独立项目**。

---

## 3. 下一步（谁做 / 要不要确认）

| # | 事项 | 谁做 | 需确认 |
|---|---|---|---|
| 1 | 读本交接 + 可行性分析 §5 / §8 / §11 + `account-center/plan/接入契约.md` §4.19.5 | AI | 否 |
| 2 | 把 v1 范围写进 `account-center/plan/RPD_需求文档.md`（新增「运营后台」章节），不改旧内容 | AI | **是**（先给范围清单） |
| 3 | 定「哪些作品需要限权（`grant`）」：0 个则权益模块降级为只读展示 | 用户 | **是** |
| 4 | 定「第一个试点作品」：必须是会读 `me.products` 并拦截的作品，纯静态站试点无意义 | 用户 + AI 抽查 | **是** |
| 5 | 实现 `ac_admin_members` + 三角色 + `admin.me` / `admin.users.list` / `admin.user.detail` | AI | 否（范围已定后） |
| 6 | 实现用户禁用 / 强制下线 / 备注 + 审计 | AI | 否 |
| 7 | 实现作品准入 `accessMode` + 单用户授权 / 撤销 | AI | 否 |
| 8 | 实现总览（新增 / 活跃 / 登录成功率 / 作品用量 / 最近审计） | AI | 否 |
| 9 | 扩展 `personal-stats`：放行自有域 CORS、payload 加 `site`、按站点分桶 | AI | 否 |
| 10 | 加备案 / 打赏 / 监控卡片 / 发布台账（同批轻量项） | AI | 否 |
| 11 | 收费合规咨询（个人主体能否站内收费） | 用户 | 否（v1 不阻塞） |
| 12 | 补 `map` / `persona` / `band` 进巡检 | 用户或 AI | 否（独立小修） |

---

## 4. 关键文件路径

| 文件 | 路径 |
|---|---|
| 可行性分析（唯一方案源） | `Idea/可行性分析_统一运营后台.md` |
| 账户中心 RPD | `account-center/plan/RPD_需求文档.md` |
| 账户接口契约（§4.19.5 已预留 admin） | `account-center/plan/接入契约.md` |
| 统一账户规范 | `account-center/plan/统一账户规范.md` |
| 账户后端入口 | `account-center/cloud/functions/accountCenter/app.js` |
| JSON 存储 | `account-center/cloud/functions/accountCenter/lib/store-json.js` |
| 账户前端 | `account-center/web/`（`assets/`、`login.html` 等） |
| 现成统计服务源码 | 本地 `personal-site/server/stats/index.js`；服务器 `/srv/chesterlee/stats/index.js` |
| 巡检脚本 | `部署上线备案/scripts/health.sh`、`monitor.sh`、`status/latest.md` |
| 备案台账 | `部署上线备案/README.md` |
| 打赏组件 | `打赏集成/component/donate.js` |
| 新工作区文件 | `account-center/account-center.code-workspace` |

服务器：`ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125`（2 核 2G，Caddy + account-center 8940 + mtl 8830 + wp-sync 8944 + map 8931 + stats 8950）。

---

## 5. 红线提醒

1. **不要新建用户表**：所有用户操作必须打在 `ac_users` / `ac_identities` / `ac_sessions` 上。
2. **不要迁移 SQLite**：609 KB / 37 用户，JSON 足够；先解决批量写盘（一次写），别换库。
3. **不要开 Caddy 访问日志再上 GoAccess**：已有 `personal-stats`，扩展它；开日志要另算磁盘与 6 个月留存。
4. **权限最后一公里在作品侧**：后台改了 `accessMode`，作品不读 `me.products` 照样能用；先定试点作品。
5. **AI Key 永远只看掩码**：后台不显示明文，不复制 `ac_ai_keys` 内容。
6. **备案台账只存编号与日期**：不存密码 / AppSecret / 私钥；凭据在 `通用信息/.private/`。
7. **打赏不能自动对账**：个人收款码无回调，只能手工 / 自报；别写“自动到账”。
8. **不做 Web 一键部署**：源码在本地 Mac；后台只记发布台账 + 跑体检，不执行任意命令。
9. **收费 v1 不做**：个人主体经营性 ICP 许可未解决，不要上“付费解锁”按钮。
10. **所有 `admin.*` 必须**：Token → `ac_admin_members` 角色 → 写审计；无权限返回 `FORBIDDEN`。
11. **不读 `备忘录`**；不 `git commit`、不部署上线，除非用户明确说。
12. 后台改动只碰 `account-center`；各作品业务数据不搬进来。
