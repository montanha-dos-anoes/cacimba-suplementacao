import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

const SOURCES = [
  "src/config.js", "src/api.js", "src/state.js", "src/farm-time.js", "src/offline.js", "src/units.js", "src/balance-guard.js", "src/ui.js", "src/outbox.js", "src/nav.js", "src/modal.js", "src/datefield.js", "src/auth.js",
  "src/feeding.js", "src/masters.js", "src/lots.js", "src/stock.js", "src/stock-manage.js", "src/formulas.js", "src/production.js", "src/feeding-report.js", "src/reports.js", "src/home.js", "src/bootstrap.js"
];

test("o HTML não carrega mais JavaScript nem CSS embutido", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.doesNotMatch(html, /<script>\s*[^<]/);
  assert.doesNotMatch(html, /data:image\/[a-z]+;base64/);
});

test("todos os arquivos referenciados pelo HTML existem", () => {
  const html = read("index.html");
  const paths = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)[^"]*"/g)].map(match => match[1]);
  assert.ok(paths.length > 5);
  for (const path of paths) assert.ok(existsSync(resolve(root, path)), `Arquivo ausente: ${path}`);
});

test("não sobrou nenhum manipulador inline — é o que o CSP exige", () => {
  const alvos = ["index.html", ...SOURCES];
  for (const path of alvos) {
    const inline = [...read(path).matchAll(/\son(?:click|change|input|submit|load|error)\s*=/g)];
    assert.deepEqual(inline.map(m => m[0].trim()), [],
      `${path} ainda tem manipulador inline; com script-src sem 'unsafe-inline' ele não dispara`);
  }
});

test("toda ação declarada por data-* está registrada no bootstrap", () => {
  const marcado = ["index.html", ...SOURCES].map(read).join("\n");
  const bootstrap = read("src/bootstrap.js");

  const registradas = tipo => {
    const bloco = bootstrap.match(new RegExp(`defineActions\\('${tipo}',\\s*\\{([\\s\\S]*?)\\n\\}\\);`));
    assert.ok(bloco, `falta defineActions('${tipo}', …) no bootstrap`);
    return new Set([...bloco[1].matchAll(/^\s{2}([A-Za-z][\w]*)\s*:/gm)].map(m => m[1]));
  };

  for (const [attr, tipo] of [["do", "click"], ["change", "change"], ["input", "input"]]) {
    const usadas = new Set([...marcado.matchAll(new RegExp(`data-${attr}="([A-Za-z][\\w]*)"`, "g"))].map(m => m[1]));
    const conhecidas = registradas(tipo);
    const orfas = [...usadas].filter(name => !conhecidas.has(name));
    assert.deepEqual(orfas, [], `data-${attr} sem handler registrado: ${orfas.join(", ")}`);
  }
});

test("o dispatcher de ações está ligado", () => {
  assert.match(read("src/ui.js"), /function dispatchAction/);
  assert.match(read("src/ui.js"), /function bindActions/);
  assert.match(read("src/bootstrap.js"), /bindActions\(\);/);
});

test("o CSP não abre mão de script-src", () => {
  const headers = read("_headers");
  assert.match(headers, /Content-Security-Policy:/);
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)[1];
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/, "script-src com unsafe-inline anula o ganho");
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);
  for (const diretiva of ["default-src", "connect-src", "frame-ancestors", "object-src", "base-uri"]) {
    assert.match(csp, new RegExp(diretiva), `falta ${diretiva} no CSP`);
  }
  assert.match(csp, /connect-src[^;]*supabase\.co/, "sem supabase em connect-src o app não fala com o banco");
});

test("nenhum texto de usuário é interpolado dentro de onclick", () => {
  const sources = SOURCES.map(read).join("\n");
  const handlers = [...sources.matchAll(/onclick="([^"]*)"/g)].map(match => match[1]);
  const comTexto = handlers.filter(handler => /\$\{esc\(/.test(handler));
  assert.deepEqual(comTexto, [], "use data-* + listener; entidade HTML vira aspa e escapa da string JS");
});

test("gravar fecha a folha de gestão em vez de deixá-la aberta", () => {
  const stock = read("src/stock-manage.js");
  assert.doesNotMatch(stock, /sheet\.select\("entrada"\)/);
  assert.doesNotMatch(stock, /sheet\.select\("baixa"\)/);
  assert.doesNotMatch(stock, /sheet\.select\("editar"\)/);
  assert.ok(stock.match(/sheet\.close\(\)/g).length >= 5, "toda gravação da folha precisa fechar");
});

test("gravar trato limpa o formulário e volta pro Início", () => {
  const feeding = read("src/feeding.js");
  assert.match(feeding, /function resetFeedingForm/);
  assert.match(feeding, /resetFeedingForm\(\);[\s\S]*showTab\('inicio'\)/);
});

test("relatório de estoque não promete um período que ele ignora", () => {
  const reports = read("src/reports.js");
  const html = read("index.html");
  assert.match(reports, /function reportUsesPeriod/);
  assert.match(reports, /reportFromBox.*hidden|hidden.*reportFromBox/s);
  assert.match(reports, /if \(!reportUsesPeriod\(\)\) return `posição de/);
  for (const id of ["reportFromBox", "reportToBox"]) {
    assert.match(html, new RegExp(`id="${id}"`), `falta o id ${id} para esconder o filtro`);
  }
});

test("relatório busca todas as páginas em vez de parar no limite do PostgREST", () => {
  const reports = read("src/reports.js");
  assert.match(reports, /async function fetchAllReportRows/);
  assert.match(reports, /\.range\(/);
  assert.doesNotMatch(reports, /renderReport\(rows, \[/, "as colunas saem das chaves da linha, não de lista paralela");
});

test("correção de custo de entrada passa por RPC, não por update direto", () => {
  const stock = read("src/stock-manage.js");
  assert.match(stock, /suplementacao_fix_entry_cost/);
  assert.doesNotMatch(stock, /\.update\(\{\s*unit_cost/);
});

test("o mapa de tipos de movimento existe num lugar só", () => {
  assert.match(read("src/ui.js"), /const STOCK_KINDS =/);
  assert.doesNotMatch(read("src/stock-manage.js"), /const STOCK_KINDS =/);
  assert.doesNotMatch(read("src/reports.js"), /const kinds = \{/);
});

test("toda biblioteca do CDN tem versão fixa e integrity", () => {
  const html = read("index.html");
  const tags = [...html.matchAll(/<script src="(https:\/\/[^"]+)"([^>]*)>/g)];
  assert.ok(tags.length >= 4, "esperava supabase, xlsx, jspdf e autotable");
  for (const [, url, attrs] of tags) {
    assert.match(attrs, /integrity="sha384-[A-Za-z0-9+/=]{60,}"/, `sem integrity: ${url}`);
    assert.match(attrs, /crossorigin="anonymous"/, `integrity sem crossorigin não valida: ${url}`);
    assert.doesNotMatch(url, /@\d+(\.\d+)?$/, `versão flutuante não aceita integrity: ${url}`);
  }
});

test("as bibliotecas do service worker são as mesmas do HTML", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  const noHtml = [...html.matchAll(/<script src="(https:\/\/cdn\.jsdelivr\.net[^"]+)"/g)].map(m => m[1]).sort();
  const noSw = [...sw.matchAll(/"(https:\/\/cdn\.jsdelivr\.net[^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(noSw, noHtml, "CDN_URLS do sw.js divergiu do HTML — o app quebra offline");
});

test("salvar fórmula é uma transação só no banco", () => {
  const formulas = read("src/formulas.js");
  assert.match(formulas, /suplementacao_save_formula/);
  assert.doesNotMatch(formulas, /from\("suplementacao_formula_items"\)\.insert/);
  assert.doesNotMatch(formulas, /function resolveFormulaProduct/);
});

test("trato lançado errado tem conserto pela tela", () => {
  const feeding = read("src/feeding.js");
  assert.match(feeding, /function openFeedingEdit/);
  assert.match(feeding, /async function deleteFeeding/);
  assert.match(feeding, /rpc\('correct_feeding_record'/, "tem que ser a v1, que preserva product_id");
  assert.match(feeding, /rpc\('delete_feeding_record_v2'/);
});

test("a correção de trato nunca usa correct_feeding_record_v2", () => {
  const sources = SOURCES.map(read).join("\n");
  assert.doesNotMatch(sources, /correct_feeding_record_v2/,
    "a v2 zera product_id e o gatilho apaga a baixa de estoque do trato");
});

test("a janela de 30 min do perfil Campo aparece na tela", () => {
  const feeding = read("src/feeding.js");
  assert.match(feeding, /FEEDING_FIELD_WINDOW_MIN\s*=\s*30/);
  assert.match(feeding, /function canEditFeeding/);
  assert.match(feeding, /role==='owner'\|\|profile\.role==='admin'/);
});

test("o login aceita o PIN cru e o PIN com o prefixo que a admin-users grava", () => {
  const auth = read("src/auth.js");
  const fn = read("supabase/edge-functions/admin-users/index.ts");
  assert.match(fn, /const pinPassword=\(pin:string\)=>`Cc\$\{pin\}`/,
    "a Edge Function padded o PIN para chegar aos 6 caracteres que o Supabase Auth exige");
  assert.match(auth, /function pinPassword\(pin\)\{return `Cc\$\{pin\}`\}/,
    "o front precisa do mesmo prefixo, senão o PIN certo volta invalid_credentials");
  assert.match(auth, /const attempts=typedId\.includes\('@'\)\?\[typedPass,pinPassword\(typedPass\)\]:\[pinPassword\(typedPass\),typedPass\]/,
    "Proprietário entra com senha crua e usuário de campo com PIN prefixado — tem que tentar os dois");
  assert.match(auth, /function badCredentials/);
});

test("a admin-users versionada aponta para a tabela com prefixo", () => {
  const fn = read("supabase/edge-functions/admin-users/index.ts");
  assert.doesNotMatch(fn, /from\('profiles'\)/,
    "depois do rename-legadas.sql a tabela public.profiles não existe mais");
  assert.match(fn, /from\('suplementacao_profiles'\)/);
});

test("o lote guarda composição versionada em vez de só um nome", () => {
  const html = read("index.html");
  const lotsFile = read("src/lots.js");
  const sql = read("supabase/13-lotes-versionados.sql");

  assert.doesNotMatch(html, /id="newLot"/, "o campo solto de adicionar lote saiu");
  assert.match(html, /data-do="lotCreate"/);
  assert.match(html, /id="lotTabs"/);
  for (const fn of ["function lotVersionForDate", "function currentLotInfo", "function openLotSupplement", "function openLotHistory", "async function saveLot"]) {
    assert.ok(lotsFile.includes(fn), `falta ${fn} em src/lots.js`);
  }
  assert.match(lotsFile, /suplementacao_lot_versions/);
  assert.match(lotsFile, /suplementacao_lot_version_groups/);
  assert.match(lotsFile, /suplementacao_save_lot_configuration/);
  assert.match(sql, /rename to suplementacao_lot_versions/);
  assert.match(sql, /rename to suplementacao_lot_version_groups/);
  assert.match(sql, /on conflict \(lot_id, effective_from\) do update/,
    "salvar o mesmo lote na mesma data deve atualizar a vigência existente");
  assert.match(sql, /delete from public\.suplementacao_lot_version_groups[\s\S]*where lot_version_id = v_version_id/,
    "ao atualizar a vigência, os grupos antigos devem ser substituídos");
  assert.doesNotMatch(sql, /Já existe uma configuração deste lote com esta data de vigência/);
  assert.doesNotMatch(read("src/masters.js"), /async function addLot/, "o cadastro de lote mora em src\/lots.js agora");
});

test("criar e editar lote mantém o botão de salvar fixo no rodapé do modal", () => {
  const modal = read("src/modal.js");
  const lotsFile = read("src/lots.js");
  const css = read("assets/css/app.css");

  assert.match(modal, /class="sheetFooter" hidden/);
  assert.match(modal, /setFooter: html/);
  assert.match(lotsFile, /sheet\.setFooter\('<button class="btn" id="sheetLotSaveBtn"/,
    "o mesmo editor atende tanto o cadastro quanto a edição do lote");
  assert.match(css, /\.sheetFooter\{[^}]*flex:none[^}]*border-top:/);
  assert.match(css, /\.sheetFooter \.btn\{width:100%\}/);
});

test("os filtros e o botão de novo lote ficam alinhados", () => {
  const html = read("index.html");
  const css = read("assets/css/app.css");

  assert.match(html, /class="stockToolbar lotToolbar"[\s\S]*id="lotTabs"/);
  assert.match(css, /\.lotToolbar \.tabs\{[^}]*margin:0/);
  assert.match(css, /\.lotToolbar \.tab,\.lotToolbar>\.btn\{[^}]*height:40px/);
});

test("o custo do produto fabricado acompanha o custo total da fabricação", () => {
  const sql = read("supabase/15-corrigir-custo-fabricacao.sql");

  assert.match(sql, /total_cost, quantity_kg, product_id/);
  assert.match(sql, /set unit_cost = round\(coalesce\(p\.total_cost, 0\) \/ p\.quantity_kg, 4\)/,
    "a migração precisa corrigir as fabricações que já foram registradas");
  assert.match(sql, /after update of total_cost, quantity_kg, product_id/,
    "as próximas fabricações também precisam manter o movimento sincronizado");
  assert.match(sql, /m\.kind in \('entry', 'yield'\)/,
    "o custo médio deve considerar entradas e produtos fabricados");
});

test("datas automáticas de trato e fabricação não ficam congeladas desde a abertura do app", () => {
  const html = read("index.html");
  const feeding = read("src/feeding.js");
  const production = read("src/production.js");

  assert.match(html, /id="occurred"[^>]*data-change="feedingOccurred"/);
  assert.match(html, /id="productionDate"[^>]*data-change="productionOccurred"/);
  assert.match(feeding, /async function saveFeeding\(\)[\s\S]*refreshAutomaticDateTime\(\$\('occurred'\)\)/);
  assert.match(production, /async function saveProduction\(\)[\s\S]*refreshAutomaticDateTime\(\$\("productionDate"\)\)/);
  assert.match(production, /farmLocalToDate\(occurred\)\.toISOString\(\)/,
    "a data exibida no fuso da fazenda deve ser convertida no mesmo fuso antes de gravar");
});

test("a categoria do lote aponta para um produto do estoque, não texto livre", () => {
  const lotsFile = read("src/lots.js");
  const sql = read("supabase/13-lotes-versionados.sql");
  assert.match(lotsFile, /productOptionsHtml\(group\?\.product_id \|\| ""\)/,
    "o produto da categoria é escolhido no select do estoque");
  assert.match(lotsFile, /product_id: row\.querySelector\("\.lotProduct"\)\.value/);
  assert.match(sql, /set product_id = p\.id/, "a migração casa o product_name antigo com o produto do estoque");
  assert.match(sql, /raise exception 'Escolha o produto de todas as categorias\.'/);
});

test("o trato pré-seleciona o produto do lote e deixa trocar", () => {
  const html = read("index.html");
  const feeding = read("src/feeding.js");
  const bootstrap = read("src/bootstrap.js");

  assert.match(html, /id="lot" data-change="lotProduct"/);
  assert.match(html, /id="lotProductHint"/);
  assert.match(html, /<select id="product"/, "o produto continua sendo um select que o usuário pode trocar");
  assert.match(feeding, /function applyLotProduct/);
  assert.match(feeding, /function renderLotProductHint/);
  assert.match(feeding, /lotMainGroup\(info\)/, "quem manda é a categoria com mais animais");
  assert.match(bootstrap, /lotProduct:\(\)=>applyLotProduct\(\)/);
  assert.match(bootstrap, /feedingOccurred:\(\)=>feedingOccurredChanged\(\)/);
  assert.doesNotMatch(feeding, /\$\("product"\)\.disabled/, "pré-selecionar não pode travar o campo");
});

test("o botão de remover linha é uma lixeira que serve qualquer lista", () => {
  const css = read("assets/css/app.css");
  assert.match(css, /^\.rowRemove\{position:absolute/m,
    "estilo preso a .formulaRow deixa a linha de categoria do lote com um quadradinho vazio");
  assert.match(css, /^\.rowRemove svg\{width:/m, "sem tamanho o svg renderiza 0x0");
  assert.match(css, /\.formulaRow,\.lotGroupRow\{position:relative\}/);
  assert.match(css, /\.formulaRowGrid,\.lotGroupGrid\{padding-right:/, "sem folga a lixeira cobre o primeiro campo");
  assert.match(read("src/ui.js"), /^  trash: '<svg/m);
  for (const file of ["src/lots.js", "src/formulas.js"]) {
    assert.match(read(file), /class="rowRemove"[^>]*>\$\{icon\("trash"\)\}/, `${file} não usa a lixeira`);
  }
});

test("as ações do lote ficam num grid de colunas iguais", () => {
  const css = read("assets/css/app.css");
  assert.match(css, /\.lotActions\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(150px,1fr\)\)/,
    "coluna menor que 150px quebra o rótulo Alterar suplemento em duas linhas");
  assert.match(css, /\.lotActions \.btn\{width:100%;white-space:nowrap\}/);
  assert.match(read("src/lots.js"), /class="actions lotActions"/);
});

test("estar sem rede não é a mesma coisa que navigator.onLine false", () => {
  const ui = read("src/ui.js");
  assert.match(ui, /function isNetworkError/);
  assert.match(ui, /function noteConnection/);
  assert.match(ui, /let connectionDown = false/);
  const corpo = ui.slice(ui.indexOf("function isOffline()"));
  assert.ok(corpo.includes("return connectionDown;"),
    "celular com sinal fraco reporta onLine true; a falha real de rede também conta");
  assert.match(ui, /if \(isNetworkError\(text\)\) noteConnection\(false\)/);
});

test("trato grava offline; o resto das telas continua exigindo rede", () => {
  const ui = read("src/ui.js");
  const bootstrap = read("src/bootstrap.js");
  assert.match(ui, /async function runAction\(button, work, waitingLabel = "Salvando…", \{ offline = false \} = \{\}\)/);
  assert.match(ui, /if \(!offline && isOffline\(\)\)/);
  assert.match(bootstrap, /saveFeeding:el=>runAction\(el,saveFeeding,'Salvando…',\{offline:true\}\)/);
  assert.match(bootstrap, /syncOutbox:el=>runAction\(el,\(\)=>syncOutbox\(true\),'Enviando…',\{offline:true\}\)/);
  const linhaDe = nome => bootstrap.split("\n").find(linha => linha.includes(`${nome}:`)) || "";
  for (const write of ["saveProduction", "saveFormula", "saveLot", "createUser"]) {
    assert.ok(!linhaDe(write).includes("offline:true"),
      `${write} depende de saldo/validação do servidor e não pode entrar na fila offline`);
  }
});

test("a fila de tratos sobrevive ao aparelho e não duplica no reenvio", () => {
  const outbox = read("src/outbox.js");
  const feeding = read("src/feeding.js");
  assert.match(outbox, /const OUTBOX_KEY = "suplementacao:outbox"/);
  assert.match(outbox, /localStorage\.setItem\(OUTBOX_KEY/, "a fila tem que sobreviver a fechar o app");
  assert.match(feeding, /id:newLocalId\(\)/,
    "o id vem do aparelho: é ele que impede o mesmo trato entrar duas vezes");
  assert.match(outbox, /error\.code === "23505"/,
    "chave duplicada significa que já subiu antes — tira da fila em vez de tentar de novo");
  assert.match(outbox, /if \(isNetworkError\(error\)\)[\s\S]{0,120}semRede = true/,
    "caiu a rede no meio: para e mantém o resto da fila");
  assert.match(feeding, /if\(isOffline\(\)\)return queueFeeding\(record\)/);
  assert.match(feeding, /if\(isNetworkError\(error\)\)\{noteConnection\(false\);return queueFeeding\(record\)\}/,
    "falhou por rede depois de tentar: vai pra fila em vez de perder o trato");
  assert.match(read("sw.js"), /"\.\/src\/outbox\.js"/);
});

test("offline entra com o perfil guardado, mas acesso revogado não entra", () => {
  const auth = read("src/auth.js");
  assert.match(auth, /const PROFILE_CACHE_KEY='suplementacao:profile'/);
  assert.match(auth, /function storedSessionUserId/);
  assert.match(auth, /const guardado=storedSessionUserId\(\);/,
    "tem que ler o id antes do getSession, que apaga o token quando o refresh é recusado");
  const abre = auth.slice(auth.indexOf("async function bootOnce"), auth.indexOf("async function refreshAccess"));
  assert.match(abre, /if\(isOffline\(\)\)\{/,
    "sem rede o boot nem chama o servidor: esperar dois timeouts pisca a tela de login");
  assert.doesNotMatch(abre, /await sb\./,
    "a tela sai do aparelho primeiro; esperar a rede para decidir e o que joga o usuario no login");
  assert.ok(abre.indexOf("applyProfile(local)") < abre.indexOf("accessRefresh="),
    "o perfil guardado desenha a tela antes de a conferencia comecar");

  const confere = auth.slice(auth.indexOf("async function refreshAccess"));
  assert.match(confere, /if\(!sessao&&error&&isNetworkError\(error\)\)/,
    "sem rede cai no cache; token recusado pelo servidor nao cai");
  assert.match(confere, /if\(estado\)forgetAccess\(\)/,
    "sessao recusada pelo servidor tem que limpar o acesso guardado");
  assert.match(confere, /if\(perfilErro&&isNetworkError\(perfilErro\)\)return noteConnection\(false\)/,
    "consulta que falhou por rede nao pode derrubar quem ja estava dentro");
  assert.match(auth, /localStorage\.removeItem\(PROFILE_CACHE_KEY\)/, "sair limpa o perfil guardado");
});

test("a fila aparece na tela e dá para reenviar ou descartar", () => {
  const html = read("index.html");
  const outbox = read("src/outbox.js");
  const feeding = read("src/feeding.js");
  assert.match(html, /id="outboxBar"/);
  assert.match(outbox, /function renderOutboxBar/);
  assert.match(outbox, /data-do="syncOutbox"/);
  assert.match(outbox, /async function discardQueuedFeeding/);
  assert.match(feeding, /AGUARDANDO INTERNET/);
  assert.match(feeding, /data-feed-drop=/);
  const online = read("src/bootstrap.js").split("\n").find(linha => linha.includes("addEventListener('online'")) || "";
  assert.ok(online.includes("syncOutbox()"), "voltou a internet, a fila sobe sozinha");
  assert.match(read("assets/css/app.css"), /\.outboxBar\{/);
});

test("o frontend só carrega chave publicável", () => {
  const config = read("src/config.js");
  assert.match(config, /supabaseUrl:\s*"https:\/\/[^"]+\.supabase\.co"/);
  assert.doesNotMatch(SOURCES.map(read).join("\n"), /service_role|sb_secret_/i);
});

test("o modal largo e os ícones existem e não usam emoji de engrenagem", () => {
  const sources = SOURCES.map(read).join("\n");
  assert.match(sources, /function showSheet\s*\(/);
  assert.match(sources, /const icon = name =>/);
  assert.doesNotMatch(sources, /⚙/);
});

test("o modelo antigo de unidade e os formulários soltos sumiram", () => {
  const html = read("index.html");
  const sources = SOURCES.map(read).join("\n");
  assert.doesNotMatch(sources, /alt_unit/);
  assert.doesNotMatch(sources, /\brow\.unit\b|\bstockRows\[[^\]]*\]\.unit\b/);
  for (const id of ["entryProduct", "baixaProduct", "stockAltUnit", "stockHasAlt", "stockUnit"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `id removido ainda presente: ${id}`);
  }
  assert.match(html, /id="stockSearch"/);
});

test("estoque mínimo não existe mais em lugar nenhum", () => {
  const html = read("index.html");
  const sources = SOURCES.map(read).join("\n");
  assert.doesNotMatch(sources, /min_stock|below_min/);
  assert.doesNotMatch(sources, /ABAIXO DO MÍNIMO/);
  assert.doesNotMatch(html, /id="sheetEditMin"|id="stockMin"|>Mínimo</);
});

test("a fórmula trabalha só em porcentagem e o produto sai do nome dela", () => {
  const html = read("index.html");
  const formulas = read("src/formulas.js");
  assert.doesNotMatch(html, /id="formulaBase"/);
  for (const id of ["formulaHasProduct", "formulaProductPick", "formulaProductNew", "formulaNewProduct", "formulaProduct"]) {
    assert.doesNotMatch(html + formulas, new RegExp(`id="${id}"`), `campo removido ainda presente: ${id}`);
  }
  assert.doesNotMatch(formulas, /function toggleFormulaProduct/);
  assert.match(formulas, /p_new_product_name: editingFormulaProductId \? null : name/,
    "sem produto escolhido à mão, o nome da fórmula é quem cria o produto");
});

test("a navegação cobre todas as telas e Cadastros saiu", () => {
  const html = read("index.html");
  const nav = read("src/nav.js");
  for (const id of ["inicio", "trato", "estoque", "lotes", "historico", "relatorios", "sistema"]) {
    assert.match(nav, new RegExp(`id: "${id}"`), `destino ausente na navegação: ${id}`);
    assert.match(html, new RegExp(`<section id="${id}"`), `tela ausente no HTML: ${id}`);
  }
  assert.doesNotMatch(html, /id="cadastros"/);
  assert.match(html, /id="bottomNav"/);
  assert.match(html, /id="sideNav"/);
});

test("Fórmulas virou aba do Estoque, ao lado de Fabricar", () => {
  const html = read("index.html");
  const nav = read("src/nav.js");
  const ui = read("src/ui.js");
  assert.doesNotMatch(nav, /id: "formulas"/, "Fórmulas não é mais destino do menu");
  assert.doesNotMatch(html, /<section id="formulas"/, "a tela solta de fórmulas saiu");
  assert.match(html, /data-arg="sub-formulas"/);
  assert.match(html, /<div id="sub-formulas"/);
  for (const id of ["sub-estoque", "sub-fabricar", "sub-formulas"]) {
    assert.match(ui, new RegExp(`'${id}'`), `sub-aba fora do mapa do showSubTab: ${id}`);
  }
  assert.match(ui, /function currentSubTab/);
  assert.match(nav, /STOCK_SUBTABS\[currentSubTab\(\)\]/, "atualizar tela tem que respeitar a sub-aba aberta");
});

test("listar fórmula e criar fórmula são telas separadas", () => {
  const html = read("index.html");
  const formulas = read("src/formulas.js");
  assert.match(html, /data-do="formulaCreate"/, "falta o botão que abre o modal");
  assert.match(html, /id="formulasList"/);
  assert.match(formulas, /function openFormulaSheet/);
  assert.match(formulas, /showSheet\(\{/, "o editor tem que morar num modal, como o do estoque");
  assert.match(formulas, /function renderFormulaEditor/);
  assert.match(formulas, /function renderFormulas/);
  const editorIds = [...formulas.matchAll(/id="(formula[A-Za-z]*)"/g)].map(match => match[1]);
  assert.deepEqual(editorIds, [], `id do editor sem prefixo sheet: ${editorIds.join(", ")}`);
});

test("o campo de data é um componente próprio, não o nativo do navegador", () => {
  const html = read("index.html");
  const field = read("src/datefield.js");
  const bootstrap = read("src/bootstrap.js");
  assert.match(field, /function enhanceDateFields/);
  assert.match(field, /function showDateTimePicker/);
  assert.match(field, /function openDateField/);
  assert.match(bootstrap, /dateField:\(el,arg\)=>openDateField\(arg\)/);
  assert.match(bootstrap, /enhanceDateFields\(document\)/);
  assert.match(read("src/modal.js"), /enhanceDateFields\(body\)/, "campo de data dentro de folha também precisa virar componente");
  assert.match(read("assets/css/app.css"), /\.dateFieldBtn\{/);
  assert.ok(/type="date"|type="datetime-local"/.test(html), "os inputs nativos seguem no HTML como depósito do valor");
});

test("toda gravação passa pela trava de duplo clique", () => {
  const html = read("index.html");
  const bootstrap = read("src/bootstrap.js");
  const marcado = [html, ...SOURCES.map(read)].join("\n");
  const writers = ["signIn", "firstOwner", "saveFeeding", "saveProduction", "saveFormula", "saveLot", "createUser"];
  for (const name of writers) {
    assert.match(marcado, new RegExp(`data-do="${name}"`), `${name} não está ligado a nenhum botão`);
    assert.match(bootstrap, new RegExp(`\\n\\s{2}${name}:\\s*el\\s*=>\\s*runAction\\(el,`), `${name} não está protegido por runAction`);
  }
  assert.match(read("src/ui.js"), /async function runAction/);
});

test("campo numérico usa máscara em vez de input type number", () => {
  const html = read("index.html");
  const sources = SOURCES.map(read).join("\n");
  assert.doesNotMatch(html, /type="number"/);
  assert.doesNotMatch(sources, /type="number"/);
  assert.match(sources, /function sanitizeDecimal/);
});

test("o app é instalável e o service worker cobre tudo que o HTML carrega", () => {
  const html = read("index.html");
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const sw = read("sw.js");

  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/);
  assert.match(read("src/bootstrap.js"), /serviceWorker.*register\('\.\/sw\.js'/s);
  assert.ok(manifest.icons.some(item => item.sizes === "192x192"), "falta ícone 192");
  assert.ok(manifest.icons.some(item => item.sizes === "512x512"), "falta ícone 512");
  assert.ok(manifest.icons.some(item => item.purpose === "maskable"), "falta ícone maskable");
  for (const item of manifest.icons) assert.ok(existsSync(resolve(root, item.src)), `ícone ausente: ${item.src}`);

  const loaded = [...html.matchAll(/src="\.\/(src\/[^"?]+)/g)].map(match => match[1]);
  assert.ok(loaded.length > 10);
  for (const file of loaded) {
    assert.match(sw, new RegExp(`"\\./${file.replace(/\./g, "\\.")}"`), `fora do cache offline: ${file}`);
  }
  assert.match(sw, /\.\/assets\/css\/app\.css/);
});

test("a fórmula aceita digitar em % ou em kg", () => {
  const formulas = read("src/formulas.js");
  assert.match(formulas, /id="sheetFormulaMode"/);
  assert.match(formulas, /id="sheetFormulaBatch"/);
  assert.match(formulas, /function setFormulaMode/);
  assert.match(formulas, /unit: "percent"/, "a fórmula tem que continuar sendo gravada em porcentagem");
});

test("cadastro de produto aceita saldo inicial e o histórico corrige valor de entrada", () => {
  const manage = read("src/stock-manage.js");
  assert.match(manage, /id="sheetInitQty"/);
  assert.match(manage, /id="sheetInitCost"/);
  assert.match(manage, /suplementacao_add_stock_entry/);
  assert.match(manage, /async function fixEntryCost/);
  assert.match(manage, /data-fix=/);
});

test("entrada de produto fabricado oferece rodar a fórmula", () => {
  const manage = read("src/stock-manage.js");
  assert.match(manage, /id="sheetEntryOrigin"/);
  assert.match(manage, /suplementacao_register_production/, "a origem fabricada tem que chamar a fabricação de verdade");
  assert.match(manage, /function refreshEntryPlan/);
  assert.match(read("src/formulas.js"), /async function fabricarFormula/);
});

test("exportação de PDF está ligada e as bibliotecas ficam disponíveis offline", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  assert.match(html, /id="reportPdfBtn"/);
  assert.doesNotMatch(html, /Gerar relatório/, "o botão sem função foi substituído pelo Exportar PDF");
  for (const lib of ["jspdf@2.5.1", "jspdf-autotable@3.8.2"]) {
    assert.match(html, new RegExp(lib.replace(/[.@]/g, "\$&")), `biblioteca ausente no HTML: ${lib}`);
    assert.match(sw, new RegExp(lib.replace(/[.@]/g, "\$&")), `biblioteca fora do cache: ${lib}`);
  }
  assert.match(read("src/reports.js"), /function exportReportPdf/);
});

test("Sistema tem manutenção: atualizar dados, backup e versão", () => {
  const html = read("index.html");
  const masters = read("src/masters.js");
  assert.match(html, /id="syncStatus"/);
  assert.match(html, /id="appVersionLine"/);
  assert.match(masters, /async function refreshAllData/);
  assert.match(masters, /async function downloadBackup/);
  assert.match(masters, /async function checkAppUpdate/);
});

test("a versão do app no config acompanha a do service worker", () => {
  const config = read("src/config.js").match(/appVersion:\s*"([^"]+)"/)[1];
  const cache = read("sw.js").match(/CACHE_PREFIX\}([\d.]+)/)[1];
  assert.equal(config, cache, "config.js e sw.js estão em versões diferentes");
});

test("toda tag ?v= do HTML acompanha a versão do config", () => {
  const config = read("src/config.js").match(/appVersion:\s*"([^"]+)"/)[1];
  const tags = [...read("index.html").matchAll(/\?v=([\d.]+)"/g)].map(match => match[1]);
  assert.equal(tags.length, SOURCES.length, "cada arquivo de src/ precisa da tag ?v= no HTML");
  assert.deepEqual([...new Set(tags)], [config], "há tag ?v= numa versão diferente do config.js");
});

test("atualizar dados está no cabeçalho, alcançável por qualquer perfil", () => {
  const html = read("index.html");
  const nav = read("src/nav.js");
  assert.match(html, /id="refreshBtn"/);
  assert.match(html, /data-do="refreshScreen"/);
  assert.match(read("src/bootstrap.js"), /refreshScreen:\s*el\s*=>\s*runAction\(el,\s*refreshCurrentScreen/);
  assert.match(nav, /async function refreshCurrentScreen/);
  assert.doesNotMatch(html, /id="refreshBtn"[^>]*class="[^"]*admin/, "o botão não pode ser exclusivo de admin");
});

test("relatório é paginado em tabela", () => {
  const reports = read("src/reports.js");
  assert.match(reports, /function paginate\(total, page, size\)/);
  assert.match(reports, /function renderReportPage/);
  assert.match(reports, /REPORT_PAGE_SIZE = 25/);
});

test("relatório pagina no servidor, não puxa tudo para a tela", () => {
  const reports = read("src/reports.js");
  assert.match(reports, /count: "exact", head: true/, "precisa do count no servidor");
  assert.match(reports, /\.range\(info\.offset, info\.offset \+ REPORT_PAGE_SIZE - 1\)/,
    "a tela tem que pedir só a página visível");
  assert.match(reports, /async function loadReportPage/);
  assert.doesNotMatch(reports, /buildReportTable\(reportRows\)\s*;/);
});

test("PDF grande avisa antes de travar o aparelho", () => {
  const reports = read("src/reports.js");
  assert.match(reports, /REPORT_PDF_WARN/);
  assert.match(reports, /reportTotal > REPORT_PDF_WARN[\s\S]{0,400}showConfirm/);
});

test("exportação tem teto e diz quando cortou", () => {
  const reports = read("src/reports.js");
  assert.match(reports, /REPORT_EXPORT_MAX/);
  assert.match(reports, /Math\.min\(reportTotal, REPORT_EXPORT_MAX\)/);
  assert.match(reports, /reduza o período para levar tudo/i);
});

test("tabela que vira cartão no celular tem rótulo em toda célula", () => {
  const sources = ["src/reports.js", "src/stock-manage.js", "src/production.js"].map(read).join("\n");
  const stacked = [...sources.matchAll(/<table class="[^"]*stackTable[^"]*"/g)];
  assert.ok(stacked.length >= 3, "esperava relatório, histórico e prévia de fabricação empilháveis");
  const cells = [...sources.matchAll(/<td[^>]*>/g)].map(match => match[0]);
  const semRotulo = cells.filter(cell => !cell.includes("data-label"));
  assert.deepEqual(semRotulo, [], "célula sem data-label fica sem título quando vira cartão");
  assert.match(read("assets/css/app.css"), /table\.stackTable td::before/);
});
