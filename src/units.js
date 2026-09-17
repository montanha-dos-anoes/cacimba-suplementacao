const SupUnits = (() => {
  function factor(product, unit) {
    if (!product || !unit || unit === "kg") return 1;
    if (unit === product.display_unit && Number(product.display_unit_kg) > 0) return Number(product.display_unit_kg);
    return 1;
  }

  function toKg(amount, unit, product) {
    return (Number(amount) || 0) * factor(product, unit);
  }

  function fromKg(kg, unit, product) {
    return (Number(kg) || 0) / factor(product, unit);
  }

  function unitOptions(product) {
    const options = [{ value: "kg", label: "kg" }];
    if (product && product.display_unit && Number(product.display_unit_kg) > 0) {
      options.push({ value: product.display_unit, label: product.display_unit });
    }
    return options;
  }

  function format(value) {
    return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  }

  function formatKg(kg) {
    return `${format(kg)} kg`;
  }

  function formatQuantity(kg, product) {
    if (!product || !product.display_unit || !(Number(product.display_unit_kg) > 0)) {
      return { main: formatKg(kg), secondary: "" };
    }
    const inDisplayUnit = `${format(fromKg(kg, product.display_unit, product))} ${product.display_unit}`;
    return product.display_unit_primary
      ? { main: inDisplayUnit, secondary: `= ${formatKg(kg)}` }
      : { main: formatKg(kg), secondary: `= ${inDisplayUnit}` };
  }

  return { toKg, fromKg, unitOptions, formatKg, formatQuantity };
})();
