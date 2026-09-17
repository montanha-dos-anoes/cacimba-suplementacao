import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

test("os dois arquivos novos carregam antes de quem depende deles", () => {
  const html = read("index.html");
  const posicao = file => html.indexOf(`./src/${file}?v=`);
  for (const base of ["farm-time.js", "offline.js"]) {
    assert.ok(posicao(base) > 0, `${base} não está no HTML`);
    assert.match(read("sw.js"), new RegExp(`"\./src/${base.replace(".", "\.")}"`), `${base} fora do cache offline`);
  }
  for (const dependente of ["feeding.js", "masters.js", "lots.js", "stock.js", "home.js"]) {
    assert.ok(posicao("farm-time.js") < posicao(dependente), `farm-time.js precisa vir antes de ${dependente}`);
    assert.ok(posicao("offline.js") < posicao(dependente), `offline.js precisa vir antes de ${dependente}`);
  }
});

test("todo loader de estado passa pelo cache do aparelho", () => {
  for (const file of ["src/masters.js", "src/feeding.js", "src/lots.js", "src/stock.js",
    "src/home.js", "src/production.js", "src/formulas.js"]) {
    assert.match(read(file), /SupCache\.fetch\(/, `${file} ainda busca sem guardar no aparelho`);
  }
});

test("nenhum loader troca o estado por vazio quando a busca falha", () => {
  const proibidos = [
    ["src/masters.js", /lots\s*=\s*a\.data\s*\|\|\s*\[\]/],
    ["src/feeding.js", /productStock\s*=\s*data\s*\|\|\s*\[\]/],
    ["src/feeding.js", /feedingRecords\s*=\s*data\s*\|\|\s*\[\]/],
    ["src/lots.js", /lotVersions\s*=\s*versions\.data\s*\|\|\s*\[\]/],
    ["src/stock.js", /stockRows\s*=\s*\(data\s*\|\|\s*\[\]\)/]
  ];
  for (const [file, padrao] of proibidos) {
    assert.doesNotMatch(read(file), padrao, `${file} apaga o estado quando a resposta vem com erro`);
  }
});

test("as datas são do fuso da fazenda, não do aparelho", () => {
  const farmTime = read("src/farm-time.js");
  assert.match(farmTime, /America\/Campo_Grande/);
  assert.match(farmTime, /Intl\.DateTimeFormat/);

  const sources = ["src/ui.js", "src/feeding.js", "src/lots.js", "src/home.js", "src/production.js",
    "src/stock-manage.js", "src/reports.js", "src/bootstrap.js"].map(read).join("\n");
  assert.doesNotMatch(sources, /localNow\(\)/, "localNow usa o fuso do aparelho; use farmNowLocal");
  assert.doesNotMatch(sources, /new Date\([^)]*\)\.toLocaleString\(["']pt-BR["']\)/,
    "toLocaleString formata no fuso do aparelho; use farmDateTimeBR");
  assert.doesNotMatch(read("src/lots.js"), /function farmDateISO/, "farmDateISO agora mora em farm-time.js");
});

test("o trato recusa data futura e data velha demais", () => {
  const feeding = read("src/feeding.js");
  assert.match(feeding, /function occurredError/);
  assert.match(feeding, /FEEDING_BACKDATE_HOURS = 24/);
  assert.match(feeding, /function feedingErrors/);
  const validacao = feeding.slice(feeding.indexOf("function feedingErrors"), feeding.indexOf("async function saveFeeding"));
  assert.match(validacao, /occurredError\(campos\.occurred, now\)/, "a data entra na mesma lista de faltas");

  const salvar = feeding.slice(feeding.indexOf("async function saveFeeding"), feeding.indexOf("async function loadProductStock"));
  assert.match(salvar, /feedingErrors\(/, "saveFeeding grava sem checar nada");
  assert.ok(salvar.indexOf("feedingErrors(") < salvar.indexOf("const record"),
    "a checagem tem que vir antes de montar o registro");
});

test("a faixa de sem conexão nunca aparece vazia", () => {
  const html = read("index.html");
  const faixa = html.match(/<div id="offlineBar"[^>]*>([^<]*)<\/div>/);
  assert.ok(faixa, "faixa não encontrada no HTML");
  assert.ok(faixa[1].trim().length > 0,
    "o texto mora no HTML: se o JS não rodar, a faixa amarela aparece pelada");
  assert.doesNotMatch(read("src/bootstrap.js"), /offlineBar'\)\.textContent|bar\.textContent/,
    "o JS não deve reescrever o texto da faixa");
});

test("sair do sistema não deixa os dados da fazenda no aparelho", () => {
  assert.match(read("src/auth.js"), /SupCache\.clear\(\)/);
});

test("o começo do dia é meia-noite na fazenda", () => {
  const home = read("src/home.js");
  assert.match(home, /farmDayBounds\(/, "startOfToday usava a meia-noite do aparelho");
  assert.doesNotMatch(home, /now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\)/);
});

test("tela que depende do servidor avisa em vez de tentar buscar", () => {
  const ui = read("src/ui.js");
  assert.match(ui, /function applyNetworkGate/);
  assert.match(ui, /SupCache\.needsNetwork\(/);
  assert.match(ui, /precisa de internet/i, "o aviso tem que dizer o que fazer");

  const showTab = ui.slice(ui.indexOf("function showTab"), ui.indexOf("function showSubTab"));
  assert.match(showTab, /if\s*\(applyNetworkGate\(id\)\)\s*return/,
    "sem o return, a tela bloqueada ainda dispara a busca");
  assert.ok(showTab.indexOf("applyNetworkGate") < showTab.indexOf("loadHome"),
    "o bloqueio tem que vir antes de qualquer loader");
});

test("quando a conexão volta, a tela bloqueada se recarrega sozinha", () => {
  const bootstrap = read("src/bootstrap.js");
  const aoVoltar = bootstrap.slice(bootstrap.indexOf("addEventListener('online'"));
  assert.match(aoVoltar.slice(0, 200), /showTab\(currentTabId\(\)\)/,
    "sem isso o usuário fica olhando o aviso mesmo com internet de volta");
});

test("a fila de tratos não tenta subir enquanto está sem conexão", () => {
  const outbox = read("src/outbox.js");
  const sync = outbox.slice(outbox.indexOf("async function syncOutbox"));
  const guarda = sync.indexOf("isOffline()");
  const rede = sync.indexOf("sb.auth.getSession");
  assert.ok(guarda > 0, "syncOutbox não checa a conexão");
  assert.ok(guarda < rede, "cada tentativa sem rede vira um erro de fetch no console");
});

test("sem conexão, o supabase para de tentar renovar a sessão sozinho", () => {
  const ui = read("src/ui.js");
  assert.match(ui, /function applyAutoRefresh/);
  assert.match(ui, /sb\.auth\.stopAutoRefresh\(\)/,
    "o ticker do supabase tenta renovar a cada 30s e cada tentativa vira 8 fetch");
  assert.match(ui, /sb\.auth\.startAutoRefresh\(\)/, "sem religar, a sessão não volta a se renovar");

  const mudanca = ui.slice(ui.indexOf("function noteConnection"));
  assert.match(mudanca.slice(0, 260), /applyAutoRefresh\(\)/, "a troca de estado precisa mexer no ticker");

  const bootstrap = read("src/bootstrap.js");
  for (const evento of ["online", "offline"]) {
    const trecho = bootstrap.slice(bootstrap.indexOf(`addEventListener('${evento}'`), bootstrap.indexOf(`addEventListener('${evento}'`) + 220);
    assert.match(trecho, /applyAutoRefresh\(\)/, `o evento ${evento} não ajusta o ticker`);
  }
});

test("toda chamada ao supabase tem prazo para desistir", () => {
  const api = read("src/api.js");
  assert.match(api, /global: \{ fetch: supFetch \}/,
    "sem isso o getSession do supabase fica 25s tentando antes de o app desenhar");
  assert.match(api, /SUP_CONFIG\.requestTimeoutMs/);
  assert.match(api, /SUP_CONFIG\.offlineRetryMs/, "sem trava, cada tela sem rede repete os 8 fetch do refresh");
  assert.doesNotMatch(api, /await fetch\(`\$\{SUP_CONFIG\.supabaseUrl\}/,
    "a função admin também precisa passar pelo fetch com prazo");
});

test("o app não busca o mesmo dado duas vezes ao abrir", () => {
  const offline = read("src/offline.js");
  assert.match(offline, /emAndamento/, "duas telas pedindo junto disparavam duas buscas");
  assert.match(offline, /maxAgeMs/, "trocar de aba refazia a busca dos cadastros");

  const feeding = read("src/feeding.js");
  assert.match(feeding, /loadProductStock\(\{ force: true \}\)/,
    "depois de salvar um trato o saldo tem que vir fresco, sem esperar o prazo");
});
