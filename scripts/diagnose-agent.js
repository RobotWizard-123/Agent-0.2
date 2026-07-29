#!/usr/bin/env node
// One-shot connectivity test for the configured Agent endpoint.
// Run with:  node scripts/diagnose-agent.js   (or double-click diagnose-agent.cmd)
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function loadDotEnv() {
  try {
    const text = readFileSync(resolve(projectRoot, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k] === undefined) {
        process.env[k] = v.replace(/^['"]|['"]$/g, "");
      }
    }
  } catch (e) {
    console.log("[env] .env not found, using existing process.env");
  }
}

loadDotEnv();
const baseUrl = (process.env.AGENT_BASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.AGENT_API_KEY || "";
const model = process.env.AGENT_MODEL || "";
const timeoutMs = Number(process.env.AGENT_TIMEOUT_MS || 8000);

console.log("\n=== Agent Endpoint Diagnostic ===\n");
console.log("AGENT_BASE_URL  =", JSON.stringify(baseUrl));
console.log("AGENT_MODEL     =", JSON.stringify(model));
console.log("AGENT_API_KEY   =", apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)} (len ${apiKey.length})` : "(empty)");
console.log("AGENT_TIMEOUT_MS=", timeoutMs);
console.log("");

const tests = [
  { name: "1. 基础连通 (GET /health or /)", path: "/health" },
  { name: "2. 鉴权检查 (POST 无 body)", path: "/v1/chat/completions", method: "POST", body: {} },
  { name: "3. 模型列表 (GET /v1/models)", path: "/v1/models", method: "GET" },
  { name: "4. 真实模型调用 (POST /v1/chat/completions)", path: "/v1/chat/completions", method: "POST", body: { model, temperature: 0, max_tokens: 16, messages: [{ role: "user", content: "只输出 {\"ok\":true}" }] } },
];

let exit = 0;
for (const t of tests) {
  const url = baseUrl + t.path;
  const opts = {
    method: t.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    ...(t.method === "POST" ? { body: JSON.stringify(t.body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  };
  const start = Date.now();
  try {
    const res = await fetch(url, opts);
    const ms = Date.now() - start;
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    console.log(`${t.name}`);
    console.log(`  url     : ${url}`);
    console.log(`  status  : ${res.status} ${res.statusText}  (${ms}ms)`);
    if (res.status >= 200 && res.status < 300) {
      console.log(`  ok      : ✓ reachable`);
      if (parsed && t.path.endsWith("/models")) {
        const ids = (parsed.data || parsed.models || []).map((m) => m.id).slice(0, 8);
        console.log(`  models  : ${ids.join(", ")}${ids.length >= 8 ? ", ..." : ""}`);
      }
      if (parsed && t.path.endsWith("/chat/completions") && parsed.choices) {
        const content = parsed.choices?.[0]?.message?.content ?? "";
        console.log(`  reply   : ${JSON.stringify(content).slice(0, 80)}`);
        if (parsed.usage) console.log(`  usage   : ${JSON.stringify(parsed.usage)}`);
      }
      if (parsed) {
        const snippet = JSON.stringify(parsed).slice(0, 160).replace(/\n/g, " ");
        console.log(`  body    : ${snippet}${JSON.stringify(parsed).length > 160 ? "..." : ""}`);
      } else if (text) {
        console.log(`  body    : ${text.slice(0, 160)}${text.length > 160 ? "..." : ""}`);
      }
    } else if (res.status === 401) {
      console.log(`  ok      : ✗ 401 Unauthorized — API Key 不对、被吊销、或格式错误`);
      console.log(`  hint    : 去智谱控制台 https://bigmodel.cn/usercenter/apikeys 重新生成一个`);
      exit = 2;
    } else if (res.status === 403) {
      console.log(`  ok      : ✗ 403 Forbidden — Key 无权访问该模型`);
      console.log(`  hint    : 确认 Key 对应的账号开通了 glm-5.2 的权限`);
      exit = 2;
    } else if (res.status === 404) {
      console.log(`  ok      : ✗ 404 Not Found — 路径或模型名错误`);
      console.log(`  hint    : 智谱官方模型名是 glm-4-plus / glm-4-flash / glm-3-turbo，"glm-5.2" 不是官方名字`);
      console.log(`            试一下 GET /v1/models 看实际可用的模型列表`);
      exit = 2;
    } else if (res.status === 429) {
      console.log(`  ok      : ✗ 429 Too Many Requests — 限流了`);
      console.log(`  hint    : 等几秒再试，或换一个 Key`);
      exit = 2;
    } else {
      console.log(`  ok      : ✗ HTTP ${res.status}`);
      const snippet = (text || "").slice(0, 200).replace(/\n/g, " ");
      if (snippet) console.log(`  body    : ${snippet}`);
      exit = 2;
    }
  } catch (e) {
    const ms = Date.now() - start;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      console.log(`${t.name}`);
      console.log(`  url     : ${url}`);
      console.log(`  status  : TIMEOUT after ${ms}ms`);
      console.log(`  ok      : ✗ 连不上/不响应`);
      console.log(`  hint    : 可能是 1) 端点 IP/端口写错 2) 不在你机器能访问的内网/VPN  3) 防火墙/代理拦截`);
      exit = 3;
    } else if (e.code === "ECONNREFUSED") {
      console.log(`${t.name}`);
      console.log(`  url     : ${url}`);
      console.log(`  status  : CONNECTION REFUSED`);
      console.log(`  ok      : ✗ 端口未开放或服务没起`);
      console.log(`  hint    : 确认 10.245.100.107:4000 上确实有服务在 listen`);
      exit = 3;
    } else if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") {
      console.log(`${t.name}`);
      console.log(`  url     : ${url}`);
      console.log(`  status  : DNS / HOST UNREACHABLE`);
      console.log(`  ok      : ✗ 主机不可达`);
      console.log(`  hint    : 你的机器不能访问 10.245.100.107 (内网/专网)，需要先连 VPN`);
      exit = 3;
    } else {
      console.log(`${t.name}`);
      console.log(`  url     : ${url}`);
      console.log(`  status  : ERROR`);
      console.log(`  ok      : ✗ ${e.message || e}`);
      exit = 3;
    }
  }
  console.log("");
}

console.log("=== 结论 ===");
if (exit === 0) {
  console.log("✓ 4 步全通过 — 模型可用，问题不在端点。检查 .env 是否被正确加载、或浏览器缓存。");
} else if (exit === 2) {
  console.log("✗ 端点能连上但被拒绝 — 90% 是 Key 或模型名问题。");
  console.log("  最常见：'glm-5.2' 不是智谱官方模型名。智谱的模型名是 glm-4-plus / glm-4-flash / glm-3-turbo");
  console.log("  如果你们内部网关对模型做了别名映射，请确认 glm-5.2 是否注册了。");
} else if (exit === 3) {
  console.log("✗ 网络/鉴权层都通不到。10.245.100.107 是内网 IP — 你的机器没在那个内网里。");
  console.log("  解决方案：1) 切到你公司的 VPN  2) 改用公网 GLM  3) 改用其它公网模型");
}
process.exit(exit);
