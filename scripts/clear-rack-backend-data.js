import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const operationalFields = [
  "devices",
  "power_connections",
  "network_connections",
];

const legacyCollectionFiles = [
  "servers.json",
  "batches.json",
  "deployments.json",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

export function clearRackBackendData({ projectRoot } = {}) {
  const root = projectRoot ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const dataDirectory = join(root, "data");
  const runtimeStatePath = join(dataDirectory, "runtime", "state.json");
  const seedStatePath = join(dataDirectory, "seed", "state.json");
  const sourceStatePath = existsSync(runtimeStatePath) ? runtimeStatePath : seedStatePath;

  if (!existsSync(sourceStatePath)) {
    throw Object.assign(new Error(`Rack state does not exist: ${sourceStatePath}`), {
      code: "RACK_STATE_MISSING",
    });
  }

  const current = readJson(sourceStatePath);
  const seed = readJson(seedStatePath);
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw Object.assign(new Error(`Rack state is invalid: ${sourceStatePath}`), {
      code: "RACK_STATE_INVALID",
    });
  }

  const cleared = structuredClone(current);
  cleared.version = Number.isInteger(current.version) ? current.version + 1 : 1;
  if (!Array.isArray(cleared.racks) || cleared.racks.length === 0) {
    if (!Array.isArray(seed.racks) || seed.racks.length === 0) {
      throw Object.assign(new Error(`Seed rack structure is invalid: ${seedStatePath}`), {
        code: "RACK_SEED_INVALID",
      });
    }
    cleared.racks = structuredClone(seed.racks);
  }
  for (const field of operationalFields) cleared[field] = [];
  writeJson(runtimeStatePath, cleared);

  for (const filename of legacyCollectionFiles) {
    writeJson(join(dataDirectory, filename), []);
  }

  return {
    runtime_state_cleared: true,
    cleared_fields: [...operationalFields],
    cleared_legacy_files: [...legacyCollectionFiles],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = clearRackBackendData();
  console.log(`Rack backend data cleared: ${result.cleared_fields.length} runtime collections and ${result.cleared_legacy_files.length} legacy files.`);
}
