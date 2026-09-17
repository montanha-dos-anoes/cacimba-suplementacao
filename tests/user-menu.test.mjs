import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const roleName = r => (r === "owner" ? "Proprietário" : r === "admin" ? "Administrador" : "Campo");

function menu(role, full_name = "João Silva") {
  let sheet = null;
  const abertos = [];
  const context = vm.createContext({
    Set, Map, Object, Array, Number, String, Promise,
    profile: { id: "U1", full_name, role },
    esc, roleName,
    icon: () => "",
    showSheet: opcoes => { sheet = opcoes; },
    showTab: id => abertos.push(id),
    logout: () => abertos.push("sair"),
    openOwnPinChange: () => abertos.push("trocarPin"),
    document: { querySelector: () => null }
  });
  vm.runInContext(read("src/nav.js"), context);
  vm.runInContext("openNavMore()", context);

  const botoes = [];
  const container = {
    innerHTML: "",
    querySelectorAll() {
      return [...this.innerHTML.matchAll(/data-go="([^"]+)"/g)].map(m => {
        const botao = { dataset: { go: m[1] }, onclick: null };
        botoes.push(botao);
        return botao;
      });
    }
  };
  sheet.tabs[0].render(container, { close: () => {} });
  const clicar = alvo => botoes.find(b => b.dataset.go === alvo)?.onclick?.();
  return { sheet, html: container.innerHTML, abertos, clicar };
}

test("o avatar abre a mesma folha do Mais", () => {
  const bootstrap = read("src/bootstrap.js");
  assert.match(bootstrap, /userMenu:\(\)=>openNavMore\(\)/,
    "o W e o Mais precisam cair no mesmo menu");
  assert.doesNotMatch(bootstrap, /openUserMenu/, "o menu antigo do avatar ficou pendurado");
  assert.doesNotMatch(read("src/nav.js"), /function openUserMenu/);
  assert.doesNotMatch(read("src/modal.js"), /function showPopover/, "showPopover ficou sem nenhum uso");
});

test("a folha identifica quem está logado", () => {
  const { sheet } = menu("field", "João da Silva");
  assert.equal(sheet.title, "Mais");
  assert.match(sheet.subtitle, /João da Silva/,
    "abaixo de 640px o nome no cabeçalho fica escondido; a folha é o único lugar que mostra");
  assert.match(sheet.subtitle, /Campo/);
});

test("a folha escapa o nome do usuário", () => {
  const { sheet } = menu("field", '<img src=x onerror="alert(1)">');
  assert.doesNotMatch(sheet.subtitle, /<img/, "showSheet injeta o subtítulo como HTML");
});

test("usuário de campo tem Trocar meu PIN na folha", () => {
  const { html, abertos, clicar } = menu("field");
  assert.match(html, /Trocar meu PIN/);
  clicar("trocarPin");
  assert.deepEqual(abertos, ["trocarPin"]);
});

test("administrador também troca o próprio PIN", () => {
  assert.match(menu("admin").html, /Trocar meu PIN/);
});

test("o Proprietário não vê Trocar meu PIN: a função admin-users recusa para owner", () => {
  assert.doesNotMatch(menu("owner").html, /Trocar meu PIN/);
});

test("a folha continua levando às telas e ao sair", () => {
  const { html, abertos, clicar } = menu("owner");
  assert.match(html, /data-go="relatorios"/);
  assert.match(html, /data-go="sistema"/);
  clicar("relatorios");
  clicar("sair");
  assert.deepEqual(abertos, ["relatorios", "sair"]);
});

function usersHtml(role, rows) {
  const elementos = {};
  const elemento = id => (elementos[id] ||= { innerHTML: "", textContent: "", value: "" });
  const context = vm.createContext({
    Date, JSON, Promise, Object, Array, Number, String, Set, Map, console,
    profile: { id: "U1", role },
    esc, roleName,
    $: elemento,
    icon: () => "",
    sb: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) }
  });
  vm.runInContext(read("src/masters.js"), context);
  return vm.runInContext("loadUsers()", context).then(() => elementos.usersList.innerHTML);
}

const CAMPO = { id: "U9", full_name: "Maria", login_name: "maria", role: "field", active: true, protected_owner: false };
const DONO = { id: "U1", full_name: "Willian", login_name: null, role: "owner", active: true, protected_owner: true };

test("o Proprietário vê Trocar PIN na lista de usuários", async () => {
  const html = await usersHtml("owner", [CAMPO]);
  assert.match(html, /data-do="resetUserPin" data-arg="U9"/);
});

test("administrador não troca o PIN dos outros: a função admin-users só aceita owner", async () => {
  const html = await usersHtml("admin", [CAMPO]);
  assert.doesNotMatch(html, /resetUserPin/);
});

test("o Proprietário protegido não recebe botão de trocar PIN", async () => {
  const html = await usersHtml("owner", [DONO]);
  assert.doesNotMatch(html, /resetUserPin/, "a função recusa protected_owner; o botão não pode nem aparecer");
});

function auth({ role = "field" } = {}) {
  const enviados = [];
  const context = vm.createContext({
    Date, JSON, Promise, Object, console,
    profile: { id: "U1", full_name: "João Silva", role, must_change_password: true },
    esc, roleName,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    $: () => ({ innerHTML: "", value: "", classList: { add() {}, remove() {} } }),
    msg: () => {}, toast: () => {},
    friendlyError: e => String(e?.message || e),
    icon: () => "", renderNav: () => {}, initials: () => "JS",
    isOffline: () => false,
    showSheet: () => {},
    SupCache: { clear: () => {} },
    SupApi: { invokeAdmin: async body => { enviados.push(body); return { ok: true }; } }
  });
  vm.runInContext(read("src/state.js"), context);
  vm.runInContext(read("src/auth.js"), context);
  vm.runInContext("profile = { id: 'U1', full_name: 'João Silva', role: '" + role + "', must_change_password: true };", context);
  vm.runInContext("var capturado = null; openPinSheet = opcoes => { capturado = opcoes };", context);
  return { context, enviados, run: expr => vm.runInContext(expr, context) };
}

test("trocar o próprio PIN usa change_password", async () => {
  const { run, enviados } = auth();
  run("openOwnPinChange()");
  await run("capturado.salvar('123456')");
  assert.deepEqual(JSON.parse(JSON.stringify(enviados)), [{ action: "change_password", password: "123456" }]);
});

test("depois de trocar, o perfil guardado perde a marca de PIN provisório", async () => {
  const { run } = auth();
  run("openOwnPinChange()");
  await run("capturado.salvar('123456')");
  assert.equal(run("profile.must_change_password"), false,
    "senão o gate de primeiro acesso volta na próxima abertura offline");
});

test("o PIN passa pela mesma regra da tela de primeiro acesso", () => {
  const { run } = auth();
  assert.equal(run("newPinError('12345', '12345')"), "O PIN precisa ter pelo menos 6 dígitos.");
  assert.equal(run("newPinError('123456', '123457')"), "Os dois PINs não são iguais.");
});

function masters(role = "owner") {
  const enviados = [];
  const context = vm.createContext({
    Date, JSON, Promise, Object, Array, Number, String, Set, Map, console,
    profile: { id: "U1", role },
    esc, roleName,
    $: () => ({ innerHTML: "", textContent: "", value: "" }),
    icon: () => "", toast: () => {}, showAlert: async () => {},
    friendlyError: e => String(e?.message || e),
    sb: { from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [CAMPO], error: null }) }) }) },
    SupApi: { invokeAdmin: async body => { enviados.push(body); return { ok: true }; } },
    openPinSheet: () => {}
  });
  vm.runInContext(read("src/masters.js"), context);
  vm.runInContext("var capturado = null; openPinSheet = opcoes => { capturado = opcoes };", context);
  return { enviados, run: expr => vm.runInContext(expr, context) };
}

test("o Proprietário trocando o PIN de outro usa reset_password", async () => {
  const { run, enviados } = masters();
  await run("loadUsers()");
  run("openUserPinReset('U9')");
  await run("capturado.salvar('123456')");
  assert.deepEqual(JSON.parse(JSON.stringify(enviados)), [{ action: "reset_password", user_id: "U9", password: "123456" }]);
});

test("a folha de reset diz que a pessoa vai escolher o PIN dela depois", async () => {
  const { run } = masters();
  await run("loadUsers()");
  run("openUserPinReset('U9')");
  assert.match(run("capturado.subtitle"), /Maria/, "sem o nome dá para resetar o usuário errado");
  assert.match(run("capturado.aviso"), /provis/i);
});
