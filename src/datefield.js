const DATE_FIELD_MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];
const DATE_FIELD_WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseFieldValue(value, withTime) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), withTime ? Number(hour || 0) : 0, withTime ? Number(minute || 0) : 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fieldValueFrom(date, withTime) {
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return withTime ? `${day}T${pad2(date.getHours())}:${pad2(date.getMinutes())}` : day;
}

function formatFieldLabel(date, withTime) {
  const day = `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
  const weekday = DATE_FIELD_WEEKDAYS[date.getDay()];
  return withTime ? `${weekday}, ${day} às ${pad2(date.getHours())}:${pad2(date.getMinutes())}` : `${weekday}, ${day}`;
}

function sameDay(a, b) {
  return !!a && !!b
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function monthGridHtml(view, selected) {
  const firstWeekday = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = farmNowAsLocalDate();
  const cells = [];
  for (let blank = 0; blank < firstWeekday; blank += 1) cells.push('<span class="dpDay blank"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(view.getFullYear(), view.getMonth(), day);
    const classes = ["dpDay"];
    if (sameDay(date, selected)) classes.push("on");
    if (sameDay(date, today)) classes.push("today");
    cells.push(`<button type="button" class="${classes.join(" ")}" data-day="${day}">${day}</button>`);
  }
  return cells.join("");
}

function timeOptionsHtml(total, chosen) {
  return Array.from({ length: total }, (unused, value) =>
    `<option value="${value}" ${value === chosen ? "selected" : ""}>${pad2(value)}</option>`).join("");
}

function showDateTimePicker({ value, withTime, title = "", clearable = false }) {
  const start = parseFieldValue(value, withTime) || farmNowAsLocalDate();
  if (!withTime) start.setHours(0, 0, 0, 0);
  let selected = start;
  let view = new Date(selected.getFullYear(), selected.getMonth(), 1);

  return _openModal(
    `<div class="dpCard">
      ${title ? `<div class="dpTitle">${esc(title)}</div>` : ""}
      <div class="dpHead">
        <button type="button" class="dpNav" data-act="prev" aria-label="Mês anterior">${icon("chevronLeft")}</button>
        <b data-act="month"></b>
        <button type="button" class="dpNav" data-act="next" aria-label="Próximo mês">${icon("chevronRight")}</button>
      </div>
      <div class="dpWeek">${DATE_FIELD_WEEKDAYS.map(day => `<span>${esc(day[0].toUpperCase())}</span>`).join("")}</div>
      <div class="dpGrid" data-act="grid"></div>
      ${withTime ? `<div class="dpTime">
        <label>Horário</label>
        <div class="dpTimeRow">
          <select data-act="hour" aria-label="Hora">${timeOptionsHtml(24, selected.getHours())}</select>
          <span class="dpTimeSep">:</span>
          <select data-act="minute" aria-label="Minuto">${timeOptionsHtml(60, selected.getMinutes())}</select>
        </div>
      </div>` : ""}
      <div class="dpQuick">
        <button type="button" class="btn alt smallbtn" data-act="now">${withTime ? "Agora" : "Hoje"}</button>
        ${clearable ? '<button type="button" class="btn alt smallbtn" data-act="clear">Limpar</button>' : ""}
      </div>
      <div class="modalActions">
        <button type="button" class="btn alt" data-act="cancel">Cancelar</button>
        <button type="button" class="btn" data-act="confirm">Confirmar</button>
      </div>
    </div>`,
    {
      onMount: (overlay, close) => {
        const grid = overlay.querySelector('[data-act="grid"]');
        const monthLabel = overlay.querySelector('[data-act="month"]');
        const hourSelect = overlay.querySelector('[data-act="hour"]');
        const minuteSelect = overlay.querySelector('[data-act="minute"]');

        const draw = () => {
          monthLabel.textContent = `${DATE_FIELD_MONTHS[view.getMonth()]} ${view.getFullYear()}`;
          grid.innerHTML = monthGridHtml(view, selected);
          grid.querySelectorAll("[data-day]").forEach(button => {
            button.onclick = () => {
              selected = new Date(view.getFullYear(), view.getMonth(), Number(button.dataset.day), selected.getHours(), selected.getMinutes());
              draw();
            };
          });
        };

        const shiftMonth = step => {
          view = new Date(view.getFullYear(), view.getMonth() + step, 1);
          draw();
        };

        overlay.querySelector('[data-act="prev"]').onclick = () => shiftMonth(-1);
        overlay.querySelector('[data-act="next"]').onclick = () => shiftMonth(1);
        if (hourSelect) hourSelect.onchange = () => { selected.setHours(Number(hourSelect.value)); };
        if (minuteSelect) minuteSelect.onchange = () => { selected.setMinutes(Number(minuteSelect.value)); };

        overlay.querySelector('[data-act="now"]').onclick = () => {
          const now = farmNowAsLocalDate();
          if (!withTime) now.setHours(0, 0, 0, 0);
          selected = now;
          view = new Date(now.getFullYear(), now.getMonth(), 1);
          if (hourSelect) hourSelect.value = String(now.getHours());
          if (minuteSelect) minuteSelect.value = String(now.getMinutes());
          draw();
        };

        const clearButton = overlay.querySelector('[data-act="clear"]');
        if (clearButton) clearButton.onclick = () => close("");
        overlay.querySelector('[data-act="cancel"]').onclick = () => close(null);
        overlay.querySelector('[data-act="confirm"]').onclick = () => close(fieldValueFrom(selected, withTime));

        draw();
      }
    }
  );
}

function dateFieldLabel(input) {
  const holder = input.closest("div");
  const label = holder ? holder.querySelector("label") : null;
  return label ? label.textContent.trim() : "";
}

function watchFieldValue(input, onChange) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
  Object.defineProperty(input, "value", {
    configurable: true,
    get() {
      return descriptor.get.call(this);
    },
    set(next) {
      descriptor.set.call(this, next);
      onChange();
    }
  });
}

function enhanceDateFields(root) {
  const scope = root || document;
  scope.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach(input => {
    if (input.dataset.dateField === "1") return;
    input.dataset.dateField = "1";
    if (!input.id) input.id = `dateField${Math.random().toString(36).slice(2, 9)}`;

    const withTime = input.type === "datetime-local";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dateFieldBtn";
    trigger.dataset.do = "dateField";
    trigger.dataset.arg = input.id;

    const refresh = () => {
      const parsed = parseFieldValue(input.value, withTime);
      trigger.innerHTML = `<span class="dateFieldIcon">${icon("calendar")}</span>
        <span class="dateFieldText${parsed ? "" : " empty"}">${esc(parsed ? formatFieldLabel(parsed, withTime) : withTime ? "Escolher data e hora" : "Escolher data")}</span>`;
    };

    input.classList.add("dateFieldNative");
    input.parentNode.insertBefore(trigger, input);
    watchFieldValue(input, refresh);
    input.addEventListener("change", refresh);
    refresh();
  });
}

async function openDateField(id) {
  const input = document.getElementById(id);
  if (!input) return;
  const withTime = input.type === "datetime-local";
  const chosen = await showDateTimePicker({
    value: input.value,
    withTime,
    title: dateFieldLabel(input),
    clearable: input.dataset.clearable === "1"
  });
  if (chosen === null || chosen === undefined) return;
  input.value = chosen;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
