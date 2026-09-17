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
  vm.runInContext(read("src/units.js"), context);
  return vm.runInContext(expression, context);
}

const SACA = '{ display_unit: "sc", display_unit_kg: 60 }';
const OLEO = '{ display_unit: "L", display_unit_kg: 0.92 }';
const OLEO_PADRAO = '{ display_unit: "L", display_unit_kg: 0.92, display_unit_primary: true }';
const SO_KG = '{ display_unit: null, display_unit_kg: null }';

test("kg é identidade em qualquer produto", () => {
  assert.equal(run(`SupUnits.toKg(120, "kg", ${SACA})`), 120);
  assert.equal(run(`SupUnits.fromKg(120, "kg", ${SACA})`), 120);
  assert.equal(run(`SupUnits.toKg(50, "kg", ${SO_KG})`), 50);
});

test("unidade de exibição multiplica e divide pelo peso equivalente", () => {
  assert.equal(run(`SupUnits.toKg(2, "sc", ${SACA})`), 120);
  assert.equal(run(`SupUnits.fromKg(120, "sc", ${SACA})`), 2);
  assert.equal(run(`SupUnits.toKg(200, "L", ${OLEO})`), 184);
});

test("unidade desconhecida é tratada como kg", () => {
  assert.equal(run(`SupUnits.toKg(10, "bombona", ${SACA})`), 10);
  assert.equal(run(`SupUnits.fromKg(10, "bombona", ${SO_KG})`), 10);
});

test("unitOptions oferece kg sempre e a unidade de exibição quando existe", () => {
  assert.deepEqual(run(`SupUnits.unitOptions(${SO_KG})`), [{ value: "kg", label: "kg" }]);
  assert.deepEqual(run(`SupUnits.unitOptions(${SACA})`), [
    { value: "kg", label: "kg" },
    { value: "sc", label: "sc" }
  ]);
});

test("formatQuantity mostra a segunda unidade só quando há unidade de exibição", () => {
  assert.deepEqual(run(`SupUnits.formatQuantity(1200, ${SO_KG})`), { main: "1.200 kg", secondary: "" });
});

test("kg é o destaque enquanto a outra unidade não for marcada como padrão", () => {
  assert.deepEqual(run(`SupUnits.formatQuantity(184, ${OLEO})`), { main: "184 kg", secondary: "= 200 L" });
});

test("marcando a unidade como padrão, ela vira o destaque e o kg vai para baixo", () => {
  assert.deepEqual(run(`SupUnits.formatQuantity(184, ${OLEO_PADRAO})`), { main: "200 L", secondary: "= 184 kg" });
});

test("formatQuantity preserva o sinal de saldo negativo", () => {
  assert.deepEqual(run(`SupUnits.formatQuantity(-300, ${SO_KG})`), { main: "-300 kg", secondary: "" });
});
