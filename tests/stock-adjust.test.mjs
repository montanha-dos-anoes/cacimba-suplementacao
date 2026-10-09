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
  vm.runInContext(read("src/stock-manage.js"), context);
  return vm.runInContext(expression, context);
}

test("aumentar soma e diminuir subtrai do saldo", () => {
  assert.equal(run("adjustedBalance(100, 25, 1)"), 125);
  assert.equal(run("adjustedBalance(100, 25, -1)"), 75);
  assert.equal(run("adjustedBalance(10, 25, -1)"), -15);
  assert.equal(run("adjustedBalance(0.1, 0.2, 1)"), 0.3);
});

test("a aba Corrigir fica ao lado do Histórico e usa ajuste com sinal, não entrada nem venda", () => {
  const manage = read("src/stock-manage.js");
  assert.match(manage, /id: "corrigir", label: "Corrigir"[^\n]*\n\s*\{ id: "historico"/);
  const corrigir = manage.slice(manage.indexOf("function renderStockAdjust"), manage.indexOf("function renderStockEdit"));
  assert.match(corrigir, /suplementacao_adjust_stock/);
  assert.match(corrigir, /p_quantity: adjustDirection \* quantity/);
  assert.match(corrigir, /runWithNegativeConfirm/);
  assert.doesNotMatch(corrigir, /suplementacao_add_stock_entry|suplementacao_sell_stock/);
});

test("a baixa não oferece mais correção, que foi para a aba própria", () => {
  const manage = read("src/stock-manage.js");
  const baixa = manage.slice(manage.indexOf("function renderStockExit"), manage.indexOf("let adjustDirection"));
  assert.doesNotMatch(baixa, /value="fix"/);
});
