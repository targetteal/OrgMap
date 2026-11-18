import type { FeatureDefinition } from "../../feature-contract";

export const governanceMetadata = {
  id: "governance",
  module: "structure",
  label: "Governança",
  matches: (path: string) => /^\/(?:app\/)?structure\/(?:proposals|working-agreements|tensions|branches|governance-policy)(?:\/|$|\?)/.test(path),
  collapseSidebar: (path: string) => /^\/structure\/(proposals|working-agreements)\/[^/?]+/.test(path),
  navigation: [
    { path: "/structure/proposals", label: "Propostas", location: "sidebar" },
    { path: "/structure/working-agreements", label: "Restrições", location: "sidebar" },
    { path: "/structure/tensions", label: "Tensões", location: "sidebar" },
    { path: "/structure/branches", label: "Rascunhos de estrutura", location: "sidebar", visible: (c: import("../../feature-contract").FeatureContext) => c.bootstrap.membership.memberType !== "GUEST" },
    { path: "/structure/governance-policy", label: "Processo de governança", location: "sidebar", visible: (c: import("../../feature-contract").FeatureContext) => c.bootstrap.membership.memberType !== "GUEST" },
  ],
} satisfies Pick<FeatureDefinition, "id" | "module" | "label" | "matches" | "collapseSidebar" | "navigation">;
