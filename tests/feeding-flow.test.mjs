import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const LOTES = [
  { id: "L1", name: "Lote 1", active: true },
  { id: "L2", name: "Lote 2", active: true },
  { id: "L3", name: "Lote 3", active: false },
  { id: "L4", name: "Lote 4", active: true }
];
const VERSOES = [
  { id: "V1", lot_id: "L1", effective_from: "2026-09-01" },
  { id: "V2", lot_id: "L2", effective_from: "2026-09-01" },
  { id: "V3", lot_id: "L3", effective_from: "2026-09-01" },
  { id: "V2b", lot_id: "L2", effective_from: "2026-09-20" }
];
const GRUPOS = [
  { lot_version_id: "V1", category: "Novilha", quantity: 100, product_id: "PROT", expected_consumption_kg_head_day: 0.1 },
  { lot_version_id: "V2", category: "Garrote", quantity: 50, product_id: "PROT", expected_consumption_kg_head_day: 0.2 },
  { lot_version_id: "V3", category: "Vaca", quantity: 30, product_id: "PROT", expected_consumption_kg_head_day: 0.3 },
  { lot_version_id: "V2b", category: "Garrote", quantity: 50, product_id: "SAL", expected_consumption_kg_head_day: 0.05 }
];

function tela() {
  const elementos = {};
  const context = vm.createContext({
    Intl, Date, Number, JSON,
    $: id => (elementos[id] ||= { innerHTML: "", value: "", textContent: "", options: [] }),
    esc: value => String(value ?? "")
  });
  vm.runInContext(read("src/state.js"), context);
  vm.runInContext(read("src/farm-time.js"), context);
  vm.runInContext(read("src/units.js"), context);
  vm.runInContext(read("src/lots.js"), context);
  vm.runInContext(read("src/feeding.js"), context);
  vm.runInContext(`lots = ${JSON.stringify(LOTES)}; lotVersions = ${JSON.stringify(VERSOES)}; lotVersionGroups = ${JSON.stringify(GRUPOS)};`, context);
  return { run: expression => vm.runInContext(expression, context), elementos };
}

const ids = lista => [...lista].map(lot => lot.id);

test("escolhendo o suplemento, só aparecem os lotes ativos que recebem ele", () => {
  const { run } = tela();
  assert.deepEqual(ids(run(`feedingLotOptions("PROT", "2026-09-15")`)), ["L1", "L2"]);
});

test("sem suplemento escolhido, aparecem todos os lotes ativos", () => {
  const { run } = tela();
  assert.deepEqual(ids(run(`feedingLotOptions("", "2026-09-15")`)), ["L1", "L2", "L4"]);
});

test("o filtro respeita a vigência do lote na data do trato", () => {
  const { run } = tela();
  assert.deepEqual(ids(run(`feedingLotOptions("PROT", "2026-09-25")`)), ["L1"]);
  assert.deepEqual(ids(run(`feedingLotOptions("SAL", "2026-09-25")`)), ["L2"]);
});

test("o suplemento do trato é sempre o cadastrado no lote", () => {
  const { run } = tela();
  assert.equal(run(`lotSupplementId("L2", "2026-09-15")`), "PROT");
  assert.equal(run(`lotSupplementId("L2", "2026-09-25")`), "SAL");
  assert.equal(run(`lotSupplementId("L4", "2026-09-25")`), "");
});

test("escolher o lote já preenche a quantidade sugerida, editável", () => {
  const { run, elementos } = tela();
  elementos.occurred = { value: "2026-09-15T08:00" };
  elementos.lot = { value: "L1" };
  run("fillSuggestedQty()");
  assert.equal(elementos.qty.value, "10");
});

test("salvar usa o suplemento do lote, não o que estiver no filtro", () => {
  const feeding = read("src/feeding.js");
  const salvar = feeding.slice(feeding.indexOf("async function saveFeeding"), feeding.indexOf("const SALDO_MAX_AGE_MS"));
  assert.match(salvar, /lotSupplementId\(lotId,feedingDateISO\(\)\)/);
  assert.doesNotMatch(salvar, /product_id:\$\('product'\)\.value/);
});

test("a correção de trato também amarra o suplemento ao lote", () => {
  const feeding = read("src/feeding.js");
  const corrigir = feeding.slice(feeding.indexOf("function renderFeedingEdit"), feeding.indexOf("async function deleteFeeding"));
  assert.match(corrigir, /p_product_id:productId/);
  assert.doesNotMatch(corrigir, /<select id="sheetFeedProduct"/);
});
