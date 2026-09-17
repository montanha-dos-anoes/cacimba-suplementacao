import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const LOTES = [{ id: "L1", name: "Pasto 1", active: true }];
const PRODUTOS = [{ id: "P1", name: "Proteinado", active: true }];

function telaDeTrato({ falham = [], offline = false, guardado: semente = null } = {}) {
  const store = new Map(Object.entries(semente || {}));
  const chamadas = [];
  const elementos = {};
  const avisos = [];
  const context = vm.createContext({
    Date,
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
      key: index => [...store.keys()][index] ?? null,
      get length() { return store.size; }
    },
    $: id => (elementos[id] ||= { innerHTML: "", value: "", textContent: "" }),
    esc: value => String(value ?? ""),
    msg: (id, texto) => avisos.push({ id, texto }),
    isOffline: () => offline,
    isNetworkError: error => /Failed to fetch/i.test(String(error?.message || "")),
    friendlyError: error => String(error?.message || error),
    farmDateTimeBR: () => "14/09/2026 10:00",
    sb: {
      from(table) {
        chamadas.push(table);
        const resposta = falham.includes(table)
          ? Promise.resolve({ data: null, error: { message: 'relation does not exist', code: "42P01" } })
          : Promise.resolve({
              data: table === "suplementacao_lots" ? LOTES
                : table === "suplementacao_products" ? PRODUTOS : [],
              error: null
            });
        const chain = {
          select: () => chain, order: () => chain, eq: () => chain,
          then: (ok, falhou) => resposta.then(ok, falhou)
        };
        return chain;
      }
    }
  });
  vm.runInContext(read("src/state.js"), context);
  vm.runInContext(read("src/offline.js"), context);
  vm.runInContext(read("src/masters.js"), context);
  return { context, elementos, avisos, chamadas, store };
}

test("com tudo no ar, lote e produto aparecem", async () => {
  const { context, elementos } = telaDeTrato();
  await vm.runInContext("loadMasters()", context);
  assert.match(elementos.lot.innerHTML, /Pasto 1/);
  assert.match(elementos.product.innerHTML, /Proteinado/);
});

test("erro em fórmulas não pode esvaziar lote e produto", async () => {
  const { context, elementos } = telaDeTrato({ falham: ["suplementacao_formulas"] });
  await vm.runInContext("loadMasters()", context);
  assert.match(elementos.lot.innerHTML, /Pasto 1/, "o lote veio do servidor e sumiu da tela");
  assert.match(elementos.product.innerHTML, /Proteinado/, "o produto veio do servidor e sumiu da tela");
});

test("erro em produtos não pode esvaziar a lista de lotes", async () => {
  const { context, elementos } = telaDeTrato({ falham: ["suplementacao_products"] });
  await vm.runInContext("loadMasters()", context);
  assert.match(elementos.lot.innerHTML, /Pasto 1/, "lote não depende de produto para ser listado");
});

test("falha que não é de rede não pode ser anunciada como falta de conexão", async () => {
  const { context, avisos } = telaDeTrato({ falham: ["suplementacao_lots", "suplementacao_products", "suplementacao_formulas"] });
  await vm.runInContext("loadMasters()", context);
  const texto = avisos.map(item => item.texto).join(" ");
  assert.doesNotMatch(texto, /Sem conexão/, `erro do servidor virou aviso de rede: ${texto}`);
});

test("fórmula quebrada não vira aviso de sem conexão, com lote e produto frescos", async () => {
  const { context, avisos } = telaDeTrato({ falham: ["suplementacao_formulas"] });
  await vm.runInContext("loadMasters()", context);
  const texto = avisos.map(item => item.texto).join(" ");
  assert.doesNotMatch(texto, /Sem conexão/,
    `lote e produto vieram do servidor nesta carga; nada foi lido do aparelho: ${texto}`);
});

test("a mesma falha não é anunciada duas vezes", async () => {
  const { context, avisos } = telaDeTrato({ falham: ["suplementacao_lots", "suplementacao_products"] });
  await vm.runInContext("loadMasters()", context);
  const texto = avisos.map(item => item.texto).join(" ");
  const ocorrencias = texto.split("relation does not exist").length - 1;
  assert.ok(ocorrencias <= 1, `a mesma mensagem apareceu ${ocorrencias} vezes: ${texto}`);
});

const CHAVE = nome => `suplementacao:cache:${nome}`;
const guardadoCom = (nome, valor) => ({ [CHAVE(nome)]: JSON.stringify({ value: valor, savedAt: "2026-09-14T13:00:00.000Z" }) });

test("offline, a tela de trato não dispara nenhuma busca", async () => {
  const { context, chamadas } = telaDeTrato({
    offline: true,
    guardado: { ...guardadoCom("cadastro-lotes", LOTES), ...guardadoCom("cadastro-produtos", PRODUTOS) }
  });
  await vm.runInContext("loadMasters()", context);
  assert.deepEqual(chamadas, [], `cada uma dessas vira um erro de fetch na tela: ${chamadas.join(", ")}`);
});

test("offline, lote e produto vêm do que está guardado", async () => {
  const { context, elementos } = telaDeTrato({
    offline: true,
    guardado: { ...guardadoCom("cadastro-lotes", LOTES), ...guardadoCom("cadastro-produtos", PRODUTOS) }
  });
  await vm.runInContext("loadMasters()", context);
  assert.match(elementos.lot.innerHTML, /Pasto 1/);
  assert.match(elementos.product.innerHTML, /Proteinado/);
});

test("offline sem nada guardado avisa em vez de deixar a tela muda", async () => {
  const { context, avisos } = telaDeTrato({ offline: true });
  await vm.runInContext("loadMasters()", context);
  const texto = avisos.map(item => item.texto).join(" ");
  assert.match(texto, /internet/i, `o usuário precisa saber o que fazer: ${texto}`);
});
