import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const SOURCES = [
  "src/config.js", "src/api.js", "src/state.js", "src/farm-time.js", "src/offline.js", "src/units.js", "src/balance-guard.js", "src/ui.js", "src/outbox.js", "src/nav.js",
  "src/modal.js", "src/datefield.js", "src/auth.js", "src/feeding.js", "src/masters.js", "src/lots.js", "src/stock.js", "src/stock-manage.js",
  "src/formulas.js", "src/production.js", "src/feeding-report.js", "src/reports.js", "src/home.js", "src/bootstrap.js"
];

const CREATED_AT_RUNTIME = /^sheet/;

test("todo elemento buscado por id no JavaScript existe no HTML", () => {
  const html = read("index.html");
  const declared = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const sources = SOURCES.map(read).join("\n");
  const used = new Set([...sources.matchAll(/\$\(\s*["']([A-Za-z][\w-]*)["']\s*\)/g)].map(match => match[1]));

  const missing = [...used].filter(id => !declared.has(id) && !CREATED_AT_RUNTIME.test(id));
  assert.deepEqual(missing, [], `ids usados no JS que não existem no HTML: ${missing.join(", ")}`);
});
