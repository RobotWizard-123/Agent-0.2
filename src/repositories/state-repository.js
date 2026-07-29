import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function clone(value) {
  return structuredClone(value);
}

function readState(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function versionConflict(expectedVersion, actualVersion) {
  return Object.assign(new Error(`State version changed from ${expectedVersion} to ${actualVersion}`), {
    code: "STATE_VERSION_CONFLICT",
    expected_version: expectedVersion,
    actual_version: actualVersion,
  });
}

function assertVersion(state, expectedVersion) {
  if (state.version !== expectedVersion) {
    throw versionConflict(expectedVersion, state.version);
  }
}

function nextState(current, mutator) {
  const draft = clone(current);
  mutator(draft);
  draft.version = current.version + 1;
  return draft;
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export function createMemoryRepository(initialState) {
  const seed = clone(initialState);
  let state = clone(initialState);

  return {
    read() {
      return clone(state);
    },
    mutate(expectedVersion, mutator) {
      assertVersion(state, expectedVersion);
      state = nextState(state, mutator);
      return clone(state);
    },
    reset() {
      state = clone(seed);
      return clone(state);
    },
  };
}

export function createJsonRepository({ seedPath, statePath }) {
  if (!existsSync(seedPath)) {
    throw Object.assign(new Error(`Seed state does not exist: ${seedPath}`), { code: "SEED_STATE_MISSING" });
  }

  if (!existsSync(statePath)) {
    atomicWriteJson(statePath, readState(seedPath));
  }

  return {
    read() {
      return clone(readState(statePath));
    },
    mutate(expectedVersion, mutator) {
      const current = readState(statePath);
      assertVersion(current, expectedVersion);
      const changed = nextState(current, mutator);
      atomicWriteJson(statePath, changed);
      return clone(changed);
    },
    reset() {
      const seed = readState(seedPath);
      atomicWriteJson(statePath, seed);
      return clone(seed);
    },
  };
}
