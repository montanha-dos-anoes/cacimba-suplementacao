function _isTopModal(overlay) {
  return $("modalRoot").lastElementChild === overlay;
}

function _closeModal(overlay, resolve, value) {
  overlay.remove();
  document.removeEventListener("keydown", overlay._onKey);
  resolve(value);
}

function _openModal(bodyHtml, { onMount } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";
    overlay.innerHTML = `<div class="modalCard">${bodyHtml}</div>`;
    overlay.addEventListener("mousedown", e => {
      if (e.target === overlay) _closeModal(overlay, resolve, undefined);
    });
    overlay._onKey = e => {
      if (e.key === "Escape" && _isTopModal(overlay)) _closeModal(overlay, resolve, undefined);
    };
    document.addEventListener("keydown", overlay._onKey);
    $("modalRoot").appendChild(overlay);
    if (onMount) onMount(overlay, value => _closeModal(overlay, resolve, value));
  });
}

function showAlert(message) {
  return _openModal(
    `<div class="modalMsg">${esc(message)}</div>
     <div class="modalActions"><button class="btn" data-act="ok">OK</button></div>`,
    {
      onMount: (overlay, close) => {
        overlay.querySelector('[data-act="ok"]').onclick = () => close(undefined);
        overlay.querySelector('[data-act="ok"]').focus();
      }
    }
  );
}

function showConfirm(message, { danger = false } = {}) {
  return _openModal(
    `<div class="modalMsg">${esc(message)}</div>
     <div class="modalActions">
       <button class="btn alt" data-act="cancel">Cancelar</button>
       <button class="btn ${danger ? "danger" : ""}" data-act="confirm">Confirmar</button>
     </div>`,
    {
      onMount: (overlay, close) => {
        overlay.querySelector('[data-act="cancel"]').onclick = () => close(false);
        overlay.querySelector('[data-act="confirm"]').onclick = () => close(true);
        overlay.querySelector('[data-act="confirm"]').focus();
      }
    }
  ).then(value => value === true);
}

function showPrompt(message, { placeholder = "", defaultValue = "" } = {}) {
  return _openModal(
    `<div class="modalMsg">${esc(message)}</div>
     <input type="text" data-act="input" placeholder="${esc(placeholder)}" value="${esc(defaultValue)}">
     <div class="modalActions">
       <button class="btn alt" data-act="cancel">Cancelar</button>
       <button class="btn" data-act="confirm">OK</button>
     </div>`,
    {
      onMount: (overlay, close) => {
        const input = overlay.querySelector('[data-act="input"]');
        overlay.querySelector('[data-act="cancel"]').onclick = () => close(null);
        overlay.querySelector('[data-act="confirm"]').onclick = () => close(input.value);
        input.addEventListener("keydown", e => {
          if (e.key === "Enter") close(input.value);
        });
        input.focus();
        input.select();
      }
    }
  );
}

function showSheet({ title, subtitle = "", tabs }) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";
    overlay.innerHTML = `<div class="modalCard sheetCard">
      <div class="sheetHead">
        <div>
          <b class="sheetTitle">${esc(title)}</b>
          <div class="sheetSubtitle small">${subtitle}</div>
        </div>
        <button class="iconBtn" data-act="close" aria-label="Fechar">${icon("close")}</button>
      </div>
      ${tabs.length > 1 ? `<div class="sheetTabs">${tabs.map((tab, index) => `<button class="tab ${index === 0 ? "on" : ""}" data-tab="${esc(tab.id)}">${esc(tab.label)}</button>`).join("")}</div>` : ""}
      <div class="sheetBody"></div>
      <div class="sheetFooter" hidden></div>
    </div>`;

    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", overlay._onKey);
      resolve(undefined);
    };
    overlay._onKey = e => {
      if (e.key === "Escape" && _isTopModal(overlay)) close();
    };
    overlay.addEventListener("mousedown", e => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", overlay._onKey);
    overlay.querySelector('[data-act="close"]').onclick = close;

    const body = overlay.querySelector(".sheetBody");
    const footer = overlay.querySelector(".sheetFooter");
    const sheet = {
      close,
      setSubtitle: html => {
        overlay.querySelector(".sheetSubtitle").innerHTML = html;
      },
      setFooter: html => {
        footer.innerHTML = html;
        footer.hidden = !html;
      },
      select: id => {
        const tab = tabs.find(item => item.id === id);
        if (!tab) return;
        overlay.querySelectorAll(".sheetTabs .tab").forEach(button => button.classList.toggle("on", button.dataset.tab === id));
        body.innerHTML = "";
        sheet.setFooter("");
        tab.render(body, sheet);
        enhanceDateFields(body);
      }
    };

    overlay.querySelectorAll(".sheetTabs .tab").forEach(button => {
      button.onclick = () => sheet.select(button.dataset.tab);
    });

    $("modalRoot").appendChild(overlay);
    sheet.select(tabs[0].id);
  });
}
