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
  vm.runInContext(read("src/ui.js"), context);
  return vm.runInContext(expression, context);
}

test("máscara descarta o que não é número", () => {
  assert.equal(run('sanitizeDecimal("abc12x3")'), "123");
  assert.equal(run('sanitizeDecimal("12kg")'), "12");
  assert.equal(run('sanitizeDecimal("-40")'), "40");
});

test("ponto digitado vira vírgula", () => {
  assert.equal(run('sanitizeDecimal("12.5")'), "12,5");
  assert.equal(run('sanitizeDecimal("12..5")'), "12,5");
});

test("com vírgula presente, ponto é separador de milhar e some", () => {
  assert.equal(run('sanitizeDecimal("1.234,56")'), "1234,56");
  assert.equal(run('sanitizeDecimal("1.234.567,8")'), "1234567,8");
});

test("só a primeira vírgula sobrevive", () => {
  assert.equal(run('sanitizeDecimal("12,5,7")'), "12,57");
});

test("vazio continua vazio e vírgula solta é preservada durante a digitação", () => {
  assert.equal(run('sanitizeDecimal("")'), "");
  assert.equal(run('sanitizeDecimal("12,")'), "12,");
});

test("decimalValue converte o texto da máscara em número", () => {
  assert.equal(run('decimalValue("1234,56")'), 1234.56);
  assert.equal(run('decimalValue("12,")'), 12);
  assert.equal(run('decimalValue("")'), 0);
  assert.equal(run('decimalValue("abc")'), 0);
});
