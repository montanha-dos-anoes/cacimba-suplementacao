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
  vm.runInContext("const esc = s => String(s ?? '');", context);
  vm.runInContext(read("src/masters.js"), context);
  return vm.runInContext(expression, context);
}

const PRODUTOS = JSON.stringify([
  { id: "1", name: "Ureia" },
  { id: "2", name: "Proteinado 0,3" },
  { id: "3", name: "Milho moído" },
  { id: "4", name: "Ração engorda" }
]);
const FABRICADOS = JSON.stringify(["2", "4"]);

test("fabricados vêm primeiro, em grupo próprio", () => {
  const html = run(`productSelectHtml(${PRODUTOS}, ${FABRICADOS})`);
  assert.ok(html.indexOf("Fabricados") < html.indexOf("Comprados"), "grupo dos fabricados tem que vir antes");
  assert.ok(html.indexOf("Proteinado 0,3") < html.indexOf("Milho moído"), "produto fabricado tem que vir antes do comprado");
});

test("cada grupo sai em ordem alfabética", () => {
  const html = run(`productSelectHtml(${PRODUTOS}, ${FABRICADOS})`);
  assert.ok(html.indexOf("Proteinado 0,3") < html.indexOf("Ração engorda"));
  assert.ok(html.indexOf("Milho moído") < html.indexOf("Ureia"));
});

test("sem fabricado, não cria grupo vazio", () => {
  const html = run(`productSelectHtml(${PRODUTOS}, [])`);
  assert.doesNotMatch(html, /Fabricados/);
  assert.match(html, /Milho moído/);
});

test("sem produto nenhum, avisa em vez de vir vazio", () => {
  assert.match(run("productSelectHtml([], [])"), /Nenhum produto cadastrado/);
});
