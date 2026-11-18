import { fail } from "../../src/core.js";

export const organizationColorThemes = ["mare", "cobalto", "argila", "grafite"] as const;
export type OrganizationColorTheme = (typeof organizationColorThemes)[number];
export function colorTheme(value: unknown): OrganizationColorTheme {
  if (value === undefined) return "mare";
  if (!organizationColorThemes.includes(value as OrganizationColorTheme)) fail(422, "INVALID_COLOR_THEME");
  return value as OrganizationColorTheme;
}
/** An older client preserves the palette. Administrative delegation does not
 * grant authority to change this organization-owner setting. */
export function authorizeColorTheme(inputBranding: Record<string, unknown>, previousBranding: Record<string, unknown> | undefined, owner: boolean) {
  const previous = colorTheme(previousBranding?.colorTheme);
  const next = Object.hasOwn(inputBranding, "colorTheme") ? colorTheme(inputBranding.colorTheme) : previous;
  if (next !== previous && !owner) fail(403, "ORGANIZATION_OWNER_REQUIRED");
  return next;
}
