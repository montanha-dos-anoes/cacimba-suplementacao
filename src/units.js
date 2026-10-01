const SupUnits = (() => {
  function format(value) {
    return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  }

  function formatKg(kg) {
    return `${format(kg)} kg`;
  }

  return { formatKg };
})();
