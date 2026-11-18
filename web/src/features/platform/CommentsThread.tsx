import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { RichTextEditor, RichTextView, type RichDocument } from "../../editor";
import { emptyRichDocument, toPlainText } from "../../../../packages/content";
import { errorMessage } from "../../api";
import { Notice } from "../../ui";
import { useLocalization } from "../../localization";
import "./platform.css";
import { platformTranslator } from "./messages";
type Comment = {
  id: string;
  key: string;
  authorId: string | null;
  content: string;
  contentRich?: RichDocument | null;
  createdAt: string;
};
type Page = {
  items: Comment[];
  page: { hasMore: boolean; nextCursor: string | null };
};
type Draft = {
  value: RichDocument;
  command?: { key: string; body: { contentRich: RichDocument } };
};
export type CommentsThreadProps = {
  context: FeatureContext;
  type: string;
  resourceId: string;
};
/** Shared canonical thread. Keyed state and abort fences isolate resource changes. */
export function CommentsThread(props: CommentsThreadProps) {
  const drafts = useRef(new Map<string, Draft>());
  const identity = JSON.stringify([
    props.context.organizationId,
    props.type,
    props.resourceId,
  ]);
  return (
    <Thread
      key={identity}
      {...props}
      identity={identity}
      drafts={drafts.current}
    />
  );
}
function Thread({
  context,
  type,
  resourceId,
  identity,
  drafts,
}: CommentsThreadProps & { identity: string; drafts: Map<string, Draft> }) {
  const path =
    "/organizations/" +
    context.organizationId +
    "/platform/resources/" +
    encodeURIComponent(type) +
    "/" +
    encodeURIComponent(resourceId);
  const { formatInstant, locale } = useLocalization();
  const t = platformTranslator(locale);
  const [draft, setDraft] = useState<RichDocument>(
    () => drafts.get(identity)?.value ?? emptyRichDocument(),
  );
  const command = useRef(drafts.get(identity)?.command);
  const [items, setItems] = useState<Comment[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [canComment, setCanComment] = useState(false),
    [epoch, setEpoch] = useState(0),
    [revision, setRevision] = useState(0);
  const pagesLoaded = useRef(1);
  const active = useRef(true),
    pageRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pageRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoading(true);
    setItems([]);
    setCursor(null);
    setCanComment(false);
    context
      .api<{ actions: Record<string, boolean> }>(path + "/capabilities", {
        signal: controller.signal,
      })
      .then((r) => {
        if (!controller.signal.aborted)
          setCanComment(r.data.actions.comment === true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    (async () => {
      const combined: Comment[] = [];
      let next: string | null = null;
      for (let page = 0; page < pagesLoaded.current; page++) {
        const r: { data: Page } = await context.api<Page>(
          path +
            "/comments" +
            (next ? "?cursor=" + encodeURIComponent(next) : ""),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        combined.push(...r.data.items);
        next = r.data.page.nextCursor;
        if (!next) break;
      }
      if (!controller.signal.aborted) {
        setItems(combined);
        setCursor(next);
      }
    })()
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  useEffect(
    () =>
      context.registerNavigationGuard?.(() =>
        toPlainText(draft).trim() ? t("commentDraftGuard") : null,
      ),
    [context.registerNavigationGuard, draft, locale],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (toPlainText(draft).trim()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [draft]);
  async function more() {
    if (!cursor || loading) return;
    const controller = new AbortController();
    pageRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const r = await context.api<Page>(
        path + "/comments?cursor=" + encodeURIComponent(cursor),
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        pagesLoaded.current++;
        setItems((old) => {
          const keys = new Set(old.map((c) => c.key));
          return [...old, ...r.data.items.filter((c) => !keys.has(c.key))];
        });
        setCursor(r.data.page.nextCursor);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function submit() {
    if (busy || !canComment) return;
    command.current ??= {
      key: crypto.randomUUID(),
      body: { contentRich: draft },
    };
    drafts.set(identity, { value: draft, command: command.current });
    setBusy(true);
    setError("");
    try {
      await context.api(path + "/comments", {
        method: "POST",
        ...command.current,
      });
      drafts.delete(identity);
      command.current = undefined;
      if (active.current) {
        setDraft(emptyRichDocument());
        setEpoch((n) => n + 1);
        setRevision((n) => n + 1);
        context.notify(t("commentSavedNotice"));
      }
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className="platform-section" aria-label={t("comments")}>
      <h2>
        <MessageSquare size={18} /> {t("comments")}
      </h2>
      {error && (
        <>
          <Notice>{error}</Notice>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              setRevision((n) => n + 1);
            }}
          >
            {t("commentsReload")}
          </button>
        </>
      )}
      {!loading && !items.length && (
        <p className="muted">{t("commentsEmpty")}</p>
      )}
      {items.map((c) => (
        <article className="platform-comment" key={c.key ?? c.id}>
          <div className="platform-row">
            <strong>
              {c.authorId === null
                ? t("commentAuthorHidden")
                : (context.members.find((m) => m.id === c.authorId)
                    ?.displayName ?? t("commentMember"))}
            </strong>
            <time dateTime={c.createdAt}>{formatInstant(c.createdAt)}</time>
          </div>
          <RichTextView
            value={c.contentRich ?? c.content}
            label={t("commentSavedLabel")}
          />
        </article>
      ))}
      {loading && <p role="status">{t("commentsLoading")}</p>}
      {cursor && (
        <button type="button" disabled={loading} onClick={() => void more()}>
          {t("commentsMore")}
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <RichTextEditor
          key={epoch}
          value={draft}
          onChange={(value) => {
            setDraft(value);
            command.current = undefined;
            drafts.set(identity, { value });
          }}
          label={t("commentAdd")}
          required
          pending={busy}
          readOnly={busy || !canComment}
        />
        {[...toPlainText(draft)].length > 10000 && (
          <Notice>{t("commentTooLong")}</Notice>
        )}
        <button
          type="submit"
          className="primary"
          disabled={
            !canComment ||
            busy ||
            !toPlainText(draft).trim() ||
            [...toPlainText(draft)].length > 10000
          }
        >
          {busy ? t("commentSaving") : t("commentSubmit")}
        </button>
      </form>
    </section>
  );
}
