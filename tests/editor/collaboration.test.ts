import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  createRichYDoc,
  hasPendingYUpdates,
  migrateLegacyNotes,
  readRichSnapshot,
  readRichYDoc,
  RICH_TEXT_FRAGMENT,
  RICH_TEXT_POSITION_METADATA,
  validateRichUpdate,
} from "../../packages/content/collaboration.ts";
import {
  fromPlainText,
  renderHTML,
  toPlainText,
  validateRichDocument,
} from "../../packages/content/index.ts";

const snapshot = (d: Y.Doc) => Y.encodeStateAsUpdate(d);
const fork = (d: Y.Doc) => {
  const c = new Y.Doc();
  Y.applyUpdate(c, snapshot(d));
  return c;
};
function text(d: Y.Doc) {
  return (d.getXmlFragment(RICH_TEXT_FRAGMENT).get(0) as Y.XmlElement).get(
    0,
  ) as Y.XmlText;
}

test("official binding roundtrips all marks and lists through the closed server schema", () => {
  const value = validateRichDocument({
    format: "orgmap-richtext",
    version: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "Olá 👩🏽‍💻",
                      marks: [
                        { type: "bold" },
                        { type: "italic" },
                        { type: "underline" },
                        { type: "strike" },
                        {
                          type: "link",
                          attrs: { href: "https://example.org/" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const doc = createRichYDoc(value);
  try {
    assert.deepEqual(readRichYDoc(doc), value);
    assert.deepEqual(readRichSnapshot(snapshot(doc)), value);
  } finally {
    doc.destroy();
  }
});

test("two clients merge concurrent Unicode/formatting; updates duplicate safely and snapshot survives reconnect", () => {
  const base = createRichYDoc(fromPlainText("base")),
    a = fork(base),
    b = fork(base);
  try {
    const vector = Y.encodeStateVector(base);
    text(a).insert(0, "α👩🏽‍💻 ", { bold: {} });
    text(b).insert(4, " 漢字", { italic: {} });
    const ua = Y.encodeStateAsUpdate(a, vector),
      ub = Y.encodeStateAsUpdate(b, vector);
    const ab = validateRichUpdate(
      validateRichUpdate(snapshot(base), ua).snapshot,
      ub,
    );
    const ba = validateRichUpdate(
      validateRichUpdate(snapshot(base), ub).snapshot,
      ua,
    );
    assert.deepEqual(ab.document, ba.document);
    assert.match(toPlainText(ab.document), /α👩🏽‍💻/);
    assert.match(toPlainText(ab.document), /漢字/);
    assert.match(renderHTML(ab.document), /<strong>/);
    assert.match(renderHTML(ab.document), /<em>/);
    assert.deepEqual(validateRichUpdate(ab.snapshot, ua).document, ab.document);
    assert.deepEqual(readRichSnapshot(ab.snapshot), ab.document);
  } finally {
    base.destroy();
    a.destroy();
    b.destroy();
  }
});

test("candidate rejects executable/unknown XML and never mutates confirmed snapshot", () => {
  const base = createRichYDoc(fromPlainText("confirmed")),
    original = snapshot(base);
  const attacks: ((d: Y.Doc) => void)[] = [
    (d) => text(d).format(0, 1, { link: { href: "javascript:alert(1)" } }),
    (d) => text(d).format(0, 1, { bold: { onclick: "alert(1)" } }),
    (d) =>
      (
        d.getXmlFragment(RICH_TEXT_FRAGMENT).get(0) as Y.XmlElement
      ).setAttribute("onclick", "alert(1)"),
    (d) =>
      d.getXmlFragment(RICH_TEXT_FRAGMENT).push([new Y.XmlElement("script")]),
    (d) => d.getMap("secret").set("html", "<script>"),
    (d) => text(d).setAttribute("hidden", "payload"),
    (d) => text(d).insertEmbed(0, { html: "<iframe>" }),
    (d) => text(d).format(0, 1, { bold: true }),
  ];
  try {
    for (const attack of attacks) {
      const bad = fork(base);
      try {
        attack(bad);
        assert.throws(() =>
          validateRichUpdate(
            original,
            Y.encodeStateAsUpdate(bad, Y.encodeStateVector(base)),
          ),
        );
      } finally {
        bad.destroy();
      }
      assert.equal(toPlainText(readRichSnapshot(original)), "confirmed");
    }
    assert.throws(() => readRichSnapshot(new Uint8Array([255, 255])));
    const hiddenRootAttrs = new Y.Doc();
    try {
      hiddenRootAttrs.getMap(RICH_TEXT_FRAGMENT).set("hidden", "payload");
      assert.throws(
        () => validateRichUpdate(original, snapshot(hiddenRootAttrs)),
        /ocultos na raiz/,
      );
    } finally {
      hiddenRootAttrs.destroy();
    }
    for (const payload of [
      { html: "<script>" },
      {
        version: 1,
        client: 1,
        clock: 1,
        seen: [],
        transfers: [
          {
            source: { client: 1, clock: 1, length: 1 },
            target: { client: 1, clock: 1, type: null, tname: "secret" },
          },
        ],
      },
    ]) {
      const metadata = new Y.Doc();
      try {
        metadata.getMap(RICH_TEXT_POSITION_METADATA).set("1:1", payload);
        assert.throws(() => validateRichUpdate(original, snapshot(metadata)));
      } finally {
        metadata.destroy();
      }
    }
    assert.throws(
      () => validateRichUpdate(original, new Uint8Array(1_000_001)),
      /binário/,
    );
  } finally {
    base.destroy();
  }
});

test("legacy migration is new-document only, exact CRLF/Unicode/blank lines, detached original bytes", () => {
  const legacy = new Y.Doc();
  try {
    const plain = "  Olá 👩🏽‍💻\r\n\n漢字\r\n";
    legacy.getText("notes").insert(0, plain);
    const old = snapshot(legacy),
      migrated = migrateLegacyNotes(old);
    assert.equal(toPlainText(migrated.document), plain);
    assert.equal(toPlainText(readRichSnapshot(migrated.snapshot)), plain);
    assert.deepEqual(migrated.originalSnapshot, old);
    assert.notEqual(migrated.originalSnapshot, old);
    assert.equal(legacy.getText("notes").toString(), plain);
    const fresh = new Y.Doc();
    try {
      Y.applyUpdate(fresh, migrated.snapshot);
      assert.deepEqual([...fresh.share.keys()], [RICH_TEXT_FRAGMENT]);
    } finally {
      fresh.destroy();
    }
  } finally {
    legacy.destroy();
  }
});

test("migration refuses ACK-able out-of-order structs and deletes until all dependencies resolve", () => {
  const source = new Y.Doc(),
    updates: Uint8Array[] = [];
  source.on("update", (u) => updates.push(u));
  try {
    source.getText("notes").insert(0, "first");
    source.getText("notes").insert(5, " second");
    source.getText("notes").delete(0, 1);
    for (const u of [updates[1], updates[2]]) {
      const pending = new Y.Doc();
      try {
        Y.applyUpdate(pending, u);
        assert.equal(hasPendingYUpdates(pending), true);
        assert.throws(
          () => migrateLegacyNotes(snapshot(pending)),
          /LEGACY_PENDING_UPDATES/,
        );
        Y.applyUpdate(pending, snapshot(source));
        assert.equal(hasPendingYUpdates(pending), false);
        assert.equal(
          toPlainText(migrateLegacyNotes(snapshot(pending)).document),
          source.getText("notes").toString(),
        );
      } finally {
        pending.destroy();
      }
    }
  } finally {
    source.destroy();
  }
});

test("migration rejects non-plain legacy roots, formatting and embedded values instead of dropping them", () => {
  const docs: Y.Doc[] = [];
  try {
    let d = new Y.Doc();
    docs.push(d);
    d.getText("notes").insert(0, "x", { bold: {} });
    d = new Y.Doc();
    docs.push(d);
    d.getMap("other").set("secret", "x");
    d = new Y.Doc();
    docs.push(d);
    d.getText("notes").insertEmbed(0, { secret: true });
    d = new Y.Doc();
    docs.push(d);
    d.getMap("notes").set("x", "y");
    for (const doc of docs)
      assert.throws(() => migrateLegacyNotes(snapshot(doc)));
  } finally {
    docs.forEach((d) => d.destroy());
  }
});
