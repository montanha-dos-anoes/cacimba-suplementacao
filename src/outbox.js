const OUTBOX_KEY = "suplementacao:outbox";
let outboxSyncing = false;

function newLocalId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0;
    return (char === "x" ? random : (random & 0x3 | 0x8)).toString(16);
  });
}

function outboxRead() {
  try {
    const saved = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function outboxWrite(list) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch {
    toast("O aparelho está sem espaço para guardar o trato.", "err");
  }
  renderOutboxBar();
}

function outboxCount() {
  return outboxRead().length;
}

function outboxAdd(record) {
  outboxWrite([...outboxRead(), { record, queued_at: new Date().toISOString(), error: "" }]);
}

function outboxPendingRecords() {
  return outboxRead().map(item => ({ ...item.record, queued_at: item.queued_at, queue_error: item.error }));
}

function renderOutboxBar() {
  const bar = $("outboxBar");
  if (!bar) return;
  const pending = outboxRead();
  bar.classList.toggle("hidden", !pending.length);
  if (!pending.length) return;
  const recusados = pending.filter(item => item.error).length;
  bar.innerHTML = `<span>${pending.length} trato${pending.length > 1 ? "s" : ""} guardado${pending.length > 1 ? "s" : ""} no aparelho${recusados ? ` · ${recusados} recusado${recusados > 1 ? "s" : ""} pelo servidor` : ""}.</span>
    <button class="btn alt smallbtn" data-do="syncOutbox">Enviar agora</button>`;
}

async function syncOutbox(manual = false) {
  if (outboxSyncing) return;
  const pending = outboxRead();
  if (!pending.length) {
    if (manual) toast("Nenhum trato guardado no aparelho.");
    return;
  }

  if (isOffline()) {
    if (manual) toast("Ainda sem conexão. Os tratos continuam guardados no aparelho.", "err");
    return;
  }

  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    if (manual) await showAlert("Não consegui confirmar seu acesso. Conecte-se e entre de novo para enviar os tratos guardados.");
    return;
  }

  outboxSyncing = true;
  const remaining = [];
  let sent = 0;
  let semRede = false;

  for (const item of pending) {
    if (semRede) {
      remaining.push(item);
      continue;
    }
    const { error } = await sb.from("suplementacao_feeding_records").insert(item.record);
    if (!error || error.code === "23505") {
      sent += 1;
      continue;
    }
    if (isNetworkError(error)) {
      noteConnection(false);
      semRede = true;
      remaining.push(item);
      continue;
    }
    remaining.push({ ...item, error: friendlyError(error) });
  }

  outboxSyncing = false;
  outboxWrite(remaining);

  if (sent) {
    noteConnection(true);
    toast(`${sent} trato${sent > 1 ? "s enviados" : " enviado"} para o servidor.`);
    forgetAfterWrite("saldo", "inicio");
    await Promise.all([loadHistory(), loadProductStock({ force: true })]);
  }

  const recusados = remaining.filter(item => item.error);
  if (recusados.length) {
    return showAlert(`${recusados.length} trato(s) o servidor recusou:\n\n${recusados.map(item => `· ${item.error}`).join("\n")}\n\nEles continuam guardados. Corrija o cadastro (lote ou produto) e envie de novo, ou descarte pelo Histórico.`);
  }
  if (manual && !sent) toast("Ainda sem conexão. Os tratos continuam guardados.", "err");
}

async function discardQueuedFeeding(id) {
  if (!(await showConfirm("Descartar este trato guardado? Ele nunca chegou ao servidor e não dá para recuperar.", { danger: true }))) return;
  outboxWrite(outboxRead().filter(item => item.record.id !== id));
  await loadHistory();
  toast("Trato guardado descartado.");
}
