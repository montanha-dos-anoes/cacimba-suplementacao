let lotTab = "active";
let lotSheet = null;

function lotVersionForDate(lotId, dateStr = farmDateISO()) {
  return lotVersions
    .filter(version => version.lot_id === lotId && version.effective_from <= dateStr)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] || null;
}

function groupsForVersion(versionId) {
  return lotVersionGroups.filter(group => group.lot_version_id === versionId);
}

function currentLotInfo(lotId, dateStr = farmDateISO()) {
  const version = lotVersionForDate(lotId, dateStr);
  if (!version) return null;
  const groups = groupsForVersion(version.id);
  return { version, groups, total: groups.reduce((sum, group) => sum + Number(group.quantity || 0), 0) };
}

function lotProductName(group) {
  return products.find(item => item.id === group.product_id)?.name || group.product_name || "Produto";
}

function lotMainGroup(info) {
  return [...(info?.groups || [])].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0] || null;
}

function lotProductList(info) {
  const seen = new Map();
  (info?.groups || []).forEach(group => {
    if (group.product_id && !seen.has(group.product_id)) seen.set(group.product_id, lotProductName(group));
  });
  return [...seen].map(([product_id, name]) => ({ product_id, name }));
}

function lotExpectedKgDay(info, productId = null) {
  return (info?.groups || [])
    .filter(group => !productId || group.product_id === productId)
    .reduce(
      (sum, group) => sum + Number(group.quantity || 0) * Number(group.expected_consumption_kg_head_day || 0),
      0
    );
}

const LOT_VERSIONS_MAX_AGE_MS = 120000;

async function loadLotVersions(opcoes = {}) {
  const composicao = await SupCache.fetch("lotes",
    () => Promise.all([
      sb.from("suplementacao_lot_versions").select("*").order("effective_from", { ascending: false }),
      sb.from("suplementacao_lot_version_groups").select("*").order("created_at")
    ]),
    ([versionsRes, groupsRes]) => ({ versions: versionsRes.data || [], groups: groupsRes.data || [] }),
    { maxAgeMs: LOT_VERSIONS_MAX_AGE_MS, ...opcoes });

  if (composicao.value) {
    lotVersions = composicao.value.versions;
    lotVersionGroups = composicao.value.groups;
  }
  msg("lotsMsg", ...cacheStatus([composicao], "a composição dos lotes"));
}

async function loadLots() {
  await Promise.all([loadMasters(), loadStock(), loadLotVersions()]);
  renderLots();
}

function showLotTab(tab) {
  lotTab = tab;
  renderLots();
}

function lotGroupLine(group) {
  const expected = group.expected_consumption_kg_head_day;
  const missing = group.product_id ? "" : ' <span class="pill warn">SEM PRODUTO NO ESTOQUE</span>';
  return `<div class="small lotMeta">· ${esc(group.category)} · ${Number(group.quantity || 0).toLocaleString("pt-BR")} animais · ${esc(SupUnits.formatKg(group.avg_weight_kg))} · ${esc(lotProductName(group))}${missing} · esperado ${expected == null ? "—" : Number(expected).toLocaleString("pt-BR")} kg/cab/dia</div>`;
}

function lotCardHtml(lot) {
  const info = currentLotInfo(lot.id);
  const detail = info
    ? info.groups.map(lotGroupLine).join("")
      + `<div class="small lotMeta"><b>Total atual: ${info.total.toLocaleString("pt-BR")} animais</b> · ${esc(SupUnits.formatKg(lotExpectedKgDay(info)))}/dia esperado · válido desde ${esc(farmDateBR(info.version.effective_from))}</div>`
    : '<div class="small lotMeta">Ainda sem composição cadastrada.</div>';

  return `<div class="item">
    <b>${esc(lot.name)}</b> <span class="pill">${lot.active ? "ATIVO" : "ENCERRADO"}</span>
    ${detail}
    <div class="actions lotActions">
      <button class="btn alt smallbtn" data-do="lotEdit" data-arg="${lot.id}">Editar lote</button>
      <button class="btn alt smallbtn" data-do="lotSupplement" data-arg="${lot.id}">Alterar suplemento</button>
      <button class="btn alt smallbtn" data-do="lotHistory" data-arg="${lot.id}">Ver histórico</button>
      <button class="btn ${lot.active ? "danger" : "alt"} smallbtn" data-do="lotToggle" data-arg="${lot.id}">${lot.active ? "Encerrar lote" : "Reativar lote"}</button>
    </div>
  </div>`;
}

function renderLots() {
  document.querySelectorAll("#lotTabs .tab").forEach(button => {
    button.classList.toggle("on", button.dataset.arg === lotTab);
  });
  const rows = lots.filter(lot => (lotTab === "active" ? lot.active : !lot.active));
  $("lotsList").innerHTML = rows.map(lotCardHtml).join("")
    || `<div class="small">${lotTab === "active" ? "Nenhum lote ativo." : "Nenhum lote encerrado."}</div>`;
}

function lotGroupRowHtml(group) {
  return `<div class="groupBox lotGroupRow">
    <div class="grid">
      <div class="full"><label>Categoria dos animais</label><input class="lotCategory" placeholder="Ex.: Novilha de engorda" value="${esc(group?.category || "")}"></div>
      <div><label>Quantidade de animais</label><input class="lotQty decimal" type="text" inputmode="numeric" placeholder="Ex.: 120" value="${esc(group ? String(group.quantity ?? "") : "")}"></div>
      <div><label>Peso médio (kg)</label><input class="lotWeight decimal" type="text" inputmode="decimal" placeholder="Ex.: 380" value="${esc(group ? String(group.avg_weight_kg ?? "").replace(".", ",") : "")}"></div>
      <div class="full"><label>Suplemento</label><select class="lotProduct">${supplementOptionsHtml(group?.product_id || "")}</select></div>
      <div class="full"><label>Consumo esperado (kg/cabeça/dia)</label><input class="lotExpected decimal" type="text" inputmode="decimal" placeholder="Ex.: 0,08" value="${esc(group ? String(group.expected_consumption_kg_head_day ?? "").replace(".", ",") : "")}"></div>
    </div>
  </div>`;
}

function readLotGroups() {
  return [...document.querySelectorAll("#sheetLotGroups .lotGroupRow")].map(row => ({
    category: row.querySelector(".lotCategory").value.trim(),
    quantity: decimalValue(row.querySelector(".lotQty").value),
    avg_weight_kg: decimalValue(row.querySelector(".lotWeight").value),
    product_id: row.querySelector(".lotProduct").value,
    expected_consumption_kg_head_day: decimalValue(row.querySelector(".lotExpected").value)
  }));
}

function validateLotGroups(groups) {
  if (groups.length !== 1) return "O lote tem exatamente uma categoria.";
  const [group] = groups;
  if (!group.category) return "Informe a categoria dos animais.";
  if (!Number.isInteger(group.quantity) || group.quantity < 0) return "A quantidade de animais precisa ser um número inteiro.";
  if (!(group.avg_weight_kg > 0)) return "Informe o peso médio.";
  if (!group.product_id) return "Escolha o suplemento.";
  if (!(group.expected_consumption_kg_head_day >= 0)) return "Informe o consumo esperado.";
  return "";
}

function legacyGroupsNote(info) {
  const extra = (info?.groups.length || 0) - 1;
  return extra > 0
    ? `<div class="small emptyBox">Este lote tinha ${info.groups.length} categorias. Agora o lote tem uma só: ao salvar, fica apenas a categoria abaixo (a de mais animais).</div>`
    : "";
}

function renderLotEditor(container, sheet, lot) {
  lotSheet = sheet;
  const info = lot ? currentLotInfo(lot.id) : null;
  container.innerHTML = `
    <div class="grid">
      <div class="full"><label>Nome do lote</label><input id="sheetLotName" placeholder="Ex.: Lote 01" value="${esc(lot?.name || "")}"></div>
      <div class="full"><label>Data de vigência</label><input id="sheetLotEffective" type="date" value="${esc(farmDateISO())}">
        <div class="small">A partir desta data a composição passa a valer. Se já existir uma configuração nesta data, ela será atualizada; em outra data, uma nova vigência será criada. Para trocar só o suplemento, use <b>Alterar suplemento</b> no lote.</div>
      </div>
    </div>
    <div class="itemsHead">Categoria do lote</div>
    ${legacyGroupsNote(info)}
    <div id="sheetLotGroups">${lotGroupRowHtml(lotMainGroup(info))}</div>
    <div class="full"><label>Observação da alteração (opcional)</label><textarea id="sheetLotNote" placeholder="Ex.: apartação de 50 novilhas"></textarea></div>
    <input type="hidden" id="sheetLotEditId" value="${esc(lot?.id || "")}">`;

  sheet.setFooter('<button class="btn" id="sheetLotSaveBtn" data-do="saveLot">Salvar lote</button><div id="sheetLotMsg"></div>');
}

function openLotSheet(lot) {
  showSheet({
    title: lot ? "Editar lote" : "Novo lote",
    subtitle: lot
      ? "Na mesma data, salvar atualiza a vigência existente; em outra data, cria uma nova."
      : "Cadastre a categoria dos animais e o suplemento que ela recebe.",
    tabs: [{
      id: "lote",
      label: "Lote",
      render: (container, sheet) => renderLotEditor(container, sheet, lot)
    }]
  }).then(() => { lotSheet = null; });
}

function openLotCreate() {
  openLotSheet(null);
}

function openLotEdit(id) {
  const lot = lots.find(item => item.id === id);
  if (lot) openLotSheet(lot);
}

async function saveLot() {
  msg("sheetLotMsg", "");
  const name = $("sheetLotName").value.trim();
  const effective = $("sheetLotEffective").value;
  const groups = readLotGroups();
  if (!name) return msg("sheetLotMsg", "Informe o nome do lote.", true);
  if (!effective) return msg("sheetLotMsg", "Informe a data de vigência.", true);

  const invalid = validateLotGroups(groups);
  if (invalid) return msg("sheetLotMsg", invalid, true);

  try {
    await SupApi.rpc("suplementacao_save_lot_configuration", {
      p_lot_id: $("sheetLotEditId").value || null,
      p_name: name,
      p_effective_from: effective,
      p_note: $("sheetLotNote").value.trim() || null,
      p_groups: groups
    });
  } catch (error) {
    return msg("sheetLotMsg", friendlyError(error), true);
  }

  forgetAfterWrite("lotes", "inicio");
  const sheet = lotSheet;
  if (sheet) sheet.close();
  await loadLots();
  toast("Lote salvo.");
}

function renderLotSupplement(container, sheet, lot, info) {
  lotSheet = sheet;
  container.innerHTML = `
    <div class="grid">
      <div class="full"><label>Data de vigência da mudança</label><input id="sheetLotEffective" type="date" value="${esc(farmDateISO())}">
        <div class="small">Categoria, quantidade de animais e peso médio continuam iguais. Só o suplemento e o consumo esperado mudam a partir desta data. Se já houver uma configuração nesta data, ela será atualizada.</div>
      </div>
    </div>
    <div class="itemsHead">Categoria</div>
    ${legacyGroupsNote(info)}
    <div id="sheetLotGroups">${[lotMainGroup(info)].map(group => `<div class="groupBox lotGroupRow">
      <b>${esc(group.category)}</b>
      <div class="small">${Number(group.quantity || 0).toLocaleString("pt-BR")} animais · ${esc(SupUnits.formatKg(group.avg_weight_kg))}</div>
      <div class="grid">
        <div class="full"><label>Novo suplemento</label><select class="lotProduct">${supplementOptionsHtml(group.product_id || "")}</select></div>
        <div class="full"><label>Novo consumo esperado (kg/cabeça/dia)</label><input class="lotExpected decimal" type="text" inputmode="decimal" value="${esc(String(group.expected_consumption_kg_head_day ?? "").replace(".", ","))}"></div>
      </div>
      <input type="hidden" class="lotCategory" value="${esc(group.category)}">
      <input type="hidden" class="lotQty" value="${esc(String(group.quantity ?? ""))}">
      <input type="hidden" class="lotWeight" value="${esc(String(group.avg_weight_kg ?? "").replace(".", ","))}">
    </div>`).join("")}</div>
    <div class="full"><label>Observação (opcional)</label><textarea id="sheetLotNote" placeholder="Ex.: mudança de creep para proteinado 0,3%"></textarea></div>
    <div class="full"><button class="btn" id="sheetLotSaveBtn" data-do="saveLot">Salvar mudança de suplemento</button><div id="sheetLotMsg"></div></div>
    <input type="hidden" id="sheetLotEditId" value="${esc(lot.id)}">
    <input type="hidden" id="sheetLotName" value="${esc(lot.name)}">`;
}

function openLotSupplement(id) {
  const lot = lots.find(item => item.id === id);
  if (!lot) return;
  const info = currentLotInfo(id);
  if (!info || !info.groups.length) return showAlert("Este lote ainda não tem composição cadastrada.");
  showSheet({
    title: "Alterar suplemento",
    subtitle: esc(lot.name),
    tabs: [{ id: "suplemento", label: "Suplemento", render: (container, sheet) => renderLotSupplement(container, sheet, lot, info) }]
  }).then(() => { lotSheet = null; });
}

function openLotHistory(id) {
  const lot = lots.find(item => item.id === id);
  if (!lot) return;
  const versions = lotVersions
    .filter(version => version.lot_id === id)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  showSheet({
    title: "Histórico do lote",
    subtitle: esc(lot.name),
    tabs: [{
      id: "historico",
      label: "Histórico",
      render: container => {
        container.innerHTML = versions.map(version => {
          const groups = groupsForVersion(version.id);
          return `<div class="item">
            <b>Válido desde ${esc(farmDateBR(version.effective_from))}</b>
            ${version.note ? `<div class="small">Observação: ${esc(version.note)}</div>` : ""}
            ${groups.map(lotGroupLine).join("")}
            <div class="small lotMeta">Total ${groups.reduce((sum, group) => sum + Number(group.quantity || 0), 0).toLocaleString("pt-BR")} animais</div>
          </div>`;
        }).join("") || '<div class="small">Este lote ainda não tem histórico de composição.</div>';
      }
    }]
  });
}

async function toggleLot(id) {
  const lot = lots.find(item => item.id === id);
  if (!lot) return;
  const question = lot.active
    ? "Encerrar este lote? Ele sai da lista de tratos, mas o histórico continua."
    : "Reativar este lote?";
  if (!(await showConfirm(question, { danger: lot.active }))) return;
  const { error } = await sb.from("suplementacao_lots").update({ active: !lot.active }).eq("id", id);
  if (error) return showAlert(friendlyError(error));
  forgetAfterWrite("lotes", "inicio");
  toast(lot.active ? "Lote encerrado." : "Lote reativado.");
  await loadLots();
}
