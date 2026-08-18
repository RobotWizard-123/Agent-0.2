#!/usr/bin/env node
/**
 * 机房智能管理 Agent V0.2 —— 一键启动器（已加固）
 *
 * 特性：
 *   1. 若 .env（或环境变量）已配置 AGENT_BASE_URL / AGENT_API_KEY / AGENT_MODEL，
 *      则使用你接入的真实大模型（OpenAI 兼容 /v1/chat/completions 协议）。
 *   2. 否则自动拉起项目自带的本地模拟模型进程（scripts/mock-agent-server.js）。
 *   3. 自动避开被占用的端口（3000 被占会自动顺延到 3001…）。
 *   4. 轮询 /health/live 直到服务真正就绪，再打开浏览器，避免“打开太早白屏”。
 *   5. 子进程日志同时写入 output/run-demo.log，并在窗口中可见；启动失败会明确报错。
 *
 * 用法：
 *   node run-demo.js                # 默认模式
 *   node run-demo.js --real         # 强制使用 .env 中的真实模型（未配置则报错退出）
 *   NO_BROWSER=1 node run-demo.js   # 仅启动不打开浏览器
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const forceReal = process.argv.includes("--real");
const openBrowser = !process.env.NO_BROWSER;

const logDir = join(root, "output");
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, "run-demo.log");
function log(line) {
  const text = `[${new Date().toISOString()}] ${line}`;
  process.stdout.write(`${text}\n`);
  try {
    appendFileSync(logFile, `${text}\n`);
  } catch {
    /* ignore */
  }
}

/** 解析 .env */
function parseEnv(content) {
  const out = {};
  for (const raw of String(content).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const env = { ...process.env };
if (existsSync(join(root, ".env"))) Object.assign(env, parseEnv(readFileSync(join(root, ".env"), "utf8")));

// 演示用登录凭据（未配置时给出本地演示默认值）
env.HOST = env.HOST || "127.0.0.1";
env.SESSION_SECRET = env.SESSION_SECRET || "demo-session-secret-change-me";
env.APP_ADMIN_PASSWORD = env.APP_ADMIN_PASSWORD || "admin123";
env.APP_VIEWER_PASSWORD = env.APP_VIEWER_PASSWORD || "viewer123";
env.TRUST_PROXY_HTTPS = env.TRUST_PROXY_HTTPS || "false";

const hasRealModel = Boolean(env.AGENT_BASE_URL && env.AGENT_API_KEY && env.AGENT_MODEL);
const useReal = forceReal || hasRealModel;
const children = [];

if (useReal && !hasRealModel) {
  log("[run-demo] --real 已指定，但未检测到 AGENT_BASE_URL/AGENT_API_KEY/AGENT_MODEL 配置。");
  log("[run-demo] 请在 .env 或环境变量中填写真实模型参数后重试。");
  process.exit(1);
}

/** 检查端口是否空闲 */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

/** 从 preferred 开始找一个空闲端口 */
async function pickPort(preferred) {
  let port = preferred;
  for (let i = 0; i < 30; i++) {
    if (await isPortFree(port)) return port;
    log(`[run-demo] 端口 ${port} 已被占用，尝试 ${port + 1}…`);
    port += 1;
  }
  throw new Error(`从 ${preferred} 起连续 30 个端口均被占用，请手动释放后重试。`);
}

/** 轮询直到服务就绪（最多 timeoutMs） */
async function waitForServer(url, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function openInBrowser(target) {
  let opener;
  if (process.platform === "win32") {
    opener = spawn("cmd", ["/c", "start", "", target], { windowsHide: true, detached: true });
  } else if (process.platform === "darwin") {
    opener = spawn("open", [target], { detached: true });
  } else {
    opener = spawn("xdg-open", [target], { detached: true });
  }
  opener.unref?.();
}

async function main() {
  const preferred = Number(env.PORT || 3000);
  const port = await pickPort(preferred);
  env.PORT = String(port);

  if (useReal) {
    log(`使用真实模型: ${env.AGENT_MODEL} -> ${env.AGENT_BASE_URL}`);
  } else {
    log("未检测到真实模型配置，自动拉起本地模拟模型 (model=local-e2e-model)");
    env.AGENT_BASE_URL = "http://127.0.0.1:3200";
    env.AGENT_API_KEY = "local-e2e-agent-key";
    env.AGENT_MODEL = "local-e2e-model";
    env.AGENT_TIMEOUT_MS = env.AGENT_TIMEOUT_MS || "8000";
    env.MOCK_AGENT_API_KEY = "local-e2e-agent-key";
    const mock = spawn(process.execPath, [join(root, "scripts", "mock-agent-server.js")], {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    children.push(mock);
    mock.on("exit", (code) => log(`模拟模型进程退出: ${code ?? "signal"}`));
    mock.on("error", (err) => log(`模拟模型启动失败: ${err.message}`));
  }

  log("正在启动应用…（日志同时写入 output/run-demo.log）");
  const app = spawn(process.execPath, [join(root, "server.js")], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(app);
  app.on("error", (err) => log(`应用启动失败: ${err.message}`));
  app.on("exit", (code, signal) => {
    if (code === 0 || signal) return; // 正常退出（如收到 Ctrl+C）不视为错误
    log(`应用进程异常退出 (code=${code})。请查看上面的报错，或 output/run-demo.log。`);
  });

  const url = `http://${env.HOST}:${port}`;
  const ready = await waitForServer(`http://${env.HOST}:${port}/health/live`);
  if (!ready) {
    log(`服务在 12 秒内未能就绪，可能启动失败。请查看日志: ${logFile}`);
    process.exit(1);
  }

  log("────────────────────────────────────────────");
  log(`站点已就绪: ${url}`);
  log(`管理员登录: 用户名 admin / 密码 ${env.APP_ADMIN_PASSWORD}`);
  log(`只读查看:   用户名 viewer / 密码 ${env.APP_VIEWER_PASSWORD}`);
  log("────────────────────────────────────────────");
  if (openBrowser) {
    openInBrowser(url);
    log("已尝试打开默认浏览器。");
  } else {
    log("NO_BROWSER 已设置，未自动打开浏览器，请手动访问上面的地址。");
  }
}

function shutdown() {
  log("正在关闭（模型进程 + 应用）…");
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  log(`启动器出错: ${err?.message || err}`);
  process.exit(1);
});
