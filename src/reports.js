let reportRows = [];
let reportColumns = [];
let reportNumeric = [];
let reportName = "relatorio";
let reportSource = null;
let feedingReport = null;
let reportTotal = 0;
let reportPage = 1;

const MONEY_COLUMNS = /custo|valor|pre[çc]o|total/i;
const REPORT_PAGE_SIZE = 25;
const REPORT_FETCH_PAGE = 1000;
const REPORT_EXPORT_MAX = 20000;
const REPORT_PDF_WARN = 2000;

function paginate(total, page, size) {
  const count = Math.max(Number(total) || 0, 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  const offset = (current - 1) * size;
  const shown = Math.max(Math.min(size, count - offset), 0);
  return {
    page: current,
    pages,
    total: count,
    offset,
    from: count ? offset + 1 : 0,
    to: count ? offset + shown : 0
  };
}

function reportCellText(column, value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "number") return String(value);
  return MONEY_COLUMNS.test(column)
    ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function buildReportTable(rows, columns) {
  const list = rows || [];
  const head = columns || [];
  const numericColumns = head
    .map((column, index) => (list.some(row => typeof row[column] === "number") ? index : -1))
    .filter(index => index >= 0);
  return {
    head,
    numericColumns,
    body: list.map(row => head.map(column => reportCellText(column, row[column])))
  };
}

const MOVEMENT_KINDS = {
  in: ["entry", "yield", "reversal", "adjustment"],
  out: ["consumption", "feeding", "sale", "reversal", "adjustment"],
  all: ["entry", "yield", "consumption", "feeding", "sale", "reversal", "adjustment"]
};

const MOVEMENT_DIRECTION_LABELS = { in: "Entradas", out: "Saídas", all: "Entradas e saídas" };
const MOVEMENT_CATEGORY_LABELS = { raw: "Matérias-primas", supplement: "Suplementos" };

function movementKindsFor(direction) {
  return [...(MOVEMENT_KINDS[direction] || MOVEMENT_KINDS.all)];
}

function reportCategoryProducts(list, supplementIds, category) {
  const supplements = new Set(supplementIds || []);
  const wantSupplement = category === "supplement";
  return (list || [])
    .filter(item => supplements.has(item.id) === wantSupplement)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }))
    .map(item => ({ id: item.id, label: item.active === false ? `${item.name} (inativo)` : item.name }));
}

function movementProductFilter(category, itemIds, supplementIds) {
  if (itemIds.length) return { op: "in", ids: [...itemIds] };
  const supplements = [...(supplementIds || [])];
  if (category === "supplement") return supplements.length ? { op: "in", ids: supplements } : { op: "none", ids: [] };
  return supplements.length ? { op: "not_in", ids: supplements } : { op: "any", ids: [] };
}

function movementQueryPlan({ direction, category, itemIds, kinds, supplementIds }) {
  const available = new Set(movementKindsFor(direction));
  const signs = { in: "positive", out: "negative" };
  return {
    sign: signs[direction] || null,
    kinds: (kinds || []).filter(kind => available.has(kind)),
    product: movementProductFilter(category, itemIds || [], supplementIds)
  };
}

function applyMovementPlan(query, plan) {
  let scoped = query;
  if (plan.sign === "positive") scoped = scoped.gt("quantity_kg", 0);
  if (plan.sign === "negative") scoped = scoped.lt("quantity_kg", 0);
  if (plan.kinds.length) scoped = scoped.in("kind", plan.kinds);
  if (plan.product.op === "in") scoped = scoped.in("product_id", plan.product.ids);
  if (plan.product.op === "not_in") scoped = scoped.not("product_id", "in", `(${plan.product.ids.join(",")})`);
  if (plan.product.op === "none") scoped = scoped.is("id", null);
  return scoped;
}

function movementFilterLabel({ direction, category, itemNames, kindLabels }) {
  return [
    MOVEMENT_DIRECTION_LABELS[direction] || MOVEMENT_DIRECTION_LABELS.all,
    MOVEMENT_CATEGORY_LABELS[category] || MOVEMENT_CATEGORY_LABELS.raw,
    (itemNames || []).join(", "),
    (kindLabels || []).join(", ")
  ].filter(Boolean).join(" · ");
}

function movementReportRow(row, direction) {
  const quantity = Number(row.quantity_kg);
  return {
    Data: farmDateTimeBR(row.occurred_at),
    Produto: row.suplementacao_products?.name || "",
    Tipo: STOCK_KINDS[row.kind] || row.kind,
    Quantidade: direction === "all" ? quantity : Math.abs(quantity),
    "Valor unitário": Number(row.unit_cost),
    Fornecedor: row.supplier || "",
    Motivo: row.reason || ""
  };
}

function productionReportRow(row) {
  const quantity = Number(row.quantity_kg);
  const totalCost = Number(row.total_cost);
  return {
    Data: farmDateTimeBR(row.occurred_at),
    Fórmula: row.suplementacao_formulas?.name || "",
    Produto: row.products?.name || "",
    "Quantidade (kg)": quantity,
    "Custo total": totalCost,
    "Custo por kg": quantity ? totalCost / quantity : 0,
    Situação: row.reversed_at ? "Estornada" : "Ativa",
    Itens: (row.suplementacao_production_items || []).map(item => `${item.suplementacao_products?.name}: ${Number(item.quantity).toLocaleString("pt-BR")} kg`).join(" | ")
  };
}

function reportRange() {
  const from = $("reportFrom").value ? new Date(`${$("reportFrom").value}T00:00:00`) : null;
  const to = $("reportTo").value ? new Date(`${$("reportTo").value}T23:59:59`) : null;
  return { from, to };
}

const REPORT_LABELS = {
  stock: "Estoque atual",
  movements: "Entradas e saídas de estoque",
  productions: "Fabricações realizadas",
  feeding: "Consumo por lote"
};

function reportUsesPeriod() {
  return $("reportType").value !== "stock";
}

function isFeedingReport() {
  return $("reportType").value === "feeding";
}

function isMovementReport() {
  return $("reportType").value === "movements";
}

function checkedValues(containerId) {
  return [...$(containerId).querySelectorAll("input[type=checkbox]:checked")].map(input => input.value);
}

function renderReportChecks(containerId, options, keep) {
  const kept = new Set(keep);
  $(containerId).innerHTML = options.length
    ? options.map(option => `<label class="checkChip"><input type="checkbox" value="${esc(option.value)}" data-change="reportFilter" ${kept.has(option.value) ? "checked" : ""}><span>${esc(option.label)}</span></label>`).join("")
    : '<div class="small">Nenhum item nesta categoria.</div>';
}

function movementFilters() {
  return {
    direction: $("reportDirection").value,
    category: $("reportCategory").value,
    itemIds: checkedValues("reportItems"),
    kinds: checkedValues("reportKinds")
  };
}

function refreshMovementFilters({ resetItems = false } = {}) {
  const { direction, category } = movementFilters();
  renderReportChecks("reportKinds", movementKindsFor(direction).map(kind => ({ value: kind, label: STOCK_KINDS[kind] || kind })), checkedValues("reportKinds"));
  renderReportChecks("reportItems", reportCategoryProducts(products, supplementIds, category).map(item => ({ value: item.id, label: item.label })), resetItems ? [] : checkedValues("reportItems"));
}

function onReportMovementFilterChange(resetItems) {
  refreshMovementFilters({ resetItems });
  markReportStale();
}

function clearReportChecks(containerId) {
  $(containerId).querySelectorAll("input[type=checkbox]").forEach(input => { input.checked = false; });
  markReportStale();
}

function populateReportLots() {
  const encerrados = $("reportLotStatus").value === "closed";
  const disponiveis = lots.filter(lot => (encerrados ? !lot.active : lot.active));
  const escolhido = $("reportLot").value;
  $("reportLot").innerHTML = disponiveis.length
    ? disponiveis.map(lot => `<option value="${lot.id}">${esc(lot.name)}</option>`).join("")
    : '<option value="">Nenhum lote nesta situação</option>';
  if (escolhido && disponiveis.some(lot => lot.id === escolhido)) $("reportLot").value = escolhido;
}

function markReportStale() {
  if (!reportTotal) return;
  $("reportStale").classList.remove("hidden");
  $("reportExportBtn").disabled = true;
  $("reportPdfBtn").disabled = true;
}

function clearReportStale() {
  $("reportStale").classList.add("hidden");
}

function resetReport() {
  reportRows = [];
  reportColumns = [];
  reportNumeric = [];
  reportSource = null;
  feedingReport = null;
  reportTotal = 0;
  reportPage = 1;
  clearReportStale();
  updateExportButtons();
  $("reportOut").innerHTML = '<div class="emptyBox small">Escolha os filtros e toque em Pesquisar.</div>';
}

function onReportLotStatusChange() {
  populateReportLots();
  markReportStale();
}

function onReportTypeChange() {
  const usesPeriod = reportUsesPeriod();
  const porLote = isFeedingReport();
  $("reportFromBox").classList.toggle("hidden", !usesPeriod);
  $("reportToBox").classList.toggle("hidden", !usesPeriod);
  $("reportLotBox").classList.toggle("hidden", !porLote);
  $("reportLotStatusBox").classList.toggle("hidden", !porLote);
  const movimentos = isMovementReport();
  ["reportCategoryBox", "reportDirectionBox", "reportKindsBox", "reportItemsBox"].forEach(id => $(id).classList.toggle("hidden", !movimentos));
  if (movimentos) refreshMovementFilters();
  if (porLote) {
    populateReportLots();
    feedingReportPeriod();
  }
  resetReport();
}

function reportPeriodLabel() {
  if (!reportUsesPeriod()) return `posição de ${farmDateTimeBR(new Date())}`;
  const { from, to } = reportRange();
  if (!from && !to) return "todo o período";
  const start = from ? from.toLocaleDateString("pt-BR") : "início";
  const end = to ? to.toLocaleDateString("pt-BR") : "hoje";
  return `${start} até ${end}`;
}

function reportSources() {
  const { from, to } = reportRange();
  const period = query => {
    let scoped = query;
    if (from) scoped = scoped.gte("occurred_at", from.toISOString());
    if (to) scoped = scoped.lte("occurred_at", to.toISOString());
    return scoped;
  };
  const lot = $("reportLot").value;
  const readings = { empty: "Vazio", medium: "Médio", full: "Cheio" };
  const movement = movementFilters();
  const movementPlan = movementQueryPlan({ ...movement, supplementIds });

  return {
    stock: {
      name: "estoque",
      table: "suplementacao_product_stock",
      countColumn: "product_id",
      select: "*",
      order: [["name", true]],
      map: row => ({
        Produto: row.name,
        "Saldo (kg)": Number(row.quantity_kg),
        "Saldo negativo": row.negative ? "Sim" : "Não",
        "Custo médio": Number(row.avg_unit_cost)
      })
    },
    movements: {
      name: "movimentacoes_estoque",
      table: "suplementacao_stock_movements",
      countColumn: "id",
      select: "*, suplementacao_products(name)",
      order: [["occurred_at", false], ["id", false]],
      subtitle: movementFilterLabel({
        direction: movement.direction,
        category: movement.category,
        itemNames: movement.itemIds.map(id => products.find(item => item.id === id)?.name || ""),
        kindLabels: movementPlan.kinds.map(kind => STOCK_KINDS[kind] || kind)
      }),
      filter: query => applyMovementPlan(period(query), movementPlan),
      map: row => movementReportRow(row, movement.direction)
    },
    productions: {
      name: "fabricacoes",
      table: "suplementacao_productions",
      countColumn: "id",
      select: "*, suplementacao_formulas(name), products:suplementacao_products(name), suplementacao_production_items(quantity, suplementacao_products(name))",
      order: [["occurred_at", false], ["id", false]],
      filter: period,
      map: productionReportRow
    },
    feeding: {
      name: "consumo_por_lote",
      table: "suplementacao_feeding_records",
      countColumn: "id",
      select: "*, lots:suplementacao_lots(name), products:suplementacao_products(name)",
      order: [["occurred_at", false], ["id", false]],
      filter: query => {
        const scoped = period(query);
        return lot ? scoped.eq("lot_id", lot) : scoped;
      },
      map: row => ({
        Data: farmDateTimeBR(row.occurred_at),
        Lote: row.lots?.name || "",
        Produto: row.products?.name || row.product_name || "",
        "Quantidade (kg)": Number(row.quantity_kg),
        Cocho: readings[row.trough_reading] || ""
      })
    }
  };
}

function reportQuery(source, { forCount = false } = {}) {
  let query = forCount
    ? sb.from(source.table).select(source.countColumn, { count: "exact", head: true })
    : sb.from(source.table).select(source.select);
  if (source.filter) query = source.filter(query);
  if (!forCount) for (const [column, ascending] of source.order) query = query.order(column, { ascending });
  return query;
}

function reportFailed(error) {
  reportRows = [];
  reportTotal = 0;
  $("reportExportBtn").disabled = true;
  $("reportPdfBtn").disabled = true;
  $("reportOut").innerHTML = `<div class="msg err">${esc(friendlyError(error))}</div>`;
}

function updateExportButtons() {
  $("reportExportBtn").disabled = !reportTotal;
  $("reportPdfBtn").disabled = !reportTotal;
}

function feedingReportPeriod() {
  const from = $("reportFrom").value || farmDateISO(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
  const to = $("reportTo").value || farmDateISO();
  if (!$("reportFrom").value) $("reportFrom").value = from;
  if (!$("reportTo").value) $("reportTo").value = to;
  return { from, to };
}

async function runFeedingReport() {
  const lotId = $("reportLot").value;
  reportName = "trato_por_lote";
  reportSource = null;
  feedingReport = null;
  reportRows = [];
  reportTotal = 0;

  if (!lotId) {
    $("reportOut").innerHTML = '<div class="emptyBox small">Escolha um lote para gerar o relatório.</div>';
    return updateExportButtons();
  }

  const { from, to } = feedingReportPeriod();
  const inicio = farmDayBounds(from).start;
  const fim = farmDayBounds(to).end;
  $("reportOut").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';

  const tratos = await SupCache.fetch(`trato-${lotId}-${from}-${to}`, () => sb
    .from("suplementacao_feeding_records")
    .select("*, products:suplementacao_products(name), profiles:suplementacao_profiles!feeding_records_recorded_by_fkey(full_name)")
    .eq("lot_id", lotId)
    .gte("occurred_at", inicio.toISOString())
    .lte("occurred_at", fim.toISOString())
    .order("occurred_at", { ascending: true }));

  if (!tratos.value) {
    $("reportOut").innerHTML = `<div class="msg err">${esc(cacheStatus([tratos], "este relatório")[0])}</div>`;
    return updateExportButtons();
  }

  feedingReport = SupFeedingReport.build({
    records: tratos.value,
    versions: lotVersions,
    groups: lotVersionGroups,
    products,
    lotId,
    from,
    to
  });
  reportRows = SupFeedingReport.flatRows(feedingReport);
  reportTotal = reportRows.length;
  renderFeedingReport(lots.find(lot => lot.id === lotId)?.name || "Lote");
  updateExportButtons();
}

function feedingCardsHtml(lotName) {
  const cartao = (rotulo, valor) => `<div class="homeCard"><div class="small">${esc(rotulo)}</div><b>${esc(valor)}</b></div>`;
  return `<div class="homeGrid">
    ${cartao("Lote", lotName)}
    ${cartao("Trato total", SupUnits.formatKg(feedingReport.totalKg))}
    ${cartao("Dias com registro", String(feedingReport.diasComRegistro))}
    ${cartao("Dias sem registro", String(feedingReport.diasSemRegistro))}
  </div>`;
}

function feedingCompositionHtml() {
  if (!feedingReport.composicao.length) {
    return '<div class="emptyBox small">Este lote não tem composição cadastrada no período.</div>';
  }
  return feedingReport.composicao.map(bloco => `<div class="groupBox">
    <b>${esc(farmDateBR(bloco.inicio))} a ${esc(farmDateBR(bloco.fim))} · ${bloco.totalAnimais.toLocaleString("pt-BR")} animais</b>
    ${bloco.grupos.map(grupo => `<div class="small">• ${esc(grupo.categoria)} — ${grupo.animais.toLocaleString("pt-BR")} animais — peso médio ${esc(SupUnits.formatKg(grupo.pesoMedio))} — ${esc(grupo.produto)} — esperado ${esc(SupUnits.formatKg(grupo.esperadoCabDia))}/cab/dia (${esc(SupUnits.formatKg(grupo.esperadoGrupoDia))}/dia no grupo)</div>`).join("")}
  </div>`).join("");
}

function feedingProductsHtml() {
  if (!feedingReport.porProduto.length) {
    return '<div class="emptyBox small">Sem produto esperado ou fornecido no período.</div>';
  }
  return `<div class="cards">${feedingReport.porProduto.map(item => {
    const cor = item.diferenca < 0 ? "bad" : "good";
    const percentual = item.esperado
      ? `${item.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do esperado`
      : "sem esperado cadastrado";
    return `<div class="productCard">
      <dt class="small">Produto</dt>
      <b class="productName">${esc(item.produto)}</b>
      <dl>
        <dt>Esperado no período</dt><dd>${esc(SupUnits.formatKg(item.esperado))}</dd>
        <dt>Fornecido no período</dt><dd>${esc(SupUnits.formatKg(item.fornecido))}</dd>
      </dl>
      <div class="productFoot">
        <span class="small">${esc(percentual)}</span>
        <span class="diff ${cor}">${esc(SupUnits.formatKg(item.diferenca))}</span>
      </div>
    </div>`;
  }).join("")}</div>`;
}

function feedingDaysHtml() {
  const colunas = ["Data", "Hora", "Categoria", "Animais", "Produto", "Trato", "Leitura do cocho", "Responsável", "Editado"];
  const corpo = feedingReport.dias.map(dia => {
    const data = farmDateBR(dia.dia);
    const animais = dia.animais === null ? "—" : dia.animais.toLocaleString("pt-BR");
    if (dia.semRegistro) {
      return `<tr class="semRegistro">
        <td data-label="Data">${esc(data)}</td><td data-label="Hora" class="vazio">—</td>
        <td data-label="Categoria" class="vazio">—</td><td data-label="Animais" class="num">${esc(animais)}</td>
        <td data-label="Produto" class="produto">SEM REGISTRO</td><td data-label="Trato" class="num vazio">—</td>
        <td data-label="Leitura do cocho" class="vazio">Sem registro</td><td data-label="Responsável" class="vazio">Sem registro</td>
        <td data-label="Editado" class="vazio">—</td></tr>`;
    }
    const linhas = dia.linhas.map(linha => `<tr>
      <td data-label="Data">${esc(data)}</td><td data-label="Hora">${esc(linha.hora)}</td>
      <td data-label="Categoria">${esc(linha.categoria)}</td><td data-label="Animais" class="num">${esc(linha.animais === null ? "—" : linha.animais.toLocaleString("pt-BR"))}</td>
      <td data-label="Produto">${esc(linha.produto)}</td><td data-label="Trato" class="num">${esc(SupUnits.formatKg(linha.kg))}</td>
      <td data-label="Leitura do cocho">${esc(linha.cocho)}</td><td data-label="Responsável">${esc(linha.responsavel)}</td>
      <td data-label="Editado">${esc(linha.editado)}</td></tr>`).join("");
    return `${linhas}<tr class="totalDia">
      <td data-label="Data" colspan="5">Total do dia ${esc(data)}</td>
      <td data-label="Trato" class="num">${esc(SupUnits.formatKg(dia.totalDia))}</td>
      <td data-label="Leitura do cocho"></td><td data-label="Responsável"></td><td data-label="Editado"></td></tr>`;
  }).join("");

  return `<table class="stackTable"><thead><tr>${colunas.map(nome => `<th>${esc(nome)}</th>`).join("")}</tr></thead>
    <tbody>${corpo}</tbody></table>`;
}

function renderFeedingReport(lotName) {
  $("reportOut").innerHTML = `${feedingCardsHtml(lotName)}
    <div class="reportBlock"><h3>Composição do lote no período</h3>
      ${feedingCompositionHtml()}</div>
    <div class="reportBlock"><h3>Consumo por produto no período</h3>
      ${feedingProductsHtml()}
      <div class="reportNote">Cada produto é calculado de forma independente. O fornecido, o esperado, a diferença e o percentual nunca são somados entre produtos diferentes.</div></div>
    <div class="reportBlock"><h3>Tratos diários</h3>
      <div class="tableWrap always">${feedingDaysHtml()}</div></div>`;
}

async function runReport() {
  clearReportStale();
  if (isFeedingReport()) return runFeedingReport();
  if (isMovementReport()) refreshMovementFilters();
  const source = reportSources()[$("reportType").value];
  if (!source) return;
  reportSource = source;
  reportName = source.name;
  reportColumns = [];
  reportNumeric = [];
  $("reportOut").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const { count, error } = await reportQuery(source, { forCount: true });
    if (error) throw error;
    reportTotal = count || 0;
    await loadReportPage(1);
  } catch (error) {
    reportFailed(error);
  }
}

async function loadReportPage(page) {
  const info = paginate(reportTotal, page, REPORT_PAGE_SIZE);
  reportPage = info.page;

  if (!info.total) {
    reportRows = [];
    return renderReportPage(info);
  }

  const { data, error } = await reportQuery(reportSource)
    .range(info.offset, info.offset + REPORT_PAGE_SIZE - 1);
  if (error) throw error;

  reportRows = (data || []).map(reportSource.map);
  if (reportRows.length) {
    if (!reportColumns.length) reportColumns = Object.keys(reportRows[0]);
    if (!reportNumeric.length) reportNumeric = buildReportTable(reportRows, reportColumns).numericColumns;
  }
  renderReportPage(info);
}

async function goToReportPage(page) {
  $("reportOut").classList.add("busy");
  try {
    await loadReportPage(page);
  } catch (error) {
    reportFailed(error);
  } finally {
    $("reportOut").classList.remove("busy");
  }
}

function renderReportPage(info) {
  const columns = reportColumns;
  const table = buildReportTable(reportRows, columns);

  $("reportExportBtn").disabled = !info.total;
  $("reportPdfBtn").disabled = !info.total;

  const title = [REPORT_LABELS[$("reportType").value] || "Relatório", reportSource?.subtitle, reportPeriodLabel()].filter(Boolean).join(" · ");
  const counter = info.total ? `${info.from}–${info.to} de ${info.total}` : "nenhum registro";
  const head = `<div class="reportHead"><span class="planHead">${esc(title)}</span><span class="small">${esc(counter)}</span></div>`;

  if (!info.total) {
    $("reportOut").innerHTML = head + '<div class="emptyBox small">Nenhum dado para os filtros escolhidos. Tente ampliar o período.</div>';
    return;
  }

  const numeric = new Set(reportNumeric.length ? reportNumeric : table.numericColumns);
  const body = table.body.map(cells => `<tr>${cells.map((cell, index) =>
    `<td class="${numeric.has(index) ? "num" : ""}" data-label="${esc(columns[index])}">${esc(cell)}</td>`).join("")}</tr>`).join("");

  const nav = info.pages > 1
    ? `<div class="pager">
        <button class="btn alt smallbtn" data-do="reportPage" data-arg="${info.page - 1}" ${info.page === 1 ? "disabled" : ""}>Anterior</button>
        <span class="small">Página ${info.page} de ${info.pages}</span>
        <button class="btn alt smallbtn" data-do="reportPage" data-arg="${info.page + 1}" ${info.page === info.pages ? "disabled" : ""}>Próxima</button>
      </div>`
    : "";

  const exportNote = info.total > REPORT_EXPORT_MAX
    ? `<div class="msg err">São ${info.total.toLocaleString("pt-BR")} linhas. A exportação leva as primeiras ${REPORT_EXPORT_MAX.toLocaleString("pt-BR")} — reduza o período para levar tudo.</div>`
    : `<div class="small">Exportar PDF e Excel levam todas as ${info.total.toLocaleString("pt-BR")} linha(s), não só esta página.</div>`;

  $("reportOut").innerHTML = `${head}
    <div class="tableWrap always"><table class="histTable stackTable">
      <thead><tr>${columns.map((column, index) => `<th class="${numeric.has(index) ? "num" : ""}">${esc(column)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${nav}
    ${exportNote}`;
}

async function fetchAllReportRows() {
  if (isFeedingReport()) return reportRows;
  const limit = Math.min(reportTotal, REPORT_EXPORT_MAX);
  const all = [];
  for (let offset = 0; offset < limit; offset += REPORT_FETCH_PAGE) {
    const size = Math.min(REPORT_FETCH_PAGE, limit - offset);
    const { data, error } = await reportQuery(reportSource).range(offset, offset + size - 1);
    if (error) throw error;
    const page = data || [];
    if (!page.length) break;
    for (const row of page) all.push(reportSource.map(row));
  }
  return all;
}

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return String(value);
}

function sheetColumnWidths(rows) {
  const list = rows || [];
  if (!list.length) return [];
  const keys = [...new Set(list.flatMap(row => Object.keys(row)))];
  return keys.map(key => {
    const longest = list.reduce((max, row) => Math.max(max, cellText(row[key]).length), key.length);
    return { wch: Math.min(Math.max(longest + 2, 12), 60) };
  });
}

async function exportReport() {
  if (typeof XLSX === "undefined") return showAlert("A biblioteca de Excel não foi carregada. Conecte-se à internet e tente novamente.");
  if (!reportTotal) return showAlert("Gere um relatório com dados antes de exportar.");

  const rows = await fetchAllReportRows();
  if (!rows.length) return showAlert("Gere um relatório com dados antes de exportar.");

  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet["!cols"] = sheetColumnWidths(rows);
  const book = XLSX.utils.book_new();

  if (isFeedingReport() && feedingReport) {
    const resumo = SupFeedingReport.summaryRows(feedingReport);
    const abaResumo = XLSX.utils.json_to_sheet(resumo);
    abaResumo["!cols"] = sheetColumnWidths(resumo);
    XLSX.utils.book_append_sheet(book, abaResumo, "Resumo");
    XLSX.utils.book_append_sheet(book, sheet, "Tratos diários");
    XLSX.writeFile(book, `${reportName}_${farmDateISO()}.xlsx`);
    return toast(`Planilha gerada com ${rows.length.toLocaleString("pt-BR")} linha(s).`);
  }

  XLSX.utils.book_append_sheet(book, sheet, "Relatório");
  XLSX.writeFile(book, `${reportName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`Planilha gerada com ${rows.length.toLocaleString("pt-BR")} linha(s).`);
}

function brandLogoDataUrl() {
  try {
    const image = document.querySelector(".appBrand img");
    if (!image || !image.complete || !image.naturalWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

async function exportReportPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return showAlert("A biblioteca de PDF não foi carregada. Conecte-se à internet uma vez para o app guardá-la.");
  }
  if (!reportTotal) return showAlert("Gere um relatório com dados antes de exportar.");

  if (reportTotal > REPORT_PDF_WARN) {
    const aviso = `Este relatório tem ${reportTotal.toLocaleString("pt-BR")} linhas. Um PDF desse tamanho demora e pode travar o aparelho, ainda mais no celular.\n\nPara guardar ou continuar a conta, o Excel dá conta melhor.\n\nGerar o PDF mesmo assim?`;
    if (!(await showConfirm(aviso, { danger: true }))) return;
  }

  const rows = await fetchAllReportRows();
  if (!rows.length) return showAlert("Gere um relatório com dados antes de exportar.");

  const table = buildReportTable(rows, isFeedingReport() ? Object.keys(rows[0] || {}) : reportColumns);
  const doc = new window.jspdf.jsPDF({
    orientation: table.head.length > 4 ? "landscape" : "portrait",
    unit: "mm",
    format: "a4"
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const title = REPORT_LABELS[$("reportType").value] || "Relatório";
  const emitido = farmDateTimeBR(new Date());
  const logo = brandLogoDataUrl();

  doc.setFillColor(63, 122, 67);
  doc.rect(0, 0, pageWidth, 26, "F");
  if (logo) doc.addImage(logo, "JPEG", 14, 5, 26, 16);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.text("Agropecuária Cacimba", logo ? 44 : 14, 12);
  doc.setFontSize(9.5);
  doc.text("Controle de Suplementação", logo ? 44 : 14, 18);

  doc.setTextColor(30, 43, 34);
  doc.setFontSize(14);
  doc.text(title, 14, 38);
  doc.setFontSize(9.5);
  doc.setTextColor(92, 106, 92);
  const filtros = !isFeedingReport() && reportSource?.subtitle
    ? doc.splitTextToSize(`Filtros: ${reportSource.subtitle}`, pageWidth - 28)
    : [];
  const deslocamento = filtros.length * 5;
  if (filtros.length) doc.text(filtros, 14, 44);
  doc.text(`Período: ${reportPeriodLabel()}`, 14, 44 + deslocamento);
  doc.text(`${rows.length.toLocaleString("pt-BR")} registro(s)`, 14, 49 + deslocamento);

  let inicioTabela = 55 + deslocamento;
  if (isFeedingReport() && feedingReport) {
    const lote = lots.find(item => item.id === $("reportLot").value)?.name || "Lote";
    doc.setTextColor(30, 43, 34);
    doc.setFontSize(10);
    doc.text(`${lote} · trato total ${SupUnits.formatKg(feedingReport.totalKg)} · ${feedingReport.diasComRegistro} dia(s) com registro · ${feedingReport.diasSemRegistro} sem registro`, 14, 55);

    doc.autoTable({
      head: [["Produto", "Esperado (kg)", "Fornecido (kg)", "Diferença (kg)", "% do esperado"]],
      body: feedingReport.porProduto.map(item => [
        item.produto,
        SupUnits.formatKg(item.esperado),
        SupUnits.formatKg(item.fornecido),
        SupUnits.formatKg(item.diferenca),
        `${item.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
      ]),
      startY: 60,
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.4, textColor: [30, 43, 34], lineColor: [224, 229, 218], lineWidth: 0.1 },
      headStyles: { fillColor: [63, 122, 67], textColor: 255, fontStyle: "bold", halign: "left" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      margin: { left: 14, right: 14 }
    });
    inicioTabela = doc.lastAutoTable.finalY + 8;
  }

  const alignRight = {};
  (reportNumeric.length ? reportNumeric : table.numericColumns).forEach(index => {
    alignRight[index] = { halign: "right" };
  });

  doc.autoTable({
    head: [table.head],
    body: table.body,
    startY: inicioTabela,
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.4, textColor: [30, 43, 34], lineColor: [224, 229, 218], lineWidth: 0.1 },
    headStyles: { fillColor: [63, 122, 67], textColor: 255, fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: [244, 247, 242] },
    columnStyles: alignRight,
    margin: { left: 14, right: 14, bottom: 18 },
    didDrawPage: () => {
      const page = doc.internal.getCurrentPageInfo().pageNumber;
      const height = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(92, 106, 92);
      doc.text(`Emitido em ${emitido}`, 14, height - 8);
      doc.text(`Página ${page}`, pageWidth - 14, height - 8, { align: "right" });
    }
  });

  doc.save(`${reportName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  toast("PDF gerado.");
}
