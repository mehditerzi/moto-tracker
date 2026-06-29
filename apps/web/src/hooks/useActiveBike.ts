import { useCallback, useState } from "react";

/**
 * The currently selected ("active") vehicle on the dashboard. Persisted to
 * localStorage so the selection survives the capture → review → back navigation
 * round-trip (the dashboard unmounts during it) and app restarts — without this
 * the OCR button would silently fall back to the first bike on return.
 */
const KEY = "mototracker.activeBikeId";

export function getActiveBikeId(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    // Private mode / disabled storage — fall back to ephemeral selection.
    return undefined;
  }
}

export function storeActiveBikeId(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function useActiveBikeId() {
  const [activeBikeId, setState] = useState<string | undefined>(getActiveBikeId);
  const setActiveBikeId = useCallback((id: string | undefined) => {
    setState(id);
    storeActiveBikeId(id);
  }, []);
  return [activeBikeId, setActiveBikeId] as const;
}
