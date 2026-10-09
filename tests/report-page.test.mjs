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

test("divide em páginas do tamanho pedido", () => {
  const page = run("paginate(57, 1, 25)");
  assert.equal(page.pages, 3);
  assert.equal(page.offset, 0);
  assert.equal(page.from, 1);
  assert.equal(page.to, 25);
});

test("última página traz só o que sobrou", () => {
  const page = run("paginate(57, 3, 25)");
  assert.equal(page.offset, 50);
  assert.equal(page.from, 51);
  assert.equal(page.to, 57);
});

test("página fora do intervalo é puxada de volta pro válido", () => {
  assert.equal(run("paginate(57, 99, 25)").page, 3);
  assert.equal(run("paginate(57, 0, 25)").page, 1);
  assert.equal(run("paginate(57, -5, 25)").page, 1);
});

test("total menor que uma página não pagina", () => {
  const page = run("paginate(2, 1, 25)");
  assert.equal(page.pages, 1);
  assert.equal(page.from, 1);
  assert.equal(page.to, 2);
});

test("total zero não quebra", () => {
  const page = run("paginate(0, 1, 25)");
  assert.equal(page.pages, 1);
  assert.equal(page.total, 0);
  assert.equal(page.from, 0);
  assert.equal(page.to, 0);
});

test("o offset pedido ao servidor acompanha a página", () => {
  assert.equal(run("paginate(1000, 1, 25)").offset, 0);
  assert.equal(run("paginate(1000, 2, 25)").offset, 25);
  assert.equal(run("paginate(1000, 40, 25)").offset, 975);
});

test("volume grande não muda o tamanho da página", () => {
  const page = run("paginate(250000, 7, 25)");
  assert.equal(page.pages, 10000);
  assert.equal(page.offset, 150);
  assert.equal(page.to - page.from + 1, 25);
});
