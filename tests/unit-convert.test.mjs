import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({});
  vm.runInContext(read("src/units.js"), context);
  return vm.runInContext(expression, context);
}

test("formatKg formata em kg no padrão brasileiro", () => {
  assert.equal(run("SupUnits.formatKg(1200)"), "1.200 kg");
  assert.equal(run("SupUnits.formatKg(0.125)"), "0,125 kg");
});

test("formatKg preserva o sinal de saldo negativo", () => {
  assert.equal(run("SupUnits.formatKg(-300)"), "-300 kg");
});

test("não existe mais unidade além de kg", () => {
  const api = run("Object.keys(SupUnits)");
  assert.deepEqual([...api], ["formatKg"]);
});
