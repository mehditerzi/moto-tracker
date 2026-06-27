import { api } from "@/lib/api";

export type VehicleType = "motorcycle" | "car";

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Search vehicle makes for the combobox. Returns canonical make names. */
export function fetchMakes(query: string, type?: VehicleType): Promise<string[]> {
  return api<string[]>(`/api/catalog/makes${qs({ q: query, type })}`);
}

/** Search models for a given make. Empty make → empty list. */
export function fetchModels(make: string, query: string, type?: VehicleType): Promise<string[]> {
  if (!make.trim()) return Promise.resolve([]);
  return api<string[]>(`/api/catalog/models${qs({ make, q: query, type })}`);
}
