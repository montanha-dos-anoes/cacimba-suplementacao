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
  vm.runInContext(read("src/reports.js"), context);
  return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

const LINHAS = JSON.stringify([
  { Produto: "Milho moído", "Saldo (kg)": 1200, "Custo médio": 1.15, "Saldo negativo": "Não" },
  { Produto: "DDG", "Saldo (kg)": 500.5, "Custo médio": 2.4, "Saldo negativo": "Não" }
]);
const COLUNAS = JSON.stringify(["Produto", "Saldo (kg)", "Custo médio", "Saldo negativo"]);

test("tabela do PDF usa as colunas visíveis, na ordem", () => {
  const table = run(`buildReportTable(${LINHAS}, ${COLUNAS})`);
  assert.deepEqual(table.head, ["Produto", "Saldo (kg)", "Custo médio", "Saldo negativo"]);
  assert.equal(table.body.length, 2);
  assert.equal(table.body[0][0], "Milho moído");
});

test("número sai formatado em pt-BR e dinheiro com R$", () => {
  const table = run(`buildReportTable(${LINHAS}, ${COLUNAS})`);
  assert.equal(table.body[0][1], "1.200");
  assert.equal(table.body[1][1], "500,5");
  assert.equal(table.body[0][2].replace(/ /g, " "), "R$ 1,15");
});

test("colunas numéricas são marcadas para alinhar à direita", () => {
  const table = run(`buildReportTable(${LINHAS}, ${COLUNAS})`);
  assert.deepEqual(table.numericColumns, [1, 2]);
});

test("valor ausente vira célula vazia, não 'undefined'", () => {
  const table = run(`buildReportTable([{ Produto: "Sal" }], ${COLUNAS})`);
  assert.deepEqual(table.body[0], ["Sal", "", "", ""]);
});

test("sem linhas, a tabela vem vazia mas com cabeçalho", () => {
  const table = run(`buildReportTable([], ${COLUNAS})`);
  assert.deepEqual(table.body, []);
  assert.equal(table.head.length, 4);
});
