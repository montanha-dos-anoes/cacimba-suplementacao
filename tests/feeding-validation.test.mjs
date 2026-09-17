import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({ Intl, Date, Number, JSON });
  vm.runInContext(read("src/farm-time.js"), context);
  vm.runInContext(read("src/feeding.js"), context);
  return vm.runInContext(expression, context);
}

const COMPLETO = { lot: "L1", product: "P1", qty: "25", reading: "empty", occurred: "2026-09-15T10:00" };
const erros = campos => run(`feedingErrors(${JSON.stringify({ ...COMPLETO, ...campos })}, new Date("2026-09-15T14:00:00-04:00"))`);

test("formulário completo não tem erro", () => {
  assert.deepEqual(erros({}), []);
});

test("sem lote, diz que falta o lote — e só isso", () => {
  assert.deepEqual(erros({ lot: "" }), ["Escolha o lote."]);
});

test("sem produto, diz que falta o produto", () => {
  assert.deepEqual(erros({ product: "" }), ["Escolha o produto."]);
});

test("sem leitura do cocho, diz que falta a leitura", () => {
  assert.deepEqual(erros({ reading: null }), ["Escolha a leitura do cocho."]);
});

test("sem quantidade, diz que falta a quantidade", () => {
  assert.deepEqual(erros({ qty: "" }), ["Informe a quantidade em kg."]);
});

test("faltando três coisas, lista as três", () => {
  assert.deepEqual(erros({ lot: "", product: "", reading: null }), [
    "Escolha o lote.", "Escolha o produto.", "Escolha a leitura do cocho."
  ]);
});

test("zero kg é válido: o cocho estava cheio e nada foi colocado", () => {
  assert.deepEqual(erros({ qty: "0" }), []);
});

test("zero com vírgula também é válido", () => {
  assert.deepEqual(erros({ qty: "0,000" }), []);
});

test("quantidade negativa é recusada", () => {
  assert.deepEqual(erros({ qty: "-5" }), ["A quantidade não pode ser negativa."]);
});

test("a data errada entra na mesma lista, não numa mensagem separada", () => {
  assert.deepEqual(erros({ occurred: "2026-09-15T14:01" }), ["O trato não pode ter data ou hora no futuro."]);
});

test("saveFeeding usa a lista e não a mensagem genérica", () => {
  const feeding = read("src/feeding.js");
  const salvar = feeding.slice(feeding.indexOf("async function saveFeeding"), feeding.indexOf("async function loadProductStock"));
  assert.match(salvar, /feedingErrors\(/);
  assert.doesNotMatch(salvar, /Preencha lote, produto, quantidade e leitura do cocho/,
    "a mensagem genérica não diz o que está faltando");
});

test("existe migração que libera o trato de 0 kg no banco", () => {
  const sql = read("supabase/14-trato-zero.sql");
  assert.match(sql, /coalesce\(new\.quantity_kg, 0\) = 0/,
    "o gatilho precisa parar de criar movimento de estoque para trato zerado");
  assert.match(sql, /delete from public\.suplementacao_stock_movements where feeding_record_id = new\.id/,
    "corrigir um trato para 0 tem que apagar o movimento que existia");
  assert.doesNotMatch(sql, /drop constraint|alter column quantity_kg/,
    "movimento de estoque com 0 kg continua proibido; quem muda é o gatilho");
  assert.match(sql, /create or replace function public\._suplementacao_feeding_movement/);
});

test("o trato de 0 kg não é barrado pelo app antes de chegar ao banco", () => {
  const feeding = read("src/feeding.js");
  const salvar = feeding.slice(feeding.indexOf("async function saveFeeding"), feeding.indexOf("async function loadProductStock"));
  assert.doesNotMatch(salvar, /quantity_kg\s*<=\s*0|!decimalValue/,
    "zero é um lançamento válido: o cocho estava cheio");
});
