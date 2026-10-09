import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function context() {
  const scope = vm.createContext({});
  vm.runInContext(read("src/stock-manage.js"), scope);
  return scope;
}

function run(movements, opening) {
  const args = opening === undefined ? "" : `, ${JSON.stringify(opening)}`;
  return JSON.parse(vm.runInContext(
    `JSON.stringify(stockHistoryWithBalance(${JSON.stringify(movements)}${args}))`, context()));
}

function opening(totalKg, movements) {
  return JSON.parse(vm.runInContext(
    `JSON.stringify(openingBalanceKg(${totalKg}, ${JSON.stringify(movements)}))`, context()));
}

const MOVS = [
  { occurred_at: "2026-09-10T12:00:00Z", quantity_kg: -500 },
  { occurred_at: "2026-09-05T12:00:00Z", quantity_kg: -300 },
  { occurred_at: "2026-09-01T12:00:00Z", quantity_kg: 1000 }
];

test("saldo acumulado soma do mais antigo pro mais novo", () => {
  assert.deepEqual(run(MOVS).map(row => row.balance_after), [200, 700, 1000]);
});

test("a lista continua do mais novo pro mais antigo", () => {
  assert.deepEqual(run(MOVS).map(row => row.quantity_kg), [-500, -300, 1000]);
});

test("saldo acumulado pode ficar negativo", () => {
  const rows = run([
    { occurred_at: "2026-09-02T12:00:00Z", quantity_kg: -50 },
    { occurred_at: "2026-09-01T12:00:00Z", quantity_kg: 20 }
  ]);
  assert.deepEqual(rows.map(row => row.balance_after), [-30, 20]);
});

test("lista vazia devolve lista vazia", () => {
  assert.deepEqual(run([]), []);
});

test("o saldo parte da semente quando a janela não é o histórico inteiro", () => {
  const rows = run(MOVS, 5000);
  assert.deepEqual(rows.map(row => row.balance_after), [5200, 5700, 6000]);
});

test("a semente é o que ficou fora da janela de 100 movimentos", () => {
  assert.equal(opening(5200, MOVS), 5000);
});

test("sem movimento fora da janela a semente é zero", () => {
  assert.equal(opening(200, MOVS), 0);
});

test("o saldo mais recente fecha com o saldo do produto", () => {
  const total = 5200;
  const rows = run(MOVS, opening(total, MOVS));
  assert.equal(rows[0].balance_after, total);
});

test("movimento no mesmo instante desempata por created_at", () => {
  const rows = run([
    { id: "b", occurred_at: "2026-09-01T12:00:00Z", created_at: "2026-09-01T12:00:02Z", quantity_kg: -400 },
    { id: "a", occurred_at: "2026-09-01T12:00:00Z", created_at: "2026-09-01T12:00:01Z", quantity_kg: 1000 }
  ]);
  assert.deepEqual(rows.map(row => row.id), ["b", "a"]);
  assert.deepEqual(rows.map(row => row.balance_after), [600, 1000]);
});
