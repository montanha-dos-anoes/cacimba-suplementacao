function homeCard(value, label, hint, tone = "") {
  return `<div class="homeCard ${tone}">
    <b class="homeValue">${esc(value)}</b>
    <span class="homeLabel">${esc(label)}</span>
    ${hint ? `<span class="small">${esc(hint)}</span>` : ""}
  </div>`;
}

function homeSkeleton() {
  return '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
}

function startOfToday() {
  return farmDayBounds(farmDateISO()).start.toISOString();
}

const HOME_MAX_AGE_MS = 30000;

async function loadHome(opcoes = {}) {
  const frescor = { maxAgeMs: HOME_MAX_AGE_MS, ...opcoes };
  $("homeGreeting").textContent = `Olá, ${profile.full_name.split(" ")[0]}`;
  $("homeCards").innerHTML = homeSkeleton();

  if (profile.role === "field") return loadHomeField(frescor);
  return loadHomeAdmin(frescor);
}

async function loadHomeField(frescor) {
  $("homeActions").innerHTML = `<button class="btn homeBig" data-do="tab" data-arg="trato">Registrar trato agora</button>`;
  const meus = await SupCache.fetch("home-campo", () => sb
    .from("suplementacao_feeding_records")
    .select("occurred_at, quantity_kg, lots:suplementacao_lots(name), products:suplementacao_products(name)")
    .eq("recorded_by", profile.id)
    .order("occurred_at", { ascending: false })
    .limit(5), undefined, frescor);

  const rows = meus.value || [];
  $("homeCards").innerHTML = homeCard(String(rows.length), "tratos recentes", "seus últimos lançamentos");
  $("homeList").innerHTML = rows.length
    ? rows.map(row => `<div class="item">
        <b>${esc(row.lots?.name || "Lote")}</b>
        <div>${esc(SupUnits.formatKg(row.quantity_kg))} de ${esc(row.products?.name || "produto")}</div>
        <div class="small">${farmDateTimeBR(row.occurred_at)}</div>
      </div>`).join("")
    : '<div class="emptyBox small">Você ainda não registrou nenhum trato.</div>';
}

async function loadHomeAdmin(frescor) {
  $("homeActions").innerHTML = `
    <button class="btn homeBig" data-do="tab" data-arg="trato">Registrar trato</button>
    <button class="btn alt homeBig" data-do="tab" data-arg="estoque">Abrir estoque</button>`;

  const [tratosHoje, saldo, fabricacoes] = await Promise.all([
    SupCache.fetch("home-tratos", () => sb.from("suplementacao_feeding_records").select("id, lot_id, quantity_kg").gte("occurred_at", startOfToday()), undefined, frescor),
    SupCache.fetch("home-saldo", () => sb.from("suplementacao_product_stock").select("name, quantity_kg, negative").eq("active", true), undefined, frescor),
    SupCache.fetch("home-fabricacoes", () => sb.from("suplementacao_productions")
      .select("quantity_kg, occurred_at, reversed_at, suplementacao_formulas(name), suplementacao_products(name)")
      .order("occurred_at", { ascending: false })
      .limit(3), undefined, frescor)
  ]);

  const today = tratosHoje.value || [];
  const stock = saldo.value || [];
  const productions = fabricacoes.value || [];
  const lotsToday = new Set(today.map(row => row.lot_id)).size;
  const kgToday = today.reduce((total, row) => total + Number(row.quantity_kg || 0), 0);
  const negatives = (stock || []).filter(row => row.negative);

  $("homeCards").innerHTML = [
    homeCard(String(today.length), "tratos hoje", `${lotsToday} lote(s) · ${SupUnits.formatKg(kgToday)}`),
    homeCard(String(negatives.length), "com saldo negativo", negatives.slice(0, 2).map(row => row.name).join(", "), negatives.length ? "bad" : "good"),
    homeCard(String((stock || []).length), "produtos ativos", "no catálogo de estoque")
  ].join("");

  $("homeList").innerHTML = (productions || []).length
    ? (productions || []).map(row => `<div class="item">
        <b>${esc(row.suplementacao_formulas?.name || "Fabricação")}</b>${row.reversed_at ? ' <span class="pill warn">ESTORNADA</span>' : ""}
        <div>${esc(SupUnits.formatKg(row.quantity_kg))} de ${esc(row.suplementacao_products?.name || "produto")}</div>
        <div class="small">${farmDateTimeBR(row.occurred_at)}</div>
      </div>`).join("")
    : '<div class="emptyBox small">Nenhuma fabricação registrada ainda.</div>';
}
