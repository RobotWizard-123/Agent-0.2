import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "data");

export function readJson(name) {
  return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
}

export function writeJson(name, value) {
  writeFileSync(join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadData() {
  return {
    topology: readJson("topology.json"),
    cabinets: readJson("cabinets.json"),
    servers: readJson("servers.json"),
    batches: readJson("batches.json"),
    deployments: readJson("deployments.json"),
  };
}

export function saveData(data) {
  writeJson("servers.json", data.servers ?? []);
  writeJson("batches.json", data.batches ?? []);
  writeJson("deployments.json", data.deployments ?? []);
}
