import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({});
  vm.runInContext(read("src/formulas.js"), context);
  return vm.runInContext(expression, context);
}

const ITEMS = `[
  { item_id: "milho", unit: "percent", amount: 60 },
  { item_id: "farelo", unit: "percent", amount: 25 },
  { item_id: "nucleo", unit: "kg", amount: 50 },
  { item_id: "ureia", unit: "kg", amount: 100 }
]`;

test("resolve percentual e quilo na mesma fórmula", () => {
  assert.deepEqual(run(`SupFormula.resolveItems(${ITEMS}, 1000)`), [
    { item_id: "milho", kg: 600 },
    { item_id: "farelo", kg: 250 },
    { item_id: "nucleo", kg: 50 },
    { item_id: "ureia", kg: 100 }
  ]);
  assert.equal(run(`SupFormula.formulaTotal(${ITEMS}, 1000)`), 1000);
});

test("fórmula que fecha a quantidade é válida", () => {
  assert.deepEqual(run(`SupFormula.validateFormula(${ITEMS}, 1000)`), { valid: true, code: "", error: "" });
});

test("fórmula que não fecha a quantidade aponta a diferença", () => {
  const partial = '[{ item_id: "milho", unit: "percent", amount: 60 }, { item_id: "farelo", unit: "percent", amount: 25 }]';
  assert.deepEqual(run(`SupFormula.validateFormula(${partial}, 1000)`), {
    valid: false,
    code: "sum",
    error: "A fórmula soma 850 kg e a quantidade é de 1.000 kg. Faltam 150 kg."
  });

  const excess = '[{ item_id: "milho", unit: "percent", amount: 100 }, { item_id: "ureia", unit: "kg", amount: 30 }]';
  assert.deepEqual(run(`SupFormula.validateFormula(${excess}, 1000)`), {
    valid: false,
    code: "sum",
    error: "A fórmula soma 1.030 kg e a quantidade é de 1.000 kg. Sobram 30 kg."
  });
});

test("fórmula sem item ou com item repetido é recusada", () => {
  assert.equal(run("SupFormula.validateFormula([], 1000).error"), "Inclua pelo menos um item na fórmula.");
  const repeated = '[{ item_id: "milho", unit: "kg", amount: 500 }, { item_id: "milho", unit: "kg", amount: 500 }]';
  assert.equal(run(`SupFormula.validateFormula(${repeated}, 1000).error`), "O mesmo item não pode aparecer duas vezes na fórmula.");
});

test("escala a fórmula para a quantidade que será produzida", () => {
  assert.deepEqual(run(`SupFormula.scaleToProduction(${ITEMS}, 1000, 250)`), [
    { item_id: "milho", quantity: 150 },
    { item_id: "farelo", quantity: 62.5 },
    { item_id: "nucleo", quantity: 12.5 },
    { item_id: "ureia", quantity: 25 }
  ]);
});

test("calcula o custo estimado por quilo produzido", () => {
  const costs = '{ milho: 1.2, farelo: 2, nucleo: 8, ureia: 3.5 }';
  assert.equal(run(`SupFormula.costPerKg(${ITEMS}, 1000, ${costs})`), 1.97);
  assert.equal(run(`SupFormula.costPerKg(${ITEMS}, 1000, {})`), 0);
});

test("produto de saída não pode ser item de entrada da própria fórmula", () => {
  assert.deepEqual(run(`SupFormula.validateNoSelfInput(${ITEMS}, "farinha")`), { valid: true, error: "" });
  assert.deepEqual(run(`SupFormula.validateNoSelfInput(${ITEMS}, "milho")`), {
    valid: false,
    error: "O produto de saída da fórmula não pode ser um item de entrada da mesma fórmula."
  });
  assert.deepEqual(run(`SupFormula.validateNoSelfInput(${ITEMS}, "")`), { valid: true, error: "" });
});

const COMPOSICAO = `[
  { item_id: "milho", unit: "percent", amount: 45 },
  { item_id: "ddg", unit: "kg", amount: 250 }
]`;

test("composição devolve kg, porcentagem e largura de cada item", () => {
  const composition = run(`SupFormula.composition(${COMPOSICAO}, 1000)`);
  assert.equal(composition.total, 700);
  assert.equal(composition.base, 1000);
  assert.deepEqual(composition.segments.map(segment => [segment.item_id, segment.kg, segment.percent]), [
    ["milho", 450, 45],
    ["ddg", 250, 25]
  ]);
  assert.deepEqual(composition.segments.map(segment => segment.ratio), [0.45, 0.25]);
  assert.ok(composition.segments.every(segment => /^#[0-9a-f]{6}$/.test(segment.color)));
});

test("composição que não fecha aponta quanto falta", () => {
  const composition = run(`SupFormula.composition(${COMPOSICAO}, 1000)`);
  assert.equal(composition.missing, 300);
  assert.equal(composition.excess, 0);
  assert.equal(composition.closed, false);
  assert.equal(composition.missingRatio, 0.3);
});

test("composição que fecha não tem falta nem sobra", () => {
  const composition = run('SupFormula.composition([{ item_id: "milho", unit: "percent", amount: 100 }], 1000)');
  assert.equal(composition.closed, true);
  assert.equal(composition.missing, 0);
  assert.equal(composition.excess, 0);
});

test("composição que passa da quantidade marca a sobra e reescala a barra", () => {
  const composition = run('SupFormula.composition([{ item_id: "milho", unit: "kg", amount: 1200 }], 1000)');
  assert.equal(composition.excess, 200);
  assert.equal(composition.missing, 0);
  assert.equal(composition.closed, false);
  assert.equal(composition.excessRatio, 200 / 1200);
  assert.equal(composition.limitRatio, 1000 / 1200);
  assert.equal(composition.segments[0].ratio, 1);
});

test("sem sobra, a marca dos 100% fica no fim da barra", () => {
  assert.equal(run(`SupFormula.composition(${COMPOSICAO}, 1000)`).limitRatio, 1);
});

test("linha sem produto escolhido fica fora da composição", () => {
  const composition = run('SupFormula.composition([{ item_id: "", unit: "kg", amount: 300 }, { item_id: "milho", unit: "kg", amount: 200 }], 1000)');
  assert.equal(composition.segments.length, 1);
  assert.equal(composition.total, 200);
});

test("quantidade zero devolve composição vazia sem quebrar", () => {
  const composition = run(`SupFormula.composition(${COMPOSICAO}, 0)`);
  assert.deepEqual(composition.segments, []);
  assert.equal(composition.total, 0);
  assert.equal(composition.closed, false);
});

test("cada recusa da validação vem com um código", () => {
  assert.equal(run("SupFormula.validateFormula([], 1000).code"), "empty");
  assert.equal(run('SupFormula.validateFormula([{ item_id: "", unit: "kg", amount: 10 }], 1000).code'), "no-item");
  assert.equal(run('SupFormula.validateFormula([{ item_id: "milho", unit: "kg", amount: 0 }], 1000).code'), "bad-amount");
  assert.equal(run('SupFormula.validateFormula([{ item_id: "milho", unit: "kg", amount: 10 }], 0).code'), "no-base");
  assert.equal(run('SupFormula.validateFormula([{ item_id: "milho", unit: "kg", amount: 10 }], 1000).code'), "sum");
});

test("converte fórmula antiga (base em kg) para porcentagem", () => {
  const antiga = '[{ item_id: "milho", unit: "percent", amount: 45 }, { item_id: "nucleo", unit: "kg", amount: 50 }]';
  assert.deepEqual(run(`SupFormula.toPercentItems(${antiga}, 1000)`), [
    { item_id: "milho", unit: "percent", amount: 45 },
    { item_id: "nucleo", unit: "percent", amount: 5 }
  ]);
});

test("fórmula já em porcentagem passa inteira pela conversão", () => {
  const nova = '[{ item_id: "milho", unit: "percent", amount: 45 }]';
  assert.deepEqual(run(`SupFormula.toPercentItems(${nova}, 100)`), [
    { item_id: "milho", unit: "percent", amount: 45 }
  ]);
});

test("conversão sem base válida zera as quantidades em kg", () => {
  const antiga = '[{ item_id: "nucleo", unit: "kg", amount: 50 }]';
  assert.deepEqual(run(`SupFormula.toPercentItems(${antiga}, 0)`), [
    { item_id: "nucleo", unit: "percent", amount: 0 }
  ]);
});
