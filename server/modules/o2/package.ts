import { createHash } from "node:crypto";
import { fail, optionalText, text } from "../../src/core.js";
import { functionCodes, type RoleFunction } from "./contract.js";

// Adapted definitions, traced to the reference; not application permission names.
export const definitions: Record<
  RoleFunction,
  {
    name: string;
    purpose: string;
    responsibilities: string[];
    artifacts: string[];
  }
> = {
  GUIDE: {
    name: "Guia",
    purpose: "Expressar o propósito do círculo",
    responsibilities: [
      "Organizar o círculo para realizar seu propósito e compromissos com o círculo externo.",
      "Convidar pessoas para os papéis, acompanhar sua adequação e retirar energizações quando necessário.",
      "Orientar as prioridades do círculo.",
    ],
    artifacts: ["Processo de energização dos papéis definidos no círculo."],
  },
  REPRESENTATIVE: {
    name: "Representante",
    purpose: "Expressar o propósito do círculo",
    responsibilities: [
      "Compreender as tensões dos integrantes e levá-las ao círculo externo quando apropriado.",
      "Dar visibilidade à saúde do círculo no círculo externo.",
    ],
    artifacts: [],
  },
  FACILITATOR: {
    name: "Facilitador",
    purpose: "Promover encontros saudáveis e coerentes com os meta-acordos",
    responsibilities: ["Conduzir a facilitação das reuniões do círculo."],
    artifacts: [],
  },
  SCRIBE: {
    name: "Escriba",
    purpose: "Dar clareza aos meta-acordos e à estrutura do círculo",
    responsibilities: [
      "Organizar o agendamento regular dos encontros.",
      "Documentar tensões, propostas, objeções e resultados quando solicitado.",
      "Esclarecer a interpretação dos meta-acordos e da estrutura mediante solicitação.",
    ],
    artifacts: [
      "Registros da estrutura do círculo.",
      "Interpretação final dos meta-acordos e da estrutura quando houver conflito.",
    ],
  },
};
export type EssentialDefinition = { purpose: string; responsibilities: string[]; artifacts: string[] };
export type EssentialDefinitions = Record<RoleFunction, EssentialDefinition>;
export type EssentialDefinitionOverrides = Partial<Record<RoleFunction, Partial<EssentialDefinition>>>;
export const essentialDefinitionDefaults = Object.fromEntries(functionCodes.map(code => {
  const { purpose, responsibilities, artifacts } = definitions[code];
  return [code, { purpose, responsibilities: [...responsibilities], artifacts: [...artifacts] }];
})) as EssentialDefinitions;
function validateEssentialDefinitions(value: unknown): EssentialDefinitionOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !functionCodes.includes(k as RoleFunction))) fail(422,"INVALID_ESSENTIAL_DEFINITION");
  const result: EssentialDefinitionOverrides = {};
  for (const [code, raw] of Object.entries(value as Record<RoleFunction,unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["purpose","responsibilities","artifacts"].includes(k))) fail(422,"INVALID_ESSENTIAL_DEFINITION");
    const input=raw as Record<string,unknown>, definition:Partial<EssentialDefinition>={}, baseline=essentialDefinitionDefaults[code as RoleFunction];
    if (input.purpose !== undefined) {
      if (typeof input.purpose !== "string") fail(422,"INVALID_ESSENTIAL_DEFINITION");
      const purpose=optionalText(input.purpose,10000).normalize("NFC");
      if (purpose!==baseline.purpose) definition.purpose=purpose;
    }
    for(const key of ["responsibilities","artifacts"] as const) if(input[key]!==undefined) {
      const rawItems=input[key];
      if(!Array.isArray(rawItems)||rawItems.length>100)fail(422,"INVALID_ESSENTIAL_DEFINITION");
      const items=(rawItems as unknown[]).map(raw=>{
        const item=text(raw,1000).normalize("NFC");
        if(/[\p{Cc}]/u.test(item))fail(422,"INVALID_ESSENTIAL_DEFINITION");
        return item;
      });
      if(items.join("\n").length>10000)fail(422,"INVALID_ESSENTIAL_DEFINITION");
      if(JSON.stringify(items)!==JSON.stringify(baseline[key]))definition[key]=items;
    }
    if(Object.keys(definition).length)result[code as RoleFunction]=definition;
  }
  return result;
}
export const defaultRules = {
  membership: "OCCUPANCY" as "OCCUPANCY" | "LEGACY",
  assignment: "GUIDE" as "GUIDE" | "LEGACY",
  guideSelection: "PARENT_GUIDE" as "PARENT_GUIDE" | "LEGACY",
  structureChanges: "GOVERNANCE" as "GOVERNANCE" | "LEGACY",
  essentialFunctions: [...functionCodes] as RoleFunction[],
  electedFunctions: [
    "REPRESENTATIVE",
    "FACILITATOR",
    "SCRIBE",
  ] as RoleFunction[],
  protectEssentials: true,
  enforceEligibility: true,
  essentialDefinitions: structuredClone(essentialDefinitionDefaults),
};
export type ModelRules = typeof defaultRules;
export type ModelOverrides = Partial<Omit<ModelRules,"essentialDefinitions">> & { essentialDefinitions?: EssentialDefinitionOverrides };
export const o2GovernanceDefaults = {
  decisionProcess: "HOLACRACY_O2" as const,
  method: "MANUAL_FACILITATED" as const,
};
export const o2Package = {
  id: "targetteal.o2",
  name: "Organização Orgânica (O2)",
  version: "0.1.0",
  contractVersion: 1,
  reference: {
    url: "https://o2.targetteal.com/meta-acordos",
    revision: "consultada-2026-11-01",
    accessedAt: "2026-11-01",
    definitionsDigest: createHash("sha256")
      .update(JSON.stringify(definitions))
      .digest("hex"),
  },
  capabilities: [
    "structure.definition",
    "structure.occupancies",
    "governance.proposals",
    "governance.elections",
    "meetings",
  ],
  coverage: "PACKAGE_ONBOARDING_AND_ENERGIZATIONS",
};
export function resolveRules(value: unknown): {
  overrides: ModelOverrides;
  rules: ModelRules;
} {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(400, "INVALID_MODEL_CONFIGURATION");
  const overrides: ModelOverrides = structuredClone(value as ModelOverrides);
  if (Object.keys(overrides).some((k) => !Object.hasOwn(defaultRules, k)))
    fail(422, "UNSUPPORTED_MODEL_RULE");
  for (const [key, options] of [
    ["membership", ["OCCUPANCY", "LEGACY"]],
    ["assignment", ["GUIDE", "LEGACY"]],
    ["guideSelection", ["PARENT_GUIDE", "LEGACY"]],
    ["structureChanges", ["GOVERNANCE", "LEGACY"]],
  ] as const)
    if (
      overrides[key] !== undefined &&
      !options.includes(overrides[key] as never)
    )
      fail(422, "INVALID_MODEL_RULE");
  for (const key of ["protectEssentials", "enforceEligibility"] as const)
    if (overrides[key] !== undefined && typeof overrides[key] !== "boolean")
      fail(422, "INVALID_MODEL_RULE");
  for (const key of ["essentialFunctions", "electedFunctions"] as const)
    if (
      overrides[key] !== undefined &&
      (!Array.isArray(overrides[key]) ||
        new Set(overrides[key]).size !== overrides[key]!.length ||
        overrides[key]!.some((v) => !functionCodes.includes(v)))
    )
      fail(422, "INVALID_MODEL_RULE");
  const definitionOverrides=overrides.essentialDefinitions === undefined ? {} : validateEssentialDefinitions(overrides.essentialDefinitions);
  if(Object.keys(definitionOverrides).length)overrides.essentialDefinitions=definitionOverrides;
  else delete overrides.essentialDefinitions;
  const effectiveDefinitions=Object.fromEntries(functionCodes.map(code=>[code,{...essentialDefinitionDefaults[code],...definitionOverrides[code]}])) as EssentialDefinitions;
  const rules = structuredClone({ ...defaultRules, ...overrides, essentialDefinitions:effectiveDefinitions });
  if (rules.electedFunctions.some((f) => !rules.essentialFunctions.includes(f)))
    fail(422, "INVALID_MODEL_RULE");
  return { overrides: structuredClone(overrides), rules };
}
