import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function load(online = true) {
  const context = vm.createContext({
    document: { getElementById: () => null },
    navigator: { onLine: online },
    setTimeout
  });
  vm.runInContext(read("src/ui.js"), context);
  return context;
}

const FAKE_BUTTON = `(() => {
  const button = {
    tagName: "BUTTON",
    dataset: {},
    disabled: false,
    innerHTML: "Registrar entrada",
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    closest() { return null; }
  };
  return button;
})()`;

function run(expression, online = true) {
  const context = load(online);
  return vm.runInContext(`(async () => { ${expression} })()`, context);
}

test("executa o trabalho e devolve o resultado", async () => {
  const result = await run(`
    const button = ${FAKE_BUTTON};
    return await runAction(button, async () => "salvo");
  `);
  assert.equal(result, "salvo");
});

test("clique repetido durante a gravação não executa de novo", async () => {
  const calls = await run(`
    const button = ${FAKE_BUTTON};
    let calls = 0;
    const work = () => new Promise(done => { calls += 1; setTimeout(() => done(), 20); });
    const first = runAction(button, work);
    const second = runAction(button, work);
    const third = runAction(button, work);
    await Promise.all([first, second, third]);
    return calls;
  `);
  assert.equal(calls, 1);
});

test("botão volta ao normal depois de gravar", async () => {
  const state = await run(`
    const button = ${FAKE_BUTTON};
    await runAction(button, async () => "ok");
    return { disabled: button.disabled, label: button.innerHTML, busy: button.dataset.busy, aria: button.attributes["aria-busy"] };
  `);
  assert.deepEqual(state, { disabled: false, label: "Registrar entrada", busy: undefined, aria: undefined });
});

test("durante a gravação o botão fica travado e avisa", async () => {
  const during = await run(`
    const button = ${FAKE_BUTTON};
    let snapshot = null;
    await runAction(button, async () => {
      snapshot = { disabled: button.disabled, label: button.innerHTML, aria: button.attributes["aria-busy"] };
    });
    return snapshot;
  `);
  assert.equal(during.disabled, true);
  assert.equal(during.aria, "true");
  assert.match(during.label, /Salvando/);
});

test("erro propaga e o botão volta a funcionar", async () => {
  const outcome = await run(`
    const button = ${FAKE_BUTTON};
    let message = "";
    try {
      await runAction(button, async () => { throw new Error("falhou"); });
    } catch (error) {
      message = error.message;
    }
    let second = 0;
    await runAction(button, async () => { second += 1; });
    return { message, second, disabled: button.disabled, label: button.innerHTML };
  `);
  assert.deepEqual(outcome, { message: "falhou", second: 1, disabled: false, label: "Registrar entrada" });
});

test("rótulo de espera pode ser trocado", async () => {
  const label = await run(`
    const button = ${FAKE_BUTTON};
    let seen = "";
    await runAction(button, async () => { seen = button.innerHTML; }, "Entrando…");
    return seen;
  `);
  assert.match(label, /Entrando/);
});

test("sem botão, o trabalho roda igual", async () => {
  assert.equal(await run("return await runAction(null, async () => 42);"), 42);
});

test("sem conexão a gravação nem sai do lugar", async () => {
  const outcome = await run(`
    const button = ${FAKE_BUTTON};
    let calls = 0;
    const result = await runAction(button, async () => { calls += 1; });
    return { calls, result: result === undefined, disabled: button.disabled, label: button.innerHTML };
  `, false);
  assert.deepEqual(outcome, { calls: 0, result: true, disabled: false, label: "Registrar entrada" });
});
