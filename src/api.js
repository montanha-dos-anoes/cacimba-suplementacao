let ultimaIdaARede = 0;

function podeIrARede() {
  if (typeof isOffline !== "function" || !isOffline()) return true;
  return Date.now() - ultimaIdaARede >= SUP_CONFIG.offlineRetryMs;
}

async function supFetch(input, init = {}, timeoutMs = SUP_CONFIG.requestTimeoutMs) {
  if (!podeIrARede()) throw new TypeError("Failed to fetch — sem conexão com o servidor.");
  ultimaIdaARede = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const chamador = init.signal;
  const repassar = () => controller.abort();
  if (chamador) chamador.addEventListener("abort", repassar, { once: true });

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (typeof noteConnection === "function") noteConnection(true);
    return response;
  } catch (error) {
    if (chamador && chamador.aborted) throw error;
    if (typeof noteConnection === "function") noteConnection(false);
    if (controller.signal.aborted) throw new TypeError("Failed to fetch — o servidor não respondeu no tempo esperado.");
    throw error;
  } finally {
    clearTimeout(timer);
    if (chamador) chamador.removeEventListener("abort", repassar);
  }
}

let conexaoConferida = null;

function probeConnection() {
  if (conexaoConferida) return conexaoConferida;
  conexaoConferida = (async () => {
    if (isOffline()) return false;
    try {
      const response = await supFetch(`${SUP_CONFIG.supabaseUrl}/auth/v1/health`, {
        method: "GET",
        headers: { apikey: SUP_CONFIG.supabasePublishableKey }
      }, SUP_CONFIG.probeTimeoutMs);
      return response.ok;
    } catch {
      return false;
    }
  })();
  return conexaoConferida;
}

function forgetConnectionProbe() {
  conexaoConferida = null;
}

const sb = supabase.createClient(SUP_CONFIG.supabaseUrl, SUP_CONFIG.supabasePublishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: supFetch }
});

const SupApi = (() => {
  async function rpc(name, body = {}) {
    const { data, error } = await sb.rpc(name, body);
    noteConnection(!error || !isNetworkError(error));
    if (error) {
      const failure = new Error(error.message);
      failure.details = error.details;
      failure.hint = error.hint;
      failure.code = error.code;
      throw failure;
    }
    return data;
  }

  async function invokeAdmin(body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Sua sessão expirou. Entre de novo para gerenciar usuários.");

    let response;
    try {
      response = await supFetch(`${SUP_CONFIG.supabaseUrl}/functions/v1/admin-users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUP_CONFIG.supabasePublishableKey
        },
        body: JSON.stringify(body)
      });
    } catch {
      throw new Error("Não foi possível falar com o serviço de usuários. Confira a conexão e se a função admin-users está publicada neste ambiente do Supabase.");
    }

    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    if (response.status === 404) {
      throw new Error("A função admin-users não está publicada neste ambiente do Supabase.");
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || payload.message || `O serviço de usuários respondeu ${response.status}.`);
    }
    return payload;
  }

  return { rpc, invokeAdmin };
})();
