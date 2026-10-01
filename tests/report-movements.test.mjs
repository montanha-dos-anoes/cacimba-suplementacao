import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({
    farmDateTimeBR: value => `data:${value}`,
    STOCK_KINDS: { entry: "Entrada", consumption: "Consumo", yield: "Produção", feeding: "Trato", sale: "Venda", reversal: "Estorno", adjustment: "Ajuste" }
  });
  vm.runInContext(read("src/reports.js"), context);
  return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

const PRODUCTS = JSON.stringify([
  { id: "p3", name: "Sal mineral", active: true },
  { id: "p1", name: "Milho", active: true },
  { id: "p2", name: "Proteinado", active: true },
  { id: "p4", name: "Farelo antigo", active: false }
]);

test("entradas oferecem só os tipos que aumentam o estoque", () => {
  assert.deepEqual(run('movementKindsFor("in")'), ["entry", "yield", "reversal", "adjustment"]);
});

test("saídas oferecem só os tipos que baixam o estoque", () => {
  assert.deepEqual(run('movementKindsFor("out")'), ["consumption", "feeding", "sale", "reversal", "adjustment"]);
});

test("todas oferecem os sete tipos de movimento", () => {
  assert.deepEqual(run('movementKindsFor("all")'), ["entry", "yield", "consumption", "feeding", "sale", "reversal", "adjustment"]);
});

test("matérias-primas são os produtos sem fórmula ativa, em ordem alfabética", () => {
  const list = run(`reportCategoryProducts(${PRODUCTS}, ["p2"], "raw")`);
  assert.deepEqual(list.map(item => item.id), ["p4", "p1", "p3"]);
});

test("suplementos são os produtos com fórmula ativa", () => {
  const list = run(`reportCategoryProducts(${PRODUCTS}, ["p2"], "supplement")`);
  assert.deepEqual(list.map(item => item.id), ["p2"]);
});

test("produto inativo continua na lista de itens, marcado", () => {
  const list = run(`reportCategoryProducts(${PRODUCTS}, ["p2"], "raw")`);
  assert.equal(list.find(item => item.id === "p4").label, "Farelo antigo (inativo)");
  assert.equal(list.find(item => item.id === "p1").label, "Milho");
});

test("entradas filtram quantidade positiva e saídas negativa", () => {
  assert.equal(run('movementQueryPlan({ direction: "in", category: "raw", itemIds: [], kinds: [], supplementIds: [] })').sign, "positive");
  assert.equal(run('movementQueryPlan({ direction: "out", category: "raw", itemIds: [], kinds: [], supplementIds: [] })').sign, "negative");
  assert.equal(run('movementQueryPlan({ direction: "all", category: "raw", itemIds: [], kinds: [], supplementIds: [] })').sign, null);
});

test("tipo marcado que não pertence à direção é ignorado", () => {
  const plan = run('movementQueryPlan({ direction: "in", category: "raw", itemIds: [], kinds: ["sale", "entry"], supplementIds: [] })');
  assert.deepEqual(plan.kinds, ["entry"]);
});

test("itens marcados viram o filtro de produto", () => {
  const plan = run('movementQueryPlan({ direction: "out", category: "raw", itemIds: ["p1"], kinds: ["sale"], supplementIds: ["p2"] })');
  assert.deepEqual(plan.product, { op: "in", ids: ["p1"] });
  assert.deepEqual(plan.kinds, ["sale"]);
});

test("matéria-prima sem item marcado exclui os suplementos", () => {
  const plan = run('movementQueryPlan({ direction: "all", category: "raw", itemIds: [], kinds: [], supplementIds: ["p2"] })');
  assert.deepEqual(plan.product, { op: "not_in", ids: ["p2"] });
});

test("matéria-prima sem nenhum suplemento cadastrado não filtra produto", () => {
  const plan = run('movementQueryPlan({ direction: "all", category: "raw", itemIds: [], kinds: [], supplementIds: [] })');
  assert.deepEqual(plan.product, { op: "any", ids: [] });
});

test("suplemento sem item marcado filtra pelos produtos com fórmula", () => {
  const plan = run('movementQueryPlan({ direction: "all", category: "supplement", itemIds: [], kinds: [], supplementIds: ["p2"] })');
  assert.deepEqual(plan.product, { op: "in", ids: ["p2"] });
});

test("suplemento sem nenhuma fórmula cadastrada não traz nada", () => {
  const plan = run('movementQueryPlan({ direction: "all", category: "supplement", itemIds: [], kinds: [], supplementIds: [] })');
  assert.deepEqual(plan.product, { op: "none", ids: [] });
});

test("título descreve os filtros escolhidos", () => {
  assert.equal(
    run('movementFilterLabel({ direction: "out", category: "raw", itemNames: ["Milho"], kindLabels: ["Venda"] })'),
    "Saídas · Matérias-primas · Milho · Venda"
  );
  assert.equal(
    run('movementFilterLabel({ direction: "all", category: "supplement", itemNames: [], kindLabels: [] })'),
    "Entradas e saídas · Suplementos"
  );
  assert.equal(
    run('movementFilterLabel({ direction: "in", category: "raw", itemNames: ["Milho", "Farelo"], kindLabels: [] })'),
    "Entradas · Matérias-primas · Milho, Farelo"
  );
});

test("entradas e saídas mostram a quantidade sem sinal; todas mantêm o sinal", () => {
  const row = '{ occurred_at: "x", kind: "sale", quantity_kg: -150, unit_cost: 2, suplementacao_products: { name: "Milho" } }';
  assert.equal(run(`movementReportRow(${row}, "out")`).Quantidade, 150);
  assert.equal(run(`movementReportRow(${row}, "all")`).Quantidade, -150);
  assert.equal(run(`movementReportRow(${row}, "out")`).Tipo, "Venda");
});

test("fabricação traz custo por kg ao lado do custo total", () => {
  const row = run('productionReportRow({ occurred_at: "x", quantity_kg: 500, total_cost: 1250, suplementacao_production_items: [] })');
  assert.equal(row["Custo total"], 1250);
  assert.equal(row["Custo por kg"], 2.5);
  const keys = Object.keys(row);
  assert.equal(keys.indexOf("Custo por kg"), keys.indexOf("Custo total") + 1);
});

test("fabricação sem quantidade tem custo por kg zero", () => {
  const row = run('productionReportRow({ occurred_at: "x", quantity_kg: 0, total_cost: 100, suplementacao_production_items: [] })');
  assert.equal(row["Custo por kg"], 0);
});
