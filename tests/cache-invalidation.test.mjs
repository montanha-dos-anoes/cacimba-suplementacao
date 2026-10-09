import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const ESCRITAS = [
  ["src/lots.js", "async function saveLot()", ["lotes"]],
  ["src/lots.js", "async function toggleLot(id)", ["lotes"]],
  ["src/feeding.js", "async function saveFeeding()", ["saldo"]],
  ["src/feeding.js", "async function deleteFeeding(id)", ["saldo"]],
  ["src/production.js", "async function saveProduction()", ["saldo"]],
  ["src/production.js", "async function reverseProduction(id)", ["saldo"]],
  ["src/formulas.js", "async function deactivateFormula(id)", ["produtos"]],
  ["src/formulas.js", "async function saveFormula()", ["produtos"]]
];

function load() {
  const store = new Map();
  const context = vm.createContext({
    Date,
    isOffline: () => false,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      key: index => [...store.keys()][index] ?? null,
      get length() { return store.size; }
    }
  });
  vm.runInContext(read("src/offline.js"), context);
  vm.runInContext("let idas = 0; const buscar = () => { idas += 1; return { data: [idas], error: null } };", context);
  return {
    idas: () => vm.runInContext("idas", context),
    run: expression => vm.runInContext(expression, context)
  };
}

const JANELA = '{ maxAgeMs: 120000 }';

function corpo(source, assinatura) {
  const inicio = source.indexOf(assinatura);
  assert.ok(inicio >= 0, `não achei ${assinatura}`);
  const fim = source.indexOf("\n}", inicio);
  return source.slice(inicio, fim);
}

test("dentro da janela de frescor o fetch não vai ao servidor", async () => {
  const cache = load();
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  assert.equal(cache.idas(), 1, "a segunda chamada tinha que reaproveitar a janela");
});

test("esquecer o cache faz a próxima leitura ir ao servidor na hora", async () => {
  const cache = load();
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  cache.run(`SupCache.forget("lotes")`);
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  assert.equal(cache.idas(), 2, "depois de gravar, a janela de frescor tem que cair");
});

test("esquecer aceita vários caches de uma vez", async () => {
  const cache = load();
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  await cache.run(`SupCache.fetch("cadastro-lotes", buscar, undefined, ${JANELA})`);
  cache.run(`SupCache.forget("lotes", "cadastro-lotes")`);
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  await cache.run(`SupCache.fetch("cadastro-lotes", buscar, undefined, ${JANELA})`);
  assert.equal(cache.idas(), 4, "forget de vários nomes tem que derrubar todos");
});

test("gravar lote derruba a composição e o cadastro de uma vez só", async () => {
  const cache = load();
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  await cache.run(`SupCache.fetch("cadastro-lotes", buscar, undefined, ${JANELA})`);
  cache.run(`forgetAfterWrite("lotes")`);
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  await cache.run(`SupCache.fetch("cadastro-lotes", buscar, undefined, ${JANELA})`);
  assert.equal(cache.idas(), 4, "o grupo lotes tem que cobrir composição e cadastro");
});

test("grupo desconhecido não derruba nada nem quebra", async () => {
  const cache = load();
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  cache.run(`forgetAfterWrite("nao-existe")`);
  await cache.run(`SupCache.fetch("lotes", buscar, undefined, ${JANELA})`);
  assert.equal(cache.idas(), 1);
});

test("todo nome listado em SUP_CACHES é um cache que alguém realmente busca", () => {
  const cache = load();
  const nomes = cache.run("JSON.stringify(Object.values(SUP_CACHES).flat())");
  const sources = ["src/feeding.js", "src/lots.js", "src/masters.js", "src/home.js", "src/stock.js", "src/formulas.js", "src/production.js"]
    .map(read).join("\n");
  for (const nome of JSON.parse(nomes)) {
    assert.match(sources, new RegExp(`SupCache\\.fetch\\(["']${nome}["']`),
      `SUP_CACHES lista "${nome}", mas nenhum loader busca esse nome — o forget não derruba nada`);
  }
});

test("toda gravação derruba a janela de frescor do que ela mudou", () => {
  for (const [path, assinatura, grupos] of ESCRITAS) {
    const trecho = corpo(read(path), assinatura);
    const chamada = trecho.match(/forgetAfterWrite\(([^)]*)\)/);
    assert.ok(chamada, `${assinatura} grava e recarrega dentro da janela: vai redesenhar o dado velho`);
    for (const grupo of grupos) {
      assert.match(chamada[1], new RegExp(`["']${grupo}["']`), `${assinatura} não derruba o grupo ${grupo}`);
    }
  }
});

test("mexer no estoque pela folha de gestão também derruba o saldo", () => {
  const stock = read("src/stock-manage.js");
  const chamadas = stock.match(/forgetAfterWrite\(/g) || [];
  assert.ok(chamadas.length >= 5,
    `entrada, baixa, fabricação, cadastro e ativar/desativar produto: esperava 5 gravações invalidando, achei ${chamadas.length}`);
  assert.match(stock, /forgetAfterWrite\("produtos", "saldo", "inicio"\)/,
    "mexer no cadastro do produto muda o select do Trato, o saldo e os cartões do Início");
});

test("fabricar invalida também a lista principal do estoque", () => {
  const offline = read("src/offline.js");
  assert.match(offline, /saldo:\s*\["saldo",\s*"estoque"\]/,
    "a fabricação muda quantidade e custo médio; a tela de estoque não pode reutilizar o valor anterior");
});

test("a fila offline que sobe sozinha também derruba o saldo e o Início", () => {
  assert.match(read("src/outbox.js"), /forgetAfterWrite\("saldo", "inicio"\)/,
    "trato guardado que sobe depois precisa atualizar saldo e Início igual ao trato online");
});

test("a janela de frescor do lote não passa de dois minutos", () => {
  const janela = Number(read("src/lots.js").match(/LOT_VERSIONS_MAX_AGE_MS = (\d+)/)[1]);
  assert.ok(janela <= 120000, "janela longa demais deixa o app mostrando composição velha");
});
