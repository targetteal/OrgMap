import { useState } from "react";
import type { RichDocument } from "../../../../packages/content";
import type { FeatureContext } from "../../feature-contract";
import { RichTextView } from "../../editor";
import { Dialog, Field, Notice } from "../../ui";
import { DefinitionsDiff, definitionItems, definitionItemText, DiffText, diffText, plain } from "../../text-diff";
import { useMeetingsLocalization } from "./use-localization";

type ProposalDocument = {
  documentId: string;
  title: string;
  proposedContent?: string | null;
  proposedRich?: RichDocument | null;
  publishedContent?: string | null;
  publishedRich?: RichDocument | null;
};
export type ProposalOutcomeDetail = {
  payload?: any;
  state?: string;
  version?: number;
  authorId?: string;
  originTension?: { id: string; title: string; state: string; version: number; authorId: string } | null;
  entityReferences?: { entityId: string; name: string; kind: string; archived: boolean }[];
  documents?: ProposalDocument[];
};
const VERB: Record<string, { label: string; tone: string }> = {
  CREATE: { label: "Incluir", tone: "create" },
  UPDATE: { label: "Editar", tone: "update" },
  FIELD: { label: "Editar campo", tone: "update" },
  ARCHIVE: { label: "Apagar", tone: "archive" },
  MOVE: { label: "Mover", tone: "move" },
  RESTORE: { label: "Restaurar", tone: "move" },
  ELECTION: { label: "Eleição", tone: "update" },
};
export function ProposalOutcomeDiff({ context, detail, proposalId, onDone }: { context: FeatureContext; detail?: ProposalOutcomeDetail; proposalId?: string; onDone?: () => void }) {
  const { t } = useMeetingsLocalization();
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState("");
  const [busy, setBusy] = useState(false);
  const payload = detail?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const entityName = (id?: string) => {
    if (!id) return "";
    const key = id.toLowerCase();
    return detail?.entityReferences?.find((r) => r.entityId === key)?.name
      ?? context.structure.nodes.find((n) => n.entityId === key)?.name
      ?? "";
  };
  const node = (id?: string) => id ? context.structure.nodes.find((n) => n.entityId === id.toLowerCase()) : undefined;
  const nodeName = (nodeId?: string | null) => nodeId ? context.structure.nodes.find((n) => n.nodeId === nodeId)?.name ?? "" : "";
  const definition = (id?: string) =>
    id ? [...context.structure.circles, ...context.structure.roles].find((e) => e.id === id.toLowerCase()) : undefined;
  const purposeText = (entity?: { purpose: string | null; purposeRich?: RichDocument | null }) =>
    entity ? plain(entity.purposeRich, entity.purpose) : "";
  const docInfo = (id?: string) => detail?.documents?.find((doc) => doc.documentId === id);
  const docParts = [...(Array.isArray(payload.documents) ? payload.documents : []), ...(payload.documentId ? [payload] : [])];
  const canDiscard =
    !!proposalId &&
    !!detail?.version &&
    ["DRAFT", "REVIEW"].includes(detail.state ?? "") &&
    context.bootstrap.membership.memberType !== "GUEST" &&
    (context.bootstrap.membership.orgRole === "OWNER" || detail.authorId === context.bootstrap.membership.id);
  async function discard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    setBusy(true);
    setDiscardError("");
    try {
      await context.api(`/organizations/${context.organizationId}/proposals/${proposalId}/actions/withdraw`, {
        method: "POST",
        body: { reason },
        version: detail?.version,
      });
      setDiscarding(false);
      context.notify(t("Alteração confirmada."));
      onDone?.();
    } catch (error) {
      setDiscardError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="meetings-proposal-diff">
      {(payload.changes ?? payload.patches ?? []).map((change: any, index: number) => {
        if (!change || typeof change.kind !== "string") return null;
        const verb = VERB[change.kind] ?? { label: change.kind, tone: "update" };
        const current = change.kind === "CREATE" ? undefined : definition(change.entityId);
        const currentNode = node(change.entityId);
        const name = change.name ?? entityName(change.entityId);
        const purposeProvided = change.purpose !== undefined || change.purposeRich !== undefined;
        const showContent = !["CREATE", "ARCHIVE"].includes(change.kind);
        const contextList = (list: any[] | undefined) => {
          const rows = definitionItems(list);
          if (!rows.length) return null;
          return <ul className="word-diff word-diff-list">{rows.map((item) => <li key={item.id}>{definitionItemText(item)}</li>)}</ul>;
        };
        const definitionSection = (label: string, field: "responsibilities" | "artifacts") =>
          (change[field] !== undefined || (showContent && definitionItems(current?.[field]).length > 0)) && (
            <section>
              <h5>{label}</h5>
              {change[field] !== undefined
                ? <DefinitionsDiff proposed={change[field]} current={current?.[field]} />
                : contextList(current?.[field])}
            </section>
          );
        return (
          <section key={index} className="meetings-proposal-diff-change">
            <h4><strong className={"is-" + verb.tone}>{t(verb.label)}</strong> · {name}</h4>
            {change.kind === "UPDATE" && change.name !== undefined && currentNode && change.name !== currentNode.name && (
              <DiffText parts={diffText(currentNode.name, change.name)} />
            )}
            {(purposeProvided || (showContent && purposeText(current) !== "")) && (
              <section>
                <h5>{t("Propósito")}</h5>
                {change.kind === "CREATE" ? (
                  purposeProvided && <div className="meetings-proposal-diff-added"><RichTextView value={change.purposeRich ?? change.purpose ?? ""} /></div>
                ) : purposeProvided ? (
                  <DiffText parts={diffText(purposeText(current), plain(change.purposeRich, change.purpose))} />
                ) : (
                  <p className="word-diff-text">{purposeText(current)}</p>
                )}
              </section>
            )}
            {change.kind !== "ARCHIVE" && definitionSection(t("Responsabilidades"), "responsibilities")}
            {change.kind !== "ARCHIVE" && definitionSection(t("Artefatos"), "artifacts")}
            {change.kind === "MOVE" && (
              <p>{t("De {from} para {to}", { from: nodeName(currentNode?.parentNodeId), to: entityName(change.parentCircleId) })}</p>
            )}
            {change.kind === "FIELD" && (
              <p>{t("Valor proposto: {value}", { value: Array.isArray(change.value) ? change.value.join(", ") : String(change.value ?? "") })}</p>
            )}
            {change.kind === "ARCHIVE" && current && (
              <div className="meetings-proposal-diff-removed">
                {purposeText(current) && <p><del>{purposeText(current)}</del></p>}
                <ul>
                  {[...definitionItems(current.responsibilities), ...definitionItems(current.artifacts)].map((item) => (
                    <li key={item.id}><del>{definitionItemText(item)}</del></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
      {docParts.map((part: any, index: number) => {
        if (!part || typeof part !== "object") return null;
        const info = docInfo(part.documentId);
        const verb = part.newDocument ? VERB.CREATE : part.documentAction === "ARCHIVE" ? VERB.ARCHIVE : VERB.UPDATE;
        const title = part.newDocument?.title ?? info?.title ?? "";
        const proposedText = part.newDocument ? plain(part.newDocument.richContent, undefined) : plain(info?.proposedRich, info?.proposedContent);
        const publishedText = plain(info?.publishedRich, info?.publishedContent);
        return (
          <section key={"document-" + index} className="meetings-proposal-diff-change">
            <h4><strong className={"is-" + verb.tone}>{t(verb.label)}</strong> · {title}</h4>
            {part.newDocument ? (
              part.newDocument.richContent && <div className="meetings-proposal-diff-added"><RichTextView value={part.newDocument.richContent} /></div>
            ) : part.documentAction === "ARCHIVE" ? (
              (publishedText || proposedText) !== "" && <div className="meetings-proposal-diff-removed"><p><del>{publishedText || proposedText}</del></p></div>
            ) : publishedText !== proposedText ? (
              publishedText
                ? <DiffText parts={diffText(publishedText, proposedText)} />
                : proposedText !== "" && <div className="meetings-proposal-diff-added"><p><ins>{proposedText}</ins></p></div>
            ) : (
              proposedText !== "" && <p className="word-diff-text">{proposedText}</p>
            )}
          </section>
        );
      })}
      {typeof payload.roleId === "string" && (
        <section className="meetings-proposal-diff-change">
          <h4><strong className="is-update">{t("Eleição")}</strong> · {entityName(payload.roleId)}</h4>
          {payload.winnerId && <p>{t("Candidato: {name}", { name: context.members.find((m) => m.id === payload.winnerId)?.displayName ?? "" })}</p>}
        </section>
      )}
      {canDiscard && (
        <button type="button" className="meetings-proposal-discard" onClick={() => setDiscarding(true)}>
          {t("Descartar proposta")}
        </button>
      )}
      {discarding && (
        <Dialog title={t("Descartar proposta")} onClose={() => setDiscarding(false)}>
          <form className="meetings-proposal-discard-form" onSubmit={discard}>
            <p>{t("A proposta será marcada como retirada e não poderá ser editada ou decidida.")}</p>
            <Field label={t("Motivo")} name="reason">
              <textarea name="reason" required maxLength={10000} />
            </Field>
            {discardError && <Notice>{discardError}</Notice>}
            <div className="meetings-inline-actions">
              <button type="button" onClick={() => setDiscarding(false)}>{t("Cancelar")}</button>
              <button type="submit" className="danger" disabled={busy}>{t("Descartar proposta")}</button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
