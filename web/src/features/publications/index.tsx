import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import {publicationsMetadata} from './metadata';
import { RequestError, errorMessage } from "../../api";
import { RichTextEditor, RichTextView } from "../../editor";
import {
  emptyRichDocument,
  type RichDocument,
} from "../../../../packages/content/index";
import { useLocalization } from "../../localization";
import "./publications.css";

type Group = { id: string; name: string; version: number };
type Post = {
  id: string;
  groupId: string;
  authorMemberId: string;
  state: "DRAFT" | "PUBLISHED";
  version: number;
  title: string;
  bodyRichDocument: RichDocument;
  publishedAt?: string;
};
type Page = { posts: Post[]; nextCursor: string | null };
const strings = {
  pt: {
    title: "Publicações",
    groups: "Grupo",
    emptyGroups: "Você ainda não participa de nenhum grupo com publicações.",
    loading: "Carregando publicações…",
    error: "Não foi possível carregar as publicações.",
    retry: "Tentar novamente",
    new: "Nova publicação",
    drafts: "Incluir meus rascunhos",
    empty: "Ainda não há publicações neste grupo.",
    draft: "Rascunho",
    published: "Publicada",
    more: "Carregar mais",
    back: "Voltar para publicações",
    edit: "Editar meu rascunho",
    save: "Salvar rascunho",
    publish: "Publicar",
    archive: "Arquivar",
    confirmArchive:
      "Arquivar esta publicação? Ela deixará de aparecer no grupo e nas exportações.",
    confirm: "Confirmar arquivamento",
    cancel: "Cancelar",
    formTitle: "Título",
    body: "Conteúdo",
    saveFirst: "Salve as alterações antes de publicar.",
    createHint:
      "O rascunho é visível apenas para você. Publique para compartilhá-lo com participantes atuais do grupo.",
    publishedHint:
      "A versão publicada continua visível enquanto você edita o rascunho.",
    saved: "Rascunho salvo.",
    posted: "Publicação compartilhada com o grupo.",
    archived: "Publicação arquivada.",
    conflict:
      "Esta publicação mudou em outra sessão. Seu texto foi preservado. Atualize a versão antes de tentar salvar novamente.",
    refreshVersion: "Atualizar versão",
    updatedVersion: "Versão atualizada. Revise seu texto antes de salvar.",
    discard: "Você tem alterações não salvas. Deseja descartá-las?",
    busy: "Aguarde a operação terminar.",
    export: "Exportar publicações",
    exportHint:
      "O arquivo contém apenas publicações dos grupos selecionados aos quais você tem acesso agora; rascunhos e anexos ficam de fora.",
    selectGroups: "Grupos para exportação",
    requestExport: "Solicitar exportação",
    exported:
      "Exportação solicitada. Acompanhe o resultado em Importação e exportação.",
    jobs: "Abrir importação e exportação",
    pendingSave:
      "A resposta do salvamento não chegou. Tente salvar novamente para confirmar o resultado antes de editar ou sair.",
    pendingExport:
      "A resposta da solicitação não chegou. Tente novamente para confirmar o resultado antes de mudar a seleção ou sair.",
    selectionChanged:
      "Seu acesso aos grupos mudou. Atualize a lista antes de solicitar a exportação.",
    select: "Selecionar",
    failed:
      "Não foi possível concluir a ação. Confira a conexão e tente novamente.",
    titleRequired: "Informe um título de até 200 caracteres.",
    loadPost: "Não foi possível abrir esta publicação.",
    noAccess:
      "Você não tem acesso a esta publicação ou ela não está mais disponível.",
  },
  en: {
    title: "Publications",
    groups: "Group",
    emptyGroups: "You do not belong to any publication groups yet.",
    loading: "Loading publications…",
    error: "Could not load publications.",
    retry: "Try again",
    new: "New publication",
    drafts: "Include my drafts",
    empty: "There are no publications in this group yet.",
    draft: "Draft",
    published: "Published",
    more: "Load more",
    back: "Back to publications",
    edit: "Edit my draft",
    save: "Save draft",
    publish: "Publish",
    archive: "Archive",
    confirmArchive:
      "Archive this publication? It will no longer appear in the group or exports.",
    confirm: "Confirm archive",
    cancel: "Cancel",
    formTitle: "Title",
    body: "Content",
    saveFirst: "Save your changes before publishing.",
    createHint:
      "Only you can see this draft. Publish to share it with current group members.",
    publishedHint:
      "The published version remains visible while you edit the draft.",
    saved: "Draft saved.",
    posted: "Publication shared with the group.",
    archived: "Publication archived.",
    conflict:
      "This publication changed in another session. Your text is preserved. Refresh its version before saving again.",
    refreshVersion: "Refresh version",
    updatedVersion: "Version refreshed. Review your text before saving.",
    discard: "You have unsaved changes. Discard them?",
    busy: "Wait for the operation to finish.",
    export: "Export publications",
    exportHint:
      "The file contains only published posts from selected groups you can access now; drafts and attachments are excluded.",
    selectGroups: "Groups to export",
    requestExport: "Request export",
    exported: "Export requested. Follow its progress in Import and export.",
    jobs: "Open import and export",
    pendingSave:
      "The save response did not arrive. Retry the save to confirm the result before editing or leaving.",
    pendingExport:
      "The request response did not arrive. Retry to confirm its result before changing the selection or leaving.",
    selectionChanged:
      "Your group access changed. Refresh the list before requesting an export.",
    select: "Select",
    failed:
      "Could not complete the action. Check your connection and try again.",
    titleRequired: "Enter a title of up to 200 characters.",
    loadPost: "Could not open this publication.",
    noAccess:
      "You cannot access this publication or it is no longer available.",
  },
};
const isConflict = (e: unknown) =>
  e instanceof RequestError && e.code === "VERSION_CONFLICT";
function PublicationsScreen({ context: c }: { context: FeatureContext }) {
  const { locale } = useLocalization(),
    t = locale.toLowerCase().startsWith("en") ? strings.en : strings.pt;
  const root = `/organizations/${c.organizationId}`,
    base = root + "/publications",
    guest = c.bootstrap.membership.memberType === "GUEST",
    owner = c.bootstrap.membership.orgRole === "OWNER" && !guest;
  const [groups, setGroups] = useState<Group[] | null>(null),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState<Page | null>(null),
    [includeDrafts, setIncludeDrafts] = useState(false),
    [opened, setOpened] = useState<Post | null>(null),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(""),
    [doc, setDoc] = useState<RichDocument>(() => emptyRichDocument()),
    [dirty, setDirty] = useState(false),
    [conflict, setConflict] = useState(false),
    [archive, setArchive] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [exportOpen, setExportOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [pendingExport, setPendingExport] = useState<{
    ids: string[];
    revision: number;
    key: string;
  } | null>(null);
  const keys = useRef(new Map<string, string>()),
    loadId = useRef(0);
  const idempotency = (signature: string) => {
    let k = keys.current.get(signature);
    if (!k) {
      k = crypto.randomUUID();
      keys.current.set(signature, k);
    }
    return k;
  };
  const message = (e: unknown) =>
    e instanceof RequestError &&
    ["ACTION_DENIED", "RESOURCE_NOT_FOUND", "EXPORT_ACCESS_REVOKED"].includes(
      e.code,
    )
      ? t.noAccess
      : e instanceof RequestError && e.code === "NETWORK_ERROR"
        ? t.failed
        : errorMessage(e);
  const refreshGroups = async (signal?: AbortSignal) => {
    const response = await c.api<{ groups: Group[] }>(base + "/groups", {
      signal,
    });
    return response;
  };
  const loadGroups = async (signal?: AbortSignal) => {
    const r = await refreshGroups(signal);
    if (signal?.aborted) return;
    setGroups(r.data.groups);
    setGroup((current) =>
      r.data.groups.some((g) => g.id === current)
        ? current
        : (r.data.groups[0]?.id ?? ""),
    );
    setSelected((current) =>
      current.length
        ? current.filter((id) => r.data.groups.some((g) => g.id === id))
        : r.data.groups.map((g) => g.id),
    );
  };
  useEffect(() => {
    if (guest) return;
    const controller = new AbortController();
    setGroups(null);
    setError("");
    void loadGroups(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(message(e));
    });
    return () => controller.abort();
  }, [base, guest]);
  useEffect(() => {
    if (!group) return;
    const controller = new AbortController(),
      token = ++loadId.current;
    setPage(null);
    setError("");
    void c
      .api<Page>(base + `/groups/${group}/posts?drafts=${includeDrafts}`, {
        signal: controller.signal,
      })
      .then((r) => {
        if (!controller.signal.aborted && token === loadId.current)
          setPage(r.data);
      })
      .catch((e) => {
        if (!controller.signal.aborted && token === loadId.current)
          setError(message(e));
      });
    return () => controller.abort();
  }, [base, group, includeDrafts]);
  useEffect(
    () =>
      c.registerNavigationGuard?.(() =>
        busy
          ? t.busy
          : pendingSave
            ? t.pendingSave
            : pendingExport
              ? t.pendingExport
              : dirty
                ? t.discard
                : null,
      ),
    [busy, dirty, pendingSave, pendingExport, c.registerNavigationGuard, t],
  );
  if (guest) return null;
  const discard = () =>
    pendingSave
      ? window.confirm(t.pendingSave)
      : !dirty || window.confirm(t.discard);
  const list = async () => {
    if (!group) return;
    const r = await c.api<Page>(
      base + `/groups/${group}/posts?drafts=${includeDrafts}`,
    );
    setPage(r.data);
  };
  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (isConflict(e)) setConflict(true);
      setError(isConflict(e) ? t.conflict : message(e));
    } finally {
      setBusy(false);
    }
  };
  const goList = () => {
    if (!discard()) return;
    setOpened(null);
    setEditing(false);
    setDirty(false);
    setConflict(false);
    setArchive(false);
    setError("");
  };
  const open = async (id: string, edit = false) => {
    if (!discard()) return;
    await perform(async () => {
      const r = await c.api<{ post: Post }>(
        base + `/posts/${id}` + (edit ? "?draft=true" : ""),
      );
      setOpened(r.data.post);
      setEditing(edit || r.data.post.state === "DRAFT");
      setTitle(r.data.post.title);
      setDoc(r.data.post.bodyRichDocument);
      setDirty(false);
      setConflict(false);
    });
  };
  const newPost = () => {
    if (!discard()) return;
    setOpened(null);
    setTitle("");
    setDoc(emptyRichDocument());
    setEditing(true);
    setDirty(false);
    setConflict(false);
    setError("");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || [...title.trim()].length > 200) {
      setError(t.titleRequired);
      return;
    }
    if (conflict) return;
    const payload = { title: title.trim(), bodyRichDocument: doc },
      path = opened
        ? base + `/posts/${opened.id}`
        : base + `/groups/${group}/posts`,
      method = opened ? "PATCH" : "POST",
      signature = JSON.stringify([method, path, opened?.version, payload]);
    await perform(async () => {
      setPendingSave(true);
      let r;
      try {
        r = await c.api<{ post: Post }>(path, {
          method,
          body: payload,
          version: opened?.version,
          key: idempotency(signature),
        });
      } catch (e) {
        if (
          e instanceof RequestError &&
          [
            "VERSION_CONFLICT",
            "IDEMPOTENCY_CONFLICT",
            "ACTION_DENIED",
            "RESOURCE_NOT_FOUND",
            "INVALID_RICH_DOCUMENT",
            "INVALID_REQUEST",
            "ORGANIZATION_CLOSED",
          ].includes(e.code)
        )
          setPendingSave(false);
        throw e;
      }
      setPendingSave(false);
      keys.current.delete(signature);
      setOpened(r.data.post);
      setDirty(false);
      setNotice(t.saved);
      await list().catch(() => setError(t.error));
    });
  };
  const publish = () => {
    if (!opened || dirty || conflict) return;
    const path = base + `/posts/${opened.id}/publish`,
      signature = JSON.stringify([path, opened.version]);
    void perform(async () => {
      const r = await c.api<{ post: Post }>(path, {
        method: "POST",
        body: {},
        version: opened.version,
        key: idempotency(signature),
      });
      keys.current.delete(signature);
      setOpened(r.data.post);
      setEditing(false);
      setDirty(false);
      setNotice(t.posted);
      await list().catch(() => setError(t.error));
    });
  };
  const archivePost = () => {
    if (!opened || dirty || conflict) return;
    const path = base + `/posts/${opened.id}/archive`,
      signature = JSON.stringify([path, opened.version]);
    void perform(async () => {
      await c.api(path, {
        method: "POST",
        body: {},
        version: opened.version,
        key: idempotency(signature),
      });
      keys.current.delete(signature);
      setOpened(null);
      setEditing(false);
      setArchive(false);
      setNotice(t.archived);
      await list().catch(() => setError(t.error));
    });
  };
  const refreshVersion = () => {
    if (!opened) return;
    void perform(async () => {
      const r = await c.api<{ post: Post }>(
        base + `/posts/${opened.id}?draft=true`,
      );
      setOpened(r.data.post);
      setConflict(false);
      setArchive(false);
      setNotice(t.updatedVersion);
    });
  };
  const requestExport = () => {
    void perform(async () => {
      let attempt = pendingExport;
      if (!attempt) {
        const current = await refreshGroups();
        if (
          selected.some((id) => !current.data.groups.some((g) => g.id === id))
        ) {
          setError(t.selectionChanged);
          return;
        }
        const revision = current.meta.authorizationRevision;
        if (typeof revision !== "number") throw Error(t.failed);
        attempt = { ids: [...selected], revision, key: crypto.randomUUID() };
        setPendingExport(attempt);
      }
      try {
        await c.api(root + "/administration/publication-exports", {
          method: "POST",
          body: { groupIds: attempt.ids },
          version: attempt.revision,
          key: attempt.key,
        });
      } catch (e) {
        if (
          e instanceof RequestError &&
          [
            "VERSION_CONFLICT",
            "IDEMPOTENCY_CONFLICT",
            "ACTION_DENIED",
            "RESOURCE_NOT_FOUND",
            "EXPORT_ACCESS_REVOKED",
            "EXPORT_SCOPE_TOO_LARGE",
            "ORGANIZATION_CLOSED",
          ].includes(e.code)
        )
          setPendingExport(null);
        if (isConflict(e)) {
          setError(t.selectionChanged);
          return;
        }
        throw e;
      }
      setPendingExport(null);
      setExportOpen(false);
      setNotice(t.exported);
    });
  };
  const own = opened?.authorMemberId === c.bootstrap.membership.id;
  return (
    <div className="pub-surface">
      <header className="pub-heading">
        <h1>{t.title}</h1>
        {owner && (
          <button
            type="button"
            onClick={() => setExportOpen(!exportOpen)}
            aria-expanded={exportOpen}
          >
            {t.export}
          </button>
        )}
      </header>
      <div className="pub-content">
        {notice && (
          <p className="pub-notice" role="status">
            {notice}
            {notice === t.exported && (
              <>
                {" "}
                <button
                  type="button"
                  className="pub-link"
                  onClick={() => c.navigate("/platform/jobs")}
                >
                  {t.jobs}
                </button>
              </>
            )}
          </p>
        )}
        {error && (
          <div className="pub-error" role="alert">
            <p>{error}</p>
            {conflict && opened && (
              <button type="button" disabled={busy} onClick={refreshVersion}>
                {t.refreshVersion}
              </button>
            )}
            {!groups && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void perform(() => loadGroups())}
              >
                {t.retry}
              </button>
            )}
          </div>
        )}
        {exportOpen && owner && (
          <section className="pub-export" aria-labelledby="pub-export-title">
            {pendingExport && <p role="status">{t.pendingExport}</p>}
            <h2 id="pub-export-title">{t.export}</h2>
            <p>{t.exportHint}</p>
            <fieldset>
              <legend>{t.selectGroups}</legend>
              {groups?.map((g) => (
                <label key={g.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(g.id)}
                    disabled={busy || !!pendingExport}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, g.id]
                          : selected.filter((x) => x !== g.id),
                      )
                    }
                  />
                  {g.name}
                </label>
              ))}
            </fieldset>
            <div className="pub-actions">
              <button
                type="button"
                disabled={busy || !groups}
                onClick={requestExport}
              >
                {t.requestExport}
              </button>
              <button type="button" onClick={() => setExportOpen(false)}>
                {t.cancel}
              </button>
            </div>
          </section>
        )}
        {!groups ? (
          <p role="status">{error ? t.error : t.loading}</p>
        ) : groups.length === 0 ? (
          <p>{t.emptyGroups}</p>
        ) : editing ? (
          <section>
            <button className="pub-link" type="button" onClick={goList}>
              {t.back}
            </button>
            <h2>{opened ? t.edit : t.new}</h2>
            <p>
              {opened?.state === "PUBLISHED" ? t.publishedHint : t.createHint}
            </p>
            <form onSubmit={save}>
              {pendingSave && <p role="status">{t.pendingSave}</p>}
              <label className="pub-field">
                {t.formTitle}
                <input
                  value={title}
                  readOnly={pendingSave}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                  maxLength={400}
                  required
                />
              </label>
              <RichTextEditor
                label={t.body}
                value={doc}
                onChange={(v) => {
                  setDoc(v);
                  setDirty(true);
                }}
                pending={busy}
                readOnly={pendingSave}
              />
              <div className="pub-actions">
                <button type="submit" disabled={busy || conflict}>
                  {t.save}
                </button>
                {opened && (
                  <button
                    type="button"
                    disabled={busy || dirty || conflict || pendingSave}
                    onClick={publish}
                  >
                    {t.publish}
                  </button>
                )}
                {opened && (
                  <button
                    type="button"
                    disabled={busy || dirty || conflict || pendingSave}
                    onClick={() => setArchive(true)}
                  >
                    {t.archive}
                  </button>
                )}
                <button type="button" onClick={goList} disabled={busy}>
                  {t.cancel}
                </button>
              </div>
              {dirty && opened && <p>{t.saveFirst}</p>}
            </form>
            {archive && (
              <div
                className="pub-confirm"
                role="group"
                aria-label={t.confirmArchive}
              >
                <p>{t.confirmArchive}</p>
                <button type="button" disabled={busy} onClick={archivePost}>
                  {t.confirm}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setArchive(false)}
                >
                  {t.cancel}
                </button>
              </div>
            )}
          </section>
        ) : opened ? (
          <article>
            <button className="pub-link" type="button" onClick={goList}>
              {t.back}
            </button>
            <h2>{opened.title}</h2>
            <p>{opened.state === "DRAFT" ? t.draft : t.published}</p>
            <RichTextView value={opened.bodyRichDocument} />
            {own && (
              <div className="pub-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void open(opened.id, true)}
                >
                  {t.edit}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setArchive(true)}
                >
                  {t.archive}
                </button>
              </div>
            )}
            {archive && (
              <div
                className="pub-confirm"
                role="group"
                aria-label={t.confirmArchive}
              >
                <p>{t.confirmArchive}</p>
                <button type="button" disabled={busy} onClick={archivePost}>
                  {t.confirm}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setArchive(false)}
                >
                  {t.cancel}
                </button>
              </div>
            )}
          </article>
        ) : (
          <section>
            <div className="pub-toolbar">
              <label>
                {t.groups}
                <select
                  value={group}
                  disabled={busy}
                  onChange={(e) => {
                    if (discard()) {
                      setGroup(e.target.value);
                      setOpened(null);
                    }
                  }}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy} onClick={newPost}>
                {t.new}
              </button>
            </div>
            <label className="pub-check">
              <input
                type="checkbox"
                checked={includeDrafts}
                disabled={busy}
                onChange={(e) => setIncludeDrafts(e.target.checked)}
              />
              {t.drafts}
            </label>
            {!page ? (
              <p role="status">
                {error ? t.error : t.loading}
                {error && (
                  <button type="button" onClick={() => void perform(list)}>
                    {t.retry}
                  </button>
                )}
              </p>
            ) : page.posts.length === 0 ? (
              <p>{t.empty}</p>
            ) : (
              <ul className="pub-list">
                {page.posts.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => void open(p.id)}>
                      <strong>{p.title}</strong>
                      <span>{p.state === "DRAFT" ? t.draft : t.published}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {page?.nextCursor && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const r = await c.api<Page>(
                      base +
                        `/groups/${group}/posts?drafts=${includeDrafts}&cursor=${encodeURIComponent(page.nextCursor!)}`,
                    );
                    setPage({
                      posts: [...page.posts, ...r.data.posts],
                      nextCursor: r.data.nextCursor,
                    });
                  })
                }
              >
                {t.more}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
export function Publications({ context }: { context: FeatureContext }) {
  return (
    <PublicationsScreen
      key={`${context.organizationId}:${context.session.account.id}`}
      context={context}
    />
  );
}
export const publicationsFeature: FeatureDefinition = {
  ...publicationsMetadata,
  Component: Publications,
};
