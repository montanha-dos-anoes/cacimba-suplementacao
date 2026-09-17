function loginEmail(v){v=v.trim().toLowerCase();return v.includes('@')?v:v.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9._-]/g,'')+'@cacimba.local'}

function pinPassword(pin){return `Cc${pin}`}

function badCredentials(error){
  return error.code==='invalid_credentials'||/invalid login credentials/i.test(error.message||'');
}

async function signIn(){
  msg('loginMsg','');
  if(isOffline())return msg('loginMsg','Sem conexão. Só dá para entrar com internet; depois o aplicativo abre sozinho no campo.',true);

  const typedId=$('loginId').value;
  const typedPass=$('loginPass').value;
  const email=loginEmail(typedId);
  const attempts=typedId.includes('@')?[typedPass,pinPassword(typedPass)]:[pinPassword(typedPass),typedPass];

  let failure=null;
  for(const password of attempts){
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(!error){failure=null;break}
    failure=error;
    if(!badCredentials(error))break;
  }
  if(failure)return msg('loginMsg',badCredentials(failure)?'Usuário ou PIN incorretos.':friendlyError(failure),true);

  try{await SupApi.rpc("claim_first_owner")}catch(e){}
  await boot();
}

async function firstOwner(){
  const id=$('loginId').value.trim(),pass=$('loginPass').value;
  if(id.toLowerCase()!=='willianterceros@gmail.com')return msg('loginMsg','Use o e-mail do Proprietário cadastrado para criar o primeiro acesso.',true);
  if(pass.length<6)return msg('loginMsg','Informe uma senha de pelo menos 6 caracteres.',true);
  const {data,error}=await sb.auth.signUp({email:id,password:pass,options:{data:{full_name:'Willian'}}});
  if(error)return msg('loginMsg',error.message,true);
  if(data.session){await SupApi.rpc("claim_first_owner");await boot()}
  else msg('loginMsg','Conta criada. Confirme o e-mail recebido e depois entre.');
}

function newPinError(pin,confirmation){
  if(pin.length<6)return 'O PIN precisa ter pelo menos 6 dígitos.';
  if(pin!==confirmation)return 'Os dois PINs não são iguais.';
  return '';
}

function needsPasswordChange(perfil){return !!perfil.must_change_password&&perfil.role!=='owner'}

async function submitNewPassword(){
  msg('passwordMsg','');
  const pin=$('newPin').value.trim();
  const erro=newPinError(pin,$('newPin2').value.trim());
  if(erro)return msg('passwordMsg',erro,true);
  try{await SupApi.invokeAdmin({action:'change_password',password:pin})}
  catch(e){return msg('passwordMsg',friendlyError(e),true)}
  $('newPin').value=$('newPin2').value='';
  cacheProfile({...profile,must_change_password:false});
  await boot();
}

function openPinSheet({title,subtitle,aviso,botao,salvar}){
  showSheet({
    title,
    subtitle,
    tabs:[{
      id:'pin',
      label:'PIN',
      render:(container,sheet)=>{
        container.innerHTML=`<div class="grid">
          <div class="full"><div class="small">${esc(aviso)}</div></div>
          <div class="full"><label>Novo PIN</label><input id="sheetPin" type="password" autocomplete="new-password" inputmode="numeric"></div>
          <div class="full"><label>Repita o novo PIN</label><input id="sheetPin2" type="password" autocomplete="new-password" inputmode="numeric"></div>
          <div class="full"><button class="btn" id="sheetPinBtn">${esc(botao)}</button><div id="sheetPinMsg"></div></div>
        </div>`;

        $('sheetPinBtn').onclick=event=>runAction(event.currentTarget,async()=>{
          msg('sheetPinMsg','');
          const pin=$('sheetPin').value.trim();
          const erro=newPinError(pin,$('sheetPin2').value.trim());
          if(erro)return msg('sheetPinMsg',erro,true);
          try{await salvar(pin)}catch(e){return msg('sheetPinMsg',friendlyError(e),true)}
          sheet.close();
        },'Salvando…');
        $('sheetPin').focus();
      }
    }]
  });
}

function openOwnPinChange(){
  openPinSheet({
    title:'Trocar meu PIN',
    subtitle:`${esc(profile.full_name)} · ${esc(roleName(profile.role))}`,
    aviso:'Escolha um PIN novo. Use ele da próxima vez que entrar.',
    botao:'Salvar novo PIN',
    salvar:async pin=>{
      await SupApi.invokeAdmin({action:'change_password',password:pin});
      profile.must_change_password=false;
      cacheProfile(profile);
      toast('PIN alterado.');
    }
  });
}

const PROFILE_CACHE_KEY='suplementacao:profile';

function cacheProfile(perfil){
  try{localStorage.setItem(PROFILE_CACHE_KEY,JSON.stringify(perfil))}catch{}
}

function cachedProfile(userId){
  try{
    const saved=JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY)||'null');
    return saved&&saved.id===userId?saved:null;
  }catch{return null}
}

function storedSessionUserId(){
  try{
    const ref=SUP_CONFIG.supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1];
    const raw=ref?localStorage.getItem(`sb-${ref}-auth-token`):null;
    return raw?(JSON.parse(raw)?.user?.id||null):null;
  }catch{return null}
}

function forgetAccess(){
  profile=null;
  screensStarted=false;
  try{localStorage.removeItem(PROFILE_CACHE_KEY)}catch{}
  SupCache.clear();
}

function showLogin(){
  $('loginView').classList.remove('hidden');
  $('passwordView').classList.add('hidden');
  $('appView').classList.add('hidden');
}

function showPasswordChange(perfil){
  profile=perfil;
  $('loginView').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('passwordView').classList.remove('hidden');
}

function showApp(perfil){
  profile=perfil;
  $('loginView').classList.add('hidden');
  $('passwordView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('who').textContent=perfil.full_name;
  $('whoRole').textContent=roleName(perfil.role);
  $('whoInitials').textContent=initials(perfil.full_name);
  renderNav(perfil.role);
  $('refreshBtn').innerHTML=icon('refresh');
  if(perfil.role!=='owner')$('userRole').querySelector('option[value="admin"]').disabled=true;
}

function applyProfile(perfil){
  if(!perfil.active)return 'blocked';
  if(needsPasswordChange(perfil)){showPasswordChange(perfil);return 'password'}
  showApp(perfil);
  return 'app';
}

let screensStarted=false;
let accessRefresh=null;
let booting=null;

async function startScreens(){
  if(screensStarted)return;
  screensStarted=true;
  if(typeof probeConnection==='function')await probeConnection();
  showTab('inicio');
  await Promise.all([loadMasters(),loadHistory(),loadProductStock()]);
}

const SEM_ACESSO_GUARDADO='Sem conexão e este aparelho ainda não guardou seu acesso. Entre uma vez com internet para liberar o uso offline.';

async function boot(){
  if(booting)return booting;
  booting=bootOnce().finally(()=>{booting=null});
  return booting;
}

async function bootOnce(){
  const guardado=storedSessionUserId();
  const local=guardado?cachedProfile(guardado):null;
  const estado=local?applyProfile(local):null;
  if(estado==='app')startScreens().catch(()=>{});

  if(isOffline()){
    if(!estado)msg('loginMsg',SEM_ACESSO_GUARDADO,true);
    return;
  }

  accessRefresh=refreshAccess(guardado,estado).catch(erro=>{noteConnection(false);console.warn('Conferência de acesso adiada',erro)});
  if(!estado)await accessRefresh;
}

async function refreshAccess(guardado,estado){
  const {data,error}=await sb.auth.getSession();
  const sessao=data?.session||null;

  if(!sessao&&error&&isNetworkError(error)){
    noteConnection(false);
    if(!estado&&!guardado)msg('loginMsg',SEM_ACESSO_GUARDADO,true);
    return;
  }

  const userId=sessao?.user?.id||null;
  if(!userId){
    if(estado)forgetAccess();
    return showLogin();
  }

  const {data:p,error:perfilErro}=await sb.from('suplementacao_profiles').select('*').eq('id',userId).single();
  if(!p){
    if(perfilErro&&isNetworkError(perfilErro))return noteConnection(false);
    if(!estado)msg('loginMsg',friendlyError(perfilErro||'Não foi possível confirmar seu acesso agora.'),true);
    return;
  }

  cacheProfile(p);
  if(!p.active){
    await sb.auth.signOut();
    forgetAccess();
    showLogin();
    return msg('loginMsg','Seu acesso está desativado.',true);
  }

  if(applyProfile(p)==='app')await startScreens();
}

async function logout(){
  const guardados=outboxCount();
  const aviso=guardados
    ? `Sair do sistema? Há ${guardados} trato(s) guardados no aparelho que ainda não subiram. Eles continuam guardados, mas só sobem quando você entrar de novo.`
    : 'Sair do sistema?';
  if(!(await showConfirm(aviso,{danger:guardados>0})))return;
  forgetAccess();
  await sb.auth.signOut();
  location.reload();
}
