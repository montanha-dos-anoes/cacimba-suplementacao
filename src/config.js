const SUP_ENVS = {
  prod: {
    supabaseUrl: "https://xjcgrebtltmtqremranl.supabase.co",
    supabasePublishableKey: "sb_publishable_bCILhLcOXhn8O2XwY3SwqQ_TblX4Qpx"
  }
};

const SUP_ENV_PADRAO =
  /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/i.test(location.hostname) ? "dev" : "prod";
const SUP_AMBIENTES = Object.keys(SUP_ENVS);
const SUP_ENV = SUP_AMBIENTES.length === 1 ? SUP_AMBIENTES[0] : SUP_ENV_PADRAO;

const SUP_CONFIG = Object.freeze({
  ...SUP_ENVS[SUP_ENV],
  env: SUP_ENV,
  appVersion: "1.19.1",
  requestTimeoutMs: 10000,
  offlineRetryMs: 20000,
  probeTimeoutMs: 4000
});
