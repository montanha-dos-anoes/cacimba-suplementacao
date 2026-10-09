import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function load({ offline = false, seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  const context = vm.createContext({
    Date,
    isOffline: () => offline,
    isNetworkError: error => /Failed to fetch/i.test(String(error?.message || "")),
    friendlyError: error => String(error?.message || error),
    farmDateTimeBR: () => "14/09/2026 10:00",
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      key: index => [...store.keys()][index] ?? null,
      get length() { return store.size; }
    }
  });
  vm.runInContext(read("src/offline.js"), context);
  return { run: expression => vm.runInContext(expression, context), store };
}

const BUSCA_OK = '() => { chamou = true; return { data: [{ id: 1 }], error: null }; }';
const BUSCA_FALHA = '() => { chamou = true; return { data: null, error: { message: "Failed to fetch" } }; }';

test("offline, a busca nunca é disparada", async () => {
  const { run } = load({ offline: true });
  run("var chamou = false");
  await run(`SupCache.fetch("lotes", ${BUSCA_OK})`);
  assert.equal(run("chamou"), false, "cada chamada dessas vira um erro de fetch no console");
});

test("offline, o que estiver guardado é devolvido e marcado como guardado", async () => {
  const { run } = load({ offline: false });
  run("var chamou = false");
  await run(`SupCache.fetch("lotes", ${BUSCA_OK})`);
  const { run: offline } = load({ offline: true, seed: { "suplementacao:cache:lotes": JSON.stringify({ value: [{ id: 1 }], savedAt: "2026-09-14T10:00:00.000Z" }) } });
  offline("var chamou = false");
  const resultado = await offline(`SupCache.fetch("lotes", ${BUSCA_OK})`);
  assert.deepEqual(resultado.value, [{ id: 1 }]);
  assert.equal(resultado.fromCache, true);
});

test("offline sem nada guardado devolve nulo, sem erro de rede", async () => {
  const { run } = load({ offline: true });
  run("var chamou = false");
  const resultado = await run(`SupCache.fetch("lotes", ${BUSCA_OK})`);
  assert.equal(resultado.value, null);
  assert.equal(resultado.error, null, "offline não é erro; é estado conhecido");
});

test("online, busca e guarda", async () => {
  const { run, store } = load();
  run("var chamou = false");
  const resultado = await run(`SupCache.fetch("lotes", ${BUSCA_OK})`);
  assert.equal(run("chamou"), true);
  assert.deepEqual(resultado.value, [{ id: 1 }]);
  assert.equal(resultado.fromCache, false);
  assert.ok([...store.keys()].some(key => key.includes("lotes")));
});

test("online com falha do servidor cai no guardado e informa o erro", async () => {
  const { run } = load();
  run("var chamou = false");
  await run(`SupCache.fetch("lotes", ${BUSCA_OK})`);
  const resultado = await run(`SupCache.fetch("lotes", ${BUSCA_FALHA})`);
  assert.deepEqual(resultado.value, [{ id: 1 }]);
  assert.equal(resultado.fromCache, true);
  assert.match(String(resultado.error.message), /Failed to fetch/);
});

test("a transformação só roda sobre resposta boa", async () => {
  const { run } = load();
  run("var chamou = false");
  const resultado = await run(
    `SupCache.fetch("ids", () => ({ data: [{ product_id: "P1" }], error: null }), list => list[0].data.map(r => r.product_id))`
  );
  assert.deepEqual(resultado.value, ["P1"]);
});

test("telas que dependem do servidor são declaradas num lugar só", () => {
  const { run } = load();
  assert.equal(run(`SupCache.needsNetwork("relatorios")`), true);
  assert.equal(run(`SupCache.needsNetwork("sistema")`), true);
  assert.equal(run(`SupCache.needsNetwork("trato")`), false);
  assert.equal(run(`SupCache.needsNetwork("inicio")`), false);
  assert.equal(run(`SupCache.needsNetwork("historico")`), false);
});

const CONTADOR = '() => { idas += 1; return { data: [{ id: idas }], error: null }; }';

test("duas telas pedindo a mesma coisa ao mesmo tempo fazem uma busca só", async () => {
  const { run } = load();
  run("var idas = 0");
  await run(`Promise.all([SupCache.fetch("lotes", ${CONTADOR}), SupCache.fetch("lotes", ${CONTADOR})])`);
  assert.equal(run("idas"), 1, "abrir o app e trocar de aba buscava o mesmo cadastro duas vezes");
});

test("dentro do prazo de frescor, trocar de aba não busca de novo", async () => {
  const { run } = load();
  run("var idas = 0");
  await run(`SupCache.fetch("lotes", ${CONTADOR}, undefined, { maxAgeMs: 60000 })`);
  const segunda = await run(`SupCache.fetch("lotes", ${CONTADOR}, undefined, { maxAgeMs: 60000 })`);
  assert.equal(run("idas"), 1);
  assert.deepEqual(segunda.value, [{ id: 1 }]);
  assert.equal(segunda.fromCache, false, "dado fresco não é dado velho de aparelho sem conexão");
});

test("o prazo de frescor não engole uma atualização pedida na mão", async () => {
  const { run } = load();
  run("var idas = 0");
  await run(`SupCache.fetch("lotes", ${CONTADOR}, undefined, { maxAgeMs: 60000 })`);
  await run(`SupCache.fetch("lotes", ${CONTADOR}, undefined, { maxAgeMs: 60000, force: true })`);
  assert.equal(run("idas"), 2);
});

test("sem prazo pedido, cada chamada busca de verdade", async () => {
  const { run } = load();
  run("var idas = 0");
  await run(`SupCache.fetch("historico", ${CONTADOR})`);
  await run(`SupCache.fetch("historico", ${CONTADOR})`);
  assert.equal(run("idas"), 2, "o histórico precisa ficar fresco depois de salvar um trato");
});

test("busca que falhou não conta como fresca", async () => {
  const { run } = load();
  run("var idas = 0");
  await run(`SupCache.fetch("lotes", ${BUSCA_FALHA}, undefined, { maxAgeMs: 60000 })`);
  await run(`SupCache.fetch("lotes", ${CONTADOR}, undefined, { maxAgeMs: 60000 })`);
  assert.equal(run("idas"), 1, "uma resposta com erro não pode travar a próxima tentativa");
});
