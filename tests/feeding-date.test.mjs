import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({ Intl, Date, Number });
  vm.runInContext(read("src/farm-time.js"), context);
  vm.runInContext(read("src/feeding.js"), context);
  return vm.runInContext(expression, context);
}

const AGORA = 'new Date("2026-09-15T14:00:00-04:00")';
const erro = valor => run(`occurredError(${JSON.stringify(valor)}, ${AGORA})`);

test("trato no horário atual é aceito", () => {
  assert.equal(erro("2026-09-15T14:00"), "");
});

test("trato de duas horas atrás é aceito", () => {
  assert.equal(erro("2026-09-15T12:00"), "");
});

test("trato com data futura é recusado", () => {
  assert.equal(erro("2026-09-15T14:01"), "O trato não pode ter data ou hora no futuro.");
});

test("trato de mais de 24 horas atrás é recusado", () => {
  assert.equal(erro("2026-09-14T13:59"), "O trato só pode ser lançado até 24 horas para trás.");
});

test("exatamente 24 horas atrás ainda passa", () => {
  assert.equal(erro("2026-09-14T14:00"), "");
});

test("campo vazio é recusado", () => {
  assert.equal(erro(""), "Informe a data e a hora do trato.");
});

test("o futuro é medido no fuso da fazenda, não no do aparelho", () => {
  const limite = run(`occurredLimits(${AGORA})`);
  assert.equal(limite.max, "2026-09-15T14:00");
  assert.equal(limite.min, "2026-09-14T14:00");
});
