import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function api({ respostaEmMs = 5, timeoutMs = 40 } = {}) {
  const conexao = [];
  const abortadas = [];
  const context = vm.createContext({
    Promise, Date, console, Error, TypeError, AbortController, setTimeout, clearTimeout,
    SUP_CONFIG: { supabaseUrl: "https://ref.supabase.co", supabasePublishableKey: "k", requestTimeoutMs: timeoutMs },
    noteConnection: reachable => conexao.push(reachable),
    isNetworkError: error => /Failed to fetch|NetworkError|tempo esgotado/i.test(String(error?.message || error || "")),
    supabase: { createClient: (url, key, options) => ({ url, key, options, auth: {}, rpc: async () => ({ data: null, error: null }) }) },
    fetch: (input, init = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, status: 200 }), respostaEmMs);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        abortadas.push(String(input));
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      });
    })
  });
  vm.runInContext(read("src/api.js"), context);
  return { run: expression => vm.runInContext(expression, context), conexao, abortadas };
}

test("o cliente supabase usa o fetch com prazo, senão cada chamada fica pendurada", () => {
  const { run } = api();
  assert.equal(typeof run("supFetch"), "function");
  assert.equal(run("sb.options.global.fetch"), run("supFetch"),
    "sem isso o refresh de sessão do supabase fica 25s tentando");
});

test("request que não responde no prazo vira erro de rede conhecido", async () => {
  const { run, abortadas } = api({ respostaEmMs: 5000, timeoutMs: 30 });
  const erro = await run('supFetch("https://ref.supabase.co/x").then(() => null, e => e)');
  assert.ok(erro, "a chamada nunca terminou");
  assert.equal(run(`isNetworkError(${JSON.stringify(String(erro.message))})`), true,
    `"${erro.message}" não é reconhecido como falta de conexão, então o trato não vai para a fila`);
  assert.equal(abortadas.length, 1, "o request continuou aberto depois do prazo");
});

test("o prazo estourado marca o aparelho como sem conexão", async () => {
  const { run, conexao } = api({ respostaEmMs: 5000, timeoutMs: 30 });
  await run('supFetch("https://ref.supabase.co/x").catch(() => null)');
  assert.deepEqual(conexao, [false], "sem isso o app continua tentando a rede a cada tela");
});

test("resposta do servidor confirma a conexão, mesmo com status de erro", async () => {
  const { run, conexao } = api({ respostaEmMs: 1, timeoutMs: 500 });
  await run('supFetch("https://ref.supabase.co/x")');
  assert.deepEqual(conexao, [true]);
});

test("o prazo é configurável num lugar só", () => {
  assert.match(read("src/config.js"), /requestTimeoutMs/);
});

function apiOffline({ offline = true, offlineRetryMs = 20000 } = {}) {
  const idas = [];
  const context = vm.createContext({
    Promise, Date, console, Error, TypeError, AbortController, setTimeout, clearTimeout,
    SUP_CONFIG: { supabaseUrl: "https://ref.supabase.co", supabasePublishableKey: "k", requestTimeoutMs: 50, offlineRetryMs },
    noteConnection: () => {},
    isNetworkError: error => /Failed to fetch/i.test(String(error?.message || error || "")),
    isOffline: () => offline,
    supabase: { createClient: () => ({ auth: {}, rpc: async () => ({}) }) },
    fetch: async input => { idas.push(String(input)); throw new TypeError("Failed to fetch"); }
  });
  vm.runInContext(read("src/api.js"), context);
  return { run: expression => vm.runInContext(expression, context), idas };
}

test("sem conexão, só uma sondagem por vez chega a sair do aparelho", async () => {
  const { run, idas } = apiOffline();
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    await run('supFetch("https://ref.supabase.co/auth/v1/token").catch(() => null)');
  }
  assert.equal(idas.length, 1,
    `o refresh de sessão do supabase tenta 8 vezes; sem a trava saem ${idas.length} requests por tela`);
});

test("a recusa sem rede continua sendo um erro de rede reconhecível", async () => {
  const { run } = apiOffline();
  await run('supFetch("https://ref.supabase.co/x").catch(() => null)');
  const erro = await run('supFetch("https://ref.supabase.co/x").then(() => null, e => e)');
  assert.equal(run(`isNetworkError(${JSON.stringify(String(erro.message))})`), true,
    "senão o trato vira erro de servidor em vez de ir para a fila do aparelho");
});

test("com conexão, nada é engasgado", async () => {
  const { run, idas } = apiOffline({ offline: false });
  for (let tentativa = 0; tentativa < 3; tentativa += 1) {
    await run('supFetch("https://ref.supabase.co/x").catch(() => null)');
  }
  assert.equal(idas.length, 3);
});
