import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDemoState } from "../src/demo-state.js";
import { createJsonRepository, createMemoryRepository } from "../src/repositories/state-repository.js";

test("memory repository increments versions and rejects stale mutation", () => {
  const repository = createMemoryRepository(createDemoState());
  const changed = repository.mutate(1, (draft) => {
    draft.audit.push({ id: "A-1" });
  });

  assert.equal(changed.version, 2);
  assert.equal(changed.audit.length, 1);
  assert.throws(
    () => repository.mutate(1, () => {}),
    (error) => error.code === "STATE_VERSION_CONFLICT" && error.expected_version === 1 && error.actual_version === 2,
  );
});

test("memory repository reads clones and reset restores canonical state", () => {
  const repository = createMemoryRepository(createDemoState());
  const leaked = repository.read();
  leaked.room.name = "mutated outside repository";

  assert.equal(repository.read().room.name, "L5-A2-08 机房");
  repository.mutate(1, (draft) => {
    draft.service_health.model.status = "offline";
  });

  const reset = repository.reset();
  assert.equal(reset.version, 1);
  assert.equal(reset.service_health.model.status, "unknown");
});

test("JSON repository persists mutations and can restore the seed", () => {
  const directory = mkdtempSync(join(tmpdir(), "datacenter-repository-"));
  const seedPath = join(directory, "seed", "state.json");
  const statePath = join(directory, "runtime", "state.json");

  try {
    const seed = createDemoState();
    mkdirSync(join(directory, "seed"), { recursive: true });
    writeFileSync(seedPath, JSON.stringify(seed), { encoding: "utf8", flag: "wx" });
    const repository = createJsonRepository({ seedPath, statePath });

    repository.mutate(1, (draft) => {
      draft.audit.push({ id: "JSON-AUDIT" });
    });

    const reloaded = createJsonRepository({ seedPath, statePath });
    assert.equal(reloaded.read().version, 2);
    assert.equal(reloaded.read().audit[0].id, "JSON-AUDIT");
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).version, 2);

    const reset = reloaded.reset();
    assert.equal(reset.version, 1);
    assert.deepEqual(reset.audit, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
