import type { Bootstrap } from "./api";

/** Display vocabulary never changes entity kinds, function identity or grants. */
export function governanceVocabulary(bootstrap?: Bootstrap | null) {
  const source = bootstrap?.organization.vocabulary;
  const value = (key: "circle" | "role" | "member", fallback: string) =>
    typeof source?.[key] === "string" && source[key]!.trim()
      ? source[key]!.trim()
      : fallback;
  const circle = value("circle", "Círculo"),
    role = value("role", "Papel"),
    member = value("member", "Membro");
  return {
    circle,
    role,
    member,
    members: member === "Membro" ? "Membros" : member,
    circles: circle === "Círculo" ? "Círculos" : circle,
    roles: role === "Papel" ? "Papéis" : role,
    structure:
      circle === "Círculo" && role === "Papel"
        ? "Círculos e papéis"
        : `${circle} / ${role}`,
    pack:
      circle === "Círculo" && role === "Papel"
        ? "Círculos & papéis"
        : `${circle} / ${role}`,
    directory:
      circle === "Círculo" && role === "Papel"
        ? "Círculos e Papéis"
        : `${circle} / ${role}`,
    agreements: bootstrap?.governanceModel ? "Restrições" : "Políticas",
    agreement: bootstrap?.governanceModel ? "Restrição" : "Política",
    searchLabel: `Pesquisar estrutura e ${member === "Membro" ? "membros" : member}`,
    searchPlaceholder: `Pesquisar ${role === "Papel" ? "papéis" : role}, ${circle === "Círculo" ? "círculos" : circle}, ${member === "Membro" ? "membros" : member}…`,
    entity: (kind: string) => (kind === "CIRCLE" ? circle : role),
  };
}
