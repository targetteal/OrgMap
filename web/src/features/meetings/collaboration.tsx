import { useMeetingsLocalization } from "./use-localization";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { FeatureContext } from "../../feature-contract";
import { RichTextEditor, RichTextView } from "../../editor";
import {
  toPlainText,
  serializeRichDocument,
  type RichDocument,
} from "@orgmap/content";
import {
  RICH_TEXT_PROTOCOL,
  RICH_TEXT_FRAGMENT,
  readRichYDoc,
} from "@orgmap/content/collaboration";
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const base64 = (b: Uint8Array) => {
  let s = "";
  for (const n of b) s += String.fromCharCode(n);
  return btoa(s);
};
export function CollaborativeNotes({
  context,
  meetingId,
  sectionId,
  epoch,
  protocol = "orgmap-ytext-v1",
  schemaVersion = 1,
  editable,
  onPending,
  discreet = false,
}: {
  context: FeatureContext;
  meetingId: string;
  sectionId: string;
  epoch: number;
  protocol?: string;
  schemaVersion?: number;
  editable: boolean;
  onPending: (n: number) => void;
  discreet?: boolean;
}) {
  const { t, formatError } = useMeetingsLocalization();
  const errorFormatter = useRef(formatError);
  errorFormatter.current = formatError;
  const pendingReason = useRef("");
  pendingReason.current = t("Aguarde a confirmação das notas antes de sair.");
  const [value, setValue] = useState(""),
    [state, setState] = useState("Conectando…"),
    [recovery, setRecovery] = useState(""),
    [locked, setLocked] = useState(false),
    [boundDoc, setBoundDoc] = useState<Y.Doc | null>(null),
    [pendingCount, setPendingCount] = useState(0),
    [recoveryRich, setRecoveryRich] = useState<RichDocument | null>(null),
    [recoveryBinary, setRecoveryBinary] = useState<string | null>(null);
  const active = useRef<{ doc: Y.Doc; pending: Map<string, string> } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController(),
      doc = new Y.Doc(),
      pending = new Map<string, string>();
    active.current = { doc, pending };
    // Read the live queue: navigation can occur before React commits the
    // pending counter, and only a server acknowledgement clears an update.
    const unregisterGuard = context.registerNavigationGuard?.(() =>
      pending.size ? pendingReason.current : null,
    );
    let socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout>,
      stopped = false,
      conflict = false,
      synchronized = false,
      inFlight: string | null = null;
    const rich = protocol === RICH_TEXT_PROTOCOL,
      notes = rich ? null : doc.getText("notes");
    const recover = () => {
      if (rich) {
        try {
          const draft = readRichYDoc(doc);
          setRecoveryRich(draft);
          setRecovery(toPlainText(draft));
        } catch {
          setRecoveryBinary(base64(Y.encodeStateAsUpdate(doc)));
          setRecovery(
            "O rascunho precisa de recuperação assistida. Baixe uma cópia antes de recarregar.",
          );
        }
      } else setRecovery(notes!.toString());
    };
    notes?.observe(() => setValue(notes.toString()));
    const sendPending = () => {
      if (socket?.readyState === WebSocket.OPEN && synchronized && !inFlight) {
        const next = pending.entries().next().value;
        if (!next) return;
        const [updateId, update] = next;
        inFlight = updateId;
        socket.send(
          JSON.stringify({
            type: "update",
            epoch,
            updateId,
            update,
            protocol,
            schemaVersion,
          }),
        );
      }
    };
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      pending.set(crypto.randomUUID(), base64(update));
      onPending(pending.size);
      setPendingCount(pending.size);
      setState("Enviando alterações…");
      sendPending();
    });
    const connect = async () => {
      if (stopped || conflict) return;
      try {
        const response = await context.api<{
          ticket: string;
          document: { epoch: number; snapshot: string };
        }>(
          `/organizations/${context.organizationId}/meetings/${meetingId}/collaboration/tickets`,
          {
            method: "POST",
            body: { sectionId, epoch, protocol, schemaVersion },
            signal: controller.signal,
          },
        );
        if (stopped) return;
        const confirmed = response.data.document as any;
        if (
          (confirmed.protocol ?? "orgmap-ytext-v1") !== protocol ||
          (confirmed.schemaVersion ?? 1) !== schemaVersion
        )
          throw Object.assign(new Error(t("Protocolo de notas incompatível")), {
            code: "INCOMPATIBLE_DOCUMENT_PROTOCOL",
          });
        Y.applyUpdate(doc, bytes(confirmed.snapshot), "remote");
        if (rich) readRichYDoc(doc);
        setBoundDoc(doc);
        const url = new URL(
          `/api/v1/organizations/${context.organizationId}/meetings/${meetingId}/collaboration/socket`,
          window.location.href,
        );
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(url);
        socket.onopen = () =>
          socket?.send(
            JSON.stringify({
              type: "hello",
              ticket: response.data.ticket,
              protocol,
              schemaVersion,
            }),
          );
        socket.onmessage = (e) => {
          const message = JSON.parse(e.data);
          if (message.type === "error") {
            // Ticket expiry is transport renewal, not an ACL decision. A fresh
            // CSRF-protected ticket request rechecks current access and epoch.
            if (message.code === "TICKET_EXPIRED") {
              setState("Renovando conexão…");
              socket?.close();
              return;
            }
            conflict = true;
            setLocked(true);
            if (pending.size || message.recoveryRequired) recover();
            setState(
              message.code === "INCOMPATIBLE_DOCUMENT_PROTOCOL"
                ? "Versão do editor incompatível. Preserve o rascunho e atualize a página."
                : message.recoveryRequired
                  ? "A ata foi restaurada ou migrada. Preserve o rascunho e recarregue para entrar na nova época."
                  : message.code === "INVALID_RICH_DOCUMENT" ||
                      message.code === "INVALID_UPDATE"
                    ? "O servidor recusou este conteúdo. O rascunho está preservado para revisão."
                    : "O acesso mudou. Preserve seu rascunho e recarregue para revisar suas permissões.",
            );
            return;
          }
          if (message.type === "ack") {
            pending.delete(message.updateId);
            if (inFlight === message.updateId) inFlight = null;
            onPending(pending.size);
            setPendingCount(pending.size);
          }
          if (message.document) {
            if (message.document.epoch !== epoch) {
              conflict = true;
              setLocked(true);
              recover();
              return;
            }
            Y.applyUpdate(doc, bytes(message.document.snapshot), "remote");
          }
          if (message.type === "sync") synchronized = true;
          if (message.type === "sync" || message.type === "ack") {
            setState(
              pending.size
                ? "Enviando alterações…"
                : "Todas as alterações confirmadas",
            );
            sendPending();
          }
          if (message.type === "retry") {
            clearTimeout(timer);
            timer = setTimeout(() => {
              inFlight = null;
              sendPending();
            }, 300);
          }
        };
        socket.onclose = () => {
          synchronized = false;
          inFlight = null;
          if (!stopped && !conflict) {
            setState(
              pending.size
                ? "Sem conexão. Rascunho aguardando envio."
                : "Reconectando…",
            );
            timer = setTimeout(connect, 1200);
          }
        };
        socket.onerror = () => socket?.close();
      } catch (e) {
        if (stopped) return;
        setState(errorFormatter.current(e));
        if (
          [
            "INCOMPATIBLE_DOCUMENT_PROTOCOL",
            "STALE_EPOCH_RECOVERY_REQUIRED",
            "RESOURCE_NOT_FOUND",
            "ACTION_DENIED",
            "MODULE_DISABLED",
            "CSRF_INVALID",
            "UNAUTHENTICATED",
          ].includes((e as any).code)
        ) {
          conflict = true;
          setLocked(true);
          if (pending.size) recover();
        } else timer = setTimeout(connect, 2500);
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (pending.size) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", unload);
    void connect();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      socket?.close();
      window.removeEventListener("beforeunload", unload);
      unregisterGuard?.();
      doc.destroy();
      active.current = null;
    };
  }, [
    context.organizationId,
    meetingId,
    sectionId,
    epoch,
    protocol,
    schemaVersion,
  ]);
  function change(next: string) {
    const a = active.current;
    if (!a || !editable) return;
    const t = a.doc.getText("notes"),
      prev = t.toString();
    let start = 0;
    while (
      start < prev.length &&
      start < next.length &&
      prev[start] === next[start]
    )
      start++;
    let end = 0;
    while (
      end < prev.length - start &&
      end < next.length - start &&
      prev[prev.length - 1 - end] === next[next.length - 1 - end]
    )
      end++;
    a.doc.transact(() => {
      if (prev.length - start - end) t.delete(start, prev.length - start - end);
      if (next.length - start - end)
        t.insert(start, next.slice(start, next.length - end));
    });
  }
  return (
    <div className="meetings-notes">
      {protocol === RICH_TEXT_PROTOCOL ? (
        boundDoc ? (
          <RichTextEditor
            label={t("Notas compartilhadas")}
            toolbar={!discreet}
            readOnly={!editable || locked}
            pending={pendingCount > 0}
            conflict={locked ? t(state) : false}
            collaboration={{
              fragment: boundDoc.getXmlFragment(RICH_TEXT_FRAGMENT),
            }}
          />
        ) : (
          <p role="status">{t("Conectando ao editor…")}</p>
        )
      ) : (
        <>
          <label htmlFor="meeting-notes">{t("Notas compartilhadas")}</label>
          <textarea
            id="meeting-notes"
            value={value}
            onChange={(e) => change(e.target.value)}
            readOnly={!editable || locked}
            placeholder={
              editable
                ? t("Registre as notas desta etapa…")
                : t("As notas desta etapa aparecerão aqui.")
            }
          />
        </>
      )}
      <p role="status" className="muted">
        {t(state)}
      </p>
      {recoveryRich && (
        <details open>
          <summary>{t("Rascunho estruturado para recuperação")}</summary>
          <RichTextView value={recoveryRich} emptyText={t("Sem conteúdo.")} />
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([serializeRichDocument(recoveryRich)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "rascunho-notas.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            {t("Baixar rascunho estruturado")}
          </button>
        </details>
      )}
      {recoveryBinary && (
        <button
          type="button"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([bytes(recoveryBinary).buffer as ArrayBuffer], {
                type: "application/octet-stream",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "rascunho-notas.yjs";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t("Baixar cópia para recuperação")}
        </button>
      )}
      {recovery && (
        <details open>
          <summary>
            {t("Rascunho de recuperação — copie antes de recarregar")}
          </summary>
          <textarea
            aria-label={t("Rascunho recuperado")}
            readOnly
            value={recoveryBinary ? t(recovery) : recovery}
          />
        </details>
      )}
    </div>
  );
}
