import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  createRichYDoc,
  RICH_TEXT_FRAGMENT,
  RICH_TEXT_PROTOCOL,
} from "../../../packages/content/collaboration.js";
import { fromPlainText } from "../../../packages/content/index.js";
import type { FastifyInstance } from "fastify";
/** Synthetic preview data created only through owning HTTP commands. No private SQL shortcuts. */
export async function seedExportPreview(app: FastifyInstance, origin: string) {
  let cookie = "",
    csrf = "";
  async function call(
    method: string,
    url: string,
    payload?: any,
    version?: number,
  ) {
    const response = await app.inject({
      method: method as any,
      url: "/api/v1" + url,
      payload,
      headers: {
        origin,
        cookie,
        "x-csrf-token": csrf,
        "idempotency-key": randomUUID(),
        ...(version === undefined ? {} : { "if-match": `"${version}"` }),
      },
    });
    if (response.statusCode >= 300) throw Error(response.body);
    return { data: response.json().data, response };
  }
  const email = "meetings-export-preview@example.test";
  const registered = await call("POST", "/auth/register", {
    email,
    password: "Meetings-QA-Export-2026",
    displayName: "Pessoa Aurora",
  });
  cookie =
    registered.response.cookies[0].name +
    "=" +
    registered.response.cookies[0].value;
  csrf = registered.data.csrfToken;
  const org = (
    await call("POST", "/organizations", { name: "Aurora · Exportações" })
  ).data;
  const p = "/organizations/" + org.organization.id;
  const series = (
    await call("POST", p + "/meeting-series", {
      title: "Ata de coordenação · 日本語 🌿",
      circleId: org.rootCircle.id,
      localStart: "2026-10-20T09:00",
      timeZone: "America/Sao_Paulo",
      durationMinutes: 60,
      recurrence: { frequency: "ONCE" },
      sections: [{ id: "notes", title: "Notas", kind: "CUSTOM" }],
      notesProtocol: RICH_TEXT_PROTOCOL,
      policy: {},
    })
  ).data;
  const meetingId = series.occurrenceIds[0],
    route = p + "/meetings/" + meetingId;
  let detail = (await call("POST", route + "/actions/start", {}, 1)).data;
  detail = (
    await call(
      "POST",
      route + "/agenda",
      { title: "Preparar o próximo encontro", durationMinutes: 0 },
      detail.meeting.version,
    )
  ).data;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(detail.documents[0].snapshot, "base64"));
  const vector = Y.encodeStateVector(doc),
    fragment = doc.getXmlFragment(RICH_TEXT_FRAGMENT),
    incoming = createRichYDoc(
      fromPlainText(
        "Registro publicado para validar a exportação. 日本語 🌿\nDecisão: preparar o próximo encontro.",
      ),
    );
  doc.transact(() => {
    fragment.delete(0, fragment.length);
    fragment.insert(
      0,
      incoming
        .getXmlFragment(RICH_TEXT_FRAGMENT)
        .toArray()
        .map((x) => {
          if (!(x instanceof Y.XmlElement || x instanceof Y.XmlText))
            throw Error("Unexpected rich node");
          return x.clone();
        }),
    );
  });
  await call("POST", route + "/collaboration/updates", {
    sectionId: "notes",
    epoch: 1,
    protocol: RICH_TEXT_PROTOCOL,
    schemaVersion: 1,
    updateId: randomUUID(),
    update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString("base64"),
  });
  doc.destroy();
  incoming.destroy();
  detail = (await call("GET", route)).data;
  detail = (
    await call("POST", route + "/actions/close", {}, detail.meeting.version)
  ).data;
  detail = (
    await call(
      "POST",
      route + "/report/actions/publish",
      {},
      detail.report.version,
    )
  ).data;
  return {
    synthetic: true,
    email,
    organizationId: org.organization.id,
    memberId: org.membership.id,
    circleId: org.rootCircle.id,
    meetingId,
    reportId: detail.report.id,
  };
}
