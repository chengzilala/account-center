# 运行说明（account-center）

> 当前阶段：**已上线**——`https://account.chesterlee.cn`（腾讯云轻量 `43.136.92.125`，Caddy 反代 `127.0.0.1:8940`，QQ 邮箱 SMTP 已验证发信；2026-10-28）。
> 部署形态：与奶茶项目同台腾讯云轻量服务器（Node 常驻 + Caddy 反代 + HTTPS）；personal-site 线上入口已指向正式域名。

## 0. 打开项目

用 Trae 打开本项目自带的独立工作区文件：

```
account-center/account-center.code-workspace
```

必须用这个文件（或直接把 `account-center/` 作为工作区根）打开，项目自带的 `.trae/rules` 与 `.trae/skills` 才会生效。

## 1. 骨架自检

```bash
cd /Users/Admin/Knowledge/Coding/account-center
ls -a           # 应看到 plan dev test usage screenshots inbox web cloud sdk .trae .gitignore
```

## 2. 本地预览页面

页面已可用（`web/index.html` → 自动进登录页或我的账户），但需要**同时起页面服务和后端**：页面里的请求会发到 `http://localhost:8942`。

终端 A（后端，验证码打印在这个终端）：

```bash
cd /Users/Admin/Knowledge/Coding/account-center
node cloud/functions/accountCenter/dev-server.js   # 默认 8942
```

终端 B（页面）：

```bash
cd /Users/Admin/Knowledge/Coding/account-center/web
python3 -m http.server 18830
# 18830 被别的项目占用就换一个，页面会自动把请求打到 8942
```

然后打开：

```bash
open -a "Google Chrome" "http://localhost:18830/"
```

如果 8942 被别的进程占用（本机常见：别的项目也起在同端口，请求会打到对方服务），把后端换端口，并在页面地址上加 `?api=` 指定一次（会记进 localStorage，之后跳转页面仍生效）：

```bash
PORT=28741 node cloud/functions/accountCenter/dev-server.js
open -a "Google Chrome" "http://localhost:18830/?api=http://127.0.0.1:28741"
```

按项目规则：本机预览只用命令 `open -a "Google Chrome"`，不用内置浏览器；登录/扫码等仍由本人操作。

自测一遍：邮箱登录 → 看终端里的验证码 → 进「我的账户」→ 生成 6 位码 → 退出。

## 3. 后端（本地已可跑）

目录：`cloud/functions/accountCenter/`，核心逻辑在 `app.js`，与部署平台无关。

跑测试（24 项，覆盖登录 / 绑定 / 6 位码 / 退出 / 注销 / 限流 / 账户凭证 / 我的足迹 / 90 天清理 / 跨域票据 / 第三方登录 / HTTP 入口）：

```bash
cd /Users/Admin/Knowledge/Coding/account-center
node --test test/account.test.js
```

起本地接口（验证码打印在终端，方便自测；不需要 SMTP）：

```bash
node cloud/functions/accountCenter/dev-server.js   # 默认 8942
curl -s -X POST http://localhost:8942/accountCenter \
  -H 'Content-Type: application/json' \
  -d '{"action":"auth.email.send","email":"you@example.com"}'
curl -s http://localhost:8942/healthz
```

- 本地数据文件：`cloud/functions/accountCenter/.data/store.json`（已 gitignore）
- 开发入口不需要 SMTP，`TOKEN_PEPPER` 不设置时用开发默认值，**不能用于线上**
- 所有数据只写 `ac_*` 集合，不碰微信悦读 `wre_*` 与高驰任何数据

## 4. 生产部署（与奶茶同台轻量服务器）

> **已按本节完成（2026-10-28）**：域名 `account.chesterlee.cn` → `43.136.92.125`，代码在 `/srv/chesterlee/account`，服务 `account-center.service`（`User=ubuntu`，`127.0.0.1:8940`），数据 `/var/lib/account-center/store.json`。下面是复现步骤 + 日常更新命令。

日常更新（改完代码 / 页面后）：

```bash
cd /Users/Admin/Knowledge/Coding/account-center
rsync -az --delete --exclude '.data' --exclude 'node_modules' -e "ssh -i ~/.ssh/chesterlee_web" cloud/ ubuntu@43.136.92.125:/srv/chesterlee/account/cloud/
rsync -az --delete -e "ssh -i ~/.ssh/chesterlee_web" web/ ubuntu@43.136.92.125:/srv/chesterlee/account/web/
# 依赖必须与 package.json 对齐：漏装会像 2026-10-29 那样「缺 @alicloud/* 直接起不来」
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "cd /srv/chesterlee/account/cloud/functions/accountCenter && npm ci --omit=dev"
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "sudo systemctl restart account-center && systemctl is-active account-center"
```

**重启后必看**（`is-active` 只代表进程没立刻退出，接口通不通要单独探）：

```bash
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "curl -s http://127.0.0.1:8940/healthz"   # 期望 {"ok":true}
```

### 4.0.1 数据备份（已装 cron，2026-11-02）

数据全在 `/var/lib/account-center/store.json` 一个文件，每天 03:20 自动备份到 `/var/backups/account-center/store-<时间>.json`（校验 JSON 后保留最近 7 份，手动放的 `store-pre-deploy-*.json` 不动）。

```bash
# 装/更新备份脚本（本仓库脚本为源，改完重新推一次）
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "sudo tee /usr/local/bin/account-backup.sh >/dev/null" < ../部署上线备案/scripts/backup-account-store.sh
# 手动跑一次
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "sudo /usr/local/bin/account-backup.sh"
# 看日志 / 现有备份
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "tail -n 20 /var/log/account-backup.log; ls -1t /var/backups/account-center | head"
```

登记 / 更新作品（会写数据文件，登记后需重启）：

```bash
ssh -i ~/.ssh/chesterlee_web ubuntu@43.136.92.125 "DATA_FILE=/var/lib/account-center/store.json node /srv/chesterlee/account/tools/register-product.js personal-site 个人网站 https://chesterlee.cn && sudo systemctl restart account-center"
```

前置：服务器已装 Node 18+，`npm install --omit=dev` 已执行（nodemailer + 阿里云短信 SDK）；域名已解析到该服务器。

### 4.1 环境变量（只写 systemd 的 EnvironmentFile，不入仓库）

```bash
# /etc/account-center.env   （权限 600，属主为运行用户）
TOKEN_PEPPER=<32 字节以上随机串，设为后永不更改>
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<发信邮箱>
SMTP_PASS=<邮箱授权码>
MAIL_FROM=<发信邮箱>
DATA_FILE=/var/lib/account-center/store.json
ALLOWED_ORIGINS=https://account.chesterlee.cn,https://chesterlee.cn,https://www.chesterlee.cn
PORT=8940

# 第三方登录（要用哪个就填哪个；不填 = 该平台自动隐藏、页面不出现按钮）
OAUTH_REDIRECT_BASE=https://account.chesterlee.cn
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITEE_CLIENT_ID=
GITEE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT=common

# 手机号登录（阿里云「短信认证」；四项缺一 = 手机号入口自动隐藏，其他登录不受影响）
ALIYUN_SMS_ACCESS_KEY_ID=
ALIYUN_SMS_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=
```

生成随机串：`openssl rand -hex 32`。`ALLOWED_ORIGINS` 必须包含官网裸域与 `www`，否则官网页跨域调接口会被浏览器拦截。第三方平台的 `Client Secret` 等同密码，只写在这里，不提交仓库、不写日志。

### 4.2 systemd 守护

```ini
# /etc/systemd/system/account-center.service
[Unit]
Description=account-center
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/srv/chesterlee/account/cloud/functions/accountCenter
EnvironmentFile=/etc/account-center.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/lib/account-center && sudo chown ubuntu /var/lib/account-center
sudo systemctl daemon-reload && sudo systemctl enable --now account-center
curl -s http://127.0.0.1:8940/healthz    # 期望 {"ok":true}
```

### 4.3 反向代理 + HTTPS

- 只暴露 80 / 443；8940 只监听本机（用防火墙或安全组挡住外部）。
- Caddy 同时把 `/accountCenter`、`/oauth/*` 与 `/healthz` 反代到 `127.0.0.1:8940`，其余路径直接读 `web/`；证书自动签发续期。线上实际配置（`/etc/caddy/Caddyfile`）：

```
account.chesterlee.cn {
    encode zstd gzip
    handle /accountCenter {
        reverse_proxy 127.0.0.1:8940
    }
    handle /oauth/* {
        reverse_proxy 127.0.0.1:8940
    }
    handle /healthz {
        reverse_proxy 127.0.0.1:8940
    }
    handle {
        root * /srv/chesterlee/account/web
        file_server
    }
}
```

改完 `sudo systemctl reload caddy`。

### 4.4 数据备份

`/var/lib/account-center/store.json` 是唯一数据文件。每天 `cp` 一份到 `store-$(date +%F).json`，保留 7 天即可；用户量上来再换 SQLite（`lib/store-json.js` 同接口替换）。

### 4.5 上线前检查

- [ ] `TOKEN_PEPPER` 已设置且只有一份（改了所有人登录态失效）
- [ ] SMTP 真实可发信，测试邮箱能收到（含垃圾箱）
- [ ] 域名 HTTPS 可用，证书自动续期
- [ ] `ALLOWED_ORIGINS` 只填实际页面域名（不要 `*`）
- [ ] 要用第三方登录：`OAUTH_REDIRECT_BASE` 与对应平台密钥已填，Caddy 已转发 `/oauth/*`，平台回调地址为 `https://account.chesterlee.cn/oauth/<平台>/callback`
- [ ] 要用手机号登录：阿里云「短信认证」已开通，`ALIYUN_SMS_*` 四项已填，重启后登录页出现手机号入口
- [ ] 备份脚本已加进 crontab
- [ ] 安全组只开 22 / 80 / 443

## 5. 登录方式配置（GitHub / Gitee / Microsoft / 阿里云短信）

代码已全部就绪，差的是「在平台建应用 / 开通服务 + 填服务端环境变量」。各自独立，填哪个就出现哪个入口。

> **当前线上状态（2026-10-28）**：GitHub（App id 3972427）与 Gitee（App id 58686）已建应用，密钥已写入 `/etc/account-center.env`，`OAUTH_REDIRECT_BASE=https://account.chesterlee.cn`，Caddy 已转发 `/oauth/*`；Microsoft 未配置（需 Azure 订阅，见 §5.3）。
> 密钥只存两处：本机 `.autoshot/oauth-*.json`（600，已 gitignore）与服务器 env（600），**不要写进任何文档或仓库**。
> 建应用可用本机脚本驱动真实 Chrome：`node tools/oauth-setup.js github|github-secret|gitee|gitee-read`。

### 5.1 GitHub

1. 打开 GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App。
2. `Application name` 随意；`Homepage URL` 填 `https://account.chesterlee.cn`。
3. `Authorization callback URL` 填 `https://account.chesterlee.cn/oauth/github/callback`。
4. 创建后拿 **Client ID**，点 Generate a new client secret 拿 **Client Secret**。
5. 写进 `/etc/account-center.env` 的 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`，重启服务。

### 5.2 Gitee

1. 登录 Gitee → 右上角头像 → 设置 → 数据管理 → **第三方应用** → 创建应用。
2. 回调地址填 `https://account.chesterlee.cn/oauth/gitee/callback`；权限只勾 `user_info`。
3. 拿 **Client ID** / **Client Secret**，写进 `GITEE_CLIENT_ID` / `GITEE_CLIENT_SECRET`。
4. 若创建入口提示需要实名认证，先按 Gitee 指引完成（以页面为准）。

### 5.3 Microsoft

> **前提：需要 Azure 订阅（能进 Azure Portal / Microsoft Entra ID）**。只有个人 Microsoft 账号、没有 Azure 订阅时无法创建应用，登录页也就不会显示 Microsoft 按钮。补齐订阅后按下面步骤做，代码无需改动。
>
> **怎么拿到订阅**：打开 <https://azure.microsoft.com/zh-cn/free/> → 用个人 Microsoft 账号（outlook / hotmail 即可）→ 手机验证 + 信用卡/借记卡验证（非预付卡，只做身份核验，约 ¥7 / $1 预授权会退回）→ 注册完成即自带一个 **Entra ID 租户（Free 版）**。应用注册本身**免费**，免费账户 30 天 $200 额度用完不自动扣费。建应用入口：<https://entra.microsoft.com> → 标识 → 应用注册。不想绑卡就先不接，GitHub + Gitee 已够用。

1. Azure Portal → **Microsoft Entra ID** → 应用注册 → 新注册。
2. 账户类型选「任何组织目录中的账户和个人 Microsoft 账户」。
3. 重定向 URI 选 **Web**，填 `https://account.chesterlee.cn/oauth/microsoft/callback`。
4. 「证书和密码」→ 新建客户端密码，拿 **值**（只显示一次）；「API 权限」确认有 Microsoft Graph 的 `User.Read`。
5. 写进 `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`；`MICROSOFT_TENANT=common`。

### 5.4 本机联调

平台回调地址必须与请求里的 `redirect_uri` 完全一致。本机调试两种做法：

- **最省事**：直接用线上回调（`OAUTH_REDIRECT_BASE=https://account.chesterlee.cn`），但登录页也要开在线上域名；
- **本地回调**：在平台再加一条 `http://localhost:8942/oauth/<平台>/callback`（GitHub / Gitee / Microsoft 都允许 localhost），然后：

```bash
cd /Users/Admin/Knowledge/Coding/account-center
OAUTH_REDIRECT_BASE=http://localhost:8942 \
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy \
node cloud/functions/accountCenter/dev-server.js
```

页面仍起在 `http://localhost:18830/login.html`；回调会跳回该页面并自动换 Token（开发模式放行 localhost 域名）。

### 5.5 验收

- [ ] 登录页出现对应平台按钮；没填密钥的平台不出现
- [ ] 点按钮 → 平台授权 → 回到登录页 → 自动进「我的账户」
- [ ] 账户页能看到该平台钥匙，且第三方邮箱已注册时会提示「先用邮箱登录再绑定」
- [ ] 已登录时账户页「添加登录方式」能绑定成功；同一平台账号不能绑到第二个账户

### 5.6 手机号短信（阿里云「短信认证」）

选这条路线的理由：**个人实名就能用，不需要企业资质、不需要自建签名和模板审核**——2025-09-18 起腾讯云 / 阿里云通用短信已不再给个人认证用户签发自有签名。

1. 打开 <https://dysms.console.aliyun.com/> → 找到「短信认证」（号码认证服务）→ 开通，完成个人实名。
2. 在控制台「短信认证」里添加场景 / 资质后，记下分配给你的**签名名称**与**模板 CODE**（系统预置，不可自定义）。
3. 创建 RAM 用户并只授予 `AliyunDypnsFullAccess`（或按最小权限授予 `dypns:SendSmsVerifyCode` / `CheckSmsVerifyCode`），拿到 **AccessKey ID / Secret**。主账号 AccessKey 不要直接用。
4. 四项写进 `/etc/account-center.env`：

```bash
ALIYUN_SMS_ACCESS_KEY_ID=<AccessKey ID>
ALIYUN_SMS_ACCESS_KEY_SECRET=<AccessKey Secret>
ALIYUN_SMS_SIGN_NAME=<控制台里的签名名称>
ALIYUN_SMS_TEMPLATE_CODE=<控制台里的模板 CODE>
```

5. `sudo systemctl restart account-center`，然后按下面验收。

> 计费：核验接口免费，按运营商回执计费；≤1000 次/月约 0.06 元/条（1000–5000 约 0.056、5000–1 万约 0.054）。按「每次登录约 1.5 条」估算，100 次约 6 元、1000 次约 60 元。
> 防刷已内置：发送前必须过图形验证码；同一号码 1 次/分钟、5 次/小时、10 次/天；同 IP 20 次/小时、50 次/天。被刷是唯一实质成本风险，改限流见 `app.js` 的 `smsSend`。
> 本地调试不用配密钥：`dev-server.js` 默认走控制台短信，验证码打印在终端。

**验收**

- [ ] `curl -s https://account.chesterlee.cn/ -d '{"action":"auth.methods"}' -H 'content-type: application/json'` 返回 `"sms":true`
- [ ] 登录页「选择登录方式」出现「手机号验证码登录」
- [ ] 图形验证码能换图；不填图形码时「发送验证码」不放行
- [ ] 手机能收到 6 位验证码；输错提示「验证码不正确或已过期」
- [ ] 首次手机号登录建新账户；同一号码再次登录还是同一个 uid
- [ ] 已登录账户页「登录方式 → 手机号 → 连接」能绑定；绑定后手机号登录落到同一 uid；解绑后不再显示

## 6. 作品接入（SDK）

把 `sdk/ps-auth.js` 放进作品页面引入，然后：

```js
PSAuth.init({ apiBase: 'https://<账户中心域名>', productId: 'wxread' })

const user = await PSAuth.getUser()       // 未登录 → null
if (!user) return PSAuth.requireLogin()   // 跳账户中心登录，登录后带 ps_ticket 回来
```

> 页面与接口不同域时（本机页面 18830 / 接口 8942），再传 `loginUrl: 'http://localhost:18830/login.html'`，否则会跳到接口端口的登录页。

前提：作品域名要能被账户中心信任——在 `ac_products` 登记 `{ appId, name, url, status: 'active' }`，或把作品域名写进 `ALLOWED_ORIGINS`；两者都没有的域名会被 `auth.ticket.issue` 拒签（防开放跳转）。本机联调把页面起在 `http://localhost:<端口>` 即可（开发模式只放行 localhost）。

登记用脚本（`DATA_FILE` 不传时写本机 `.data/store.json`；登记后重启服务才生效）：

```bash
node tools/register-product.js personal-site 个人网站 http://localhost:5181

# 深色作品：登录页跟作品同色（第 4 个参数 light / dark，第 5 个参数是强调色）
node tools/register-product.js 微信悦读 微信悦读 https://read.example.com dark '#2b2b2b'

# 上线后（数据文件在服务器上）
DATA_FILE=/var/lib/account-center/store.json \
node tools/register-product.js personal-site 个人网站 https://chesterlee.cn
```

登录页只在**这一处**取配色：链接带 `productId` 时自动问 `product.theme`，登记成 `dark` 就整站深色；作品代码不用改。临时预览可直接加参数 `?theme=dark&accent=%23rrggbb`（优先级最高）。

已接入的作品：`personal-site`（顶栏「登录 / 我的」+ 作品卡「打开作品」上报，见该项目的 `web/assets/js/site.js`）。

## 7. 改哪里看哪

| 想改 | 改这里 |
|---|---|
| 需求 / 范围 | `plan/RPD_需求文档.md`（唯一需求源） |
| 设计取舍 | `plan/统一账户_方案分析.md` |
| 页面 | `web/` |
| 接口 | `cloud/functions/accountCenter/app.js`（核心）+ `server.js`（生产入口）+ `dev-server.js`（本地入口） |
| 接口约定 | `plan/接入契约.md` |
| 作品接入 | `sdk/ps-auth.js`（已实现，`init` / `getUser` / `requireLogin` / `logout` / `track`） |
