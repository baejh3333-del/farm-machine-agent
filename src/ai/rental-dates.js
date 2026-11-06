// Interpret dates relative to the day the customer submits their rental request.
const DATE_PATTERN = /(?<![\d])(?:(\d{4})\s*(?:[-./]|년\s*)\s*)?(\d{1,2})\s*(?:[-./]|월\s*|\s+)\s*(\d{1,2})(?:일)?(?![\d])/g;

function formatDate(year, month, day) {
  const value = new Date(0);
  value.setFullYear(year, month - 1, day);
  value.setHours(0, 0, 0, 0);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function readRentalDates(message, today = new Date()) {
  const matches = [...message.matchAll(DATE_PATTERN)];
  if (!matches.length) return [];
  const baseYear = today.getFullYear();
  const baseDate = formatDate(baseYear, today.getMonth() + 1, today.getDate());
  let previous = "";
  return matches.map(([, explicitYear, rawMonth, rawDay], index) => {
    const month = Number(rawMonth);
    const day = Number(rawDay);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    if (explicitYear) {
      const date = formatDate(Number(explicitYear), month, day);
      if (date) previous = date;
      return date;
    }
    let year = index === 0 ? baseYear : Number(previous.slice(0, 4)) || baseYear;
    let date = formatDate(year, month, day);
    if (!date) return "";
    const minimum = index === 0 ? baseDate : previous;
    if (date < minimum) {
      year += 1;
      date = formatDate(year, month, day);
    }
    if (date) previous = date;
    return date;
  });
}
