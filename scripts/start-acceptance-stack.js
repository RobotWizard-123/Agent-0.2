import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withEnvironmentOverrides } from "./start-e2e-stack.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function parseEnv(content) {
  const entries = {};
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

export function startAcceptanceStack() {
  const local = parseEnv(readFileSync(join(root, ".env"), "utf8"));
  const required = ["AGENT_BASE_URL", "AGENT_API_KEY", "AGENT_MODEL"];
  if (required.some((key) => !local[key])) {
    throw new Error("Local Agent configuration is incomplete");
  }

  const outputDirectory = join(root, "output", "playwright");
  mkdirSync(outputDirectory, { recursive: true });
  const stdout = openSync(join(outputDirectory, "app-acceptance.log"), "a");
  const stderr = openSync(join(outputDirectory, "app-acceptance-error.log"), "a");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: withEnvironmentOverrides(process.env, {
      HOST: "127.0.0.1",
      PORT: "3100",
      APP_ADMIN_PASSWORD: "demo-admin-pass",
      APP_VIEWER_PASSWORD: "demo-viewer-pass",
      SESSION_SECRET: "e2e-only-session-secret",
      TRUST_PROXY_HTTPS: "false",
      AGENT_BASE_URL: local.AGENT_BASE_URL,
      AGENT_API_KEY: local.AGENT_API_KEY,
      AGENT_MODEL: local.AGENT_MODEL,
      AGENT_TIMEOUT_MS: local.AGENT_TIMEOUT_MS || "8000",
    }),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  child.unref();
  closeSync(stdout);
  closeSync(stderr);
  return { app_pid: child.pid, model: local.AGENT_MODEL };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const started = startAcceptanceStack();
  process.stdout.write(`${JSON.stringify({ app_pid: started.app_pid, model_configured: true })}\n`);
}
