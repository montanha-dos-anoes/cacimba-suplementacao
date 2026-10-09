import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function load() {
  const context = vm.createContext({ localStorage: { getItem: () => null, setItem: () => {} } });
  vm.runInContext(read("src/auth.js"), context);
  return context;
}

test("usuário de campo com PIN provisório precisa trocar", () => {
  const { needsPasswordChange } = load();
  assert.equal(needsPasswordChange({ role: "field", must_change_password: true }), true);
});

test("administrador com PIN provisório precisa trocar", () => {
  const { needsPasswordChange } = load();
  assert.equal(needsPasswordChange({ role: "admin", must_change_password: true }), true);
});

test("usuário que já trocou o PIN entra direto", () => {
  const { needsPasswordChange } = load();
  assert.equal(needsPasswordChange({ role: "field", must_change_password: false }), false);
});

test("perfil antigo sem a coluna entra direto", () => {
  const { needsPasswordChange } = load();
  assert.equal(needsPasswordChange({ role: "field" }), false);
});

test("proprietário nunca é barrado, senão trava fora do sistema", () => {
  const { needsPasswordChange } = load();
  assert.equal(needsPasswordChange({ role: "owner", must_change_password: true }), false);
});

test("PIN com menos de 6 dígitos é recusado", () => {
  const { newPinError } = load();
  assert.equal(newPinError("12345", "12345"), "O PIN precisa ter pelo menos 6 dígitos.");
});

test("confirmação diferente é recusada", () => {
  const { newPinError } = load();
  assert.equal(newPinError("123456", "123457"), "Os dois PINs não são iguais.");
});

test("PIN válido e confirmado não tem erro", () => {
  const { newPinError } = load();
  assert.equal(newPinError("123456", "123456"), "");
});

test("a tela de troca de PIN existe e está ligada", () => {
  const html = read("index.html");
  const auth = read("src/auth.js");
  const bootstrap = read("src/bootstrap.js");

  assert.match(html, /id="passwordView"/);
  for (const id of ["newPin", "newPin2", "passwordMsg"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta o campo ${id}`);
  }
  assert.match(html, /data-do="submitNewPassword"/);
  assert.match(html, /id="passwordView"[\s\S]{0,900}data-do="logout"/, "sem saída o usuário fica preso na tela");
  assert.match(bootstrap, /submitNewPassword:el=>runAction\(el,submitNewPassword/);
  assert.match(auth, /action:'change_password'/);
});

function views() {
  const elementos = {};
  const elemento = id => (elementos[id] ||= {
    textContent: "", innerHTML: "",
    classList: {
      escondido: id !== "loginView",
      add(nome) { if (nome === "hidden") this.escondido = true; },
      remove(nome) { if (nome === "hidden") this.escondido = false; }
    },
    querySelector: () => ({ disabled: false })
  });
  for (const view of ["loginView", "passwordView", "appView"]) elemento(view);
  const context = vm.createContext({
    $: elemento,
    localStorage: { getItem: () => null, setItem: () => {} },
    roleName: () => "Campo",
    initials: () => "JS",
    icon: () => "",
    renderNav: () => {}
  });
  vm.runInContext(read("src/state.js"), context);
  vm.runInContext(read("src/auth.js"), context);
  return { context, elementos };
}

const aberta = (elementos, id) => !elementos[id].classList.escondido;

test("quem tem PIN provisório vai para a troca e nunca chega a ver o app", () => {
  const { context, elementos } = views();
  const estado = vm.runInContext(
    "applyProfile({id:'U1',full_name:'João Silva',role:'field',active:true,must_change_password:true})",
    context
  );
  assert.equal(estado, "password");
  assert.equal(aberta(elementos, "passwordView"), true);
  assert.equal(aberta(elementos, "appView"), false, "quem tem PIN provisório não pode chegar a ver o app");
});

test("perfil em ordem abre o app", () => {
  const { context, elementos } = views();
  assert.equal(
    vm.runInContext("applyProfile({id:'U1',full_name:'João Silva',role:'field',active:true,must_change_password:false})", context),
    "app"
  );
  assert.equal(aberta(elementos, "appView"), true);
  assert.equal(aberta(elementos, "passwordView"), false);
});

test("acesso desativado não abre nada", () => {
  const { context, elementos } = views();
  assert.equal(
    vm.runInContext("applyProfile({id:'U1',full_name:'João Silva',role:'field',active:false,must_change_password:false})", context),
    "blocked"
  );
  assert.equal(aberta(elementos, "appView"), false);
  assert.equal(aberta(elementos, "passwordView"), false);
});

test("trocar o PIN atualiza o perfil guardado, senão o gate volta na próxima entrada", () => {
  const auth = read("src/auth.js");
  const troca = auth.slice(auth.indexOf("async function submitNewPassword"));
  assert.ok(troca.includes("must_change_password:false"), "o cache precisa nascer já sem a marca");
  assert.ok(troca.includes("cacheProfile"), "o perfil guardado tem que ser regravado");
});
