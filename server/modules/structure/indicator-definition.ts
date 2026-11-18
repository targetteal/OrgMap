import { fail, optionalText, text } from "../../src/core.js";
export function indicatorDefinition(value: Record<string, any>) {
  if (
    !["METRIC", "CHECKLIST"].includes(value.kind) ||
    !["NUMBER", "BOOLEAN", "TEXT"].includes(value.valueType) ||
    (value.kind === "CHECKLIST" && value.valueType !== "BOOLEAN") ||
    !Array.isArray(value.requiredUnits) ||
    value.requiredUnits.length > 100
  )
    fail(400, "INVALID_REQUEST");
  const requiredUnits = value.requiredUnits.map((v: unknown) => text(v, 100));
  if (new Set(requiredUnits).size !== requiredUnits.length)
    fail(400, "INVALID_REQUEST");
  return {
    name: text(value.name),
    kind: value.kind as "METRIC" | "CHECKLIST",
    valueType: value.valueType as "NUMBER" | "BOOLEAN" | "TEXT",
    unit: optionalText(value.unit, 100),
    requiredUnits,
  };
}
