export type AccountTheme = "system" | "light" | "dark";

export function resolveAccountTheme(value: string, systemDark: boolean): "light" | "dark" {
  return value === "dark" || (value === "system" && systemDark) ? "dark" : "light";
}

/** Apply only the signed-in account's surface mode; organization hue stays scoped to its shell. */
export function applyAccountTheme(value: string, root: HTMLElement = document.documentElement): () => void {
  const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const update = () => { root.dataset.accountTheme = resolveAccountTheme(value, media?.matches ?? false); };
  update();
  if (value === "system") media?.addEventListener("change", update);
  return () => {
    if (value === "system") media?.removeEventListener("change", update);
    delete root.dataset.accountTheme;
  };
}
