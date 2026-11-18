export type EditorItem = {
  field: {
    id: string;
    version?: number;
    label: string;
    governed: boolean;
    schema: { type: string; required: boolean; options?: string[] };
  };
  version: number;
  schemaVersion?: number;
  status: string;
  value: unknown;
};
export function editorIdentity(
  organizationId: string,
  entityId: string,
  item: EditorItem,
) {
  return JSON.stringify([
    organizationId,
    entityId,
    item.field.id,
    item.version,
    item.schemaVersion,
    item.field.version,
  ]);
}
export function initialMulti(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}
export function toggleOption(
  selected: readonly string[],
  option: string,
  checked: boolean,
): string[] {
  return checked
    ? selected.includes(option)
      ? [...selected]
      : [...selected, option]
    : selected.filter((value) => value !== option);
}
export function multiPayload(
  selected: readonly string[],
  unknown: boolean,
  required: boolean,
): string[] | null {
  if (required && (unknown || selected.length === 0))
    throw Error("Selecione ao menos uma opção.");
  return unknown ? null : [...selected];
}
