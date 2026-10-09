import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({ Intl, Date, Number, JSON, Map, Set });
  vm.runInContext(read("src/farm-time.js"), context);
  vm.runInContext(read("src/feeding-report.js"), context);
  return vm.runInContext(expression, context);
}

const VERSOES = [
  { id: "V1", lot_id: "L1", effective_from: "2026-09-01" }
];
const GRUPOS = [
  { id: "G1", lot_version_id: "V1", category: "Fêmeas recria", quantity: 52, avg_weight_kg: 162, product_id: "P1", expected_consumption_kg_head_day: 0.486 }
];
const PRODUTOS = [{ id: "P1", name: "0,3%" }];
const TRATOS = [
  { id: "t1", lot_id: "L1", product_id: "P1", quantity_kg: 25, trough_reading: "empty", occurred_at: "2026-09-02T09:20:00-04:00", edited_at: null, profiles: { full_name: "Luan" } },
  { id: "t2", lot_id: "L1", product_id: "P1", quantity_kg: 25, trough_reading: "full", occurred_at: "2026-09-02T13:29:00-04:00", edited_at: "2026-09-03T10:00:00-04:00", profiles: { full_name: "Luan" } },
  { id: "t3", lot_id: "L1", product_id: "P1", quantity_kg: 50, trough_reading: "empty", occurred_at: "2026-09-04T09:13:00-04:00", edited_at: null, profiles: { full_name: "Renato" } }
];

const CHAMADA = `SupFeedingReport.build({
  records: ${JSON.stringify(TRATOS)},
  versions: ${JSON.stringify(VERSOES)},
  groups: ${JSON.stringify(GRUPOS)},
  products: ${JSON.stringify(PRODUTOS)},
  lotId: "L1", from: "2026-09-01", to: "2026-09-04"
})`;

test("a lista de dias cobre o período inteiro, inclusive as pontas", () => {
  assert.deepEqual(run(`SupFeedingReport.dayList("2026-09-01", "2026-09-04")`),
    ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
});

test("período invertido não devolve dia nenhum", () => {
  assert.deepEqual(run(`SupFeedingReport.dayList("2026-09-04", "2026-09-01")`), []);
});

test("dias com e sem registro são contados separadamente", () => {
  const relatorio = run(CHAMADA);
  assert.equal(relatorio.diasComRegistro, 2);
  assert.equal(relatorio.diasSemRegistro, 2);
});

test("o trato total soma só o que foi lançado", () => {
  assert.equal(run(CHAMADA).totalKg, 100);
});

test("o dia sem trato aparece marcado, não some da tabela", () => {
  const dias = run(`${CHAMADA}.dias`);
  assert.equal(dias.length, 4, "todo dia do período tem que aparecer");
  const semTrato = dias.find(item => item.dia === "2026-09-01");
  assert.equal(semTrato.semRegistro, true);
  assert.equal(semTrato.animais, 52, "mesmo sem trato, o lote tinha animais naquele dia");
});

test("o dia com trato traz hora, categoria, responsável e se foi editado", () => {
  const dia = run(`${CHAMADA}.dias`).find(item => item.dia === "2026-09-02");
  assert.equal(dia.semRegistro, false);
  assert.equal(dia.totalDia, 50);
  assert.equal(dia.linhas.length, 2);
  assert.equal(dia.linhas[0].hora, "09:20");
  assert.equal(dia.linhas[0].categoria, "Fêmeas recria");
  assert.equal(dia.linhas[0].produto, "0,3%");
  assert.equal(dia.linhas[0].cocho, "Vazio");
  assert.equal(dia.linhas[0].responsavel, "Luan");
  assert.equal(dia.linhas[0].editado, "Não");
  assert.equal(dia.linhas[1].editado, "Sim");
  assert.equal(dia.linhas[1].cocho, "Cheio");
});

test("esperado por produto multiplica animais, consumo por cabeça e dias", () => {
  const porProduto = run(`${CHAMADA}.porProduto`);
  assert.equal(porProduto.length, 1);
  assert.equal(porProduto[0].produto, "0,3%");
  assert.equal(Math.round(porProduto[0].esperado * 1000) / 1000, 101.088);
  assert.equal(porProduto[0].fornecido, 100);
  assert.equal(Math.round(porProduto[0].diferenca * 1000) / 1000, -1.088);
});

test("o percentual compara fornecido com esperado", () => {
  const porProduto = run(`${CHAMADA}.porProduto`);
  assert.equal(Math.round(porProduto[0].percentual * 10) / 10, 98.9);
});

test("produtos diferentes nunca são somados entre si", () => {
  const grupos = JSON.stringify([
    ...GRUPOS,
    { id: "G2", lot_version_id: "V1", category: "Machos", quantity: 10, avg_weight_kg: 200, product_id: "P2", expected_consumption_kg_head_day: 1 }
  ]);
  const produtos = JSON.stringify([...PRODUTOS, { id: "P2", name: "Proteinado" }]);
  const porProduto = run(`SupFeedingReport.build({
    records: ${JSON.stringify(TRATOS)}, versions: ${JSON.stringify(VERSOES)}, groups: ${grupos},
    products: ${produtos}, lotId: "L1", from: "2026-09-01", to: "2026-09-04"
  }).porProduto`);
  assert.equal(porProduto.length, 2);
  const proteinado = porProduto.find(item => item.produto === "Proteinado");
  assert.equal(proteinado.fornecido, 0, "nenhum trato de Proteinado foi lançado");
  assert.equal(proteinado.esperado, 40);
});

test("a composição do período mostra categoria, animais, peso e esperado do grupo", () => {
  const composicao = run(`${CHAMADA}.composicao`);
  assert.equal(composicao.length, 1);
  assert.equal(composicao[0].inicio, "2026-09-01");
  assert.equal(composicao[0].fim, "2026-09-04");
  assert.equal(composicao[0].totalAnimais, 52);
  const grupo = composicao[0].grupos[0];
  assert.equal(grupo.categoria, "Fêmeas recria");
  assert.equal(grupo.animais, 52);
  assert.equal(grupo.pesoMedio, 162);
  assert.equal(grupo.produto, "0,3%");
  assert.equal(grupo.esperadoCabDia, 0.486);
  assert.equal(Math.round(grupo.esperadoGrupoDia * 1000) / 1000, 25.272);
});

test("a composição quebra quando a configuração do lote muda no meio do período", () => {
  const versoes = JSON.stringify([
    { id: "V1", lot_id: "L1", effective_from: "2026-09-01" },
    { id: "V2", lot_id: "L1", effective_from: "2026-09-03" }
  ]);
  const grupos = JSON.stringify([
    ...GRUPOS,
    { id: "G9", lot_version_id: "V2", category: "Fêmeas recria", quantity: 60, avg_weight_kg: 170, product_id: "P1", expected_consumption_kg_head_day: 0.5 }
  ]);
  const composicao = run(`SupFeedingReport.build({
    records: [], versions: ${versoes}, groups: ${grupos}, products: ${JSON.stringify(PRODUTOS)},
    lotId: "L1", from: "2026-09-01", to: "2026-09-04"
  }).composicao`);
  assert.equal(composicao.length, 2);
  assert.deepEqual([composicao[0].inicio, composicao[0].fim], ["2026-09-01", "2026-09-02"]);
  assert.deepEqual([composicao[1].inicio, composicao[1].fim], ["2026-09-03", "2026-09-04"]);
  assert.equal(composicao[1].totalAnimais, 60);
});

test("lote sem configuração vigente não inventa esperado", () => {
  const relatorio = run(`SupFeedingReport.build({
    records: [], versions: [], groups: [], products: ${JSON.stringify(PRODUTOS)},
    lotId: "L1", from: "2026-09-01", to: "2026-09-02"
  })`);
  assert.deepEqual(relatorio.porProduto, []);
  assert.deepEqual(relatorio.composicao, []);
  assert.equal(relatorio.diasSemRegistro, 2);
});

test("a planilha tem uma linha por trato, com os dados novos", () => {
  const linhas = run(`SupFeedingReport.flatRows(${CHAMADA})`);
  assert.equal(linhas.length, 5, "3 tratos + 2 dias sem registro");
  assert.deepEqual(Object.keys(linhas[0]), [
    "Data", "Hora", "Categoria", "Animais", "Produto", "Trato (kg)", "Leitura do cocho", "Responsável", "Editado"
  ]);
  const comTrato = linhas.find(linha => linha.Hora === "09:20");
  assert.equal(comTrato.Data, "02/09/2026");
  assert.equal(comTrato.Categoria, "Fêmeas recria");
  assert.equal(comTrato.Animais, 52);
  assert.equal(comTrato["Trato (kg)"], 25);
  assert.equal(comTrato["Leitura do cocho"], "Vazio");
  assert.equal(comTrato["Responsável"], "Luan");
  assert.equal(comTrato.Editado, "Não");
});

test("o dia sem registro vai para a planilha marcado e com zero", () => {
  const linhas = run(`SupFeedingReport.flatRows(${CHAMADA})`);
  const vazio = linhas.find(linha => linha.Data === "01/09/2026");
  assert.equal(vazio.Produto, "SEM REGISTRO");
  assert.equal(vazio["Trato (kg)"], 0, "zero soma certo na planilha; traço vira texto");
  assert.equal(vazio.Animais, 52);
});

test("o resumo da planilha traz composição e comparação por produto", () => {
  const resumo = run(`SupFeedingReport.summaryRows(${CHAMADA})`);
  const composicao = resumo.filter(linha => linha.Bloco === "Composição do lote");
  const produtos = resumo.filter(linha => linha.Bloco === "Consumo por produto");
  assert.equal(composicao.length, 1);
  assert.equal(composicao[0]["Categoria / Produto"], "Fêmeas recria");
  assert.equal(composicao[0].Animais, 52);
  assert.equal(produtos.length, 1);
  assert.equal(produtos[0]["Categoria / Produto"], "0,3%");
  assert.equal(produtos[0]["Fornecido (kg)"], 100);
});

test("a exportação do relatório de trato usa as linhas já calculadas", () => {
  const reports = read("src/reports.js");
  const buscar = reports.slice(reports.indexOf("async function fetchAllReportRows"));
  assert.match(buscar.slice(0, 400), /isFeedingReport\(\)/,
    "o relatório de trato não é paginado no servidor; as linhas já estão na memória");

  const excel = reports.slice(reports.indexOf("async function exportReport()"), reports.indexOf("function brandLogoDataUrl"));
  assert.match(excel, /summaryRows/, "a planilha precisa levar o resumo junto");
  assert.match(excel, /book_append_sheet\([^)]*"Resumo"/, "falta a aba de resumo");

  const pdf = reports.slice(reports.indexOf("async function exportReportPdf"));
  assert.match(pdf, /feedingReport/, "o PDF precisa dos totais e da comparação por produto");
});

test("a tela mostra dia sem registro e total do dia com estilo próprio", () => {
  const css = read("assets/css/app.css");
  assert.match(css, /\.semRegistro/, "o dia sem trato precisa saltar aos olhos");
  assert.match(css, /\.totalDia/);
  assert.match(read("src/reports.js"), /class="semRegistro"/);
});

test("os blocos do relatório usam classes que existem no CSS", () => {
  const css = read("assets/css/app.css");
  const reports = read("src/reports.js");
  const usadas = [...reports.matchAll(/class="([a-zA-Z][\w -]*)"/g)]
    .flatMap(match => match[1].split(/\s+/))
    .filter(nome => /^(cards|productCard|reportBlock)$/.test(nome));
  for (const nome of [...new Set(usadas)]) {
    assert.match(css, new RegExp(`\.${nome}[\s,{:]`), `classe .${nome} usada no relatório mas ausente do CSS`);
  }
  assert.ok(usadas.length > 0, "o relatório precisa usar as classes novas");
});

function semMediaQueries(css) {
  let resultado = css;
  let inicio = resultado.indexOf("@media");
  while (inicio >= 0) {
    let profundidade = 0;
    let fim = resultado.indexOf("{", inicio);
    for (let i = fim; i < resultado.length; i += 1) {
      if (resultado[i] === "{") profundidade += 1;
      if (resultado[i] === "}") {
        profundidade -= 1;
        if (profundidade === 0) { fim = i; break; }
      }
    }
    resultado = resultado.slice(0, inicio) + resultado.slice(fim + 1);
    inicio = resultado.indexOf("@media");
  }
  return resultado;
}

test("a tabela do relatório respira no computador, não só no celular", () => {
  const css = read("assets/css/app.css");
  const foraDoMedia = semMediaQueries(css);
  assert.match(foraDoMedia, /table\.stackTable td\{[^}]*padding/,
    "sem padding fora do media query a tabela fica colada no desktop");
  assert.match(foraDoMedia, /table\.stackTable th\{[^}]*padding/);
  assert.match(foraDoMedia, /table\.stackTable\{[^}]*border-collapse/);
});

test("dia sem composição mostra traço em vez de zero animais", () => {
  const relatorio = run(`SupFeedingReport.build({
    records: [], versions: [], groups: [], products: [],
    lotId: "L1", from: "2026-09-01", to: "2026-09-01"
  })`);
  assert.equal(relatorio.dias[0].animais, null, "zero animais é informação errada; o lote não tem composição cadastrada");
  const linhas = run(`SupFeedingReport.flatRows(SupFeedingReport.build({
    records: [], versions: [], groups: [], products: [],
    lotId: "L1", from: "2026-09-01", to: "2026-09-01"
  }))`);
  assert.equal(linhas[0].Animais, "—");
});

test("o relatório usa o mesmo ponto de quebra do resto do app", () => {
  const css = read("assets/css/app.css");
  const pontos = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(m => m[1]);
  const duplicados = pontos.filter(valor => valor === "760");
  assert.deepEqual(duplicados, [],
    "o app quebra em 759px; um bloco em 760px se sobrepõe e o comportamento vira loteria");
  assert.match(css, /table\.stackTable tr\.semRegistro td\.vazio\{display:none\}/);
});

test("os tratos diários começam pelo dia mais recente", () => {
  const dias = run(`${CHAMADA}.dias`).map(dia => dia.dia);
  assert.deepEqual(dias, ["2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01"],
    "quem abre o relatório quer ver o dia de hoje sem rolar até o fim");
});

test("a planilha sai na mesma ordem da tela", () => {
  const datas = run(`SupFeedingReport.flatRows(${CHAMADA})`).map(linha => linha.Data);
  assert.deepEqual(datas, ["04/09/2026", "03/09/2026", "02/09/2026", "02/09/2026", "01/09/2026"],
    "tela e planilha em ordens diferentes é bug de conferência");
});

test("dentro do dia, os tratos seguem a ordem do relógio", () => {
  const dia = run(`${CHAMADA}.dias`).find(item => item.dia === "2026-09-02");
  assert.deepEqual(dia.linhas.map(linha => linha.hora), ["09:20", "13:29"],
    "o 1º e o 2º trato do dia se leem na ordem em que aconteceram");
});

test("a composição do lote continua do mais antigo para o mais novo", () => {
  const composicao = run(`${CHAMADA}.composicao`);
  assert.equal(composicao.length, 1);
  assert.equal(composicao[0].inicio, "2026-09-01");
  assert.equal(composicao[0].fim, "2026-09-04",
    "os blocos de composição se fundem por dias consecutivos; inverter quebraria a fusão");
});
