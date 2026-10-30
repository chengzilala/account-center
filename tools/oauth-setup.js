"use strict";

// 第三方登录应用创建助手：驱动本机真实 Chrome（可见窗口、独立 profile 保留登录态）。
// 用法：
//   node tools/oauth-setup.js open <url>       启动 / 复用 Chrome 并打开地址
//   node tools/oauth-setup.js state            打印当前页面地址、表单字段、按钮、正文摘要
//   node tools/oauth-setup.js click <文字>      点击第一处含该文字的可点元素
//   node tools/oauth-setup.js type <选择器> <值>  往输入框填值
//   node tools/oauth-setup.js shot             截图到 .autoshot/shot.png
//   node tools/oauth-setup.js github           自动创建 GitHub OAuth App
//   node tools/oauth-setup.js gitee            自动创建 Gitee OAuth App
// 密钥只写 .autoshot/*.json（600），终端里只打印 Client ID。

const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/Users/Admin/Knowledge/Coding/milk-tea-log/node_modules/playwright");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, ".autoshot");
const PROFILE = path.join(OUT, "chrome-profile");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.OAUTH_CDP_PORT || 9444);
const HOME = "https://account.chesterlee.cn";
const PASSWORDS = "/Users/Admin/Knowledge/Coding/通用信息/.private/密码.md";

fs.mkdirSync(OUT, { recursive: true });

function portFree() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(PORT, "127.0.0.1");
  });
}

async function running() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function launch(url) {
  if (await running()) {
    console.log("[oauth] Chrome 已在运行，直接复用");
    return;
  }
  if (!(await portFree())) throw new Error(`调试端口 ${PORT} 被占用，换 OAUTH_CDP_PORT`);
  spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    url || "https://github.com"
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (await running()) return;
  }
  throw new Error("Chrome 启动超时");
}

async function withPage(fn) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20000 });
  try {
    const ctx = browser.contexts()[0];
    const pages = ctx.pages().filter((p) => !/^(chrome|devtools|about):/.test(p.url()));
    const page = pages[pages.length - 1] || (await ctx.newPage());
    await page.bringToFront();
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function describe(page) {
  const info = await page.evaluate(() => {
    const text = (el) => (el ? (el.innerText || el.value || "").trim().replace(/\s+/g, " ") : "");
    const inputs = [...document.querySelectorAll("input, textarea, select")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      id: el.id || "",
      name: el.name || "",
      placeholder: el.placeholder || "",
      label: text(el.labels && el.labels[0]),
      value: el.type === "password" ? "***" : text(el).slice(0, 60),
      checked: el.checked
    }));
    const buttons = [...document.querySelectorAll('button, input[type=submit], a.btn')]
      .map((el) => ({ text: text(el).slice(0, 40), id: el.id || "", name: el.name || "", type: el.type || "" }))
      .filter((b) => b.text);
    return { url: location.href, title: document.title, inputs, buttons, text: document.body.innerText.slice(0, 2500) };
  });
  return info;
}

function printState(info) {
  console.log("URL:", info.url);
  console.log("TITLE:", info.title);
  if (info.inputs.length) {
    console.log("--- 输入框 ---");
    info.inputs.forEach((i) => console.log(JSON.stringify(i)));
  }
  if (info.buttons.length) {
    console.log("--- 按钮 ---");
    info.buttons.forEach((b) => console.log(JSON.stringify(b)));
  }
  console.log("--- 正文 ---");
  console.log(info.text);
}

function readPassword(platform, user) {
  try {
    const md = fs.readFileSync(PASSWORDS, "utf8");
    const line = md.split("\n").find((l) => l.includes(platform) && l.includes(user));
    if (!line) return "";
    const cells = line.split("|").map((c) => c.trim().replace(/`/g, ""));
    const guess = cells.find((c) => c && c !== platform && c !== user && !c.includes("见") && c.length >= 6);
    return guess && guess !== "待补充" ? guess : "";
  } catch {
    return "";
  }
}

function saveJson(name, data) {
  const file = path.join(OUT, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  return file;
}

async function isGithubLoggedIn(page) {
  try {
    await page.goto("https://github.com/settings/applications/new", { waitUntil: "domcontentloaded", timeout: 25000 });
    return !/\/login/.test(page.url());
  } catch {
    return false;
  }
}

// 等待用户在可见窗口里完成验证（邮箱验证码 / 2FA），最长 10 分钟
async function waitGithubLogin(page, maxMs = 10 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  console.log("[oauth] 需要你在浏览器窗口完成 GitHub 验证（验证码已发到账号邮箱），我在后台等你…");
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if (!/\/login|\/sessions\//.test(page.url())) {
      console.log("[oauth] 检测到已通过验证，继续创建应用");
      return true;
    }
  }
  console.log("[oauth] 等待登录超时（10 分钟），重新运行本命令即可续做");
  return false;
}

async function ensureGithubLogin(page) {
  if (!/\/login/.test(page.url()) && (await page.$("#oauth_application_name"))) return true;
  if (await isGithubLoggedIn(page)) return true;
  const shot = path.join(OUT, "github-login.png");
  await page.screenshot({ path: shot }).catch(() => {});
  if (!(await waitGithubLogin(page))) return false;
  await page.goto("https://github.com/settings/applications/new", { waitUntil: "domcontentloaded" });
  return true;
}

async function githubSecret(page) {
  if (!/\/settings\/applications\/\d+/.test(page.url())) {
    await page.goto("https://github.com/settings/developers", { waitUntil: "domcontentloaded" });
    await page.click('a:has-text("Chester Account Center")');
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
  }
  const body = await page.evaluate(() => document.body.innerText);
  const clientId = (body.match(/(?:Client ID|client_id)[\s:]*([A-Za-z0-9_.-]{10,})/i) || [])[1] || "";
  await page.click('button:has-text("Generate a new client secret")').catch(() => {});
  await page.waitForTimeout(4000);
  const secret = await page.evaluate(() => {
    const el = document.querySelector("#new-oauth-token, input[id*=secret], code[id*=secret]");
    if (el) return (el.value || el.innerText || "").trim();
    const m = document.body.innerText.match(/\b[0-9a-f]{40}\b/);
    return m ? m[0] : "";
  });
  const appId = (page.url().match(/applications\/(\d+)/) || [])[1] || "";
  if (!clientId) {
    console.log("[oauth] 没读到 Client ID");
    printState(await describe(page));
    return 3;
  }
  saveJson("oauth-github", { provider: "github", clientId, clientSecret: secret, appId, createdAt: new Date().toISOString() });
  console.log("[oauth] Client ID:", clientId);
  console.log("[oauth] Client Secret:", secret ? `已保存（${secret.length} 位）` : "未读到");
  return secret ? 0 : 4;
}

async function github(page) {
  if (!(await ensureGithubLogin(page))) {
    printState(await describe(page));
    return 2;
  }
  await page.goto("https://github.com/settings/applications/new", { waitUntil: "domcontentloaded" });
  const fill = async (sel, val) => {
    const el = await page.$(sel);
    if (!el) return false;
    await el.click();
    await el.fill("");
    await el.type(val, { delay: 20 });
    return true;
  };
  await fill("#oauth_application_name", "Chester Account Center");
  await fill("#oauth_application_url", HOME);
  await fill("#oauth_application_application_callback_urls_attributes_0_url", `${HOME}/oauth/github/callback`);
  await fill("#oauth_application_description", "统一账户中心登录");
  await page.waitForTimeout(500);
  await page.click('button:has-text("Register application")');
  await page.waitForTimeout(4000);
  const flash = await page.evaluate(() => {
    const f = document.querySelector(".flash-error, .flash-warn, .error, [role=alert]");
    return f ? f.innerText.trim().slice(0, 200) : "";
  });
  if (flash) console.log("[oauth] 表单报错:", flash);
  console.log("[oauth] 提交后地址:", page.url());
  if (/\/settings\/applications\/\d+/.test(page.url())) {
    return githubSecret(page);
  }
  const shot = path.join(OUT, "github-create.png");
  await page.screenshot({ path: shot }).catch(() => {});
  printState(await describe(page));
  return 3;
}

async function gitee(page) {
  await page.goto("https://gitee.com/oauth/applications/new", { waitUntil: "domcontentloaded" });
  if (/\/login/.test(page.url())) {
    console.log("[oauth] Gitee 需要登录：请在这个 Chrome 窗口里登录（扫码 / 手机验证码），我在这里等…");
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      if (!/\/login/.test(page.url())) break;
    }
    if (/\/login/.test(page.url())) {
      console.log("[oauth] 等待登录超时，重新运行本命令即可续做");
      return 2;
    }
    await page.goto("https://gitee.com/oauth/applications/new", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  }
  await page.fill("#oauth_application_name", "Chester Account Center");
  await page.fill("#oauth_application_site_url", `${HOME}/`);
  await page.fill("#oauth_application_redirect_uri_", `${HOME}/oauth/gitee/callback`);
  const logo = path.join(OUT, "app-logo.png");
  if (fs.existsSync(logo)) await page.setInputFiles("#oauth_application_logo", logo).catch(() => {});
  await page.check("input[type=checkbox][value=user_info]").catch(() => {});
  await page.waitForTimeout(1200);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    page.click('input[type=submit][value="创建应用"]')
  ]);
  await page.waitForTimeout(2000);
  const text = await page.evaluate(() => document.body.innerText);
  const flash = (text.match(/应用(创建|保存)失败[^\n]*/) || [""])[0];
  if (flash) console.log("[oauth] 报错:", flash);
  return giteeRead(page);
}

// Gitee 详情页把密钥放在两个 <input> 里：id=uid（Client ID）、id=secret（Client Secret）
async function giteeRead(page) {
  if (!/\/oauth\/applications\/\d+/.test(page.url())) {
    await page.goto("https://gitee.com/oauth/applications", { waitUntil: "domcontentloaded" });
    const link = await page.$('a:has-text("Chester Account Center")');
    if (!link) {
      console.log("[oauth] 找不到已创建的 Gitee 应用，当前地址:", page.url());
      return 3;
    }
    await link.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);
  }
  const clientId = await page.inputValue("#uid").catch(() => "");
  const secret = await page.inputValue("#secret").catch(() => "");
  const appId = (page.url().match(/applications\/(\d+)/) || [])[1] || "";
  if (!clientId || !secret) {
    console.log("[oauth] 没读到 Gitee 密钥，当前地址:", page.url());
    printState(await describe(page));
    return 3;
  }
  saveJson("oauth-gitee", { provider: "gitee", clientId, clientSecret: secret, appId, createdAt: new Date().toISOString() });
  console.log("[oauth] Gitee Client ID:", clientId);
  console.log("[oauth] Gitee Client Secret:", `已保存（${secret.length} 位）`);
  return 0;
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (!cmd) {
    console.log("用法见文件头注释");
    return 0;
  }
  if (cmd === "open") {
    await launch(a);
    await withPage((p) => p.goto(a, { waitUntil: "domcontentloaded" }));
    console.log("[oauth] 已打开", a);
    return 0;
  }
  await launch();
  return withPage(async (page) => {
    if (cmd === "state") return printState(await describe(page)), 0;
    if (cmd === "shot") {
      const file = path.join(OUT, "shot.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log("[oauth] 截图:", file);
      return 0;
    }
    if (cmd === "tab") {
      const ctx = page.context();
      const next = await ctx.newPage();
      await next.goto(a, { waitUntil: "domcontentloaded" }).catch(() => {});
      console.log("[oauth] 新标签:", a);
      return 0;
    }
    if (cmd === "click") {
      await page.click(`text=${a}`);
      await page.waitForTimeout(800);
      return printState(await describe(page)), 0;
    }
    if (cmd === "type") {
      await page.fill(a, b);
      console.log("[oauth] 已填", a);
      return 0;
    }
    if (cmd === "github") return github(page);
    if (cmd === "github-secret") return githubSecret(page);
    if (cmd === "gitee") return gitee(page);
    if (cmd === "gitee-read") return giteeRead(page);
    console.log("未知命令:", cmd);
    return 1;
  });
}

main().then((code) => process.exit(code || 0)).catch((err) => {
  console.error("[oauth] 失败:", err.message);
  process.exit(1);
});
