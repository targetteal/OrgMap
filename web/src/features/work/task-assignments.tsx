import type { FeatureContext } from "../../feature-contract";
import { useLocalization } from "../../localization";
import { workTranslator } from "./messages";
import { roleChoiceLabel } from "../../role-choice-label";
// Browser read model only; RoleCapacityPort and its provenance stay server-only.
type TaskPrincipal =
  { kind: "MEMBER"; memberId: string } | { kind: "ROLE"; roleId: string };
export type TaskAssignmentView = {
  principals?: TaskPrincipal[];
  resolvedAssignees?: {
    memberId: string;
    reasons?: { kind: "DIRECT" | "ROLE_CAPACITY"; roleId?: string }[];
  }[];
  roleCapacities?: (
    | { roleId: string; state: "UNAVAILABLE" }
    | {
        roleId: string;
        state: "VACANT" | "OCCUPIED";
        eligibleCount: number;
        occupantCount: number;
      }
  )[];
  assignments?: { memberId: string }[];
  assigneeIds?: string[];
};
function principalsOf(value: TaskAssignmentView): TaskPrincipal[] {
  return (
    value.principals ??
    (
      value.assignments?.map((item) => item.memberId) ??
      value.assigneeIds ??
      []
    ).map((memberId) => ({ kind: "MEMBER", memberId }))
  );
}
export function taskAssignedToMember(
  value: TaskAssignmentView,
  memberId: string,
) {
  return value.resolvedAssignees
    ? value.resolvedAssignees.some((person) => person.memberId === memberId)
    : principalsOf(value).some(
        (principal) =>
          principal.kind === "MEMBER" && principal.memberId === memberId,
      );
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase();
}
function PersonChip({ name, compact }: { name: string; compact: boolean }) {
  const short = compact ? name.split(/\s+/).filter(Boolean)[0] ?? name : name;
  return (
    <span className="work-person-chip" title={name}>
      <span className="work-person-avatar" aria-hidden="true">{initials(name)}</span>
      <span>{short}</span>
      {short !== name && <span className="work-sr-only">{name.slice(short.length)}</span>}
    </span>
  );
}
export function TaskAssigneesView({
  context: c,
  value,
  guest = false,
  compact = false,
}: {
  context: FeatureContext;
  value: TaskAssignmentView;
  guest?: boolean;
  /** Dense rows keep role, circle and people; capacity stays available to assistive technology. */
  compact?: boolean;
}) {
  const { locale, formatNumber } = useLocalization(),
    text = workTranslator(locale);
  if (guest) return <span className="mare-empty-value">{text("Identidades não compartilhadas")}</span>;
  const principals = principalsOf(value);
  if (!principals.length) return <span className="mare-empty-value">{text("Sem responsável")}</span>;
  const name = (memberId: string) =>
    c.members.find((member) => member.id === memberId)?.displayName ??
    text("Membro");
  const people = value.resolvedAssignees ?? [];
  return (
    <ul className={"work-assignee-principals" + (compact ? " is-compact" : "")}>
      {principals.map((principal) =>
        principal.kind === "MEMBER" ? (
          <li key={"MEMBER:" + principal.memberId} className="work-assignee-member">
            <PersonChip name={name(principal.memberId)} compact={compact} />
          </li>
        ) : (
          <li key={"ROLE:" + principal.roleId} className="work-assignee-role">
            <strong>
              {(() => { const role = c.structure.nodes.find(
                (node) =>
                  node.kind === "ROLE" && node.entityId === principal.roleId,
              ); return role ? roleChoiceLabel(role, c.structure.nodes, text("Círculo não compartilhado")) : text("Papel indisponível"); })()}
            </strong>
            {(() => {
              const capacity = value.roleCapacities?.find(
                (item) => item.roleId === principal.roleId,
              );
              const occupied = !!capacity && capacity.state === "OCCUPIED";
              const label = !capacity || capacity.state === "UNAVAILABLE"
                ? text("Capacidade indisponível")
                : capacity.state === "VACANT"
                  ? text("Sem ocupantes atuais")
                  : text(
                      new Intl.PluralRules(locale).select(capacity.eligibleCount) === "one"
                        ? "{count} pessoa com acesso à tarefa"
                        : "{count} pessoas com acesso à tarefa",
                      { count: formatNumber(capacity.eligibleCount) },
                    );
              return <small className={compact && occupied && people.length ? "work-sr-only" : undefined}>{label}</small>;
            })()}
          </li>
        ),
      )}
      {people.length && principals.some((principal) => principal.kind === "ROLE") ? (
        <li className="work-assignee-people">
          <span className="work-sr-only">{text("Pessoas atuais")}: </span>
          {people.map((person) => (
            <PersonChip key={person.memberId} name={name(person.memberId)} compact={compact} />
          ))}
        </li>
      ) : null}
    </ul>
  );
}
export function TaskAssignmentsEditor({
  context: c,
  value,
  roleEnabled,
  pending,
  onSave,
}: {
  context: FeatureContext;
  value: TaskAssignmentView;
  roleEnabled: boolean;
  pending: boolean;
  onSave: (principals: TaskPrincipal[]) => Promise<unknown>;
}) {
  const { locale } = useLocalization(),
    text = workTranslator(locale),
    principals = principalsOf(value),
    roles = c.structure.nodes.filter((node) => node.kind === "ROLE"),
    unavailable =
      principals.some((principal) => principal.kind === "ROLE") && !roleEnabled;
  return (
    <form
      className="work-inline"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        await onSave(
          form.getAll("principals").map((raw) => {
            const [kind, identifier] = String(raw).split(":");
            return kind === "ROLE"
              ? { kind: "ROLE" as const, roleId: identifier }
              : { kind: "MEMBER" as const, memberId: identifier };
          }),
        );
      }}
    >
      <fieldset disabled={pending || unavailable}>
        <label className="field">
          {text("Atribuir responsáveis")}
          <select
            name="principals"
            multiple
            defaultValue={principals.map((principal) =>
              principal.kind === "MEMBER"
                ? "MEMBER:" + principal.memberId
                : "ROLE:" + principal.roleId,
            )}
          >
            <optgroup label={text("Pessoas")}>
              {c.members
                .filter(
                  (member) =>
                    member.status === "ACTIVE" && member.memberType !== "GUEST",
                )
                .map((member) => (
                  <option key={member.id} value={"MEMBER:" + member.id}>
                    {member.displayName}
                  </option>
                ))}
            </optgroup>
            {roleEnabled && (
              <optgroup label={text("Papéis")}>
                {roles.map((role) => (
                  <option key={role.entityId} value={"ROLE:" + role.entityId}>
                    {roleChoiceLabel(role, c.structure.nodes, text("Círculo não compartilhado"))}
                  </option>
                ))}
                {principals.flatMap((principal) =>
                  principal.kind === "ROLE" &&
                  !roles.some((role) => role.entityId === principal.roleId)
                    ? [
                        <option
                          key={principal.roleId}
                          value={"ROLE:" + principal.roleId}
                        >
                          {text("Papel indisponível")}
                        </option>,
                      ]
                    : [],
                )}
              </optgroup>
            )}
          </select>
        </label>
        <p className="muted">
          {text(
            "Atribuir um papel não concede acesso à tarefa. Sua capacidade acompanha os ocupantes atuais.",
          )}
        </p>
        <button type="submit">{text("Salvar responsáveis")}</button>
      </fieldset>
      {unavailable && <p role="status">{text("Capacidade indisponível")}</p>}
    </form>
  );
}
