# account-center — 统一账户中心

> **状态**：后端核心已本地跑通（35 项测试通过，含跨域票据、第三方登录与手机号验证码）；**前端已按参考图改版**（纸张底色 + 黑色细线 + 大标题的编辑风）：登录页展示手机号验证码 / 邮箱验证码 / 手机扫码登录 / GitHub / Gitee / Microsoft / 账户码 / 6 位码（**没配 Client ID 的平台、没配短信的服务自动隐藏**），我的账户为「账户状态 / 登录方式（含绑定 / 解绑）/ 我的装置 / 隐私与安全」，并新增用户协议与隐私政策页；**账户凭证可保存到相册，并带「扫码自动填邮箱」的二维码**；**新设备一键登录（手机扫码确认）与昵称 / 头像跨作品同步已上线**；**没自定义昵称 / 头像的账户由系统生成默认形象（2026-10-30）**；**作品侧 SDK（`sdk/ps-auth.js`）与跨域登录票据已落地**；微信 / Google 仍为 P1；**线上已上线（`https://account.chesterlee.cn`，2026-10-28）**。
> **部署**：腾讯云轻量 `43.136.92.125`（`/srv/chesterlee/account`，`account-center.service` + Caddy + HTTPS），更新命令见 [Running.md](usage/Running.md) §4。
> **一句话**：全站统一的身份层——一个 uid 管所有作品，负责登录、会话、作品开通状态。

## 这是什么

给「个人官网 + 微信悦读（H5 / 插件 / 小程序）+ 未来作品」共用的一套账户中心：

- **账户中心**：登录页（手机号验证码 / 邮箱验证码 / GitHub / Gitee / Microsoft / 账户码 / 6 位码）、我的账户（登录方式总览：已连接 / 未连接，可连接与解绑）、管理后台
- **作品侧**只认 `uid` 与轻量 SDK `sdk/ps-auth.js`（`getUser / requireLogin / logout`）
- **第三方 Key 与业务数据不进这里**：微信读书 Key、高驰 Token、跑步 / 阅读数据继续留在各作品
- **第三方登录只做身份**：GitHub / Gitee / Microsoft 只用于识别「你是谁」，不自动合并邮箱账户，绑定由用户在账户页主动发起
- **手机号登录**：走阿里云「短信认证」（系统预置签名 + 模板，个人实名可用），发送前必须先过图形验证码；手机号同样只做身份，不自动合并邮箱账户
- **登录页配色按作品走**：在账户中心登记一次（`register-product.js` 的 `[light|dark] [#rrggbb]`），深色作品的登录页自动同色，作品代码不用改

## 目录结构

```
account-center/
├── web/                       # 页面（纯静态：零构建、零外部依赖）
│   ├── index.html             # 入口：有登录态进账户页，否则进登录页
│   ├── login.html             # 登录：手机号验证码 / 邮箱验证码（主）+ 手机扫码 / GitHub / Gitee / Microsoft + 账户码 + 6 位码
│   ├── qr.html                # 扫码登录的手机确认页（扫码后点「确认」）
│   ├── account.html           # 我的账户：账户状态（含账户凭证）/ 登录方式（总览 + 绑定 / 解绑）/ 我的装置 / 跨设备登录 / 隐私与安全
│   ├── terms.html             # 用户协议
│   ├── privacy.html           # 隐私政策（含账户安全说明）
│   └── assets/                # ac.css（ac- 前缀样式）+ ac.js（请求封装）+ theme.js（换肤引导）+ qrcode.js（零依赖二维码）
├── cloud/functions/
│   └── accountCenter/         # 账户中心服务（按 action 路由）
│       ├── app.js             # 核心逻辑（与部署平台无关）
│       ├── server.js          # 生产入口（HTTP 服务）
│       ├── dev-server.js      # 本地调试入口（验证码打印终端）
│       └── lib/               # 存储、发信、短信（sms.js）、图形验证码（captcha.js）、令牌、限流、校验、错误码、第三方登录（oauth.js）、默认昵称与头像（persona.js）
├── sdk/
│   └── ps-auth.js             # 作品侧接入 SDK（init / getUser / requireLogin / logout / track，自动换票）
├── plan/
│   ├── 统一账户_方案分析.md     # 方案与决策依据
│   ├── RPD_需求文档.md         # 唯一需求源
│   ├── 统一账户规范.md          # 身份 / 钥匙 / 会话规则（实现依据）
│   └── 接入契约.md              # 接口、错误码、SDK 契约（实现依据）
├── dev/session_log.md         # 进展记录
├── test/  usage/  screenshots/  inbox/
└── .trae/{rules,skills}       # 项目规则与技能副本（由母本同步，不入库）
```

## 怎么跑

后端与页面都已可本地运行，命令见 [Running.md](usage/Running.md) §2（页面）与 §3（后端）；生产部署见 §4。

## 下一步

1. **线上实测**：先在一处登录（`https://account.chesterlee.cn` 或任一作品），再打开 `https://chesterlee.cn` —— 应自动变「我的」（静默登录，无需再点）；账户页已去掉「我的足迹」，只保留账户状态 / 登录方式 / 我的装置 / 跨设备登录 / 隐私与安全
2. **新设备一键登录复验**：电脑打开登录页 →「手机扫码登录」→ 已登录手机扫码 → 点「确认」→ 电脑自动登录；账户页点头像或「换头像」上传后，官网顶栏应显示小头像
3. **第三方登录与手机号登录已就绪，待填密钥**：代码已支持 GitHub / Gitee / Microsoft 与阿里云短信；在平台建应用、把 `Client ID/Secret` 或 `ALIYUN_SMS_*` 写进服务端环境变量并重启后即生效（步骤见 [Running.md](usage/Running.md) §5）。微信 / Google 仍未接
4. **接作品**：`sdk/ps-auth.js` 已就绪，`personal-site` 已上线接入（顶栏「登录 / 我的」+ 作品卡上报）；`math-classics` 已在本机登记 → 接着接微信悦读 H5/插件 → 小程序
5. **部署**：已完成（`https://account.chesterlee.cn`，2026-10-28）；后续改代码按 [Running.md](usage/Running.md) §4 的 rsync 命令更新

接口口径以 [接入契约.md](plan/接入契约.md) 为准，身份规则以 [统一账户规范.md](plan/统一账户规范.md) 为准。

## 相关文档

- [统一账户_方案分析.md](plan/统一账户_方案分析.md) — 为什么这么设计、取舍与风险
- [RPD_需求文档.md](plan/RPD_需求文档.md) — 需求与分阶段计划
- [统一账户规范.md](plan/统一账户规范.md) — uid、钥匙、会话、数据归属、安全红线
- [接入契约.md](plan/接入契约.md) — 接口清单、错误码、SDK 契约
