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
  vm.runInContext(read("src/balance-guard.js"), context);
  return vm.runInContext(`JSON.stringify(${expression})`, context);
}

function json(expression) {
  const raw = run(expression);
  return raw === undefined ? undefined : JSON.parse(raw);
}

const erro = details => {
  const body = details === undefined ? "" : `error.details = ${JSON.stringify(details)};`;
  return `(() => { const error = new Error("SALDO_NEGATIVO"); ${body} return error; })()`;
};

const ITENS = [{ name: "Milho moído", balance: 200, needed: 500, result: -300 }];

test("reconhece o erro do banco e devolve os itens", () => {
  assert.deepEqual(json(`SupBalance.parseNegativeError(${erro(JSON.stringify({ items: ITENS }))})`), ITENS);
});

test("erro comum não vira confirmação de saldo negativo", () => {
  assert.equal(json('SupBalance.parseNegativeError(new Error("Sem permissão para ajustar estoque."))'), null);
});

test("detail ausente ou inválido não quebra", () => {
  assert.deepEqual(json(`SupBalance.parseNegativeError(${erro()})`), []);
  assert.deepEqual(json(`SupBalance.parseNegativeError(${erro("{isso não é json")})`), []);
});

test("mensagem tem uma linha por item, com saldo e resultado", () => {
  const texto = json(`SupBalance.negativeConfirmMessage(${JSON.stringify([
    ...ITENS,
    { name: "Ureia", balance: 0, needed: 50, result: -50 }
  ])})`);
  assert.match(texto, /Milho moído: saldo 200 kg, saída 500 kg, fica -300 kg/);
  assert.match(texto, /Ureia: saldo 0 kg, saída 50 kg, fica -50 kg/);
  assert.match(texto, /Confirmar mesmo assim\?/);
});

test("mensagem sem itens ainda pergunta", () => {
  assert.match(json("SupBalance.negativeConfirmMessage([])"), /Confirmar mesmo assim\?/);
});
