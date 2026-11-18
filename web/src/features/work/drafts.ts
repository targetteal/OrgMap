/** Best-effort device drafts. A storage failure never interferes with editing or saving. */
export function readDraft(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeDraft(key: string, value: string) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function clearDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* The confirmed server write remains authoritative. */ }
}
