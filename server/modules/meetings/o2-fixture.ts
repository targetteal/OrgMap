// Synthetic API fixture; no workers, real invitations, direct writes or main database.
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
export async function seedO2Panel(app: FastifyInstance, origin: string) {
  const password = "Synthetic-panel-2026-only-123";
  const log: any[] = [];
  async function account(label: string) {
    const email = randomUUID() + "@example.test";
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { origin },
      payload: { email, password, displayName: label },
    });
    if (r.statusCode !== 201) throw Error(r.body);
    const d = r.json().data;
    return {
      email,
      password,
      accountId: d.account.id,
      memberId: "",
      csrf: d.csrfToken,
      cookie:
        "orgmap_session=" +
        r.cookies.find((c) => c.name === "orgmap_session")!.value,
    };
  }
  const owner = await account("Organização"),
    scribe = await account("Caio Escriba"),
    facilitator = await account("Lia Facilitadora"),
    guest = await account("Bia Convidada"),
    outsider = await account("Outra organização");
  async function raw(
    actor: typeof owner,
    method: string,
    path: string,
    body?: any,
    version?: number,
    key = randomUUID(),
  ) {
    const r = await app.inject({
      method: method as any,
      url: "/api/v1" + path,
      payload: body,
      headers: {
        origin,
        cookie: actor.cookie,
        "x-csrf-token": actor.csrf,
        "idempotency-key": key,
        ...(version === undefined ? {} : { "if-match": `"${version}"` }),
      },
    });
    log.push({ method, path, status: r.statusCode });
    return r;
  }
  async function call(
    actor: typeof owner,
    method: string,
    path: string,
    body?: any,
    version?: number,
  ) {
    const r = await raw(actor, method, path, body, version);
    if (r.statusCode >= 300) throw Error(r.body);
    return r.json().data;
  }
  const org = await call(owner, "POST", "/organizations", {
      name: "Aurora · painel O2",
    }),
    base = "/organizations/" + org.organization.id,
    rootId = org.rootCircle.id;
  owner.memberId = org.membership.id;
  for (const a of [scribe, facilitator, guest])
    a.memberId = (
      await call(owner, "POST", base + "/members", { accountId: a.accountId })
    ).membership.id;
  await call(owner, "POST", base + "/governance-model/install", {
    packageId: "targetteal.o2",
  });
  const model = await call(owner, "GET", base + "/governance-model");
  for (const [actor, code] of [
    [scribe, "SCRIBE"],
    [facilitator, "FACILITATOR"],
  ] as const) {
    const binding = model.bindings.find((b: any) => b.functionCode === code);
    await call(
      owner,
      "POST",
      base + "/governance-model/roles/" + binding.roleId + "/occupancies",
      { memberId: actor.memberId, startsAt: "2026-01-01T00:00:00Z" },
    );
  }
  const effective = await call(
    scribe,
    "GET",
    base + "/governance/policies/" + rootId + "/effective",
  );
  if (
    effective.policySource !== "PACKAGE" ||
    effective.configuration.decisionProcess !== "HOLACRACY_O2" ||
    effective.configuration.method !== "MANUAL_FACILITATED"
  )
    throw Error("O2_PACKAGE_DEFAULT_POLICY_REQUIRED");
  const meeting = (
    await call(scribe, "POST", base + "/meeting-series", {
      title: "Produto",
      circleId: rootId,
      localStart: "2026-11-01T18:00",
      timeZone: "America/Sao_Paulo",
      durationMinutes: 60,
      recurrence: { frequency: "ONCE" },
      sections: [
        { id: "checkin", title: "Check-in", kind: "CHECKIN" },
        { id: "review", title: "Revisar", kind: "CUSTOM" },
        { id: "agenda", title: "Pauta", kind: "AGENDA" },
        { id: "checkout", title: "Check-out", kind: "CHECKOUT" },
      ],
      participants: [],
      notesProtocol: "orgmap-richtext-yjs-v1",
      policy: { notesOnlyNoter: true, windowDays: 7 },
    })
  ).occurrenceIds[0];
  const url = base + "/meetings/" + meeting;
  async function panelCommand(
    actor: typeof owner,
    action: string,
    body: any = {},
  ) {
    const d = await call(actor, "GET", url);
    return call(
      actor,
      "POST",
      url + "/panel/actions/" + action,
      body,
      d.meeting.version,
    );
  }
  await call(scribe, "POST", url + "/actions/start", {}, 1);
  await panelCommand(scribe, "presence", { attendance: "PRESENT" });
  await panelCommand(facilitator, "presence", { attendance: "PRESENT" });
  await panelCommand(facilitator, "assume", {
    role: "FACILITATOR",
    confirmed: true,
  });
  await panelCommand(facilitator, "invite", { memberId: guest.memberId });
  await panelCommand(guest, "presence", { attendance: "PRESENT" });
  await panelCommand(scribe, "tension", {
    title: "Publicações sem alinhamento",
    mode: "ADAPT",
  });
  await panelCommand(scribe, "tension", {
    title: "Prioridades da semana",
    mode: "SYNC",
  });
  let d = await call(scribe, "GET", url);
  const agendaId = d.agenda[0].id;
  await panelCommand(scribe, "focus", { agendaId });
  await panelCommand(scribe, "step", { sectionId: "agenda" });
  d = await call(scribe, "GET", url);
  const outcome = await call(
    scribe,
    "POST",
    url + "/outcomes",
    {
      kind: "POLICY",
      title: "Uso da identidade visual",
      agendaId,
      content:
        "Publicações com a identidade visual do círculo devem ser alinhadas com Comunicação antes da divulgação.",
    },
    d.meeting.version,
  );
  return {
    owner,
    scribe,
    facilitator,
    guest,
    outsider,
    base,
    rootId,
    meeting,
    url,
    agendaId,
    proposalId: outcome.target.id,
    log,
    call,
    raw,
    panelCommand,
  };
}
