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
  { Produto: "Milho", "Saldo (kg)": 1200, "Custo médio": 1.15 },
  { Produto: "Proteinado energético 0,3 pastagem", "Saldo (kg)": 24000.5, "Custo médio": 2.8 }
]);

test("cada coluna nasce larga o bastante para o maior conteúdo", () => {
  const widths = run(`sheetColumnWidths(${LINHAS})`);
  assert.equal(widths.length, 3);
  assert.ok(widths[0].wch >= "Proteinado energético 0,3 pastagem".length, "coluna do produto estreita demais");
  assert.ok(widths[1].wch >= "Saldo (kg)".length + 2);
});

test("coluna nunca fica menor que um mínimo legível", () => {
  const widths = run('sheetColumnWidths([{ Sim: "ok" }])');
  assert.ok(widths[0].wch >= 12);
});

test("conteúdo gigante não estoura a largura", () => {
  const widths = run(`sheetColumnWidths([{ Obs: "${"x".repeat(300)}" }])`);
  assert.equal(widths[0].wch, 60);
});

test("data e número contam pelo texto que aparece na célula", () => {
  const widths = run('sheetColumnWidths([{ Data: "13/09/2026 01:45:00", Qtd: 1234.567 }])');
  assert.ok(widths[0].wch >= "13/09/2026 01:45:00".length);
  assert.ok(widths[1].wch >= 12);
});

test("relatório vazio não quebra", () => {
  assert.deepEqual(run("sheetColumnWidths([])"), []);
});
