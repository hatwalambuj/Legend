/**
 * Degrade gracefully while a data source is unfinished or down: log and return a fallback instead of
 * failing the whole page (pages still render the parts that work).
 */
export async function safe<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error(`[page] ${label} failed; rendering fallback`, e);
    return fallback;
  }
}
