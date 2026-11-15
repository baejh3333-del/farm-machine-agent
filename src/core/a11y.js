const FONT_SCALE_KEY = "moa-font-scale-v1";
const ALLOWED_SCALES = [1, 1.25, 1.5];

export function getFontScale() {
  try {
    const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
    return ALLOWED_SCALES.includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

export function setFontScale(scale) {
  const next = ALLOWED_SCALES.includes(Number(scale)) ? Number(scale) : 1;
  document.documentElement.style.setProperty("--font-scale", String(next));
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function initFontScale() {
  return setFontScale(getFontScale());
}
