const FARM_TIME_ZONE = "America/Campo_Grande";

function farmParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FARM_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = part.value;
  if (out.hour === "24") out.hour = "00";
  return out;
}

function farmDateISO(value = new Date()) {
  const parts = farmParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function farmNowLocal(value = new Date()) {
  const parts = farmParts(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function setAutomaticDateTime(field, value = new Date()) {
  if (!field) return "";
  field.dataset.automaticDateTime = "1";
  field.value = farmNowLocal(value);
  return field.value;
}

function markDateTimeAsManual(field) {
  if (field) field.dataset.automaticDateTime = "0";
}

function refreshAutomaticDateTime(field, value = new Date()) {
  if (!field) return "";
  return field.dataset.automaticDateTime === "0"
    ? field.value
    : setAutomaticDateTime(field, value);
}

function farmDateBR(iso) {
  const [year, month, day] = String(iso || "").split("-");
  return year ? `${day}/${month}/${year}` : "";
}

function farmDateTimeBR(value) {
  if (!value) return "";
  const parts = farmParts(value);
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

function farmNowAsLocalDate(value = new Date()) {
  const parts = farmParts(value);
  return new Date(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
}

function farmOffsetMs(date) {
  const parts = farmParts(date);
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function farmLocalToDate(text) {
  const match = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute] = match;
  const guess = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour || 0), Number(minute || 0));
  return new Date(guess - farmOffsetMs(new Date(guess)));
}

function farmDayBounds(iso) {
  const start = farmLocalToDate(`${iso}T00:00`);
  const nextDay = new Date(start.getTime() + 36 * 60 * 60 * 1000);
  const end = new Date(farmLocalToDate(`${farmDateISO(nextDay)}T00:00`).getTime() - 1);
  return { start, end };
}
