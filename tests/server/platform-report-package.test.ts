import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fromPlainText } from "../../packages/content/index.js";
import {
  validateReportDocument,
  validateReportPackage,
  createReportPackageSerializer,
} from "../../server/modules/platform/report-package.js";
test("platform report payload validates closed snapshots, literal AST, references and budgets", async () => {
  const sectionId = "notes",
    document = {
      schemaVersion: 1,
      ref: {
        reportId: randomUUID(),
        meetingId: randomUUID(),
        reportVersion: 3,
        publishedVersion: 2,
        epoch: 4,
        notesSeq: { [sectionId]: 8 },
      },
      title: "Ata ü 漢字",
      circle: { id: randomUUID(), label: "Círculo" },
      state: "DRAFT",
      meeting: {
        plannedStart: "2026-10-19T12:00:00.000Z",
        actualStart: null,
        actualEnd: null,
        timezone: "America/Sao_Paulo",
      },
      sections: [
        {
          id: sectionId,
          heading: "Notas",
          body: fromPlainText('<b>literal</b> {"text":true}'),
        },
      ],
      roster: [],
      agenda: [],
      actions: [],
      capturedAt: "2026-10-19T13:00:00.000Z",
      coverage: "Synthetic fixture, current durable notes",
    };
  const bundle = {
    schema: "orgmap-meeting-pdf-bundle-v1",
    documents: [document],
    selectionId: randomUUID(),
    asOf: document.capturedAt,
    timezone: "America/Sao_Paulo",
    reportSource: "CURRENT_AUTHORIZED",
    coverage: "explicit",
    notices: [],
  };
  assert.deepEqual(
    validateReportDocument(document).sections[0].body,
    document.sections[0].body,
  );
  assert.equal(validateReportPackage(bundle).documents.length, 1);
  assert.throws(() =>
    validateReportPackage({ ...bundle, documents: [document, document] }),
  );
  assert.throws(() =>
    validateReportDocument({ ...document, html: "not accepted" }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      meeting: { ...document.meeting, plannedStart: "2026-02-30T12:00:00Z" },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      ref: { ...document.ref, notesSeq: { other: 8 } },
    }),
  );
  assert.throws(() =>
    validateReportDocument({
      ...document,
      sections: [
        {
          ...document.sections[0],
          body: {
            format: "orgmap-richtext",
            version: 1,
            doc: { type: "doc", content: [{ type: "script", text: "unsafe" }] },
          },
        },
      ],
    }),
  );
  assert.throws(() =>
    validateReportPackage({
      ...bundle,
      documents: Array.from({ length: 101 }, () => document),
    }),
  );
  assert.throws(() => validateReportPackage({ ...bundle, documents: [] }));
  const serializer = createReportPackageSerializer({
    render: async () => {
      throw Error("empty bundle must not manufacture a PDF");
    },
  });
  const empty = await serializer.serialize(
    { ...bundle, documents: [], notices: ["EMPTY_AUTHORIZED_SELECTION"] },
    "ZIP",
  );
  assert.equal(empty.readUInt32LE(), 0x04034b50);
  assert.ok(empty.toString().includes('"count": 0'));
  assert.ok(empty.toString().includes("index.xlsx"));
  assert.ok(!empty.toString().includes(".pdf"));
  await assert.rejects(
    serializer.serialize(
      { ...bundle, documents: [], notices: ["EMPTY_AUTHORIZED_SELECTION"] },
      "PDF",
    ),
  );
});
