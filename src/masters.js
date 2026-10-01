function supplementProducts(list, manufacturedIds) {
  const fabricados = new Set(manufacturedIds || []);
  return (list || [])
    .filter(item => fabricados.has(item.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

function productSelectHtml(list, manufacturedIds) {
  const suplementos = supplementProducts(list, manufacturedIds);
  if (!suplementos.length) return '<option value="">Nenhum suplemento cadastrado</option>';
  return '<option value="">Todos os suplementos</option>'
    + suplementos.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
}

const MASTERS_MAX_AGE_MS = 120000;

async function loadMasters(opcoes={}){
  const frescor={maxAgeMs:MASTERS_MAX_AGE_MS,...opcoes};
  const [lotesRes,produtosRes,formulasRes]=await Promise.all([
    SupCache.fetch('cadastro-lotes',()=>sb.from('suplementacao_lots').select('*').order('name'),undefined,frescor),
    SupCache.fetch('cadastro-produtos',()=>sb.from('suplementacao_products').select('*').order('name'),undefined,frescor),
    SupCache.fetch('formulas-ativas',()=>sb.from('suplementacao_formulas').select('product_id').eq('active',true),list=>(list[0].data||[]).map(row=>row.product_id),frescor)
  ]);

  if(lotesRes.value)lots=lotesRes.value;
  if(produtosRes.value)products=produtosRes.value;
  if(formulasRes.value)supplementIds=formulasRes.value;
  const manufacturedIds=supplementIds;

  const activeLots=lots.filter(x=>x.active), activeProducts=products.filter(x=>x.active);
  if(lotesRes.value){
    const chosenLot=$('lot').value;
    $('lot').innerHTML=activeLots.length?'<option value="">Escolha o lote…</option>'+activeLots.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join(''):'<option value="">Nenhum lote cadastrado</option>';
    if(chosenLot)$('lot').value=chosenLot;
    $('reportLot').innerHTML='<option value="">Todos</option>'+activeLots.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  }
  if(produtosRes.value){
    const chosenProduct=$('product').value;
    $('product').innerHTML=productSelectHtml(activeProducts, manufacturedIds);
    if(chosenProduct)$('product').value=chosenProduct;
  }

  msg('feedMsg',...cacheStatus([lotesRes,produtosRes],'os cadastros de lote e produto'));
}

async function createUser(){
  const full_name=$('userName').value.trim();
  const login_name=$('userLogin').value.trim();
  const password=$('userPin').value.trim();
  const role=$('userRole').value;
  if(!full_name)return showAlert('Informe o nome do usuário.');
  if(!login_name)return showAlert('Informe o usuário de acesso.');
  if(password.length<6)return showAlert('O PIN precisa ter pelo menos 6 dígitos.');
  if(role==='admin'&&profile.role!=='owner')return showAlert('Somente o Proprietário pode criar administradores.');
  try{
    await SupApi.invokeAdmin({action:'create',full_name,login_name,password,role});
  }catch(e){return showAlert(friendlyError(e))}
  $('userName').value=$('userLogin').value=$('userPin').value='';
  await loadUsers();
  await showAlert('Usuário criado.');
}

function renderAppVersion(){
  if(!$('appVersionLine'))return;
  $('appVersionLine').textContent=`Versão instalada ${SUP_CONFIG.appVersion} · ambiente ${SUP_CONFIG.env}`;
}

let userRows=[];

function userById(id){
  return userRows.find(row=>row.id===id);
}

function openUserPinReset(id){
  const alvo=userById(id);
  if(!alvo)return;
  openPinSheet({
    title:'Trocar PIN de usuário',
    subtitle:`${esc(alvo.full_name)} · ${esc(roleName(alvo.role))}`,
    aviso:'Informe um PIN provisório e passe para a pessoa. Na próxima entrada ela vai ser obrigada a escolher um PIN só dela.',
    botao:'Salvar PIN provisório',
    salvar:async pin=>{
      await SupApi.invokeAdmin({action:'reset_password',user_id:id,password:pin});
      await loadUsers();
      toast('PIN provisório definido. Passe para a pessoa.');
    }
  });
}

async function loadUsers(){
  const {data,error}=await sb.from('suplementacao_profiles').select('*').order('created_at');if(error){$('usersList').textContent=error.message;return}
  userRows=data||[];
  $('usersList').innerHTML=(data||[]).map(u=>`<div class="item"><b>${esc(u.full_name)}</b> ${u.protected_owner?'<span class="pill ownerTag">PROPRIETÁRIO PROTEGIDO</span>':''}<div class="small">${u.login_name?`Usuário: ${esc(u.login_name)} · `:''}${roleName(u.role)} · ${u.active?'Ativo':'Inativo'}</div>${u.protected_owner?'<div class="small">Este usuário não pode ser desativado, excluído ou rebaixado.</div>':`<div class="actions"><button class="btn ${u.active?'danger':'alt'} smallbtn" data-do="toggleUser" data-arg="${u.id}">${u.active?'Desativar':'Reativar'}</button>${profile.role==='owner'?`<button class="btn alt smallbtn" data-do="changeRole" data-arg="${u.id}" data-arg2="${u.role==='admin'?'field':'admin'}">${u.role==='admin'?'Tornar Campo':'Tornar Admin'}</button>`:''}${profile.role==='owner'?`<button class="btn alt smallbtn" data-do="resetUserPin" data-arg="${u.id}">Trocar PIN</button>`:''}</div>`}</div>`).join('');
}

async function toggleUser(id){try{await SupApi.invokeAdmin({action:'toggle',user_id:id});await loadUsers()}catch(e){await showAlert(friendlyError(e))}}
async function changeRole(id,role){try{await SupApi.invokeAdmin({action:'role',user_id:id,role});await loadUsers()}catch(e){await showAlert(friendlyError(e))}}

const BACKUP_TABLES = [
  "suplementacao_products",
  "suplementacao_stock_movements",
  "suplementacao_formulas",
  "suplementacao_formula_items",
  "suplementacao_productions",
  "suplementacao_production_items",
  "suplementacao_lots",
  "suplementacao_feeding_records"
];

function markDataFresh() {
  if (!$("syncStatus")) return;
  $("syncStatus").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}.`;
}

async function refreshAllData() {
  await Promise.all([loadMasters({ force: true }), loadStock(), loadProductStock({ force: true }), loadHistory()]);
  markDataFresh();
  toast("Dados atualizados.");
}

async function downloadBackup() {
  const backup = { gerado_em: new Date().toISOString(), ambiente: SUP_CONFIG.env, versao: SUP_CONFIG.appVersion, tabelas: {} };
  let total = 0;
  for (const table of BACKUP_TABLES) {
    const { data, error } = await sb.from(table).select("*");
    if (error) return showAlert(`Não foi possível ler ${table}: ${friendlyError(error)}`);
    backup.tabelas[table] = data || [];
    total += (data || []).length;
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `backup_suplementacao_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast(`Backup gerado com ${total.toLocaleString("pt-BR")} registros.`);
}

async function checkAppUpdate() {
  if (!("serviceWorker" in navigator)) return showAlert("Este navegador não guarda o aplicativo para uso offline.");
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return showAlert("O aplicativo ainda não foi instalado neste aparelho.");
  await registration.update();
  if (!(await showConfirm("Se houver versão nova, o aplicativo será recarregado. Continuar?"))) return;
  location.reload();
}
