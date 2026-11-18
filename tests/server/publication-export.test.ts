import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fromPlainText, toPlainText } from "../../packages/content/index.js";
import { serializePublicationExport } from "../../server/modules/platform/publication-export.js";
const group = randomUUID(),
  post = randomUUID(),
  selection = randomUUID(),
  doc = fromPlainText("ação 🌿");
const snapshot = {
  schema: "orgmap.publications.export.v1",
  asOf: "2026-10-30T20:00:00.000Z",
  groups: [
    {
      id: group,
      name: "Pesquisa",
      version: 1,
      posts: [
        {
          id: post,
          authorMemberId: randomUUID(),
          publishedVersion: 1,
          publishedAt: "2026-10-30T19:00:00.000Z",
          title: "Olá",
          bodyRichDocument: doc,
          bodyPlain: toPlainText(doc),
          omittedAttachmentCount: 0,
        },
      ],
    },
  ],
};
test("ZIP is independently readable and manifest hashes actual Unicode JSON", () => {
  const bytes = serializePublicationExport(selection, snapshot);
  const p = spawnSync(
    "python3",
    [
      "-c",
      `import sys,zipfile,io,json,hashlib
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
m=json.loads(z.read("manifest.json")); f=m["files"][0]; b=z.read(f["path"])
print(json.dumps({"names":z.namelist(),"manifest":m,"content":json.loads(b),"sha":hashlib.sha256(b).hexdigest(),"size":len(b)}))`,
    ],
    { input: bytes, encoding: "utf8" },
  );
  assert.equal(p.status, 0, p.stderr);
  const actual = JSON.parse(p.stdout);
  assert.deepEqual(actual.names, ["manifest.json", `groups/${group}.json`]);
  assert.equal(actual.manifest.files[0].sha256, actual.sha);
  assert.equal(actual.manifest.files[0].size, actual.size);
  assert.equal(actual.manifest.publicationCount, 1);
  assert.equal(actual.content.posts[0].bodyPlain, "ação 🌿");
  assert.deepEqual(bytes, serializePublicationExport(selection, snapshot));
  assert.equal(createHash("sha256").update(bytes).digest("hex").length, 64);
});
test("rejects traversal, extra fields, wrong projection and oversize", () => {
  assert.throws(() =>
    serializePublicationExport(selection, {
      ...snapshot,
      groups: [{ ...snapshot.groups[0], id: "../../escape" }],
    }),
  );
  assert.throws(() =>
    serializePublicationExport(selection, { ...snapshot, secret: "x" }),
  );
  assert.throws(() =>
    serializePublicationExport(selection, {
      ...snapshot,
      groups: [
        {
          ...snapshot.groups[0],
          posts: [{ ...snapshot.groups[0].posts[0], bodyPlain: "stale" }],
        },
      ],
    }),
  );
  const body = fromPlainText("x".repeat(190000));
  const posts = Array.from({ length: 30 }, () => ({
    ...snapshot.groups[0].posts[0],
    id: randomUUID(),
    bodyRichDocument: body,
    bodyPlain: toPlainText(body),
  })).sort((a, b) => a.id.localeCompare(b.id));
  assert.throws(
    () =>
      serializePublicationExport(selection, {
        ...snapshot,
        groups: [{ ...snapshot.groups[0], posts }],
      }),
    (e) => (e as any).code === "EXPORT_SCOPE_TOO_LARGE",
  );
});
