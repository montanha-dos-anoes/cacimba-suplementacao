import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const ORIGIN = "https://suplementacao.exemplo";

function serviceWorker({ redeMorta = true, guardado = [] } = {}) {
  const idas = [];
  const cache = new Map(guardado);
  const handlers = {};

  const resposta = (url, body = "ok") => ({
    ok: true,
    url,
    clone() { return resposta(url, body); },
    body
  });

  const context = vm.createContext({
    URL, Promise, Date, console,
    Response: { error: () => ({ ok: false, type: "error" }) },
    fetch: async request => {
      idas.push(request.url || String(request));
      if (redeMorta) throw new TypeError("Failed to fetch");
      return resposta(request.url || String(request), "fresco");
    },
    caches: {
      async open() {
        return {
          async match(request, options = {}) {
            const alvo = request.url || String(request);
            if (cache.has(alvo)) return cache.get(alvo);
            if (!options.ignoreSearch) return undefined;
            const semQuery = alvo.split("?")[0];
            for (const [chave, valor] of cache) if (chave.split("?")[0] === semQuery) return valor;
            return undefined;
          },
          async put(chave, valor) { cache.set(chave.url || String(chave), valor); },
          async addAll() {},
          async add() {}
        };
      },
      async keys() { return []; },
      async delete() { return true; }
    },
    self: {
      location: { origin: ORIGIN },
      addEventListener: (nome, fn) => { handlers[nome] = fn; },
      skipWaiting: () => {},
      clients: { claim: async () => {} }
    }
  });
  vm.runInContext(read("sw.js"), context);

  const pedir = async (url, mode = "no-cors") => {
    const request = { url, method: "GET", mode };
    let resolvida;
    handlers.fetch({ request, respondWith: valor => { resolvida = valor; }, waitUntil: () => {} });
    return { resposta: await resolvida, idas };
  };

  return { pedir, idas, cache };
}

test("com o app guardado, abrir a página não depende da rede", async () => {
  const { pedir, idas } = serviceWorker({
    guardado: [["./index.html", { ok: true, clone: () => ({}), body: "shell" }]]
  });
  const { resposta } = await pedir(`${ORIGIN}/`, "navigate");
  assert.equal(resposta.body, "shell", "a casca veio da rede morta em vez do aparelho");
  assert.deepEqual(idas, [], `abrir a tela foi à rede: ${idas.join(", ")}`);
});

test("os scripts com ?v= saem do aparelho sem ir à rede", async () => {
  const { pedir, idas } = serviceWorker({
    guardado: [[`${ORIGIN}/src/auth.js`, { ok: true, clone: () => ({}), body: "auth" }]]
  });
  const { resposta } = await pedir(`${ORIGIN}/src/auth.js?v=1.13.0`);
  assert.equal(resposta.body, "auth", "o script versionado não achou o que está guardado");
  assert.deepEqual(idas, [], `cada script desses pendura o carregamento no campo: ${idas.join(", ")}`);
});

test("as bibliotecas do CDN também saem do aparelho", async () => {
  const cdn = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0";
  const { pedir, idas } = serviceWorker({ guardado: [[cdn, { ok: true, clone: () => ({}), body: "sb" }]] });
  const { resposta } = await pedir(cdn);
  assert.equal(resposta.body, "sb");
  assert.deepEqual(idas, []);
});

test("o que não está guardado ainda é buscado na rede", async () => {
  const { pedir, idas } = serviceWorker({ redeMorta: false });
  const { resposta } = await pedir(`${ORIGIN}/src/auth.js?v=1.13.0`);
  assert.equal(resposta.body, "fresco");
  assert.equal(idas.length, 1);
});

test("nenhum caminho do service worker é network-first", () => {
  const sw = read("sw.js");
  assert.doesNotMatch(sw, /return\s*\(await network\)/,
    "network-first trava o app no campo: navigator.onLine mente e o fetch fica pendurado");
  assert.doesNotMatch(sw, /const fresh = await fetch\(request, \{ cache: "no-store" \}\);\s*cache\.put/,
    "a navegação não pode esperar a rede para desenhar a tela");
});
