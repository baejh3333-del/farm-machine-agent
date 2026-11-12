import { SPEC_BY_ID } from "./machine-specifications.js";

export const GARAGE_KEY = "moa-owned-machines-v1";

// A malformed or unavailable store reads as an empty garage.
export function readGarage(storage) {
  let owned = [], selectedId = "";
  try {
    const saved = JSON.parse(storage.getItem(GARAGE_KEY) || "{}");
    const ids = new Set();
    owned = (Array.isArray(saved.owned) ? saved.owned : []).filter((item) => {
      if (!item || typeof item.id !== "string" || ids.has(item.id) || SPEC_BY_ID[item.modelId]?.role !== "powerUnit" || typeof item.name !== "string") return false;
      ids.add(item.id); return true;
    }).map((item) => ({ id: item.id, modelId: item.modelId, name: item.name.slice(0, 40) }));
    selectedId = owned.some((item) => item.id === saved.selectedId) ? saved.selectedId : owned[0]?.id || "";
  } catch { /* fall through to the empty garage */ }
  return { owned, selectedId };
}

export async function updateGarage(storage, change, locks = navigator.locks) {
  return locks.request(GARAGE_KEY, () => {
    const next = change(readGarage(storage));
    if (!next.owned.some((item) => item.id === next.selectedId)) next.selectedId = next.owned[0]?.id || "";
    storage.setItem(GARAGE_KEY, JSON.stringify(next));
    return next;
  });
}
