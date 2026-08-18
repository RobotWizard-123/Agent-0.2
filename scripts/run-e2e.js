import { spawn } from "node:child_process";
import {
  waitForEndpointUnavailable,
  withEnvironmentOverrides,
} from "./start-e2e-stack.js";

const baseURL = "http://127.0.0.1:3100";
const mockAgentURL = "http://127.0.0.1:3200";
const testEnv = withEnvironmentOverrides(process.env, {
  HOST: "127.0.0.1",
  PORT: "3100",
  APP_ADMIN_PASSWORD: "demo-admin-pass",
  APP_VIEWER_PASSWORD: "demo-viewer-pass",
  SESSION_SECRET: "e2e-only-session-secret",
  E2E_ADMIN_PASSWORD: "demo-admin-pass",
  TRUST_PROXY_HTTPS: "false",
  AGENT_BASE_URL: "http://127.0.0.1:3200",
  AGENT_API_KEY: "e2e-only-agent-key",
  AGENT_MODEL: "e2e-agent-model",
  AGENT_TIMEOUT_MS: "2000",
  MOCK_AGENT_API_KEY: "e2e-only-agent-key",
});

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode ?? 1);
  return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

async function terminateChild(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    child.kill("SIGKILL");
    await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    if (child.exitCode !== null) return;
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await Promise.race([
      new Promise((resolve) => {
        killer.once("exit", resolve);
        killer.once("error", resolve);
      }),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([
    waitForExit(child),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitForReady(child, url, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready within 15 seconds`);
}

await Promise.all([
  waitForEndpointUnavailable(`${mockAgentURL}/health`, "Previous Mock Agent"),
  waitForEndpointUnavailable(`${baseURL}/health/ready`, "Previous test server"),
]);

const mockAgent = spawn(process.execPath, ["scripts/mock-agent-server.js"], {
  env: testEnv,
  stdio: "ignore",
  windowsHide: true,
});
const server = spawn(process.execPath, ["server.js"], { env: testEnv, stdio: "ignore", windowsHide: true });

try {
  await waitForReady(mockAgent, `${mockAgentURL}/health`, "Mock Agent");
  await waitForReady(server, `${baseURL}/health/ready`, "Test server");
  const runner = spawn(process.execPath, ["node_modules/playwright/cli.js", "test", ...process.argv.slice(2)], {
    env: testEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  process.exitCode = await waitForExit(runner);
} finally {
  await Promise.all([terminateChild(server), terminateChild(mockAgent)]);
  await Promise.all([
    waitForEndpointUnavailable(`${mockAgentURL}/health`, "Mock Agent"),
    waitForEndpointUnavailable(`${baseURL}/health/ready`, "Test server"),
  ]);
}
