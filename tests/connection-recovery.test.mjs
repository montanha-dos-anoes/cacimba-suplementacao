import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function ui({ probe = async () => true } = {}) {
  const timers = [];
  const voltas = [];
  const context = vm.createContext({
    Promise,
    document: { getElementById: () => null },
    navigator: { onLine: true },
    SUP_CONFIG: { offlineRetryMs: 20000 },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    onConnectionBack: () => voltas.push(true)
  });
  vm.runInContext(read("src/ui.js"), context);
  context.probeConnection = async () => {
    const ok = await probe();
    vm.runInContext(`noteConnection(${ok})`, context);
    return ok;
  };
  return { run: expression => vm.runInContext(expression, context), timers, voltas };
}

test("falha de rede agenda nova tentativa, sem esperar o evento online", () => {
  const { run, timers } = ui();
  run("noteConnection(false)");
  assert.equal(timers.length, 1, "sem timer o app nunca sai do modo offline com o sinal fraco");
  assert.equal(timers[0].ms, 20000);
});

test("várias falhas seguidas não empilham timers", () => {
  const { run, timers } = ui();
  run("noteConnection(false)");
  run("noteConnection(false)");
  run("noteConnection(false)");
  assert.equal(timers.length, 1);
});

test("sondagem com sucesso tira do modo offline e avisa a tela", async () => {
  const { run, timers, voltas } = ui();
  run("noteConnection(false)");
  await timers[0].fn();
  assert.equal(run("isOffline()"), false);
  assert.equal(voltas.length, 1, "a tela precisa recarregar e a fila de tratos precisa ser enviada");
});

test("sondagem que falha agenda outra tentativa", async () => {
  const { run, timers, voltas } = ui({ probe: async () => false });
  run("noteConnection(false)");
  await timers[0].fn();
  assert.equal(run("isOffline()"), true);
  assert.equal(timers.length, 2);
  assert.equal(voltas.length, 0);
});

test("conexão confirmada sem ter caído não dispara a volta", () => {
  const { run, voltas, timers } = ui();
  run("noteConnection(true)");
  assert.equal(voltas.length, 0);
  assert.equal(timers.length, 0);
});

test("o app tenta reconectar sozinho e pelos botões", () => {
  const bootstrap = read("src/bootstrap.js");
  assert.match(bootstrap, /visibilitychange/, "voltar ao app precisa conferir a conexão");
  assert.match(bootstrap, /function onConnectionBack/);
  assert.match(bootstrap, /refreshScreen:el=>runAction\(el,refreshCurrentScreen,'',\{offline:true\}\)/,
    "sem offline:true o botão de atualizar fica bloqueado justamente quando precisa reconectar");
  assert.doesNotMatch(read("src/api.js"), /if \(isOffline\(\)\) return false;/,
    "a sondagem não pode desistir pela marca que ela mesma deveria desligar");
  assert.match(read("src/nav.js"), /probeConnection\(\)/);
  assert.match(read("src/outbox.js"), /manual && !\(await probeConnection\(\)\)/,
    "o Enviar agora precisa tentar a rede antes de dizer que está sem conexão");
});
