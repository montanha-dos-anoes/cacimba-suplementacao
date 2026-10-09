const SupCache = (() => {
  const PREFIX = "suplementacao:cache:";

  function storageKey(name) {
    return `${PREFIX}${name}`;
  }

  function readEntry(name) {
    try {
      const raw = localStorage.getItem(storageKey(name));
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return entry && typeof entry === "object" && "value" in entry ? entry : null;
    } catch {
      return null;
    }
  }

  function write(name, value, savedAt = new Date().toISOString()) {
    try {
      localStorage.setItem(storageKey(name), JSON.stringify({ value, savedAt }));
    } catch {
      return false;
    }
    return true;
  }

  function read(name, fallback = null) {
    const entry = readEntry(name);
    return entry ? entry.value : fallback;
  }

  function savedAt(name) {
    return readEntry(name)?.savedAt || "";
  }

  function names() {
    const found = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(PREFIX)) found.push(key.slice(PREFIX.length));
    }
    return found;
  }

  function newestSavedAt() {
    return names().map(savedAt).filter(Boolean).sort().pop() || "";
  }

  function load(name, responses, build) {
    const list = Array.isArray(responses) ? responses : [responses];
    if (list.every(response => response && !response.error)) {
      const value = build(list);
      write(name, value);
      return value;
    }
    return read(name, null);
  }

  function clear() {
    for (const name of names()) {
      try {
        localStorage.removeItem(storageKey(name));
      } catch {}
    }
  }

  const NETWORK_ONLY_TABS = new Set(["relatorios", "sistema"]);

  function needsNetwork(tab) {
    return NETWORK_ONLY_TABS.has(tab);
  }

  const emAndamento = new Map();
  const buscadoEm = new Map();

  async function buscar(name, run, build) {
    const responses = [].concat(await run());
    const recusada = responses.find(response => !response || response.error);
    if (recusada) return { value: read(name, null), fromCache: true, error: recusada.error };

    const value = build(responses);
    write(name, value);
    buscadoEm.set(name, Date.now());
    return { value, fromCache: false, error: null };
  }

  function fetch(name, run, build = list => list[0].data || [], { maxAgeMs = 0, force = false } = {}) {
    if (isOffline()) return Promise.resolve({ value: read(name, null), fromCache: true, error: null });

    if (!force && maxAgeMs > 0 && Date.now() - (buscadoEm.get(name) || 0) < maxAgeMs) {
      return Promise.resolve({ value: read(name, null), fromCache: false, reused: true, error: null });
    }
    if (emAndamento.has(name)) return emAndamento.get(name);

    const trabalho = buscar(name, run, build).finally(() => emAndamento.delete(name));
    emAndamento.set(name, trabalho);
    return trabalho;
  }

  function forget(...nomes) {
    for (const name of nomes) buscadoEm.delete(name);
  }

  return { load, fetch, forget, read, write, savedAt, newestSavedAt, clear, needsNetwork };
})();

const SUP_CACHES = {
  lotes: ["lotes", "cadastro-lotes"],
  produtos: ["cadastro-produtos", "formulas-ativas"],
  saldo: ["saldo", "estoque"],
  inicio: ["home-campo", "home-tratos", "home-saldo", "home-fabricacoes"]
};

function forgetAfterWrite(...grupos) {
  SupCache.forget(...grupos.flatMap(grupo => SUP_CACHES[grupo] || []));
}

function cacheStatus(resultados, assunto) {
  const lista = [].concat(resultados);
  const faltando = lista.some(item => !item.value);
  const doAparelho = lista.some(item => item.fromCache && item.value);
  const recusa = lista.map(item => item.error).find(error => error && !isNetworkError(error));

  if (faltando) {
    return isOffline()
      ? [`Sem conexão. Este aparelho ainda não guardou ${assunto}. Abra o aplicativo uma vez com internet antes de ir ao campo.`, false]
      : [friendlyError(recusa || "Não foi possível carregar agora."), true];
  }
  if (recusa) return [friendlyError(recusa), true];
  if (doAparelho) {
    const quando = SupCache.newestSavedAt();
    return [quando
      ? `Sem conexão — mostrando os dados de ${farmDateTimeBR(quando)} guardados neste aparelho.`
      : "Sem conexão — mostrando os dados guardados neste aparelho.", false];
  }
  return ["", false];
}
