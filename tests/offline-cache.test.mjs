import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function load(seed = {}) {
  const store = new Map(Object.entries(seed));
  const context = vm.createContext({
    Date,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      key: index => [...store.keys()][index] ?? null,
      get length() { return store.size; }
    }
  });
  vm.runInContext(read("src/offline.js"), context);
  return { store, run: expression => vm.runInContext(expression, context) };
}

const OK = 'data => ({ data, error: null })';
const FALHOU = '() => ({ data: null, error: { message: "Failed to fetch" } })';
const PRIMEIRA = 'list => list[0].data';

test("resposta boa é guardada no aparelho e devolvida", () => {
  const { run, store } = load();
  const value = run(`SupCache.load("lotes", [(${OK})([{id:1}])], ${PRIMEIRA})`);
  assert.deepEqual(value, [{ id: 1 }]);
  assert.ok([...store.keys()].some(key => key.includes("lotes")), "nada foi gravado no aparelho");
});

test("resposta com erro devolve o que estava guardado", () => {
  const { run } = load();
  run(`SupCache.load("lotes", [(${OK})([{id:1}])], ${PRIMEIRA})`);
  assert.deepEqual(run(`SupCache.load("lotes", [(${FALHOU})()], ${PRIMEIRA})`), [{ id: 1 }]);
});

test("resposta com erro não apaga o que estava guardado", () => {
  const { run } = load();
  run(`SupCache.load("lotes", [(${OK})([{id:1}])], ${PRIMEIRA})`);
  run(`SupCache.load("lotes", [(${FALHOU})()], ${PRIMEIRA})`);
  assert.deepEqual(run(`SupCache.read("lotes")`), [{ id: 1 }]);
});

test("uma resposta ruim no meio de boas invalida a leva inteira", () => {
  const { run } = load();
  run(`SupCache.load("mestres", [(${OK})([1]),(${OK})([2])], list => list.map(r => r.data))`);
  const value = run(`SupCache.load("mestres", [(${OK})([9]),(${FALHOU})()], list => list.map(r => r.data))`);
  assert.deepEqual(value, [[1], [2]], "meia verdade é pior que o dado velho inteiro");
});

test("sem rede e sem nada guardado devolve null, para a tela avisar", () => {
  const { run } = load();
  assert.equal(run(`SupCache.load("lotes", [(${FALHOU})()], ${PRIMEIRA})`), null);
});

test("savedAt diz de quando é o dado guardado", () => {
  const { run } = load();
  assert.equal(run(`SupCache.savedAt("lotes")`), "");
  run(`SupCache.load("lotes", [(${OK})([1])], ${PRIMEIRA})`);
  assert.match(run(`SupCache.savedAt("lotes")`), /^\d{4}-\d{2}-\d{2}T/);
});

test("newestSavedAt devolve a sincronização mais recente entre as tabelas", () => {
  const { run } = load();
  run(`SupCache.write("lotes", [1], "2026-09-10T10:00:00.000Z")`);
  run(`SupCache.write("produtos", [2], "2026-09-14T08:00:00.000Z")`);
  assert.equal(run(`SupCache.newestSavedAt()`), "2026-09-14T08:00:00.000Z");
});

test("cache corrompido não derruba a tela", () => {
  const { run } = load({ "suplementacao:cache:lotes": "{nao é json" });
  assert.equal(run(`SupCache.load("lotes", [(${FALHOU})()], ${PRIMEIRA})`), null);
});

test("sair do sistema limpa os dados guardados", () => {
  const { run, store } = load();
  run(`SupCache.load("lotes", [(${OK})([1])], ${PRIMEIRA})`);
  run(`SupCache.clear()`);
  assert.deepEqual([...store.keys()].filter(key => key.includes("cache")), []);
});
