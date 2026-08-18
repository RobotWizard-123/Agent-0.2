import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function sanitizeEnvironment(input) {
  const output = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toUpperCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output[key] = value;
  }
  return output;
}

export function withEnvironmentOverrides(input, overrides) {
  const output = sanitizeEnvironment(input);
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = key.toUpperCase();
    for (const existing of Object.keys(output)) {
      if (existing.toUpperCase() === normalized) delete output[existing];
    }
    output[key] = value;
  }
  return output;
}

export async function waitForEndpointUnavailable(url, label, {
  attempts = 60,
  delayMs = 250,
  requestTimeoutMs = 500,
  fetchImpl = fetch,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      return;
    }
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  throw new Error(`${label} is still running at ${url}; its port was not released`);
}

function launch(script, name, env, outputDirectory) {
  const stdout = openSync(join(outputDirectory, `${name}.log`), "a");
  const stderr = openSync(join(outputDirectory, `${name}-error.log`), "a");
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
  });
  child.unref();
  closeSync(stdout);
  closeSync(stderr);
  return child.pid;
}

export function startE2EStack() {
  const outputDirectory = join(root, "output", "playwright");
  mkdirSync(outputDirectory, { recursive: true });
  const env = withEnvironmentOverrides(process.env, {
    HOST: "127.0.0.1",
    PORT: "3100",
    APP_ADMIN_PASSWORD: "demo-admin-pass",
    APP_VIEWER_PASSWORD: "demo-viewer-pass",
    SESSION_SECRET: "e2e-only-session-secret",
    TRUST_PROXY_HTTPS: "false",
    AGENT_BASE_URL: "http://127.0.0.1:3200",
    AGENT_API_KEY: "e2e-only-agent-key",
    AGENT_MODEL: "e2e-agent-model",
    AGENT_TIMEOUT_MS: "2000",
    MOCK_AGENT_API_KEY: "e2e-only-agent-key",
    CP_SAT_ENABLED: "false",
  });
  return {
    mock_agent_pid: launch("scripts/mock-agent-server.js", "mock-agent", env, outputDirectory),
    app_pid: launch("server.js", "app-e2e", env, outputDirectory),
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(startE2EStack())}\n`);
}
