const SUP_ENVS = {
  prod: {
    supabaseUrl: "https://kwogzwdidzenfmdxmiwv.supabase.co",
    supabasePublishableKey: "sb_publishable_2xZ6R8_k2_EfR6Dv02Gfyg_8U0wg2AU"
  },
  dev: {
    supabaseUrl: "https://xfdirruvwqvyuchnelbf.supabase.co",
    supabasePublishableKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGlycnV2d3F2eXVjaG5lbGJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzOTQ2MTcsImV4cCI6MjEwMzk3MDYxN30.ZRXEPvmw62Hi8y3_A8tlxHM8c2vUexjNrkPeYcbX87Y"
  }
};

const SUP_ENV =
  /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/i.test(location.hostname) ? "dev" : "prod";

const SUP_CONFIG = Object.freeze({
  ...SUP_ENVS[SUP_ENV],
  env: SUP_ENV,
  appVersion: "1.19.0",
  requestTimeoutMs: 10000,
  offlineRetryMs: 20000,
  probeTimeoutMs: 4000
});
