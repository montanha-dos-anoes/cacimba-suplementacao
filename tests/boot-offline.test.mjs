import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const PERFIL = { id: "U1", full_name: "Willian Terceros", role: "owner", active: true, must_change_password: false };
const NUNCA = new Promise(() => {});

function app({
  offline = false,
  perfilGuardado = PERFIL,
  sessaoGuardada = "U1",
  sessaoTravada = false,
  sessaoDoServidor = null,
  perfilDoServidor = undefined
} = {}) {
  const chamadasDeRede = [];
  const elementos = {};
  const guardado = new Map();
  if (perfilGuardado) guardado.set("suplementacao:profile", JSON.stringify(perfilGuardado));
  if (sessaoGuardada) guardado.set("sb-kwogzwdidzenfmdxmiwv-auth-token", JSON.stringify({ user: { id: sessaoGuardada } }));

  const elemento = id => (elementos[id] ||= {
    textContent: "", innerHTML: "", value: "",
    classList: {
      escondido: id !== "loginView",
      add(nome) { if (nome === "hidden") this.escondido = true; },
      remove(nome) { if (nome === "hidden") this.escondido = false; },
      toggle(nome, forcar) { if (nome === "hidden") this.escondido = forcar; },
      contains(nome) { return nome === "hidden" && this.escondido; }
    },
    querySelector: () => ({ disabled: false })
  });

  const telas = [];
  const context = vm.createContext({
    Date, JSON, console, Promise,
    localStorage: {
      getItem: key => (guardado.has(key) ? guardado.get(key) : null),
      setItem: (key, value) => guardado.set(key, String(value)),
      removeItem: key => guardado.delete(key),
      key: index => [...guardado.keys()][index] ?? null,
      get length() { return guardado.size; }
    },
    $: elemento,
    msg: () => {},
    toast: () => {},
    isOffline: () => offline,
    noteConnection: () => {},
    isNetworkError: error => /Failed to fetch/i.test(String(error?.message || "")),
    friendlyError: error => String(error?.message || error),
    roleName: () => "Proprietário",
    initials: () => "WT",
    icon: () => "",
    renderNav: () => {},
    showTab: () => { telas.push("inicio"); },
    loadMasters: async () => { telas.push("masters"); },
    loadHistory: async () => { telas.push("historico"); },
    loadProductStock: async () => { telas.push("saldo"); },
    SupCache: { clear: () => {} },
    SUP_CONFIG: { supabaseUrl: "https://kwogzwdidzenfmdxmiwv.supabase.co" },
    sb: {
      auth: {
        async getSession() {
          chamadasDeRede.push("getSession");
          if (sessaoTravada) return NUNCA;
          if (sessaoDoServidor) return { data: { session: sessaoDoServidor }, error: null };
          return { data: { session: null }, error: { message: "Failed to fetch" } };
        },
        signOut: async () => { chamadasDeRede.push("signOut"); }
      },
      from(table) {
        chamadasDeRede.push(table);
        const resposta = perfilDoServidor === undefined
          ? Promise.resolve({ data: null, error: { message: "Failed to fetch" } })
          : Promise.resolve({ data: perfilDoServidor, error: null });
        const chain = { select: () => chain, eq: () => chain, single: () => resposta, then: (ok, no) => resposta.then(ok, no) };
        return chain;
      }
    }
  });
  for (const view of ["loginView", "passwordView", "appView"]) elemento(view);
  vm.runInContext(read("src/state.js"), context);
  vm.runInContext(read("src/auth.js"), context);
  return { context, elementos, chamadasDeRede, elemento, telas };
}

const visivel = (elementos, id) => !!elementos[id] && !elementos[id].classList.escondido;

test("offline com acesso guardado, o app abre sem nenhuma ida à rede", async () => {
  const { context, chamadasDeRede } = app({ offline: true });
  await vm.runInContext("boot()", context);
  assert.deepEqual(chamadasDeRede, [], `boot esperou a rede estourar: ${chamadasDeRede.join(", ")}`);
});

test("offline, a tela de login nunca aparece para quem já entrou neste aparelho", async () => {
  const { context, elementos } = app({ offline: true });
  await vm.runInContext("boot()", context);
  assert.equal(visivel(elementos, "loginView"), false, "piscou a tela de entrar para quem tem acesso guardado");
  assert.equal(visivel(elementos, "appView"), true);
});

test("sem acesso guardado, a tela de login aparece", async () => {
  const { context, elementos } = app({ offline: true, perfilGuardado: null, sessaoGuardada: null });
  await vm.runInContext("boot()", context);
  assert.equal(visivel(elementos, "loginView"), true);
  assert.equal(visivel(elementos, "appView"), false);
});

test("com navigator.onLine mentindo, o app abre do aparelho sem esperar a sessão", { timeout: 3000 }, async () => {
  const { context, elementos } = app({ offline: false, sessaoTravada: true });
  await vm.runInContext("boot()", context);
  assert.equal(visivel(elementos, "appView"), true,
    "é isto que joga o usuário no login no F5: boot fica preso no getSession antes de desenhar");
  assert.equal(visivel(elementos, "loginView"), false);
});

test("com acesso guardado, as telas carregam antes da conferência com o servidor", { timeout: 3000 }, async () => {
  const { context, telas } = app({ offline: false, sessaoTravada: true });
  await vm.runInContext("boot()", context);
  assert.ok(telas.includes("masters"), "o app abriu vazio: nenhum loader foi disparado");
  assert.ok(telas.includes("inicio"));
});

test("sem nada guardado e com rede, boot espera o servidor antes de decidir", async () => {
  const { context, elementos } = app({
    offline: false,
    perfilGuardado: null,
    sessaoGuardada: null,
    sessaoDoServidor: { user: { id: "U1" } },
    perfilDoServidor: PERFIL
  });
  await vm.runInContext("boot()", context);
  assert.equal(visivel(elementos, "appView"), true, "quem acabou de entrar precisa ver o app sem dar F5");
});

test("a conferência com o servidor derruba quem foi desativado", async () => {
  const { context, elementos, chamadasDeRede } = app({
    offline: false,
    sessaoDoServidor: { user: { id: "U1" } },
    perfilDoServidor: { ...PERFIL, active: false }
  });
  await vm.runInContext("boot()", context);
  await vm.runInContext("accessRefresh", context);
  assert.ok(chamadasDeRede.includes("signOut"), "acesso desativado continuou valendo");
  assert.equal(visivel(elementos, "appView"), false);
  assert.equal(visivel(elementos, "loginView"), true);
});

test("a conferência guarda o perfil novo para o próximo uso offline", async () => {
  const novo = { ...PERFIL, full_name: "Willian T." };
  const { context } = app({
    offline: false,
    sessaoDoServidor: { user: { id: "U1" } },
    perfilDoServidor: novo
  });
  await vm.runInContext("boot()", context);
  await vm.runInContext("accessRefresh", context);
  assert.equal(vm.runInContext("cachedProfile('U1').full_name", context), "Willian T.");
});

test("perfil que não veio por falta de rede não derruba o acesso guardado", async () => {
  const { context, elementos } = app({ offline: false, sessaoDoServidor: { user: { id: "U1" } } });
  await vm.runInContext("boot()", context);
  await vm.runInContext("accessRefresh", context);
  assert.equal(visivel(elementos, "appView"), true,
    "uma consulta que falhou por rede não é prova de que o acesso acabou");
});

test("entrar sem conexão explica o motivo em vez de acusar o PIN", () => {
  const auth = read("src/auth.js");
  const entrar = auth.slice(auth.indexOf("async function signIn"), auth.indexOf("async function firstOwner"));
  assert.match(entrar, /isOffline\(\)/, "offline, signIn vira 'Usuário ou PIN incorretos'");
});
