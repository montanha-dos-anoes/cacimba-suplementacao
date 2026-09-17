const NAV_ITEMS = [
  { id: "inicio", label: "Início", icon: "home", field: true, phone: true },
  { id: "trato", label: "Trato", icon: "feed", field: true, phone: true },
  { id: "estoque", label: "Estoque", icon: "box", phone: true },
  { id: "lotes", label: "Lotes", icon: "lots", phone: true },
  { id: "historico", label: "Histórico", icon: "history", field: true, phone: "field" },
  { id: "relatorios", label: "Relatórios", icon: "report" },
  { id: "sistema", label: "Sistema", icon: "users" }
];

function navItemsFor(role) {
  return NAV_ITEMS.filter(item => role !== "field" || item.field);
}

function phoneItemsFor(role) {
  return navItemsFor(role).filter(item => item.phone === true || item.phone === role);
}

function navButtonHtml(item, extraClass = "") {
  return `<button class="navItem ${extraClass}" data-tab="${item.id}" data-do="tab" data-arg="${item.id}">
    <span class="navIcon">${icon(item.icon)}</span><span class="navLabel">${esc(item.label)}</span>
  </button>`;
}

function renderNav(role) {
  $("sideNav").innerHTML = navItemsFor(role).map(item => navButtonHtml(item)).join("")
    + `<button class="navItem navExit" data-do="logout"><span class="navIcon">${icon("exit")}</span><span class="navLabel">Sair</span></button>`;

  $("bottomNav").innerHTML = phoneItemsFor(role).map(item => navButtonHtml(item)).join("")
    + `<button class="navItem" data-do="navMore"><span class="navIcon">${icon("more")}</span><span class="navLabel">Mais</span></button>`;
}

function openNavMore() {
  const shown = new Set(phoneItemsFor(profile.role).map(item => item.id));
  const rest = navItemsFor(profile.role).filter(item => !shown.has(item.id));
  const trocaPin = profile.role !== "owner";

  showSheet({
    title: "Mais",
    subtitle: `${esc(profile.full_name)} · ${esc(roleName(profile.role))}`,
    tabs: [{
      id: "menu",
      label: "Menu",
      render: (container, sheet) => {
        container.innerHTML = `<div class="navSheet">
          ${rest.map(item => `<button class="navSheetItem" data-go="${item.id}"><span class="navIcon">${icon(item.icon)}</span>${esc(item.label)}</button>`).join("")}
          ${trocaPin ? `<button class="navSheetItem" data-go="trocarPin"><span class="navIcon">${icon("gear")}</span>Trocar meu PIN</button>` : ""}
          <button class="navSheetItem danger" data-go="sair"><span class="navIcon">${icon("exit")}</span>Sair</button>
        </div>`;
        container.querySelectorAll("[data-go]").forEach(button => {
          button.onclick = () => {
            const target = button.dataset.go;
            sheet.close();
            if (target === "sair") return logout();
            if (target === "trocarPin") return openOwnPinChange();
            showTab(target);
          };
        });
      }
    }]
  });
}

function currentTabId() {
  const active = document.querySelector(".navItem.on");
  return active ? active.dataset.tab : "inicio";
}

async function refreshCurrentScreen() {
  const tab = currentTabId();
  if (tab === "inicio") await loadHome({ force: true });
  else if (tab === "trato") await loadFeedingScreen({ force: true });
  else if (tab === "estoque") await STOCK_SUBTABS[currentSubTab()]();
  else if (tab === "lotes") await loadLots();
  else if (tab === "historico") await loadHistory();
  else if (tab === "relatorios") await runReport();
  else if (tab === "sistema") await loadUsers();
  markDataFresh();
  toast("Dados atualizados.");
}
