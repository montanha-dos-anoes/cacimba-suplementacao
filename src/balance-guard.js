const SupBalance = (() => {
  function parseNegativeError(error) {
    if (!error || error.message !== "SALDO_NEGATIVO") return null;
    try {
      const payload = JSON.parse(error.details || "{}");
      return Array.isArray(payload.items) ? payload.items : [];
    } catch {
      return [];
    }
  }

  function format(value) {
    return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  }

  function negativeConfirmMessage(items) {
    const lines = (items || []).map(
      item => `${item.name}: saldo ${format(item.balance)} kg, saída ${format(item.needed)} kg, fica ${format(item.result)} kg`
    );
    const head = lines.length > 1 ? "Estes produtos ficam com saldo negativo:" : "Este produto fica com saldo negativo:";
    return [lines.length ? head : "A operação deixa saldo negativo.", ...lines, "", "Confirmar mesmo assim?"].join("\n");
  }

  return { parseNegativeError, negativeConfirmMessage };
})();
