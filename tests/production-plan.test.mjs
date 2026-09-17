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
  vm.runInContext(read("src/formulas.js"), context);
  vm.runInContext(read("src/production.js"), context);
  return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

const ITENS = JSON.stringify([
  { item_id: "milho", unit: "percent", amount: 45 },
  { item_id: "sal", unit: "percent", amount: 12 }
]);
const SALDOS = JSON.stringify({ milho: 5000, sal: 400 });

test("plano mostra consumo e saldo antes e depois", () => {
  const plan = run(`productionPlan(${ITENS}, 100, 5000, ${SALDOS})`);
  assert.deepEqual(plan, [
    { item_id: "milho", quantity: 2250, before: 5000, after: 2750, missing: false },
    { item_id: "sal", quantity: 600, before: 400, after: -200, missing: true }
  ]);
});

test("insumo sem saldo cadastrado conta como zero", () => {
  const plan = run(`productionPlan(${ITENS}, 100, 1000, {})`);
  assert.deepEqual(plan.map(line => [line.before, line.after, line.missing]), [
    [0, -450, true],
    [0, -120, true]
  ]);
});

test("quantidade a produzir inválida devolve plano vazio", () => {
  assert.deepEqual(run(`productionPlan(${ITENS}, 100, 0, ${SALDOS})`), []);
  assert.deepEqual(run(`productionPlan([], 100, 500, ${SALDOS})`), []);
});

test("fórmula antiga em kg continua escalando certo", () => {
  const antiga = JSON.stringify([{ item_id: "milho", unit: "kg", amount: 450 }]);
  const plan = run(`productionPlan(${antiga}, 1000, 2000, { milho: 1000 })`);
  assert.deepEqual(plan, [{ item_id: "milho", quantity: 900, before: 1000, after: 100, missing: false }]);
});
