defineActions('click',{
  signIn:el=>runAction(el,signIn,'Entrando…'),
  firstOwner:el=>runAction(el,firstOwner,'Criando…'),
  submitNewPassword:el=>runAction(el,submitNewPassword,'Salvando…'),
  logout:()=>logout(),
  refreshScreen:el=>runAction(el,refreshCurrentScreen,''),
  refreshAll:el=>runAction(el,refreshAllData,'Atualizando…'),
  userMenu:()=>openNavMore(),
  navMore:()=>openNavMore(),
  tab:(el,arg)=>showTab(arg),
  subTab:(el,arg)=>showSubTab(arg,el),
  setReading:(el,arg)=>setReading(arg,el),
  saveFeeding:el=>runAction(el,saveFeeding,'Salvando…',{offline:true}),
  useSuggestedQty:()=>applySuggestedQty(),
  syncOutbox:el=>runAction(el,()=>syncOutbox(true),'Enviando…',{offline:true}),
  historyToday:el=>runAction(el,historyToday,'',{offline:true}),
  showDeletions:el=>runAction(el,showDeletions,'Buscando…'),
  stockCreate:()=>openStockCreate(),
  stockManage:(el,arg)=>openStockManager(arg),
  saveProduction:el=>runAction(el,saveProduction),
  reverseProduction:(el,arg)=>runAction(el,()=>reverseProduction(arg),'Estornando…'),
  dateField:(el,arg)=>openDateField(arg),
  formulaCreate:()=>openFormulaCreate(),
  formulaMode:(el,arg)=>setFormulaMode(arg),
  addFormulaRow:()=>addFormulaRow(),
  removeFormulaRow:el=>removeFormulaRow(el),
  fillFormulaRemainder:()=>fillFormulaRemainder(),
  saveFormula:el=>runAction(el,saveFormula),
  openFormula:(el,arg)=>openFormula(arg),
  duplicateFormula:(el,arg)=>duplicateFormula(arg),
  fabricarFormula:(el,arg)=>fabricarFormula(arg),
  deactivateFormula:(el,arg)=>runAction(el,()=>deactivateFormula(arg),'Inativando…'),
  reportPage:(el,arg)=>goToReportPage(Number(arg)),
  runReport:el=>runAction(el,runReport,'Pesquisando…'),
  exportPdf:el=>runAction(el,exportReportPdf,'Gerando PDF…'),
  exportXlsx:el=>runAction(el,exportReport,'Gerando Excel…'),
  lotCreate:()=>openLotCreate(),
  lotTab:(el,arg)=>showLotTab(arg),
  lotEdit:(el,arg)=>openLotEdit(arg),
  lotSupplement:(el,arg)=>openLotSupplement(arg),
  lotHistory:(el,arg)=>openLotHistory(arg),
  lotToggle:(el,arg)=>runAction(el,()=>toggleLot(arg)),
  addLotGroup:()=>addLotGroup(),
  removeLotGroup:el=>removeLotGroup(el),
  saveLot:el=>runAction(el,saveLot),
  backup:el=>runAction(el,downloadBackup,'Gerando…'),
  checkUpdate:()=>checkAppUpdate(),
  createUser:el=>runAction(el,createUser),
  toggleUser:(el,arg)=>runAction(el,()=>toggleUser(arg)),
  resetUserPin:(el,arg)=>openUserPinReset(arg),
  changeRole:(el,arg,arg2)=>runAction(el,()=>changeRole(arg,arg2))
});

defineActions('change',{
  loadHistory:()=>loadHistory(),
  feedingProduct:()=>{renderProductBalance();renderLotProductHint()},
  lotProduct:()=>applyLotProduct(),
  feedingOccurred:()=>feedingOccurredChanged(),
  productionOccurred:()=>productionOccurredChanged(),
  previewProduction:()=>previewProduction(),
  updateFormulaTotal:()=>updateFormulaTotal(),
  refreshEntryPlan:()=>refreshEntryPlan(),
  reportType:()=>onReportTypeChange(),
  reportLotStatus:()=>onReportLotStatusChange(),
  reportFilter:()=>markReportStale()
});

defineActions('input',{
  renderStock:()=>renderStock(),
  renderFormulas:()=>renderFormulas(),
  previewProduction:()=>previewProduction(),
  updateFormulaTotal:()=>updateFormulaTotal(),
  refreshEntryPlan:()=>refreshEntryPlan()
});

bindActions();

enhanceDateFields(document);
setAutomaticDateTime($('occurred')); setAutomaticDateTime($('productionDate'));
document.querySelectorAll('.searchIcon').forEach(node=>{node.innerHTML=icon('search')});
document.addEventListener('input',e=>{if(e.target.classList&&e.target.classList.contains('decimal'))e.target.value=sanitizeDecimal(e.target.value)},true);

function refreshConnectionBar(){$('offlineBar').classList.toggle('hidden',!isOffline())}
window.addEventListener('online',()=>{forgetConnectionProbe();noteConnection(true);applyAutoRefresh();refreshConnectionBar();showTab(currentTabId());toast('Conexão restabelecida.');syncOutbox()});
window.addEventListener('offline',()=>{noteConnection(false);applyAutoRefresh();refreshConnectionBar()});
refreshConnectionBar();
applyAutoRefresh();
renderOutboxBar();

if('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(error=>console.warn('Service worker não registrado',error)));
}

sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN')setTimeout(boot,0)});
boot().then(()=>{if(profile)syncOutbox()});
