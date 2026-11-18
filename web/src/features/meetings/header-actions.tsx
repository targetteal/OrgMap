import { useEffect, useId, useRef, useState } from "react";
import { Video, X } from "lucide-react";
import type { FeatureContext } from "../../feature-contract";
import { useMeetingsLocalization } from "./use-localization";
import { facilitatorTranslator } from "./secretary-claim-messages";
import { meetingHref } from "./routes";
type LiveMeeting = {
  id: string;
  title: string;
  startAt: string;
  circleId: string;
  isParticipant?: boolean;
  facilitatorId?: string;
  notetakerId?: string;
};
const POLL_MS = 30000;
export function MeetingsHeaderActions({ context }: { context: FeatureContext }) {
  const { t, locale, formatInstant } = useMeetingsLocalization();
  const facilitatorText = facilitatorTranslator(locale);
  const memberId = context.bootstrap.membership.id;
  const [result, setResult] = useState<{scope:string;items:LiveMeeting[]}|null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    titleId = useId();
  const scope = JSON.stringify([
    context.organizationId,
    context.session.account.id,
    memberId,
    context.bootstrap.authorizationRevision,
  ]);
  const items = result?.scope === scope ? result.items : [];
  useEffect(() => {
    setOpen(false);
  }, [scope]);
  useEffect(() => {
    if (context.bootstrap.modules.meetings === false) return;
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      try {
        const r = await context.api<{ items: LiveMeeting[] }>(
          `/organizations/${context.organizationId}/meetings?state=RUNNING&limit=20`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setResult({scope,items:
            r.data.items.filter(
              (m) =>
                m.isParticipant === true ||
                m.facilitatorId === memberId ||
                m.notetakerId === memberId,
            ),
          });
      } catch {
        /* The indicator stays hidden; the next poll retries. */
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [context.api, scope, memberId, context.bootstrap.modules.meetings]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (context.bootstrap.modules.meetings === false || !items.length)
    return null;
  const single = items.length === 1;
  const join = (meeting: LiveMeeting) => {
    setOpen(false);
    context.navigate(meetingHref(meeting.id));
  };
  return (
    <div className="meetings-live" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="meetings-live-button"
        title={single ? items[0].title : t("Reuniões em andamento")}
        aria-label={
          single
            ? t("Reunião em andamento") + ": " + items[0].title
            : t("Reuniões em andamento")
        }
        aria-expanded={single ? undefined : open}
        aria-haspopup={single ? undefined : "dialog"}
        aria-controls={open ? titleId + "-panel" : undefined}
        onClick={() => {
          if (single) join(items[0]);
          else setOpen(!open);
        }}
      >
        <Video size={20} />
        <span className="meetings-live-dot" aria-hidden="true" />
      </button>
      {open && !single && (
        <section
          id={titleId + "-panel"}
          className="meetings-live-panel"
          role="dialog"
          aria-labelledby={titleId}
        >
          <header className="meetings-live-heading">
            <h2 id={titleId}>{t("Reuniões em andamento")}</h2>
            <button type="button" aria-label={t("Fechar")} onClick={close}>
              <X size={18} />
            </button>
          </header>
          {items.map((meeting) => {
            const circle = context.structure.nodes.find(
              (node) => node.entityId === meeting.circleId,
            )?.name;
            const role =
              meeting.facilitatorId === memberId
                ? facilitatorText("name")
                : meeting.notetakerId === memberId
                  ? t("Secretaria")
                  : "";
            return (
              <button
                key={meeting.id}
                type="button"
                className="meetings-live-item"
                onClick={() => join(meeting)}
              >
                <span className="meetings-live-item-icon">
                  <Video size={17} />
                </span>
                <span className="meetings-live-copy">
                  <strong>{meeting.title}</strong>
                  <small>
                    {[circle, formatInstant(meeting.startAt), role]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <span className="meetings-live-join">
                  {t("Entrar na reunião")}
                </span>
              </button>
            );
          })}
        </section>
      )}
    </div>
  );
}
