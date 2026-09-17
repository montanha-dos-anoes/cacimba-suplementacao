let stockRows = [];

function stockRowById(id) {
  return stockRows.find(row => row.product_id === id);
}

function stockStatusHtml(item) {
  const pills = [];
  if (item.negative) pills.push('<span class="pill danger">SALDO NEGATIVO</span>');
  if (item.manufactured) pills.push('<span class="pill">FABRICADO</span>');
  if (!item.active) pills.push('<span class="pill">INATIVO</span>');
  return pills.join(" ");
}

function stockFilter() {
  const term = ($("stockSearch").value || "").trim().toLowerCase();
  return term ? stockRows.filter(item => item.name.toLowerCase().includes(term)) : stockRows;
}

function renderStock() {
  const rows = stockFilter().map(item => {
    const saldo = SupUnits.formatQuantity(item.quantity_kg, item);
    const status = stockStatusHtml(item);
    const gear = `<button class="iconBtn" data-do="stockManage" data-arg="${item.product_id}" aria-label="Gerenciar ${esc(item.name)}">${icon("gear")}</button>`;
    return {
      table: `<tr>
        <td><b>${esc(item.name)}</b>${status ? `<div class="rowPills">${status}</div>` : ""}</td>
        <td class="num">${esc(saldo.main)}${saldo.secondary ? `<div class="small">${esc(saldo.secondary)}</div>` : ""}</td>
        <td class="num">${fmtMoney(item.avg_unit_cost)}</td>
        <td class="act">${gear}</td>
      </tr>`,
      card: `<div class="stockRow">
        <div class="stockTop">
          <div class="stockName">
            <b>${esc(item.name)}</b>
            <div class="small">custo médio ${fmtMoney(item.avg_unit_cost)}</div>
          </div>
          <div class="stockQty">
            <b>${esc(saldo.main)}</b>
            ${saldo.secondary ? `<span class="small">${esc(saldo.secondary)}</span>` : ""}
          </div>
        </div>
        ${status ? `<div class="rowPills">${status}</div>` : ""}
        <div class="actions">${gear}</div>
      </div>`
    };
  });

  $("stockTableBody").innerHTML = rows.map(row => row.table).join("") || '<tr><td colspan="4" class="small">Nenhum produto encontrado.</td></tr>';
  $("stockList").innerHTML = rows.map(row => row.card).join("") || '<div class="small">Nenhum produto encontrado.</div>';
}

async function loadStock() {
  if (!stockRows.length) {
    $("stockList").innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    $("stockTableBody").innerHTML = '<tr><td colspan="4"><div class="skeleton"></div></td></tr>';
  }
  const [saldo, formulasDoEstoque] = await Promise.all([
    SupCache.fetch("estoque", () => sb.from("suplementacao_product_stock").select("*").order("name")),
    SupCache.fetch("estoque-formulas", () => sb.from("suplementacao_formulas").select("id, product_id, name, base_batch_kg, suplementacao_formula_items(*)").eq("active", true))
  ]);
  if (!saldo.value) return msg("stockMsg", ...cacheStatus([saldo], "o estoque"));

  const formulaByProduct = new Map((formulasDoEstoque.value || []).map(row => [row.product_id, row]));
  stockRows = saldo.value.map(row => {
    const formula = formulaByProduct.get(row.product_id);
    return {
      ...row,
      manufactured: !!formula,
      formula_id: formula?.id || "",
      formula_name: formula?.name || "",
      formula_base_kg: formula?.base_batch_kg || 0,
      formula_items: formula?.suplementacao_formula_items || []
    };
  });
  msg("stockMsg", ...cacheStatus([saldo, formulasDoEstoque], "o estoque"));
  renderStock();
}
