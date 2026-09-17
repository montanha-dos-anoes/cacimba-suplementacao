const CANCELADO = Symbol("cancelado");

async function runWithNegativeConfirm(call) {
  try {
    return await call(false);
  } catch (error) {
    const items = SupBalance.parseNegativeError(error);
    if (!items) throw error;
    if (!(await showConfirm(SupBalance.negativeConfirmMessage(items), { danger: true }))) throw CANCELADO;
    return call(true);
  }
}

function stockSheetSubtitle(item) {
  const saldo = SupUnits.formatQuantity(item.quantity_kg, item);
  const status = stockStatusHtml(item);
  return `${esc(saldo.main)}${saldo.secondary ? ` <span class="small">${esc(saldo.secondary)}</span>` : ""} · ${fmtMoney(item.avg_unit_cost)}/kg${status ? `<div class="rowPills">${status}</div>` : ""}`;
}

async function refreshStockSheet(sheet, id) {
  await loadStock();
  const item = stockRowById(id);
  if (item) sheet.setSubtitle(stockSheetSubtitle(item));
  return item;
}

function unitSelectHtml(id, item) {
  return `<select id="${id}">${SupUnits.unitOptions(item).map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join("")}</select>`;
}

function openStockManager(id) {
  const item = stockRowById(id);
  if (!item) return;
  showSheet({
    title: item.name,
    subtitle: stockSheetSubtitle(item),
    tabs: [
      { id: "resumo", label: "Resumo", render: container => renderStockSummary(container, stockRowById(id)) },
      { id: "entrada", label: "Entrada", render: (container, sheet) => renderStockEntry(container, sheet, id) },
      { id: "baixa", label: "Baixa", render: (container, sheet) => renderStockExit(container, sheet, id) },
      { id: "editar", label: "Editar", render: (container, sheet) => renderStockEdit(container, sheet, id) },
      { id: "historico", label: "Histórico", render: (container, sheet) => renderStockHistory(container, stockRowById(id), sheet) }
    ]
  });
}

function openStockCreate() {
  showSheet({
    title: "Novo produto",
    subtitle: "Produtos comprados e fabricados ficam na mesma lista de estoque.",
    tabs: [{ id: "editar", label: "Cadastro", render: (container, sheet) => renderStockEdit(container, sheet, null) }]
  });
}

function renderStockSummary(container, item) {
  if (!item) return;
  const saldo = SupUnits.formatQuantity(item.quantity_kg, item);
  const unidade = item.display_unit
    ? `1 ${esc(item.display_unit)} = ${esc(SupUnits.formatKg(item.display_unit_kg))}${item.display_unit_primary ? " · saldo mostrado nesta unidade" : " · saldo mostrado em kg"}`
    : "só kg";
  container.innerHTML = `
    <div class="item"><b>Saldo</b><div>${esc(saldo.main)}${saldo.secondary ? ` <span class="small">${esc(saldo.secondary)}</span>` : ""}</div></div>
    <div class="item"><b>Custo médio</b><div>${fmtMoney(item.avg_unit_cost)} por kg</div></div>
    <div class="item"><b>Unidade de exibição</b><div>${unidade}</div></div>
    <div class="item"><b>Última movimentação</b><div>${item.last_movement_at ? farmDateTimeBR(item.last_movement_at) : "nenhuma"}</div></div>
    ${item.manufactured ? `<div class="item"><b>Fabricado</b><div>fórmula ativa: ${esc(item.formula_name)}</div></div>` : ""}`;
}

let entryOrigin = "bought";
let entryPlanItem = null;

function applyEntryOrigin(item) {
  entryPlanItem = item;
  const made = entryOrigin === "made";
  if ($("sheetEntryOriginHint")) {
    $("sheetEntryOriginHint").textContent = made
      ? `Vai rodar a fórmula "${item.formula_name}" e descontar os insumos do estoque.`
      : "Compra pronta de terceiro: só soma neste produto, não desconta insumo nenhum.";
  }
  $("sheetEntryBtn").textContent = made ? "Registrar fabricação" : "Registrar entrada";
  ["sheetEntryCost", "sheetEntrySupplier"].forEach(field => {
    $(field).closest("div").classList.toggle("hidden", made);
  });
  refreshEntryPlan();
}

function refreshEntryPlan() {
  const box = $("sheetEntryPlan");
  if (!box) return;
  const item = entryPlanItem;
  if (!item || entryOrigin !== "made") {
    box.innerHTML = "";
    return;
  }
  const quantity = SupUnits.toKg(decimalValue($("sheetEntryQty").value), $("sheetEntryUnit").value, item);
  const balances = Object.fromEntries(stockRows.map(row => [row.product_id, Number(row.quantity_kg || 0)]));
  const plan = productionPlan(item.formula_items, item.formula_base_kg, quantity, balances);
  if (!plan.length) {
    box.innerHTML = '<div class="small">Informe a quantidade para ver o consumo de insumos.</div>';
    return;
  }
  const names = Object.fromEntries(stockRows.map(row => [row.product_id, row.name]));
  box.innerHTML = `<div class="planHead">Vai consumir</div>
    <div class="tableWrap always"><table class="histTable stackTable">
      <thead><tr><th>Insumo</th><th class="num">Consumo</th><th class="num">Saldo agora</th><th class="num">Depois</th></tr></thead>
      <tbody>${plan.map(line => `<tr>
        <td data-label="Insumo">${esc(names[line.item_id] || "Produto")}</td>
        <td class="num" data-label="Consumo">${esc(SupUnits.formatKg(line.quantity))}</td>
        <td class="num" data-label="Saldo agora">${esc(SupUnits.formatKg(line.before))}</td>
        <td class="num ${line.missing ? "negative" : ""}" data-label="Depois">${esc(SupUnits.formatKg(line.after))}${line.missing ? " ⚠" : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
}

function renderStockEntry(container, sheet, id) {
  const item = stockRowById(id);
  container.innerHTML = `
    <div class="grid">
      ${item.manufactured ? `<div class="full"><label>De onde veio esta quantidade?</label>
        <div class="reading" id="sheetEntryOrigin">
          <button class="on" data-origin="made">Fabriquei aqui</button>
          <button data-origin="bought">Comprei pronto</button>
        </div>
        <div class="small" id="sheetEntryOriginHint"></div>
      </div>` : ""}
      <div><label>Quantidade</label><input id="sheetEntryQty" class="decimal" type="text" inputmode="decimal" placeholder="Ex.: 1000" data-input="refreshEntryPlan"></div>
      <div><label>Unidade</label><select id="sheetEntryUnit" data-change="refreshEntryPlan">${SupUnits.unitOptions(item).map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join("")}</select></div>
      <div><label>Valor por unidade (R$) <span class="optional">opcional</span></label><input id="sheetEntryCost" class="decimal" type="text" inputmode="decimal" placeholder="Ex.: 1,15"></div>
      <div><label>Data</label><input id="sheetEntryDate" type="datetime-local" value="${farmNowLocal()}"></div>
      <div class="full"><label>Fornecedor</label><input id="sheetEntrySupplier"></div>
      <div class="full"><label>Observação</label><textarea id="sheetEntryNotes"></textarea></div>
      <div class="full" id="sheetEntryPlan"></div>
      <div class="full"><button class="btn" id="sheetEntryBtn">Registrar entrada</button><div id="sheetEntryMsg"></div></div>
    </div>`;

  if (item.manufactured) {
    $("sheetEntryOrigin").querySelectorAll("button").forEach(button => {
      button.onclick = () => {
        entryOrigin = button.dataset.origin;
        $("sheetEntryOrigin").querySelectorAll("button").forEach(other => other.classList.toggle("on", other === button));
        applyEntryOrigin(item);
      };
    });
  }
  entryOrigin = item.manufactured ? "made" : "bought";
  applyEntryOrigin(item);

  $("sheetEntryBtn").onclick = event => runAction(event.currentTarget, async () => {
    msg("sheetEntryMsg", "");
    const raw = decimalValue($("sheetEntryQty").value);
    if (!Number.isFinite(raw) || raw <= 0) return msg("sheetEntryMsg", "Informe uma quantidade maior que zero.", true);
    const unit = $("sheetEntryUnit").value;
    const kgPerUnit = SupUnits.toKg(1, unit, item) || 1;
    const costPerUnit = decimalValue($("sheetEntryCost").value);

    if (entryOrigin === "made") {
      try {
        await runWithNegativeConfirm(allowNegative => SupApi.rpc("suplementacao_register_production", {
          p_formula_id: item.formula_id,
          p_quantity_kg: SupUnits.toKg(raw, unit, item),
          p_occurred_at: $("sheetEntryDate").value ? new Date($("sheetEntryDate").value).toISOString() : new Date().toISOString(),
          p_notes: $("sheetEntryNotes").value.trim() || null,
          p_allow_negative: allowNegative
        }));
        forgetAfterWrite("saldo", "inicio");
        await loadStock();
        sheet.close();
        toast("Fabricação registrada e insumos descontados.");
      } catch (error) {
        if (error === CANCELADO) return;
        msg("sheetEntryMsg", friendlyError(error), true);
      }
      return;
    }

    try {
      await SupApi.rpc("suplementacao_add_stock_entry", {
        p_product_id: id,
        p_quantity: SupUnits.toKg(raw, unit, item),
        p_unit_cost: costPerUnit / kgPerUnit,
        p_occurred_at: $("sheetEntryDate").value ? new Date($("sheetEntryDate").value).toISOString() : new Date().toISOString(),
        p_supplier: $("sheetEntrySupplier").value.trim() || null,
        p_notes: $("sheetEntryNotes").value.trim() || null
      });
      forgetAfterWrite("saldo", "inicio");
      await loadStock();
      sheet.close();
      toast("Entrada registrada.");
    } catch (error) {
      msg("sheetEntryMsg", friendlyError(error), true);
    }
  });
}

function renderStockExit(container, sheet, id) {
  const item = stockRowById(id);
  container.innerHTML = `
    <div class="grid">
      <div><label>Quantidade</label><input id="sheetExitQty" class="decimal" type="text" inputmode="decimal" placeholder="Ex.: 500"></div>
      <div><label>Unidade</label>${unitSelectHtml("sheetExitUnit", item)}</div>
      <div class="full"><label>Tipo</label><select id="sheetExitKind"><option value="sale">Venda</option><option value="loss">Perda</option><option value="fix">Correção</option></select></div>
      <div class="full"><label>Motivo <span class="optional" id="sheetExitReasonHint">obrigatório</span></label><input id="sheetExitReason" placeholder="Ex.: perda por umidade"></div>
      <div class="full"><button class="btn" id="sheetExitBtn">Registrar baixa</button>
        <div class="small">Para corrigir o saldo <b>para mais</b>, use a aba Entrada.</div>
        <div id="sheetExitMsg"></div>
      </div>
    </div>`;

  const kindSelect = $("sheetExitKind");
  const refreshReasonHint = () => {
    $("sheetExitReasonHint").textContent = kindSelect.value === "sale" ? "opcional" : "obrigatório";
  };
  kindSelect.onchange = refreshReasonHint;
  refreshReasonHint();

  $("sheetExitBtn").onclick = event => runAction(event.currentTarget, async () => {
    msg("sheetExitMsg", "");
    const raw = decimalValue($("sheetExitQty").value);
    if (!Number.isFinite(raw) || raw <= 0) return msg("sheetExitMsg", "Informe uma quantidade maior que zero.", true);
    const reason = $("sheetExitReason").value.trim();
    const isSale = kindSelect.value === "sale";
    if (!isSale && !reason) return msg("sheetExitMsg", "Informe o motivo.", true);

    const quantity = SupUnits.toKg(raw, $("sheetExitUnit").value, item);
    const call = allowNegative => isSale
      ? SupApi.rpc("suplementacao_sell_stock", { p_product_id: id, p_quantity: quantity, p_reason: reason || null, p_allow_negative: allowNegative })
      : SupApi.rpc("suplementacao_adjust_stock", { p_product_id: id, p_quantity: -quantity, p_reason: reason, p_allow_negative: allowNegative });

    try {
      await runWithNegativeConfirm(call);
      forgetAfterWrite("saldo", "inicio");
      await loadStock();
      sheet.close();
      toast("Baixa registrada.");
    } catch (error) {
      if (error === CANCELADO) return;
      msg("sheetExitMsg", friendlyError(error), true);
    }
  });
}

function renderStockEdit(container, sheet, id) {
  const item = id ? stockRowById(id) : null;
  container.innerHTML = `
    <div class="grid">
      <div class="full"><label>Nome</label><input id="sheetEditName" value="${esc(item?.name || "")}" placeholder="Ex.: Milho moído"></div>
      <div class="full checkLine"><label><input type="checkbox" id="sheetEditHasUnit" ${item?.display_unit ? "checked" : ""}> Tem unidade de compra/uso além do kg</label></div>
      <div class="grid full ${item?.display_unit ? "" : "hidden"}" id="sheetEditUnitFields">
        <div><label>Nome da unidade</label><input id="sheetEditUnit" value="${esc(item?.display_unit || "")}" placeholder="Ex.: saca, L, bombona"></div>
        <div><label>Quanto pesa em kg</label><input id="sheetEditUnitKg" class="decimal" type="text" inputmode="decimal" value="${esc(String(item?.display_unit_kg ?? "").replace(".", ","))}" placeholder="Ex.: 30"></div>
        <div class="full checkLine"><label><input type="checkbox" id="sheetEditUnitPrimary" ${item?.display_unit_primary ? "checked" : ""}> Mostrar o saldo nesta unidade em vez de kg</label></div>
      </div>
      ${id ? "" : `<div class="full initialBox">
        <div class="itemsHead">Saldo inicial (opcional)</div>
        <div class="grid">
          <div><label>Quantidade</label><input id="sheetInitQty" class="decimal" type="text" inputmode="decimal" placeholder="Ex.: 1000"></div>
          <div><label>Unidade</label><select id="sheetInitUnit"><option value="kg">kg</option></select></div>
          <div class="full"><label>Valor por unidade (R$) <span class="optional">opcional</span></label><input id="sheetInitCost" class="decimal" type="text" inputmode="decimal" placeholder="Ex.: 1,15"></div>
        </div>
        <div class="small">Tudo aqui é opcional. Preenchendo a quantidade, o produto já nasce com essa entrada lançada; informando também o valor, o custo médio já sai calculado.</div>
      </div>`}
      <div class="full"><button class="btn" id="sheetEditBtn">${id ? "Salvar alterações" : "Cadastrar produto"}</button>
        ${id ? `<button class="btn ${item.active ? "danger" : "alt"}" style="margin-left:8px" id="sheetEditToggle">${item.active ? "Desativar" : "Reativar"}</button>` : ""}
        <div id="sheetEditMsg"></div>
      </div>
    </div>`;

  const refreshInitialUnit = () => {
    if (!$("sheetInitUnit")) return;
    const custom = $("sheetEditHasUnit").checked ? $("sheetEditUnit").value.trim() : "";
    const chosen = $("sheetInitUnit").value;
    $("sheetInitUnit").innerHTML = `<option value="kg">kg</option>${custom ? `<option value="${esc(custom)}">${esc(custom)}</option>` : ""}`;
    $("sheetInitUnit").value = custom && chosen === custom ? custom : "kg";
  };

  $("sheetEditHasUnit").onchange = () => {
    $("sheetEditUnitFields").classList.toggle("hidden", !$("sheetEditHasUnit").checked);
    refreshInitialUnit();
  };
  $("sheetEditUnit").oninput = refreshInitialUnit;

  $("sheetEditBtn").onclick = event => runAction(event.currentTarget, async () => {
    msg("sheetEditMsg", "");
    const name = $("sheetEditName").value.trim();
    if (!name) return msg("sheetEditMsg", "Informe o nome do produto.", true);
    const hasUnit = $("sheetEditHasUnit").checked;
    const unitName = $("sheetEditUnit").value.trim();
    const unitKg = decimalValue($("sheetEditUnitKg").value);
    if (hasUnit && (!unitName || !(unitKg > 0))) {
      return msg("sheetEditMsg", "Informe o nome da unidade e quanto ela pesa em kg.", true);
    }
    if (hasUnit && ["kg", "quilo", "quilos"].includes(unitName.toLowerCase())) {
      return msg("sheetEditMsg", "A unidade de exibição precisa ser diferente de kg.", true);
    }
    const payload = {
      name,
      display_unit: hasUnit ? unitName : null,
      display_unit_kg: hasUnit ? unitKg : null,
      display_unit_primary: hasUnit && $("sheetEditUnitPrimary").checked
    };
    const { data, error } = id
      ? await sb.from("suplementacao_products").update(payload).eq("id", id).select().single()
      : await sb.from("suplementacao_products").insert({ ...payload, created_by: profile.id }).select().single();
    if (error) return msg("sheetEditMsg", friendlyError(error), true);
    forgetAfterWrite("produtos", "saldo", "inicio");
    if (id) {
      await loadStock();
      sheet.close();
      toast("Produto atualizado.");
    } else {
      const created = data;
      const initialQty = decimalValue($("sheetInitQty").value);
      if (initialQty > 0) {
        const product = { display_unit: payload.display_unit, display_unit_kg: payload.display_unit_kg };
        const unit = $("sheetInitUnit").value;
        const kgPerUnit = SupUnits.toKg(1, unit, product) || 1;
        try {
          await SupApi.rpc("suplementacao_add_stock_entry", {
            p_product_id: created.id,
            p_quantity: SupUnits.toKg(initialQty, unit, product),
            p_unit_cost: decimalValue($("sheetInitCost").value) / kgPerUnit,
            p_occurred_at: new Date().toISOString(),
            p_supplier: null,
            p_notes: "Saldo inicial do cadastro"
          });
        } catch (entryError) {
          await loadStock();
          return msg("sheetEditMsg", `Produto criado, mas o saldo inicial falhou: ${friendlyError(entryError)}`, true);
        }
      }
      await loadStock();
      sheet.close();
      toast(initialQty > 0 ? "Produto cadastrado com saldo inicial." : "Produto cadastrado.");
    }
  });

  if (id) {
    $("sheetEditToggle").onclick = event => runAction(event.currentTarget, async () => {
      if (!(await showConfirm(`${item.active ? "Desativar" : "Reativar"} este produto?`, { danger: item.active }))) return;
      const { error } = await sb.from("suplementacao_products").update({ active: !item.active }).eq("id", id);
      if (error) return msg("sheetEditMsg", friendlyError(error), true);
      forgetAfterWrite("produtos", "saldo", "inicio");
      await loadStock();
      sheet.close();
      toast(item.active ? "Produto desativado." : "Produto reativado.");
    });
  }
}

function compareMovements(a, b) {
  const byOccurred = new Date(a.occurred_at) - new Date(b.occurred_at);
  if (byOccurred) return byOccurred;
  const byCreated = new Date(a.created_at || a.occurred_at) - new Date(b.created_at || b.occurred_at);
  if (byCreated) return byCreated;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function openingBalanceKg(totalKg, movements) {
  const loaded = (movements || []).reduce((sum, movement) => sum + (Number(movement.quantity_kg) || 0), 0);
  return Math.round((Number(totalKg || 0) - loaded) * 1000) / 1000;
}

function stockHistoryWithBalance(movements, opening = 0) {
  const oldestFirst = [...(movements || [])].sort(compareMovements);
  let running = Number(opening) || 0;
  const withBalance = oldestFirst.map(movement => {
    running += Number(movement.quantity_kg) || 0;
    return { ...movement, balance_after: Math.round(running * 1000) / 1000 };
  });
  return withBalance.reverse();
}

async function fixEntryCost(movement, item, container, sheet) {
  const current = String(Number(movement.unit_cost || 0)).replace(".", ",");
  const typed = await showPrompt(
    `Valor por kg pago nessa entrada de ${SupUnits.formatKg(movement.quantity_kg)}:`,
    { defaultValue: current, placeholder: "Ex.: 1,15" }
  );
  if (typed === null) return;
  const value = decimalValue(typed);
  if (!(value >= 0)) return showAlert("Informe um valor válido.");

  try {
    await SupApi.rpc("suplementacao_fix_entry_cost", { p_movement_id: movement.id, p_unit_cost: value });
  } catch (error) {
    return showAlert(friendlyError(error));
  }

  toast("Valor corrigido. Custo médio recalculado.");
  await refreshStockSheet(sheet, item.product_id);
  await renderStockHistory(container, stockRowById(item.product_id), sheet);
}

async function renderStockHistory(container, item, sheet) {
  container.innerHTML = '<div class="small">Carregando…</div>';
  const { data, error } = await sb
    .from("suplementacao_stock_movements")
    .select("*, suplementacao_profiles!suplementacao_stock_movements_recorded_by_fkey(full_name)")
    .eq("product_id", item.product_id)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) {
    container.innerHTML = `<div class="msg err">${esc(error.message)}</div>`;
    return;
  }
  const rows = stockHistoryWithBalance(data || [], openingBalanceKg(item.quantity_kg, data || []));
  container.innerHTML = rows.length
    ? `<div class="tableWrap always"><table class="histTable stackTable">
        <thead><tr><th>Data</th><th>Tipo</th><th class="num">Qtd (kg)</th><th class="num">Saldo</th><th class="num">Valor/kg</th><th>Quem</th><th>Motivo</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr>
          <td data-label="Data">${farmDateTimeBR(row.occurred_at)}</td>
          <td data-label="Tipo">${esc(STOCK_KINDS[row.kind] || row.kind)}</td>
          <td class="num" data-label="Qtd (kg)">${esc(SupUnits.formatKg(row.quantity_kg))}</td>
          <td class="num ${row.balance_after < 0 ? "negative" : ""}" data-label="Saldo">${esc(SupUnits.formatKg(row.balance_after))}</td>
          <td class="num" data-label="Valor/kg">${row.kind === "entry"
            ? `${fmtMoney(row.unit_cost)} <button class="linkBtn" data-fix="${index}">corrigir</button>`
            : row.unit_cost ? fmtMoney(row.unit_cost) : ""}</td>
          <td data-label="Quem">${esc(row.suplementacao_profiles?.full_name || "")}</td>
          <td data-label="Motivo">${esc(row.reason || row.supplier || "")}</td>
        </tr>`).join("")}</tbody>
      </table></div>${rows.length === 100 ? '<div class="small">Mostrando os 100 movimentos mais recentes.</div>' : ""}`
    : '<div class="small">Nenhuma movimentação para este produto.</div>';

  container.querySelectorAll("[data-fix]").forEach(button => {
    button.onclick = () => fixEntryCost(rows[Number(button.dataset.fix)], item, container, sheet);
  });
}
