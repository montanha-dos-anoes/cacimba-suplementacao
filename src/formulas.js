const SupFormula = (() => {
  const TOLERANCE = 0.001;

  function round(value, digits = 4) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function format(value) {
    return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  }

  function resolveItems(items, baseBatchKg) {
    const base = Number(baseBatchKg) || 0;
    return (items || []).map(item => ({
      item_id: item.item_id,
      kg: round(item.unit === "percent" ? base * Number(item.amount) / 100 : Number(item.amount), 3)
    }));
  }

  function formulaTotal(items, baseBatchKg) {
    return round(resolveItems(items, baseBatchKg).reduce((total, item) => total + item.kg, 0), 3);
  }

  function validateFormula(items, baseBatchKg) {
    const list = items || [];
    if (!list.length) return { valid: false, code: "empty", error: "Inclua pelo menos um item na fórmula." };
    if (list.some(item => !item.item_id)) return { valid: false, code: "no-item", error: "Escolha o item de todas as linhas." };
    if (list.some(item => !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0)) {
      return { valid: false, code: "bad-amount", error: "Informe uma quantidade maior que zero em todas as linhas." };
    }
    if (new Set(list.map(item => item.item_id)).size !== list.length) {
      return { valid: false, code: "duplicate", error: "O mesmo item não pode aparecer duas vezes na fórmula." };
    }

    const base = Number(baseBatchKg) || 0;
    if (base <= 0) return { valid: false, code: "no-base", error: "Informe a quantidade da fórmula." };

    const total = formulaTotal(list, base);
    const difference = round(total - base, 3);
    if (Math.abs(difference) <= TOLERANCE) return { valid: true, code: "", error: "" };

    const tail = difference < 0 ? `Faltam ${format(Math.abs(difference))} kg.` : `Sobram ${format(difference)} kg.`;
    return { valid: false, code: "sum", error: `A fórmula soma ${format(total)} kg e a quantidade é de ${format(base)} kg. ${tail}` };
  }

  function validateNoSelfInput(items, productId) {
    if (productId && (items || []).some(item => item.item_id === productId)) {
      return { valid: false, error: "O produto de saída da fórmula não pode ser um item de entrada da mesma fórmula." };
    }
    return { valid: true, error: "" };
  }

  function scaleToProduction(items, baseBatchKg, targetKg) {
    const base = Number(baseBatchKg) || 0;
    const factor = base > 0 ? Number(targetKg) / base : 0;
    return resolveItems(items, base).map(item => ({
      item_id: item.item_id,
      quantity: round(item.kg * factor, 3)
    }));
  }

  function costPerKg(items, baseBatchKg, costs) {
    const base = Number(baseBatchKg) || 0;
    if (base <= 0) return 0;
    const total = resolveItems(items, base).reduce(
      (sum, item) => sum + item.kg * Number(costs?.[item.item_id] || 0),
      0
    );
    return round(total / base, 4);
  }

  const COLORS = ["#3f7a43", "#6fa049", "#a8b84b", "#d8a13a", "#8a6bb0", "#a8382f"];

  function composition(items, baseBatchKg) {
    const base = Number(baseBatchKg) || 0;
    const empty = { base, total: 0, segments: [], missing: 0, excess: 0, missingRatio: 0, excessRatio: 0, limitRatio: 1, closed: false };
    if (base <= 0) return empty;

    const resolved = resolveItems(items, base)
      .map((item, index) => ({ ...item, color: COLORS[index % COLORS.length] }))
      .filter(item => item.item_id && item.kg > 0);
    if (!resolved.length) return empty;

    const total = round(resolved.reduce((sum, item) => sum + item.kg, 0), 3);
    const scale = Math.max(base, total);
    const difference = round(total - base, 3);

    return {
      base,
      total,
      segments: resolved.map(item => ({
        item_id: item.item_id,
        kg: item.kg,
        percent: round(item.kg * 100 / base, 3),
        ratio: item.kg / scale,
        color: item.color
      })),
      missing: difference < -TOLERANCE ? Math.abs(difference) : 0,
      excess: difference > TOLERANCE ? difference : 0,
      missingRatio: difference < -TOLERANCE ? Math.abs(difference) / scale : 0,
      limitRatio: base / scale,
      excessRatio: difference > TOLERANCE ? difference / scale : 0,
      closed: Math.abs(difference) <= TOLERANCE
    };
  }

  function colorAt(index) {
    return COLORS[index % COLORS.length];
  }

  function toPercentItems(items, baseBatchKg) {
    const base = Number(baseBatchKg) || 0;
    return (items || []).map(item => ({
      item_id: item.item_id,
      unit: "percent",
      amount: item.unit === "percent" ? Number(item.amount) || 0 : base > 0 ? round(Number(item.amount) * 100 / base, 4) : 0
    }));
  }

  return { resolveItems, formulaTotal, validateFormula, validateNoSelfInput, scaleToProduction, costPerKg, composition, colorAt, toPercentItems };
})();


let formulas = [];
let formulaMode = "kg";
let formulaSheet = null;
let editingFormulaId = null;
let editingFormulaProductId = "";
let editingFormulaProductName = "";

function formulaEditorOpen() {
  return !!$("sheetFormulaItems");
}

function formulaBatchKg() {
  const value = formulaEditorOpen() ? decimalValue($("sheetFormulaBatch").value) : 0;
  return value > 0 ? value : 1000;
}

function currentFormulaItems() {
  const batch = formulaBatchKg();
  return [...document.querySelectorAll("#sheetFormulaItems .formulaRow")].map(row => {
    const typed = decimalValue(row.querySelector(".formulaAmount").value);
    return {
      item_id: row.querySelector(".formulaItem").value,
      unit: "percent",
      amount: formulaMode === "kg" ? Math.round(typed * 100 / batch * 10000) / 10000 : typed
    };
  });
}

function formulaAmountLabel() {
  return formulaMode === "kg" ? "Quantidade (kg)" : "Participação (%)";
}

function setFormulaMode(mode) {
  if (mode === formulaMode || !formulaEditorOpen()) return;
  const batch = formulaBatchKg();
  document.querySelectorAll("#sheetFormulaItems .formulaRow .formulaAmount").forEach(input => {
    const typed = decimalValue(input.value);
    if (!typed) return;
    const converted = mode === "kg" ? typed * batch / 100 : typed * 100 / batch;
    input.value = String(Math.round(converted * 10000) / 10000).replace(".", ",");
  });
  formulaMode = mode;
  document.querySelectorAll("#sheetFormulaMode button").forEach(button => button.classList.toggle("on", button.dataset.mode === mode));
  $("sheetFormulaBatchBox").classList.toggle("hidden", mode !== "kg");
  document.querySelectorAll("#sheetFormulaItems .formulaRow .amountLabel").forEach(label => {
    label.textContent = formulaAmountLabel();
  });
  updateFormulaTotal();
}

function productOptionsHtml(selectedId, placeholder = "Escolha o produto…") {
  const options = stockRows
    .filter(item => item.active)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  if (!options.length) return '<option value="">Nenhum produto cadastrado no estoque</option>';
  return `<option value="" ${selectedId ? "" : "selected"}>${esc(placeholder)}</option>` + options
    .map(item => `<option value="${item.product_id}" ${item.product_id === selectedId ? "selected" : ""}>${esc(item.name)}${item.manufactured ? " (Fabricado)" : ""}</option>`)
    .join("");
}

function addFormulaRow(itemId = "", amount = "") {
  if (!formulaEditorOpen()) return;
  const row = document.createElement("div");
  row.className = "groupBox formulaRow";
  row.innerHTML = `
    <button class="rowRemove" data-do="removeFormulaRow" aria-label="Remover item" title="Remover item">${icon("trash")}</button>
    <div class="grid formulaRowGrid">
      <div class="full"><label>Produto</label><select class="formulaItem" data-change="updateFormulaTotal">${productOptionsHtml(itemId)}</select></div>
      <div><label class="amountLabel">${esc(formulaAmountLabel())}</label><input class="formulaAmount decimal" type="text" inputmode="decimal" value="${esc(amount)}" placeholder="${formulaMode === "kg" ? "Ex.: 450" : "Ex.: 45"}" data-input="updateFormulaTotal"></div>
    </div>
    <div class="rowFoot">
      <div class="rowBar"><span></span></div>
      <div class="small formulaHint"></div>
    </div>`;
  $("sheetFormulaItems").appendChild(row);
  updateFormulaTotal();
}

function removeFormulaRow(button) {
  button.closest(".formulaRow").remove();
  updateFormulaTotal();
}

function fillFormulaRemainder() {
  const missingPercent = SupFormula.composition(currentFormulaItems(), 100).missing;
  if (!(missingPercent > 0)) return;
  const missing = formulaMode === "kg" ? missingPercent * formulaBatchKg() / 100 : missingPercent;
  const rows = [...document.querySelectorAll("#sheetFormulaItems .formulaRow")];
  if (!rows.length) return addFormulaRow("", String(Math.round(missing * 10000) / 10000).replace(".", ","));
  const input = rows[rows.length - 1].querySelector(".formulaAmount");
  const total = Math.round((decimalValue(input.value) + missing) * 10000) / 10000;
  input.value = String(total).replace(".", ",");
  updateFormulaTotal();
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function renderFormulaRuler(composition) {
  const bar = composition.segments
    .map(segment => `<span class="rulerPart" style="width:${segment.ratio * 100}%;background:${segment.color}"></span>`)
    .join("");
  const missing = composition.missingRatio > 0
    ? `<span class="rulerPart missing" style="width:${composition.missingRatio * 100}%"></span>`
    : "";
  const limit = composition.excess > 0
    ? `<span class="rulerLimit" style="left:${composition.limitRatio * 100}%"></span>`
    : "";
  $("sheetFormulaBar").innerHTML = bar + missing + limit;

  const batch = formulaBatchKg();
  const asText = percent => formulaMode === "kg"
    ? SupUnits.formatKg(percent * batch / 100)
    : formatPercent(percent);
  const chip = composition.excess > 0
    ? `<span class="pill danger">passou ${esc(asText(composition.excess))}</span>`
    : composition.missing > 0
      ? `<button class="pill warn pillBtn" data-do="fillFormulaRemainder">faltam ${esc(asText(composition.missing))} · completar</button>`
      : composition.total > 0
        ? '<span class="pill ok">fechado</span>'
        : "";
  const total = formulaMode === "kg"
    ? `${esc(asText(composition.total))} de ${esc(SupUnits.formatKg(batch))}`
    : `${esc(formatPercent(composition.total))} de 100%`;
  $("sheetFormulaTally").innerHTML = `<b>${total}</b> ${chip}`;

  const names = Object.fromEntries(stockRows.map(item => [item.product_id, item.name]));
  $("sheetFormulaLegend").innerHTML = [...composition.segments]
    .sort((a, b) => b.kg - a.kg)
    .map(segment => `<span class="legendItem"><i style="background:${segment.color}"></i>${esc(names[segment.item_id] || "Produto")} ${esc(formatPercent(segment.percent))}</span>`)
    .join("");
}

function renderFormulaRows(items) {
  const rows = [...document.querySelectorAll("#sheetFormulaItems .formulaRow")];
  const batch = formulaBatchKg();
  const percents = items.map(item => Number(item.amount) || 0);
  const scale = Math.max(100, percents.reduce((sum, percent) => sum + percent, 0));
  rows.forEach((row, index) => {
    const percent = percents[index] || 0;
    const kg = percent * batch / 100;
    const product = stockRows.find(entry => entry.product_id === items[index]?.item_id);
    const volume = product && product.display_unit && kg > 0
      ? ` ≈ ${SupUnits.formatQuantity(kg, product).main}`
      : "";
    row.querySelector(".formulaHint").textContent = percent > 0
      ? formulaMode === "kg"
        ? `= ${formatPercent(percent)} da batida${volume}`
        : `${SupUnits.formatKg(kg)} em ${SupUnits.formatKg(batch)}${volume}`
      : "";
    const fill = row.querySelector(".rowBar span");
    fill.style.width = percent > 0 ? `${Math.min(percent / scale, 1) * 100}%` : "0";
    fill.style.background = SupFormula.colorAt(index);
  });
}

function formulaProductByName(name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  return stockRows.find(item => item.active && item.name.trim().toLowerCase() === wanted) || null;
}

function formulaProductId() {
  if (editingFormulaProductId) return editingFormulaProductId;
  const existing = formulaProductByName(formulaEditorOpen() ? $("sheetFormulaName").value : "");
  return existing ? existing.product_id : "";
}

function updateFormulaTotal() {
  if (!formulaEditorOpen()) return;
  const items = currentFormulaItems();
  const check = SupFormula.validateFormula(items, 100);
  const selfCheck = SupFormula.validateNoSelfInput(items, formulaProductId());
  const failed = !check.valid ? check : !selfCheck.valid ? selfCheck : null;

  $("sheetFormulaEmpty").classList.toggle("hidden", items.length > 0);
  renderFormulaRuler(SupFormula.composition(items, 100));
  renderFormulaRows(items);

  const costs = Object.fromEntries(stockRows.map(item => [item.product_id, Number(item.avg_unit_cost || 0)]));
  $("sheetFormulaTotal").textContent = items.length
    ? `Custo estimado ${fmtMoney(SupFormula.costPerKg(items, 100, costs))} por kg`
    : "";
  $("sheetFormulaSaveBtn").disabled = !!failed;
  $("sheetFormulaSaveBtn").title = failed ? failed.error : "";
  const shownByRuler = !failed || ["empty", "sum", "no-base", "no-item", "bad-amount"].includes(failed.code);
  msg("sheetFormulaMsg", shownByRuler ? "" : failed.error, true);
}

function formulaFilter() {
  const term = ($("formulaSearch").value || "").trim().toLowerCase();
  return term ? formulas.filter(formula => formula.name.toLowerCase().includes(term)) : formulas;
}

function renderFormulas() {
  const names = Object.fromEntries(stockRows.map(item => [item.product_id, item.name]));
  const rows = formulaFilter();
  $("formulasList").innerHTML = rows.map(formula => {
    const percentItems = SupFormula.toPercentItems(
      formula.suplementacao_formula_items.slice().sort((a, b) => a.position - b.position),
      formula.base_batch_kg
    );
    const sum = percentItems.reduce((total, item) => total + item.amount, 0);
    const lines = percentItems
      .map(item => `<div class="small">${esc(names[item.item_id] || "Produto")} — ${esc(formatPercent(item.amount))}</div>`)
      .join("");
    const product = formula.suplementacao_products?.name || "";
    return `<div class="item">
      <b>${esc(formula.name)}</b> ${product && product !== formula.name ? `<span class="pill">${esc(product)}</span>` : ""}
      <div class="small">soma ${esc(formatPercent(sum))}</div>
      ${lines}
      <div class="actions">
        <button class="btn smallbtn" data-do="fabricarFormula" data-arg="${formula.id}">Fabricar</button>
        <button class="btn alt smallbtn" data-do="openFormula" data-arg="${formula.id}">Editar</button>
        <button class="btn alt smallbtn" data-do="duplicateFormula" data-arg="${formula.id}">Duplicar</button>
        <button class="btn danger smallbtn" data-do="deactivateFormula" data-arg="${formula.id}">Inativar</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">${formulas.length ? "Nenhuma fórmula encontrada." : "Nenhuma fórmula cadastrada."}</div>`;
}

async function loadFormulas() {
  await loadStock();
  const cadastradas = await SupCache.fetch("formulas", () => sb
    .from("suplementacao_formulas")
    .select("*, suplementacao_products(name), suplementacao_formula_items(*)")
    .eq("active", true)
    .order("created_at"));
  if (!cadastradas.value) return msg("formulaMsg", ...cacheStatus([cadastradas], "as fórmulas"));
  msg("formulaMsg", ...cacheStatus([cadastradas], "as fórmulas"));
  formulas = cadastradas.value;
  renderFormulas();
  updateFormulaTotal();
}

async function fabricarFormula(id) {
  await showSubTab("sub-fabricar");
  $("productionFormula").value = id;
  $("productionQty").focus();
  previewProduction();
}

function formulaEditorHtml() {
  return `
    <div class="grid">
      <div class="full"><label>Nome da fórmula</label><input id="sheetFormulaName" placeholder="Ex.: Proteinado 0,3" data-input="updateFormulaTotal">
        <div class="small">O produto fabricado entra no estoque com este mesmo nome.</div>
      </div>
      <div><label>Digitar a receita em</label>
        <div class="reading modeSwitch" id="sheetFormulaMode">
          <button class="${formulaMode === "kg" ? "on" : ""}" data-mode="kg" data-do="formulaMode" data-arg="kg">kg</button>
          <button class="${formulaMode === "percent" ? "on" : ""}" data-mode="percent" data-do="formulaMode" data-arg="percent">%</button>
        </div>
      </div>
      <div id="sheetFormulaBatchBox" class="${formulaMode === "kg" ? "" : "hidden"}"><label>Batida de referência (kg)</label><input id="sheetFormulaBatch" class="decimal" type="text" inputmode="decimal" value="100" data-input="updateFormulaTotal"></div>
    </div>

    <div class="ruler">
      <div class="rulerHead">
        <span class="rulerLabel">Composição</span>
        <span id="sheetFormulaTally" class="rulerTally"></span>
      </div>
      <div id="sheetFormulaBar" class="rulerBar"></div>
      <div id="sheetFormulaLegend" class="rulerLegend"></div>
      <div id="sheetFormulaTotal" class="small"></div>
    </div>

    <div class="itemsHead">Itens</div>
    <div id="sheetFormulaEmpty" class="small emptyBox">Nenhum item ainda. Use o botão abaixo para montar a receita.</div>
    <div id="sheetFormulaItems"></div>
    <div class="itemsAdd"><button class="btn alt" data-do="addFormulaRow">+ Adicionar item</button></div>

    <div class="full"><button class="btn" id="sheetFormulaSaveBtn" data-do="saveFormula">Salvar fórmula</button><div id="sheetFormulaMsg"></div></div>`;
}

function renderFormulaEditor(container, sheet, formula, copy) {
  formulaSheet = sheet;
  editingFormulaId = formula && !copy ? formula.id : null;
  editingFormulaProductId = formula && !copy ? formula.product_id : "";
  editingFormulaProductName = formula && !copy ? (formula.suplementacao_products?.name || "") : "";

  container.innerHTML = formulaEditorHtml();
  $("sheetFormulaName").value = formula ? `${formula.name}${copy ? " (cópia)" : ""}` : "";

  if (formula) {
    const batch = formulaBatchKg();
    SupFormula.toPercentItems(
      formula.suplementacao_formula_items.slice().sort((a, b) => a.position - b.position),
      formula.base_batch_kg
    ).forEach(item => {
      const typed = formulaMode === "kg" ? Math.round(item.amount * batch / 100 * 10000) / 10000 : item.amount;
      addFormulaRow(item.item_id, String(typed).replace(".", ","));
    });
  }

  updateFormulaTotal();
  if (copy) msg("sheetFormulaMsg", "Ajuste o nome antes de salvar — cada produto tem uma fórmula ativa.");
}

function openFormulaSheet(formula, copy = false) {
  showSheet({
    title: formula ? (copy ? "Duplicar fórmula" : "Editar fórmula") : "Nova fórmula",
    subtitle: "A receita é gravada em porcentagem e vale para qualquer tamanho de batida.",
    tabs: [{
      id: "formula",
      label: "Fórmula",
      render: (container, sheet) => renderFormulaEditor(container, sheet, formula, copy)
    }]
  }).then(() => {
    formulaSheet = null;
    editingFormulaId = null;
    editingFormulaProductId = "";
    editingFormulaProductName = "";
  });
}

function openFormulaCreate() {
  openFormulaSheet(null);
}

function openFormula(id) {
  const formula = formulas.find(item => item.id === id);
  if (formula) openFormulaSheet(formula);
}

function duplicateFormula(id) {
  const formula = formulas.find(item => item.id === id);
  if (formula) openFormulaSheet(formula, true);
}

async function deactivateFormula(id) {
  if (!(await showConfirm("Inativar esta fórmula? As fabricações já registradas continuam no histórico.", { danger: true }))) return;
  const { error } = await sb.from("suplementacao_formulas").update({ active: false }).eq("id", id);
  if (error) return showAlert(friendlyError(error));
  forgetAfterWrite("produtos", "saldo", "inicio");
  toast("Fórmula inativada.");
  await loadFormulas();
}

async function saveFormula() {
  msg("sheetFormulaMsg", "");
  const name = $("sheetFormulaName").value.trim();
  const items = currentFormulaItems();
  if (!name) return msg("sheetFormulaMsg", "Informe o nome da fórmula.", true);

  const check = SupFormula.validateFormula(items, 100);
  if (!check.valid) return msg("sheetFormulaMsg", check.error, true);

  const selfCheck = SupFormula.validateNoSelfInput(items, formulaProductId());
  if (!selfCheck.valid) return msg("sheetFormulaMsg", selfCheck.error, true);

  if (editingFormulaProductId && name !== editingFormulaProductName) {
    const { error } = await sb.from("suplementacao_products").update({ name }).eq("id", editingFormulaProductId);
    if (error) return msg("sheetFormulaMsg", friendlyError(error), true);
  }

  try {
    await SupApi.rpc("suplementacao_save_formula", {
      p_product_id: editingFormulaProductId || null,
      p_new_product_name: editingFormulaProductId ? null : name,
      p_name: name,
      p_items: items.map(item => ({ item_id: item.item_id, amount: item.amount }))
    });
  } catch (error) {
    return msg("sheetFormulaMsg", friendlyError(error), true);
  }

  forgetAfterWrite("produtos", "saldo", "inicio");
  const sheet = formulaSheet;
  if (sheet) sheet.close();
  await loadFormulas();
  toast("Fórmula salva. O produto fabricado está no estoque — use Fabricar para produzir.");
}
