let productions = [];

function productionOccurredChanged() {
  markDateTimeAsManual($("productionDate"));
}

async function loadProductions() {
  refreshAutomaticDateTime($("productionDate"));
  await loadFormulas();
  $("productionFormula").innerHTML = formulas.length
    ? formulas.map(formula => `<option value="${formula.id}">${esc(formula.name)}</option>`).join("")
    : '<option value="">Nenhuma fórmula cadastrada</option>';

  const registradas = await SupCache.fetch("fabricacoes", () => sb
    .from("suplementacao_productions")
    .select("*, suplementacao_formulas(name), suplementacao_products(name), suplementacao_profiles!suplementacao_productions_recorded_by_fkey(full_name)")
    .order("occurred_at", { ascending: false })
    .limit(100));
  if (!registradas.value) return msg("productionMsg", ...cacheStatus([registradas], "as fabricações"));
  msg("productionMsg", ...cacheStatus([registradas], "as fabricações"));
  productions = registradas.value;

  $("productionsList").innerHTML = productions.map(row => `
    <div class="item">
      <b>${esc(row.suplementacao_formulas?.name || "")}</b> ${row.reversed_at ? '<span class="pill warn">ESTORNADA</span>' : ""}
      <div>${Number(row.quantity_kg).toLocaleString("pt-BR")} kg de ${esc(row.suplementacao_products?.name || "")} · ${fmtMoney(row.total_cost)}</div>
      <div class="small">${farmDateTimeBR(row.occurred_at)} · ${esc(row.suplementacao_profiles?.full_name || "")}</div>
      ${row.reversed_at ? `<div class="small">Estorno: ${esc(row.reversal_reason || "")}</div>` : `<div class="actions"><button class="btn danger smallbtn" data-do="reverseProduction" data-arg="${row.id}">Estornar</button></div>`}
    </div>`).join("") || '<div class="small">Nenhuma fabricação registrada.</div>';

  previewProduction();
}

function productionPlan(items, baseBatchKg, targetKg, balances) {
  const target = Number(targetKg) || 0;
  if (target <= 0 || !(items || []).length) return [];
  return SupFormula.scaleToProduction(items, baseBatchKg, target).map(line => {
    const before = Number(balances?.[line.item_id] || 0);
    const after = Math.round((before - line.quantity) * 1000) / 1000;
    return { item_id: line.item_id, quantity: line.quantity, before, after, missing: after < 0 };
  });
}

function previewProduction() {
  const formula = formulas.find(item => item.id === $("productionFormula").value);
  const target = decimalValue($("productionQty").value);
  const productsById = Object.fromEntries(stockRows.map(item => [item.product_id, item]));
  const balances = Object.fromEntries(stockRows.map(item => [item.product_id, Number(item.quantity_kg || 0)]));
  const plan = formula ? productionPlan(formula.suplementacao_formula_items, formula.base_batch_kg, target, balances) : [];

  if (!plan.length) {
    $("productionPreview").innerHTML = formula
      ? '<div class="small">Informe a quantidade a produzir para ver o consumo.</div>'
      : "";
    return;
  }

  $("productionPreview").innerHTML = `<div class="planHead">Vai consumir para ${esc(SupUnits.formatKg(target))}</div>
    <div class="tableWrap always"><table class="histTable stackTable">
      <thead><tr><th>Insumo</th><th class="num">Consumo</th><th class="num">Saldo agora</th><th class="num">Depois</th></tr></thead>
      <tbody>${plan.map(line => `<tr>
        <td data-label="Insumo">${esc(productsById[line.item_id]?.name || "Produto")}</td>
        <td class="num" data-label="Consumo">${esc(SupUnits.formatKg(line.quantity))}</td>
        <td class="num" data-label="Saldo agora">${esc(SupUnits.formatKg(line.before))}</td>
        <td class="num ${line.missing ? "negative" : ""}" data-label="Depois">${esc(SupUnits.formatKg(line.after))}${line.missing ? " ⚠" : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${plan.some(line => line.missing) ? '<div class="small">Os insumos em vermelho ficam negativos — o sistema vai pedir confirmação antes de gravar.</div>' : ""}`;
}

async function saveProduction() {
  msg("productionMsg", "");
  const occurred = refreshAutomaticDateTime($("productionDate"));
  const quantity = decimalValue($("productionQty").value);
  if (!$("productionFormula").value || !Number.isFinite(quantity) || quantity <= 0) {
    return msg("productionMsg", "Escolha a fórmula e informe a quantidade a produzir.", true);
  }
  try {
    await runWithNegativeConfirm(allowNegative => SupApi.rpc("suplementacao_register_production", {
      p_formula_id: $("productionFormula").value,
      p_quantity_kg: quantity,
      p_occurred_at: occurred ? farmLocalToDate(occurred).toISOString() : new Date().toISOString(),
      p_notes: $("productionNotes").value.trim() || null,
      p_allow_negative: allowNegative
    }));
    forgetAfterWrite("saldo", "inicio");
    $("productionQty").value = "";
    $("productionNotes").value = "";
    setAutomaticDateTime($("productionDate"));
    toast("Fabricação registrada e estoque atualizado.");
    await loadProductions();
  } catch (error) {
    if (error === CANCELADO) return;
    msg("productionMsg", friendlyError(error), true);
  }
}

async function reverseProduction(id) {
  const reason = await showPrompt("Motivo do estorno:");
  if (!reason || !reason.trim()) return;
  try {
    await runWithNegativeConfirm(allowNegative => SupApi.rpc("suplementacao_reverse_production", {
      p_production_id: id,
      p_reason: reason.trim(),
      p_allow_negative: allowNegative
    }));
    forgetAfterWrite("saldo", "inicio");
    await loadProductions();
    toast("Fabricação estornada e insumos devolvidos ao estoque.");
  } catch (error) {
    if (error === CANCELADO) return;
    await showAlert(friendlyError(error));
  }
}
