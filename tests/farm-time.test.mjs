import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function load() {
  const context = vm.createContext({ Intl, Date });
  vm.runInContext(read("src/farm-time.js"), context);
  return context;
}

test("o dia do trato é o da fazenda, não o do aparelho", () => {
  const { farmDateISO } = load();
  assert.equal(farmDateISO(new Date("2026-09-15T02:00:00Z")), "2026-09-14");
});

test("meia-noite na fazenda já conta como o dia seguinte", () => {
  const { farmDateISO } = load();
  assert.equal(farmDateISO(new Date("2026-09-15T04:30:00Z")), "2026-09-15");
});

test("farmNowLocal devolve o formato que o campo de data usa", () => {
  const { farmNowLocal } = load();
  assert.match(farmNowLocal(new Date("2026-09-15T02:00:00Z")), /^2026-09-14T22:00$/);
});

test("farmDateBR mostra a data no formato do produtor", () => {
  const { farmDateBR } = load();
  assert.equal(farmDateBR("2026-09-14"), "14/09/2026");
});

test("farmDateTimeBR carimba data e hora da fazenda", () => {
  const { farmDateTimeBR } = load();
  assert.equal(farmDateTimeBR("2026-09-15T02:00:00Z"), "14/09/2026 22:00");
});

test("farmLocalToDate devolve o instante certo do valor digitado", () => {
  const { farmLocalToDate } = load();
  assert.equal(farmLocalToDate("2026-09-14T22:00").toISOString(), "2026-09-15T02:00:00.000Z");
});

test("os limites do dia da fazenda cobrem as 24 horas", () => {
  const { farmDayBounds } = load();
  const { start, end } = farmDayBounds("2026-09-14");
  assert.equal(start.toISOString(), "2026-09-14T04:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-15T03:59:59.999Z");
});

test("o agora do calendário é o relógio da fazenda", () => {
  const { farmNowAsLocalDate } = load();
  const agora = farmNowAsLocalDate(new Date("2026-09-15T02:00:00Z"));
  assert.equal(agora.getFullYear(), 2026);
  assert.equal(agora.getMonth(), 8);
  assert.equal(agora.getDate(), 14);
  assert.equal(agora.getHours(), 22);
  assert.equal(agora.getMinutes(), 0);
});

test("campo automático renova a hora antes de salvar", () => {
  const { setAutomaticDateTime, refreshAutomaticDateTime } = load();
  const field = { value: "", dataset: {} };

  setAutomaticDateTime(field, new Date("2026-09-17T01:32:00Z"));
  assert.equal(field.value, "2026-09-16T21:32");

  refreshAutomaticDateTime(field, new Date("2026-09-17T01:50:00Z"));
  assert.equal(field.value, "2026-09-16T21:50");
});

test("data escolhida manualmente não é substituída", () => {
  const { setAutomaticDateTime, markDateTimeAsManual, refreshAutomaticDateTime } = load();
  const field = { value: "", dataset: {} };

  setAutomaticDateTime(field, new Date("2026-09-17T01:32:00Z"));
  field.value = "2026-09-15T08:00";
  markDateTimeAsManual(field);
  refreshAutomaticDateTime(field, new Date("2026-09-17T01:50:00Z"));

  assert.equal(field.value, "2026-09-15T08:00");
});
