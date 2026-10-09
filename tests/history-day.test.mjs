import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({ Intl, Date, Number, JSON });
  vm.runInContext(read("src/farm-time.js"), context);
  vm.runInContext(read("src/feeding.js"), context);
  return vm.runInContext(expression, context);
}

const REGISTROS = JSON.stringify([
  { id: "a", occurred_at: "2026-09-15T12:00:00-04:00" },
  { id: "b", occurred_at: "2026-09-15T23:59:00-04:00" },
  { id: "c", occurred_at: "2026-09-16T00:01:00-04:00" },
  { id: "d", occurred_at: "2026-09-14T08:00:00-04:00" }
]);

test("o dia do histórico é o dia da fazenda, das 00h às 23h59", () => {
  const ids = run(`feedingOfDay(${REGISTROS}, "2026-09-15").map(r => r.id)`);
  assert.deepEqual(ids, ["a", "b"]);
});

test("um minuto depois da meia-noite já é o dia seguinte", () => {
  const ids = run(`feedingOfDay(${REGISTROS}, "2026-09-16").map(r => r.id)`);
  assert.deepEqual(ids, ["c"]);
});

test("buscar um dia não apaga os outros dias já guardados", () => {
  const antes = JSON.stringify([
    { id: "velho", occurred_at: "2026-09-14T08:00:00-04:00" },
    { id: "substituido", occurred_at: "2026-09-15T09:00:00-04:00" }
  ]);
  const novos = JSON.stringify([{ id: "novo", occurred_at: "2026-09-15T10:00:00-04:00" }]);
  const ids = run(`mergeHistoryCache(${antes}, ${novos}, "2026-09-15").map(r => r.id).sort()`);
  assert.deepEqual(ids, ["novo", "velho"], "o dia buscado é trocado; os outros ficam");
});

test("o histórico guardado fica ordenado do mais novo para o mais antigo", () => {
  const ids = run(`mergeHistoryCache([], ${REGISTROS}, "2026-09-15").map(r => r.id)`);
  assert.deepEqual(ids, ["c", "b", "a", "d"]);
});

test("a tela tem o filtro de dia e o acesso às exclusões", () => {
  const html = read("index.html");
  assert.match(html, /id="historyDate"/, "falta o campo de dia no histórico");
  assert.match(html, /data-do="showDeletions"/, "falta o botão de ver exclusões");
  assert.match(read("src/bootstrap.js"), /showDeletions:/, "ação não registrada");
  assert.match(read("src/feeding.js"), /feeding_record_deletions/, "a consulta das exclusões não existe");
});
