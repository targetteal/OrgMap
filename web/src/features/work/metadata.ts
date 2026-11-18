import type { FeatureDefinition } from "../../feature-contract";

export const workMetadata = {
  id: "work",
  module: "projects",
  label: "Projetos",
  matches: (path: string) => /^\/projects(?:\/|\?|$)/.test(path),
} satisfies Pick<FeatureDefinition, "id" | "module" | "label" | "matches">;
