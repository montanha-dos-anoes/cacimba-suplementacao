const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const roleName=r=>r==='owner'?'Proprietário':r==='admin'?'Administrador':'Campo';
const fmtMoney=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

const STOCK_KINDS = {
  entry: 'Entrada',
  consumption: 'Consumo',
  yield: 'Produção',
  feeding: 'Trato',
  sale: 'Venda',
  reversal: 'Estorno',
  adjustment: 'Ajuste'
};

const UI_ACTIONS={click:{},change:{},input:{}};
const UI_ATTR={click:'do',change:'change',input:'input'};

function defineActions(kind,map){Object.assign(UI_ACTIONS[kind],map)}

function dispatchAction(kind,event){
  const attr=UI_ATTR[kind];
  const el=event.target.closest?.(`[data-${attr}]`);
  if(!el)return;
  const handler=UI_ACTIONS[kind][el.dataset[attr]];
  if(!handler)return;
  handler(el,el.dataset.arg,el.dataset.arg2);
}

function bindActions(){
  for(const kind of Object.keys(UI_ACTIONS)){
    document.addEventListener(kind,event=>dispatchAction(kind,event));
  }
}

function msg(id,t,err=false){const box=$(id);if(box)box.innerHTML=t?`<div class="msg ${err?'err':''}">${esc(t)}</div>`:''}

const STOCK_SUBTABS={
  'sub-estoque':()=>loadStock(),
  'sub-fabricar':()=>loadProductions(),
  'sub-formulas':()=>loadFormulas()
};

function currentSubTab(){
  return Object.keys(STOCK_SUBTABS).find(id=>!$(id).classList.contains('hidden'))||'sub-estoque';
}

function applyNetworkGate(id){
  const section=$(id);
  if(!section)return false;
  const bloqueada=isOffline()&&SupCache.needsNetwork(id);
  let aviso=section.querySelector('.needsNetwork');
  if(bloqueada&&!aviso){
    aviso=document.createElement('div');
    aviso.className='card needsNetwork';
    aviso.innerHTML='<h2>Esta tela precisa de internet</h2>'
      +'<div class="small">As informações desta tela ficam no servidor e não são guardadas no aparelho. '
      +'Conecte-se à internet para abrir. O registro de trato continua funcionando sem conexão.</div>';
    section.prepend(aviso);
  }
  if(aviso)aviso.classList.toggle('hidden',!bloqueada);
  return bloqueada;
}

function showTab(id){
  document.querySelectorAll('main > section').forEach(x=>x.classList.add('hidden'));
  $(id).classList.remove('hidden');
  document.querySelectorAll('.navItem').forEach(x=>x.classList.toggle('on',x.dataset.tab===id));
  window.scrollTo({top:0,behavior:'smooth'});
  if(applyNetworkGate(id))return;
  if(id==='inicio')loadHome();
  if(id==='trato')return loadFeedingScreen();
  if(id==='historico')loadHistory();
  if(id==='lotes')return loadLots();
  if(id==='sistema'){loadUsers();renderAppVersion()}
  if(id==='estoque')return STOCK_SUBTABS[currentSubTab()]();
  if(id==='relatorios')onReportTypeChange();
}
function showSubTab(id,b){
  const button=b||document.querySelector(`.subtabs .tab[data-sub="${id}"]`);
  Object.keys(STOCK_SUBTABS).forEach(x=>$(x).classList.add('hidden'));
  $(id).classList.remove('hidden');
  button.parentElement.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  button.classList.add('on');
  return STOCK_SUBTABS[id]();
}
function setReading(v,b){reading=v;document.querySelectorAll('.reading button').forEach(x=>x.classList.remove('on'));b.classList.add('on')}

const ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"></path></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17h18M5 17l1.5-6h11L19 17M8 11V7a4 4 0 0 1 8 0v4"></path></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"></path><path d="M3 8.5 12 13l9-4.5M12 13v7"></path></svg>',
  flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-9V3"></path><path d="M7.5 14h9"></path></svg>',
  lots: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="2"></rect><rect x="3" y="14" width="18" height="6" rx="2"></rect></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"></path><path d="M3.5 4.5V9H8"></path><path d="M12 8v4.5l3 1.8"></path></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V5a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2z"></path><path d="M14 3v5h5M9 13h6M9 17h6"></path></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20a5.5 5.5 0 0 1 11 0"></path><path d="M16 5.2a3.2 3.2 0 0 1 0 6M17.5 20a5.4 5.4 0 0 0-2-4.2"></path></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 5v6h-6"></path></svg>',
  exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path><path d="M10 8 6 12l4 4M6 12h9"></path></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"></path></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"></path></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M10 11.5v6M14 11.5v6"></path><path d="M6 7l.9 12.1A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.9L18 7"></path><path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"></path></svg>'
};

const icon = name => ICONS[name] || "";

function sanitizeDecimal(text) {
  const cleaned = String(text ?? "").replace(/[^\d.,]/g, "");
  const hasComma = cleaned.includes(",");
  const unified = hasComma ? cleaned.replace(/\./g, "") : cleaned.replace(".", ",").replace(/\./g, "");
  const [head, ...tail] = unified.split(",");
  return tail.length ? `${head},${tail.join("")}` : head;
}

const decimalValue = text => Number(String(text ?? "").replace(/\./g, "").replace(",", ".")) || 0;

async function runAction(button, work, waitingLabel = "Salvando…", { offline = false } = {}) {
  if (!offline && isOffline()) {
    toast("Sem conexão. Conecte-se para gravar.", "err");
    return undefined;
  }
  if (!button || !button.dataset) return work();
  if (button.dataset.busy === "1") return undefined;
  const label = button.innerHTML;
  const form = button.closest ? button.closest(".sheetBody, .card") : null;
  button.dataset.busy = "1";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="spin"></span>${esc(waitingLabel)}`;
  if (form) form.classList.add("busy");
  try {
    return await work();
  } finally {
    delete button.dataset.busy;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = label;
    if (form) form.classList.remove("busy");
  }
}

let connectionDown = false;

function isNetworkError(error) {
  return /Failed to fetch|NetworkError|network error|Load failed|ERR_INTERNET|ERR_NETWORK|ERR_NAME_NOT_RESOLVED/i
    .test(String(error?.message || error || ""));
}

function isOffline() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return connectionDown;
}

function applyAutoRefresh() {
  if (typeof sb === "undefined" || typeof sb.auth?.startAutoRefresh !== "function") return;
  Promise.resolve(isOffline() ? sb.auth.stopAutoRefresh() : sb.auth.startAutoRefresh()).catch(() => {});
}

function noteConnection(reachable) {
  const antes = isOffline();
  connectionDown = !reachable;
  if (antes === isOffline()) return;
  if (typeof refreshConnectionBar === "function") refreshConnectionBar();
  applyAutoRefresh();
}

function toast(text, tone = "ok") {
  if (!$("toastRoot")) return;
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = text;
  $("toastRoot").appendChild(node);
  setTimeout(() => node.remove(), tone === "err" ? 6000 : 3500);
}

function friendlyError(error) {
  const text = String(error?.message || error || "Não foi possível concluir.");
  if (isNetworkError(text)) noteConnection(false);
  if (/suplementacao_products_name_unique|duplicate key/i.test(text)) return "Já existe um produto ativo com esse nome.";
  if (/violates row-level security|permission denied/i.test(text)) return "Seu acesso não permite essa ação.";
  if (/Failed to fetch|NetworkError/i.test(text)) return "Sem conexão com o servidor. Tente de novo.";
  return text;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
