#!/usr/bin/env node
// WorkBuddy Dream Skin — validate every bundled theme.json against the schema.
// Usage: node scripts/check-theme-schemas.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTheme } from "../macos/scripts/theme-schema.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

async function main() {
  const presetsRoot = path.join(root, "macos", "presets");
  const entries = await fs.readdir(presetsRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && e.name.startsWith("preset-"));
  if (dirs.length === 0) {
    console.error("No preset directories found under macos/presets/");
    process.exit(1);
  }
  let failures = 0;
  for (const dir of dirs) {
    const themePath = path.join(presetsRoot, dir.name, "theme.json");
    let theme;
    try {
      theme = JSON.parse(await fs.readFile(themePath, "utf8"));
    } catch (error) {
      console.error(`✗ ${dir.name}: cannot read/parse theme.json (${error.message})`);
      failures += 1;
      continue;
    }
    const { valid, errors } = validateTheme(theme);
    if (valid) {
      console.log(`✓ ${dir.name}: theme.json valid`);
    } else {
      console.error(`✗ ${dir.name}:`);
      for (const err of errors) console.error(`    - ${err}`);
      failures += 1;
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} theme(s) failed validation.`);
    process.exit(1);
  }
  console.log(`\nAll ${dirs.length} bundled themes valid.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
