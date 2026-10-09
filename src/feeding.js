let productStock = [];

const FEEDING_BACKDATE_HOURS = 24;

function occurredLimits(now = new Date()) {
  return {
    max: farmNowLocal(now),
    min: farmNowLocal(new Date(now.getTime() - FEEDING_BACKDATE_HOURS * 60 * 60 * 1000))
  };
}

function applyOccurredLimits() {
  const field = $('occurred');
  if (!field) return;
  const limites = occurredLimits();
  field.min = limites.min;
  field.max = limites.max;
}

function occurredError(value, now = new Date()) {
  const when = farmLocalToDate(value);
  if (Number.isNaN(when.getTime())) return 'Informe a data e a hora do trato.';
  if (when.getTime() > now.getTime()) return 'O trato não pode ter data ou hora no futuro.';
  if (when.getTime() < now.getTime() - FEEDING_BACKDATE_HOURS * 60 * 60 * 1000) {
    return 'O trato só pode ser lançado até 24 horas para trás.';
  }
  return '';
}

function resetFeedingForm(){
  $('lot').value='';
  $('qty').value='';
  $('notes').value='';
  reading=null;
  document.querySelectorAll('#trato .reading button').forEach(x=>x.classList.remove('on'));
  setAutomaticDateTime($('occurred'));
  applyOccurredLimits();
}

function feedingOccurredChanged() {
  markDateTimeAsManual($("occurred"));
  renderFeedingLots();
  syncLotProduct();
}

function afterFeedingSaved(message){
  resetFeedingForm();
  renderFeedingLots();
  applyLotProduct();
  toast(message);
  $('lot').focus();
}

function queueFeeding(record){
  outboxAdd(record);
  loadHistory();
  afterFeedingSaved('Sem internet. Trato guardado no aparelho — ele sobe sozinho quando a conexão voltar.');
}

function feedingQtyError(texto){
  const quantidade=String(texto ?? '').trim();
  if(!quantidade)return 'Informe a quantidade em kg.';
  if(Number(quantidade.replace(/\./g,'').replace(',','.'))<0)return 'A quantidade não pode ser negativa.';
  return '';
}

function feedingErrors(campos, now = new Date()){
  const faltas=[];
  if(!campos.lot)faltas.push('Escolha o lote.');
  else if(!campos.product)faltas.push('Este lote não tem suplemento cadastrado nesta data. Ajuste o lote em Lotes.');

  const quantidadeInvalida=feedingQtyError(campos.qty);
  if(quantidadeInvalida)faltas.push(quantidadeInvalida);

  if(!campos.reading)faltas.push('Escolha a leitura do cocho.');

  const dataInvalida=occurredError(campos.occurred, now);
  if(dataInvalida)faltas.push(dataInvalida);

  return faltas;
}

async function saveFeeding(){
  msg('feedMsg','');
  refreshAutomaticDateTime($('occurred'));
  const lotId=$('lot').value;
  const productId=lotId?lotSupplementId(lotId,feedingDateISO()):'';
  const faltas=feedingErrors({
    lot:lotId,
    product:productId,
    qty:$('qty').value,
    reading,
    occurred:$('occurred').value
  });
  if(faltas.length)return msg('feedMsg',faltas.join(' '),true);

  const record={
    id:newLocalId(),
    occurred_at:farmLocalToDate($('occurred').value).toISOString(),
    lot_id:lotId,product_id:productId,
    quantity_kg:decimalValue($('qty').value),trough_reading:reading,
    recorded_by:profile.id,notes:$('notes').value.trim()||null
  };

  if(isOffline())return queueFeeding(record);

  const {error}=await sb.from('suplementacao_feeding_records').insert(record);
  if(error){
    if(isNetworkError(error)){noteConnection(false);return queueFeeding(record)}
    return msg('feedMsg',friendlyError(error),true);
  }
  noteConnection(true);
  forgetAfterWrite("saldo", "inicio");
  await loadHistory();
  await loadProductStock({ force: true });
  afterFeedingSaved('Trato registrado. Escolha o próximo lote.');
}

const SALDO_MAX_AGE_MS = 60000;

async function loadProductStock(opcoes = {}) {
  const saldo = await SupCache.fetch("saldo", () => sb.from("suplementacao_product_stock").select("*"),
    undefined, { maxAgeMs: SALDO_MAX_AGE_MS, ...opcoes });
  if (!saldo.value) return;
  productStock = saldo.value;
  renderProductBalance();
}

function renderProductBalance() {
  const entry = productStock.find(item => item.product_id === $("product").value);
  $("productBalance").textContent = entry
    ? `Saldo em estoque: ${SupUnits.formatKg(entry.quantity_kg)}`
    : "";
}

function feedingDateISO() {
  return ($("occurred").value || farmNowLocal()).slice(0, 10);
}

function lotSupplementId(lotId, dateStr) {
  return lotMainGroup(currentLotInfo(lotId, dateStr))?.product_id || "";
}

function feedingLotOptions(productId, dateStr) {
  return lots
    .filter(lot => lot.active && (!productId || lotSupplementId(lot.id, dateStr) === productId))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base", numeric: true }));
}

function renderFeedingLots() {
  const productId = $("product").value;
  const chosen = $("lot").value;
  const options = feedingLotOptions(productId, feedingDateISO());
  $("lot").innerHTML = options.length
    ? '<option value="">Escolha o lote…</option>' + options.map(lot => `<option value="${lot.id}">${esc(lot.name)}</option>`).join("")
    : `<option value="">${productId ? "Nenhum lote ativo recebe este suplemento" : "Nenhum lote cadastrado"}</option>`;
  $("lot").value = options.some(lot => lot.id === chosen) ? chosen : "";
}

function renderLotProductHint() {
  const box = $("lotProductHint");
  if (!box) return;
  const lotId = $("lot").value;
  if (!lotId) return void (box.innerHTML = "");

  const info = currentLotInfo(lotId, feedingDateISO());
  const group = lotMainGroup(info);
  if (!group?.product_id) {
    box.innerHTML = '<div class="emptyBox small">Este lote não tem suplemento cadastrado nesta data. Ajuste o lote em Lotes.</div>';
    return;
  }

  const animais = Number(group.quantity || 0);
  const porCabeca = Number(group.expected_consumption_kg_head_day || 0);
  box.innerHTML = `<div class="lotHint">
    <div class="lotHintHead">${esc(lotProductName(group))}</div>
    <div class="small">${animais.toLocaleString("pt-BR")} animais · ${esc(SupUnits.formatKg(porCabeca))}/cab/dia · sugerido <b>${esc(SupUnits.formatKg(lotExpectedKgDay(info)))}</b></div>
  </div>`;
}

function fillSuggestedQty() {
  const lotId = $("lot").value;
  const sugerido = lotId ? lotExpectedKgDay(currentLotInfo(lotId, feedingDateISO())) : 0;
  $("qty").value = sugerido > 0 ? sugerido.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : "";
}

function syncLotProduct() {
  const productId = lotSupplementId($("lot").value, feedingDateISO());
  if (productId && [...$("product").options].some(option => option.value === productId)) {
    $("product").value = productId;
  }
  renderProductBalance();
  renderLotProductHint();
}

function applyLotProduct() {
  syncLotProduct();
  fillSuggestedQty();
}

function feedingProductChanged() {
  renderFeedingLots();
  applyLotProduct();
}

async function loadFeedingScreen(opcoes = {}) {
  refreshAutomaticDateTime($("occurred"));
  applyOccurredLimits();
  await Promise.all([loadMasters(opcoes), loadProductStock(opcoes), loadLotVersions(opcoes)]);
  renderFeedingLots();
  syncLotProduct();
}

const TROUGH_LABELS={empty:'Vazio',medium:'Médio',full:'Cheio'};
const FEEDING_FIELD_WINDOW_MIN=30;

let feedingRecords=[];

function feedingMinutesLeft(record){
  const limit=new Date(record.created_at).getTime()+FEEDING_FIELD_WINDOW_MIN*60000;
  return Math.ceil((limit-Date.now())/60000);
}

function canEditFeeding(record){
  if(!profile)return false;
  if(profile.role==='owner'||profile.role==='admin')return true;
  return record.recorded_by===profile.id&&feedingMinutesLeft(record)>0;
}

function queuedFeedingHtml(record){
  const lote=lots.find(item=>item.id===record.lot_id)?.name||'Lote';
  const produto=products.find(item=>item.id===record.product_id)?.name||'Produto';
  const marca=record.queue_error
    ? `<span class="pill danger">RECUSADO PELO SERVIDOR</span>`
    : '<span class="pill warn">AGUARDANDO INTERNET</span>';
  return `<div class="item"><b>${esc(lote)} · ${esc(produto)}</b> ${marca}
    <div>${Number(record.quantity_kg).toLocaleString('pt-BR')} kg · Cocho ${esc(TROUGH_LABELS[record.trough_reading]||'')}</div>
    <div class="small">${farmDateTimeBR(record.occurred_at)} · guardado neste aparelho</div>
    ${record.notes?`<div class="small">Obs.: ${esc(record.notes)}</div>`:''}
    ${record.queue_error?`<div class="small">Motivo: ${esc(record.queue_error)}</div>`:''}
    <div class="actions">
      <button class="btn alt smallbtn" data-do="syncOutbox">Tentar enviar</button>
      <button class="btn danger smallbtn" data-feed-drop="${esc(record.id)}">Descartar</button>
    </div></div>`;
}

function historyDay(){
  return $('historyDate')?.value||farmDateISO();
}

function feedingOfDay(registros,dia){
  return (registros||[]).filter(record=>farmDateISO(record.occurred_at)===dia);
}

function mergeHistoryCache(anteriores,novos,dia){
  const outros=(anteriores||[]).filter(record=>farmDateISO(record.occurred_at)!==dia);
  return [...outros,...(novos||[])].sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at));
}

function historyToday(){
  if($('historyDate'))$('historyDate').value=farmDateISO();
  return loadHistory();
}

async function showDeletions(){
  const dia=historyDay();
  const {start,end}=farmDayBounds(dia);
  const {data,error}=await sb.from('feeding_record_deletions')
    .select('*')
    .gte('occurred_at',start.toISOString())
    .lte('occurred_at',end.toISOString())
    .order('deleted_at',{ascending:false});
  if(error)return showAlert(friendlyError(error));

  const linhas=(data||[]).map(row=>`<div class="item">
    <b>${esc(row.lot_name||'Lote')} · ${esc(row.product_name||'Produto')}</b>
    <div>${Number(row.quantity_kg).toLocaleString('pt-BR')} kg · Cocho ${esc(TROUGH_LABELS[row.trough_reading]||row.trough_reading||'')}</div>
    <div class="small">Trato de ${farmDateTimeBR(row.occurred_at)} · lançado por ${esc(row.recorder_name||'Usuário')}</div>
    <div class="small">Excluído em ${farmDateTimeBR(row.deleted_at)} · por ${esc(row.deleter_name||'Usuário')}</div>
    ${row.notes?`<div class="small">Obs.: ${esc(row.notes)}</div>`:''}
  </div>`).join('');

  showSheet({
    title:'Exclusões de '+farmDateBR(dia),
    tabs:[{
      id:'lista',
      label:'Lançamentos excluídos',
      render:container=>{
        container.innerHTML=linhas||`<div class="emptyBox small">Nenhum lançamento excluído em ${esc(farmDateBR(dia))}.</div>`;
      }
    }]
  });
}

function renderHistory(aviso=''){
  const guardados=outboxPendingRecords().map(queuedFeedingHtml).join('');
  const enviados=feedingRecords.map(x=>{
    const editable=canEditFeeding(x);
    const left=profile&&profile.role==='field'&&editable?feedingMinutesLeft(x):0;
    const prazo=left>0?`<span class="pill warn">${left} min para corrigir</span>`:'';
    const acoes=editable
      ?`<div class="actions"><button class="btn alt smallbtn" data-feed-edit="${esc(x.id)}">Corrigir</button><button class="btn danger smallbtn" data-feed-del="${esc(x.id)}">Excluir</button></div>`
      :'';
    const editado=x.edited_at?`<div class="small">Corrigido em ${farmDateTimeBR(x.edited_at)}</div>`:'';
    return `<div class="item"><b>${esc(x.lots?.name||'Lote')} · ${esc(x.products?.name||x.product_name||'Produto')}</b> ${prazo}
      <div>${Number(x.quantity_kg).toLocaleString('pt-BR')} kg · Cocho ${esc(TROUGH_LABELS[x.trough_reading]||'')}</div>
      <div class="small">${farmDateTimeBR(x.occurred_at)} · ${esc(x.profiles?.full_name||'')}</div>
      ${x.notes?`<div class="small">Obs.: ${esc(x.notes)}</div>`:''}${editado}${acoes}</div>`;
  }).join('');

  const vazio=guardados||enviados?'':'<div class="small">Nenhum registro.</div>';
  $('history').innerHTML=(aviso?`<div class="msg">${esc(aviso)}</div>`:'')+guardados+enviados+vazio;

  $('history').querySelectorAll('[data-feed-edit]').forEach(button=>{
    button.onclick=()=>openFeedingEdit(button.dataset.feedEdit);
  });
  $('history').querySelectorAll('[data-feed-del]').forEach(button=>{
    button.onclick=()=>runAction(button,()=>deleteFeeding(button.dataset.feedDel),'Excluindo…');
  });
  $('history').querySelectorAll('[data-feed-drop]').forEach(button=>{
    button.onclick=()=>discardQueuedFeeding(button.dataset.feedDrop);
  });
}

async function loadHistory(){
  const dia=historyDay();
  if($('historyDate')&&!$('historyDate').value)$('historyDate').value=dia;
  const {start,end}=farmDayBounds(dia);

  const historico=await SupCache.fetch('historico',
    ()=>sb.from('suplementacao_feeding_records')
      .select('*,lots:suplementacao_lots(name),products:suplementacao_products(name),profiles:suplementacao_profiles!feeding_records_recorded_by_fkey(full_name)')
      .gte('occurred_at',start.toISOString())
      .lte('occurred_at',end.toISOString())
      .order('occurred_at',{ascending:false}),
    ([res])=>mergeHistoryCache(SupCache.read('historico',[]),res.data||[],dia));

  if(!historico.fromCache)noteConnection(true);
  feedingRecords=feedingOfDay(historico.value||[],dia);
  renderHistory(cacheStatus([historico],'o histórico')[0]);
}

function feedingById(id){
  return feedingRecords.find(record=>record.id===id);
}

async function openFeedingEdit(id){
  const record=feedingById(id);
  if(!record)return;
  await loadLotVersions();
  showSheet({
    title:'Corrigir trato',
    subtitle:`Lançado em ${farmDateTimeBR(record.occurred_at)} por ${esc(record.profiles?.full_name||'')}`,
    tabs:[{id:'corrigir',label:'Corrigir',render:(container,sheet)=>renderFeedingEdit(container,sheet,id)}]
  });
}

function renderFeedingEdit(container,sheet,id){
  const record=feedingById(id);
  if(!record)return;
  const activeLots=lots.filter(lot=>lot.active||lot.id===record.lot_id);
  const dia=farmDateISO(record.occurred_at);
  const produtoDoLote=lotId=>lotSupplementId(lotId,dia)||(lotId===record.lot_id?record.product_id:'');
  const nomeDoProduto=productId=>products.find(item=>item.id===productId)?.name||'Sem suplemento cadastrado';
  container.innerHTML=`
    <div class="grid">
      <div class="full"><label>Lote</label><select id="sheetFeedLot">${activeLots.map(lot=>`<option value="${esc(lot.id)}" ${lot.id===record.lot_id?'selected':''}>${esc(lot.name)}</option>`).join('')}</select></div>
      <div class="full"><label>Suplemento</label><div id="sheetFeedProduct" class="small"></div></div>
      <div><label>Quantidade (kg)</label><input id="sheetFeedQty" class="decimal" type="text" inputmode="decimal" value="${esc(String(record.quantity_kg).replace('.',','))}"></div>
      <div class="full"><label>Leitura do cocho</label>
        <div class="reading" id="sheetFeedReading">
          ${Object.entries(TROUGH_LABELS).map(([value,label])=>`<button class="${record.trough_reading===value?'on':''}" data-reading="${value}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="full"><label>Observação</label><textarea id="sheetFeedNotes">${esc(record.notes||'')}</textarea></div>
      <div class="full"><button class="btn" id="sheetFeedBtn">Salvar correção</button>
        <div class="small">O estoque acompanha a correção: a baixa deste trato é recalculada.</div>
        <div id="sheetFeedMsg"></div>
      </div>
    </div>`;

  const mostrarProduto=()=>{$('sheetFeedProduct').textContent=nomeDoProduto(produtoDoLote($('sheetFeedLot').value))};
  $('sheetFeedLot').onchange=mostrarProduto;
  mostrarProduto();

  let reading=record.trough_reading;
  $('sheetFeedReading').querySelectorAll('button').forEach(button=>{
    button.onclick=()=>{
      reading=button.dataset.reading;
      $('sheetFeedReading').querySelectorAll('button').forEach(other=>other.classList.toggle('on',other===button));
    };
  });

  $('sheetFeedBtn').onclick=event=>runAction(event.currentTarget,async()=>{
    msg('sheetFeedMsg','');
    const quantidadeInvalida=feedingQtyError($('sheetFeedQty').value);
    if(quantidadeInvalida)return msg('sheetFeedMsg',quantidadeInvalida,true);
    const quantity=decimalValue($('sheetFeedQty').value);
    if(!reading)return msg('sheetFeedMsg','Marque a leitura do cocho.',true);
    const productId=produtoDoLote($('sheetFeedLot').value);
    if(!productId)return msg('sheetFeedMsg','Este lote não tem suplemento cadastrado nesta data.',true);
    try{
      await SupApi.rpc('correct_feeding_record',{
        p_record_id:id,
        p_lot_id:$('sheetFeedLot').value,
        p_product_id:productId,
        p_quantity_kg:quantity,
        p_trough_reading:reading,
        p_notes:$('sheetFeedNotes').value.trim()||null
      });
    }catch(error){
      return msg('sheetFeedMsg',friendlyError(error),true);
    }
    sheet.close();
    forgetAfterWrite('saldo', 'inicio');
    await loadHistory();
    await loadProductStock({ force: true });
    toast('Trato corrigido e estoque atualizado.');
  });
}

async function deleteFeeding(id){
  const record=feedingById(id);
  if(!record)return;
  const aviso=`Excluir este trato?\n\n${record.lots?.name||'Lote'} · ${record.products?.name||'Produto'}\n${Number(record.quantity_kg).toLocaleString('pt-BR')} kg em ${farmDateTimeBR(record.occurred_at)}\n\nA baixa de estoque volta atrás. O lançamento fica guardado no arquivo de exclusões.`;
  if(!(await showConfirm(aviso,{danger:true})))return;
  try{
    await SupApi.rpc('delete_feeding_record_v2',{p_record_id:id});
  }catch(error){
    return showAlert(friendlyError(error));
  }
  forgetAfterWrite('saldo', 'inicio');
  await loadHistory();
  await loadProductStock({ force: true });
  toast('Trato excluído e estoque devolvido.');
}
