import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyDemoState } from "../src/demo-state.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const seedDirectory = join(projectRoot, "data", "seed");
const runtimeDirectory = join(projectRoot, "data", "runtime");
const json = `${JSON.stringify(createEmptyDemoState(), null, 2)}\n`;
const seedOnly = process.argv.includes("--seed-only");

mkdirSync(seedDirectory, { recursive: true });
writeFileSync(join(seedDirectory, "state.json"), json, "utf8");
if (!seedOnly) {
  mkdirSync(runtimeDirectory, { recursive: true });
  writeFileSync(join(runtimeDirectory, "state.json"), json, "utf8");
}

console.log(seedOnly
  ? "Empty canonical L5-A2-08 seed regenerated; runtime state was preserved."
  : "Demo state reset to the empty canonical L5-A2-08 seed.");
