const SupFeedingReport = (() => {
  const TROUGH = { empty: "Vazio", medium: "Médio", full: "Cheio" };

  function dayList(fromISO, toISO) {
    const dias = [];
    let atual = farmLocalToDate(`${fromISO}T00:00`);
    const limite = farmLocalToDate(`${toISO}T00:00`);
    if (Number.isNaN(atual.getTime()) || Number.isNaN(limite.getTime())) return dias;
    while (atual.getTime() <= limite.getTime()) {
      dias.push(farmDateISO(atual));
      atual = farmLocalToDate(`${farmDateISO(new Date(atual.getTime() + 36 * 60 * 60 * 1000))}T00:00`);
    }
    return dias;
  }

  function versionForDay(versions, lotId, dia) {
    return (versions || [])
      .filter(version => version.lot_id === lotId && String(version.effective_from).slice(0, 10) <= dia)
      .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0] || null;
  }

  function groupsOf(groups, version) {
    return version ? (groups || []).filter(group => group.lot_version_id === version.id) : [];
  }

  function productName(products, group) {
    return (products || []).find(item => item.id === group.product_id)?.name
      || group.product_name || "Produto";
  }

  function totalAnimals(grupos) {
    return grupos.reduce((soma, group) => soma + Number(group.quantity || 0), 0);
  }

  function composition(versions, groups, products, lotId, dias) {
    const blocos = [];
    for (const dia of dias) {
      const version = versionForDay(versions, lotId, dia);
      const anterior = blocos[blocos.length - 1];
      if (anterior && anterior.versionId === (version?.id || null)) {
        anterior.fim = dia;
        continue;
      }
      if (!version) {
        blocos.push({ versionId: null, inicio: dia, fim: dia, totalAnimais: 0, grupos: [] });
        continue;
      }
      const grupos = groupsOf(groups, version);
      blocos.push({
        versionId: version.id,
        inicio: dia,
        fim: dia,
        totalAnimais: totalAnimals(grupos),
        grupos: grupos.map(group => ({
          categoria: group.category || "Categoria",
          animais: Number(group.quantity || 0),
          pesoMedio: Number(group.avg_weight_kg || 0),
          produto: productName(products, group),
          produtoId: group.product_id || null,
          esperadoCabDia: Number(group.expected_consumption_kg_head_day || 0),
          esperadoGrupoDia: Number(group.quantity || 0) * Number(group.expected_consumption_kg_head_day || 0)
        }))
      });
    }
    return blocos.filter(bloco => bloco.versionId);
  }

  function categoriesFor(grupos, productId) {
    const nomes = grupos
      .filter(group => group.product_id === productId)
      .map(group => group.category || "Categoria");
    return [...new Set(nomes)].join(", ");
  }

  function animalsFor(grupos, productId) {
    const doProduto = grupos.filter(group => group.product_id === productId);
    return doProduto.length ? totalAnimals(doProduto) : totalAnimals(grupos);
  }

  function build({ records = [], versions = [], groups = [], products = [], lotId, from, to }) {
    const dias = dayList(from, to);
    const doLote = records.filter(record => record.lot_id === lotId);

    const esperadoPorProduto = new Map();
    const fornecidoPorProduto = new Map();
    const nomePorProduto = new Map();

    const detalhe = dias.map(dia => {
      const version = versionForDay(versions, lotId, dia);
      const grupos = groupsOf(groups, version);

      for (const group of grupos) {
        if (!group.product_id) continue;
        nomePorProduto.set(group.product_id, productName(products, group));
        const atual = esperadoPorProduto.get(group.product_id) || 0;
        esperadoPorProduto.set(group.product_id,
          atual + Number(group.quantity || 0) * Number(group.expected_consumption_kg_head_day || 0));
      }

      const doDia = doLote
        .filter(record => farmDateISO(record.occurred_at) === dia)
        .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

      const linhas = doDia.map(record => {
        const quantidade = Number(record.quantity_kg || 0);
        if (record.product_id) {
          nomePorProduto.set(record.product_id,
            record.products?.name || nomePorProduto.get(record.product_id) || "Produto");
          fornecidoPorProduto.set(record.product_id,
            (fornecidoPorProduto.get(record.product_id) || 0) + quantidade);
        }
        return {
          hora: farmParts(record.occurred_at).hour + ":" + farmParts(record.occurred_at).minute,
          categoria: categoriesFor(grupos, record.product_id) || "—",
          animais: grupos.length ? animalsFor(grupos, record.product_id) : null,
          produto: record.products?.name || nomePorProduto.get(record.product_id) || "Produto",
          kg: quantidade,
          cocho: TROUGH[record.trough_reading] || "",
          responsavel: record.profiles?.full_name || record.recorder_name || "",
          editado: record.edited_at ? "Sim" : "Não"
        };
      });

      return {
        dia,
        semRegistro: linhas.length === 0,
        animais: grupos.length ? totalAnimals(grupos) : null,
        linhas,
        totalDia: linhas.reduce((soma, linha) => soma + linha.kg, 0)
      };
    });

    const porProduto = [...new Set([...esperadoPorProduto.keys(), ...fornecidoPorProduto.keys()])]
      .map(productId => {
        const esperado = esperadoPorProduto.get(productId) || 0;
        const fornecido = fornecidoPorProduto.get(productId) || 0;
        return {
          produtoId: productId,
          produto: nomePorProduto.get(productId) || "Produto",
          esperado,
          fornecido,
          diferenca: fornecido - esperado,
          percentual: esperado ? (fornecido / esperado) * 100 : 0
        };
      })
      .sort((a, b) => a.produto.localeCompare(b.produto, "pt-BR"));

    return {
      dias: [...detalhe].reverse(),
      porProduto,
      composicao: composition(versions, groups, products, lotId, dias),
      totalKg: detalhe.reduce((soma, dia) => soma + dia.totalDia, 0),
      diasComRegistro: detalhe.filter(dia => !dia.semRegistro).length,
      diasSemRegistro: detalhe.filter(dia => dia.semRegistro).length
    };
  }

  function flatRows(relatorio) {
    const linhas = [];
    for (const dia of relatorio.dias) {
      const data = farmDateBR(dia.dia);
      if (dia.semRegistro) {
        linhas.push({
          Data: data, Hora: "—", Categoria: "—", Animais: dia.animais === null ? "—" : dia.animais,
          Produto: "SEM REGISTRO", "Trato (kg)": 0,
          "Leitura do cocho": "—", "Responsável": "—", Editado: "—"
        });
        continue;
      }
      for (const linha of dia.linhas) {
        linhas.push({
          Data: data, Hora: linha.hora, Categoria: linha.categoria, Animais: linha.animais === null ? "—" : linha.animais,
          Produto: linha.produto, "Trato (kg)": linha.kg,
          "Leitura do cocho": linha.cocho, "Responsável": linha.responsavel, Editado: linha.editado
        });
      }
    }
    return linhas;
  }

  function summaryRows(relatorio) {
    const linhas = [];
    for (const bloco of relatorio.composicao) {
      for (const grupo of bloco.grupos) {
        linhas.push({
          Bloco: "Composição do lote",
          "Período": `${farmDateBR(bloco.inicio)} a ${farmDateBR(bloco.fim)}`,
          "Categoria / Produto": grupo.categoria,
          Animais: grupo.animais,
          "Peso médio (kg)": grupo.pesoMedio,
          Produto: grupo.produto,
          "Esperado (kg/cab/dia)": grupo.esperadoCabDia,
          "Esperado do grupo (kg/dia)": grupo.esperadoGrupoDia,
          "Esperado (kg)": "", "Fornecido (kg)": "", "Diferença (kg)": "", "% do esperado": ""
        });
      }
    }
    for (const item of relatorio.porProduto) {
      linhas.push({
        Bloco: "Consumo por produto",
        "Período": "",
        "Categoria / Produto": item.produto,
        Animais: "", "Peso médio (kg)": "", Produto: item.produto,
        "Esperado (kg/cab/dia)": "", "Esperado do grupo (kg/dia)": "",
        "Esperado (kg)": item.esperado,
        "Fornecido (kg)": item.fornecido,
        "Diferença (kg)": item.diferenca,
        "% do esperado": item.percentual
      });
    }
    return linhas;
  }

  return { build, dayList, versionForDay, flatRows, summaryRows, TROUGH };
})();
