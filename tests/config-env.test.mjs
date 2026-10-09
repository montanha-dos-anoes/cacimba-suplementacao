import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configSource = readFileSync(resolve(root, "src/config.js"), "utf8");

function loadConfig(envs, hostname) {
  const source = configSource.replace(
    /const SUP_ENVS = \{[\s\S]*?\n\};/,
    `const SUP_ENVS = ${JSON.stringify(envs)};`
  );
  const context = vm.createContext({ location: { hostname } });
  vm.runInContext(source, context);
  return vm.runInContext("SUP_CONFIG", context);
}

const prod = { supabaseUrl: "https://prod.supabase.co", supabasePublishableKey: "prod-key" };
const dev = { supabaseUrl: "https://dev.supabase.co", supabasePublishableKey: "dev-key" };

test("com prod e dev, localhost continua escolhendo dev", () => {
  const config = loadConfig({ prod, dev }, "localhost");
  assert.equal(config.env, "dev");
  assert.equal(config.supabaseUrl, dev.supabaseUrl);
});

test("com prod e dev, domínio publicado continua escolhendo prod", () => {
  const config = loadConfig({ prod, dev }, "app.exemplo.com");
  assert.equal(config.env, "prod");
  assert.equal(config.supabaseUrl, prod.supabaseUrl);
});

test("com somente prod, localhost usa a única configuração disponível", () => {
  const config = loadConfig({ prod }, "localhost");
  assert.equal(config.env, "prod");
  assert.equal(config.supabaseUrl, prod.supabaseUrl);
});

test("com somente dev, domínio publicado usa a única configuração disponível", () => {
  const config = loadConfig({ dev }, "app.exemplo.com");
  assert.equal(config.env, "dev");
  assert.equal(config.supabaseUrl, dev.supabaseUrl);
});

