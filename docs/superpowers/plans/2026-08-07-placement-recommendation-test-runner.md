# Placement Recommendation Test Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-platform Node.js launcher and a Windows command file inside `tests/placement-recommendation/` that run the existing placement-recommendation core/API tests, UI tests, or both.

**Architecture:** Keep command selection as pure exported functions so it can be verified without starting browsers. The CLI resolves the repository root from its own file location, launches existing Node and E2E runners sequentially with inherited output, and returns the first non-zero exit code. The `.cmd` wrapper delegates to the Node launcher and preserves its exit status.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, `child_process.spawn`, Playwright, Windows batch.

## Global Constraints

- Create both executable entry files in `tests/placement-recommendation/`.
- Default mode is `all`; accepted modes are `core`, `ui`, and `all`.
- `core` runs the existing recommendation, planning, scoring, constraint, CP-SAT, migration, rack-layout, API, and plan-service test files.
- `ui` runs the placement-related cases from `tests/e2e/closed-loops.spec.js` through the existing `scripts/run-e2e.js` stack.
- Child-process output remains visible in the calling terminal.
- A failed child command stops the sequence and becomes the launcher exit code.
- The command file must work from any current working directory and forward all arguments.
- Interactive command-file runs display the exit code and wait for a key; `--no-pause` disables the wait for automation.
- Do not modify or delete existing test cases.
- Do not stage or commit unrelated working-tree changes.

---

### Task 1: Establish executable artifacts with a failing contract test

**Files:**
- Create: `tests/placement-recommendation/run-test-set.test.js`
- Create: `tests/placement-recommendation/run-test-set.js`
- Create: `tests/placement-recommendation/run-test-set.cmd`

**Interfaces:**
- Produces: two executable artifacts at stable paths for later behavioral tests.
- Consumes: no earlier task interface.

- [ ] **Step 1: Write the failing artifact-presence test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

test("placement recommendation test runner ships Node and Windows entrypoints", () => {
  assert.equal(existsSync(resolve(here, "run-test-set.js")), true);
  assert.equal(existsSync(resolve(here, "run-test-set.cmd")), true);
});
```

- [ ] **Step 2: Run the test and verify the missing-artifact failure**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: FAIL because `run-test-set.js` and `run-test-set.cmd` do not exist.

- [ ] **Step 3: Add minimal empty artifacts**

Create `run-test-set.js` with:

```js
// Behavioral implementation is added after its contract test.
```

Create `run-test-set.cmd` with:

```bat
@echo off
```

- [ ] **Step 4: Run the presence test and verify it passes**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: PASS with one test.

- [ ] **Step 5: Commit only Task 1 when valid Git history is restored**

```powershell
git add -- tests/placement-recommendation/run-test-set.test.js tests/placement-recommendation/run-test-set.js tests/placement-recommendation/run-test-set.cmd
git commit -m "test: establish placement recommendation runner entrypoints"
```

### Task 2: Define modes and focused test commands

**Files:**
- Modify: `tests/placement-recommendation/run-test-set.test.js`
- Modify: `tests/placement-recommendation/run-test-set.js`

**Interfaces:**
- Produces: `parseMode(argv: string[]) -> "core" | "ui" | "all"`.
- Produces: `buildCommands(mode) -> Array<{ label: string, command: string, args: string[] }>`.
- Consumes: `process.execPath` for the current Node.js executable.

- [ ] **Step 1: Add failing mode and command-definition tests**

Append to `run-test-set.test.js`:

```js
test("runner defaults to all and accepts core or ui", async () => {
  const { parseMode } = await import("./run-test-set.js");
  assert.equal(parseMode([]), "all");
  assert.equal(parseMode(["core"]), "core");
  assert.equal(parseMode(["ui"]), "ui");
  assert.throws(() => parseMode(["other"]), /core\|ui\|all/);
});

test("core mode selects the focused recommendation files", async () => {
  const { buildCommands } = await import("./run-test-set.js");
  const commands = buildCommands("core");
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].args.slice(0, 2), ["--test", "tests/recommendation.test.js"]);
  for (const file of [
    "tests/planning.test.js",
    "tests/strategy-scorer.test.js",
    "tests/constraints.test.js",
    "tests/cp-sat-adapter.test.js",
    "tests/cp-sat-integration.test.js",
    "tests/cp-sat-slots.test.js",
    "tests/migration-planner.test.js",
    "tests/rack-layout.test.js",
    "tests/api.test.js",
    "tests/api-v02.test.js",
    "tests/plan-service.test.js",
  ]) {
    assert.ok(commands[0].args.includes(file), `${file} must be included`);
  }
});

test("ui mode uses the existing E2E stack and limits execution to placement cases", async () => {
  const { buildCommands } = await import("./run-test-set.js");
  const [command] = buildCommands("ui");
  assert.equal(command.args[0], "scripts/run-e2e.js");
  assert.ok(command.args.includes("tests/e2e/closed-loops.spec.js"));
  assert.ok(command.args.includes("--grep"));
  assert.match(command.args.at(-1), /placement|10U|viewer/);
});

test("all mode runs core before ui", async () => {
  const { buildCommands } = await import("./run-test-set.js");
  assert.deepEqual(buildCommands("all").map((item) => item.label), [
    "推荐上架核心与接口测试",
    "推荐上架浏览器 UI 测试",
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify the missing-export failure**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: FAIL because `parseMode` and `buildCommands` are not exported.

- [ ] **Step 3: Implement pure mode and command selection**

Replace `run-test-set.js` with:

```js
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modes = new Set(["core", "ui", "all"]);

const coreFiles = [
  "tests/recommendation.test.js",
  "tests/planning.test.js",
  "tests/strategy-scorer.test.js",
  "tests/constraints.test.js",
  "tests/cp-sat-adapter.test.js",
  "tests/cp-sat-integration.test.js",
  "tests/cp-sat-slots.test.js",
  "tests/migration-planner.test.js",
  "tests/rack-layout.test.js",
  "tests/api.test.js",
  "tests/api-v02.test.js",
  "tests/plan-service.test.js",
];

const placementUiPattern = [
  "placement",
  "10U server",
  "viewer can inspect",
].join("|");

export function parseMode(argv) {
  const mode = argv[0] ?? "all";
  if (!modes.has(mode) || argv.length > 1) {
    throw new Error("Usage: run-test-set.js [core|ui|all]");
  }
  return mode;
}

export function buildCommands(mode) {
  const core = {
    label: "推荐上架核心与接口测试",
    command: process.execPath,
    args: ["--test", ...coreFiles],
  };
  const ui = {
    label: "推荐上架浏览器 UI 测试",
    command: process.execPath,
    args: [
      "scripts/run-e2e.js",
      "tests/e2e/closed-loops.spec.js",
      "--grep",
      placementUiPattern,
    ],
  };
  if (mode === "core") return [core];
  if (mode === "ui") return [ui];
  if (mode === "all") return [core, ui];
  throw new Error(`Unsupported mode: ${mode}`);
}
```

The imported `spawn` and `repositoryRoot` are intentionally consumed in Task 3.

- [ ] **Step 4: Run the contract tests and verify they pass**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: PASS with five tests.

- [ ] **Step 5: Commit only Task 2 when valid Git history is restored**

```powershell
git add -- tests/placement-recommendation/run-test-set.test.js tests/placement-recommendation/run-test-set.js
git commit -m "feat: define placement recommendation test modes"
```

### Task 3: Execute commands sequentially and propagate failures

**Files:**
- Modify: `tests/placement-recommendation/run-test-set.test.js`
- Modify: `tests/placement-recommendation/run-test-set.js`

**Interfaces:**
- Produces: `runCommands(commands, spawnProcess?) -> Promise<number>`.
- Produces: `main(argv?) -> Promise<number>` and executable CLI behavior.
- Consumes: command objects returned by `buildCommands(mode)`.

- [ ] **Step 1: Add failing execution-order and exit-code tests**

Append to `run-test-set.test.js`:

```js
test("runner executes commands in order and stops at the first failure", async () => {
  const { runCommands } = await import("./run-test-set.js");
  const calls = [];
  const exits = [0, 7, 0];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    const listeners = new Map();
    queueMicrotask(() => listeners.get("exit")?.(exits[calls.length - 1]));
    return { once: (event, listener) => listeners.set(event, listener) };
  };
  const commands = ["one", "two", "three"].map((label) => ({
    label,
    command: process.execPath,
    args: [label],
  }));
  assert.equal(await runCommands(commands, fakeSpawn), 7);
  assert.deepEqual(calls.map((item) => item.args[0]), ["one", "two"]);
  assert.ok(calls.every((item) => item.options.stdio === "inherit"));
});
```

- [ ] **Step 2: Run the test and verify `runCommands` is missing**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: FAIL because `runCommands` is not exported.

- [ ] **Step 3: Implement sequential execution and the CLI guard**

Append to `run-test-set.js`:

```js
export async function runCommands(commands, spawnProcess = spawn) {
  for (const item of commands) {
    console.log(`\n=== ${item.label} ===`);
    const exitCode = await new Promise((resolveExit, reject) => {
      const child = spawnProcess(item.command, item.args, {
        cwd: repositoryRoot,
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  return runCommands(buildCommands(parseMode(argv)));
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Run the runner unit tests and verify they pass**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: PASS with six tests.

- [ ] **Step 5: Commit only Task 3 when valid Git history is restored**

```powershell
git add -- tests/placement-recommendation/run-test-set.test.js tests/placement-recommendation/run-test-set.js
git commit -m "feat: execute recommendation test commands sequentially"
```

### Task 4: Implement and validate the Windows command wrapper

**Files:**
- Modify: `tests/placement-recommendation/run-test-set.test.js`
- Modify: `tests/placement-recommendation/run-test-set.cmd`

**Interfaces:**
- Produces: `run-test-set.cmd [core|ui|all]`.
- Consumes: colocated `run-test-set.js` and forwards its process exit code.

- [ ] **Step 1: Add a failing static wrapper contract test**

Append to `run-test-set.test.js`:

```js
test("BUG-20260807-001 Windows wrapper keeps direct-launch results visible and supports automation", () => {
  const source = readFileSync(resolve(here, "run-test-set.cmd"), "utf8");
  assert.match(source, /%~dp0run-test-set\.js/);
  assert.match(source, /%\*/);
  assert.match(source, /--no-pause/);
  assert.match(source, /pause/);
  assert.match(source, /exit \/b/);
});
```

Update the existing `node:fs` import to:

```js
import { existsSync, readFileSync } from "node:fs";
```

- [ ] **Step 2: Run the test and verify the empty wrapper fails**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: FAIL because the wrapper does not delegate to the Node script.

- [ ] **Step 3: Implement the command wrapper**

Replace `run-test-set.cmd` with:

```bat
@echo off
setlocal
if /I "%~1"=="--no-pause" goto :no_pause

node "%~dp0run-test-set.js" %*
set "PLACEMENT_TEST_EXIT=%ERRORLEVEL%"
echo.
echo Test run finished with exit code %PLACEMENT_TEST_EXIT%.
pause
goto :finish

:no_pause
node "%~dp0run-test-set.js" %~2
set "PLACEMENT_TEST_EXIT=%ERRORLEVEL%"

:finish
endlocal & exit /b %PLACEMENT_TEST_EXIT%
```

- [ ] **Step 4: Run all launcher contract tests**

Run: `node --test tests/placement-recommendation/run-test-set.test.js`

Expected: PASS with seven tests.

- [ ] **Step 5: Commit only Task 4 when valid Git history is restored**

```powershell
git add -- tests/placement-recommendation/run-test-set.test.js tests/placement-recommendation/run-test-set.cmd
git commit -m "feat: add Windows recommendation test command"
```

### Task 5: Verify the real focused test set

**Files:**
- Inspect: `tests/placement-recommendation/run-test-set.js`
- Inspect: `tests/placement-recommendation/run-test-set.cmd`

**Interfaces:**
- Consumes: both user-facing entrypoints.
- Produces: verified command behavior against the repository's real tests.

- [ ] **Step 1: Run the core mode through Node**

Run: `node tests/placement-recommendation/run-test-set.js core`

Expected: all focused recommendation, planning, constraint, API, and plan-service tests pass; any real regression returns a non-zero exit code and remains visible.

- [ ] **Step 2: Run the core mode through the Windows wrapper**

Run: `tests\placement-recommendation\run-test-set.cmd --no-pause core`

Expected: the same focused tests pass and the wrapper returns exit code 0.

- [ ] **Step 3: Run the UI mode**

Run: `tests\placement-recommendation\run-test-set.cmd --no-pause ui`

Expected: the existing E2E stack starts, placement-related browser cases run, and Playwright returns exit code 0. If the local Edge/Chromium runtime is unavailable, report the environment failure without weakening the command.

- [ ] **Step 4: Run the repository unit suite to detect runner regressions**

Run: `npm.cmd test`

Expected: all unit tests pass, with only documented environment-gated solver skips allowed.

- [ ] **Step 5: Commit the verified entrypoints when valid Git history is restored**

```powershell
git add -- tests/placement-recommendation/run-test-set.test.js tests/placement-recommendation/run-test-set.js tests/placement-recommendation/run-test-set.cmd docs/superpowers/plans/2026-08-07-placement-recommendation-test-runner.md
git commit -m "test: add placement recommendation test launcher"
```

## Self-Review

- Spec coverage: Node launcher, Windows command file, core/API mode, UI mode, combined default mode, argument forwarding, repository-root resolution, visible child output, fail-fast execution, and exit-code propagation are covered.
- Placeholder scan: no deferred implementation markers or unspecified code steps remain.
- Type consistency: `parseMode`, `buildCommands`, `runCommands`, and `main` retain the same signatures across all tasks.
- Scope: this plan delivers the requested execution entrypoint against existing tests; structure, lifecycle governance, and additional scenario implementation remain governed by the approved suite design and are not silently bundled into this runner increment.
