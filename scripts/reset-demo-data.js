import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoState } from "../src/demo-state.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const seedDirectory = join(projectRoot, "data", "seed");
const runtimeDirectory = join(projectRoot, "data", "runtime");
const json = `${JSON.stringify(createDemoState(), null, 2)}\n`;

mkdirSync(seedDirectory, { recursive: true });
mkdirSync(runtimeDirectory, { recursive: true });
writeFileSync(join(seedDirectory, "state.json"), json, "utf8");
writeFileSync(join(runtimeDirectory, "state.json"), json, "utf8");

console.log("Demo state reset to the canonical L5-A2-08 seed.");
