import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function childTerminationDecision(result) {
  if (result.error) return { kind: "error", message: result.error.message };
  if (result.signal) return { kind: "signal", signal: result.signal };
  if (result.status !== 0) return { kind: "status", status: result.status ?? 1 };
  return null;
}

export function handleChildResult(result, label, {
  pid = process.pid,
  writeError = (message) => process.stderr.write(message),
  kill = (targetPid, signal) => process.kill(targetPid, signal),
  exit = (code) => process.exit(code),
} = {}) {
  const decision = childTerminationDecision(result);
  if (!decision) return null;

  if (decision.kind === "error") {
    writeError(`${label} could not start: ${decision.message}\n`);
    exit(1);
    return decision;
  }
  if (decision.kind === "signal") {
    writeError(`${label} was terminated by ${decision.signal}\n`);
    kill(pid, decision.signal);
    return decision;
  }
  exit(decision.status);
  return decision;
}

function main() {
  const defaultPython = process.platform === "win32"
    ? ".venv\\Scripts\\python.exe"
    : ".venv/bin/python";
  const explicitPythonPath = process.env.CP_SAT_PYTHON;
  const pythonPath = explicitPythonPath || defaultPython;
  const mustExistOnDisk = !explicitPythonPath || pythonPath.includes("/") || pythonPath.includes("\\");

  if (mustExistOnDisk && !existsSync(pythonPath)) {
    process.stderr.write(`CP-SAT Python interpreter not found: ${pythonPath}\n`);
    process.exit(1);
  }

  const python = spawnSync(pythonPath, ["-m", "unittest", "solver.test_cp_sat_solver", "-v"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  if (handleChildResult(python, "CP-SAT Python tests")) return;

  const integration = spawnSync(process.execPath, ["--test", "tests/cp-sat-integration.test.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CP_SAT_INTEGRATION: "1",
      CP_SAT_PYTHON: pythonPath,
    },
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  handleChildResult(integration, "CP-SAT integration test");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
