import { fail } from "../../src/core.js";
import type { Ctx } from "../../src/runtime.js";
import { validFieldValue, type FieldDefinition } from "./project-content.js";
export type CustomFieldValues = Record<string, string | number | null>;
/** Defined IDs have strict types; existing human-named metadata remains textual. */
export function customFields(value: unknown, definitions: FieldDefinition[] = []): CustomFieldValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400,"INVALID_CUSTOM_FIELDS");
  const entries=Object.entries(value as Record<string,unknown>);
  if (entries.length>20) fail(400,"INVALID_CUSTOM_FIELDS");
  const result:CustomFieldValues=Object.create(null);
  for (const [key,value] of entries) {
    const name=key.trim().normalize("NFC");
    const field=definitions.find(f=>f.id===name.toLowerCase());
    if (!name || name.length>80 || /[\p{Cc}:]/u.test(name) || Object.hasOwn(result,name)) fail(400,"INVALID_CUSTOM_FIELDS");
    if (field ? !validFieldValue(field,value) : typeof value!=="string" || /[\r\n]/.test(value as string) || (value as string).length>1000) fail(400,"INVALID_CUSTOM_FIELDS");
    const canonical=field?.id ?? name;
    if(Object.hasOwn(result,canonical)) fail(400,"INVALID_CUSTOM_FIELDS");
    result[canonical]=value as string | number | null;
  }
  return result;
}
export async function collectionFieldDefinitions(ctx: Ctx): Promise<FieldDefinition[]> {
  return (await ctx.c.query("SELECT custom_field_definitions FROM work_settings WHERE organization_id=$1", [ctx.org.id])).rows[0]?.custom_field_definitions ?? [];
}
export async function collectionCustomFields(ctx: Ctx, value: unknown): Promise<CustomFieldValues> {
  return customFields(value, await collectionFieldDefinitions(ctx));
}
