/** Whole pesos, deterministic across Node/ICU versions. */
export function formatPeso(pesos: number): string {
  return `₱${Math.round(pesos).toLocaleString('en-US')}`;
}
