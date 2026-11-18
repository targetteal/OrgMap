import { test } from "node:test";
import assert from "node:assert/strict";
import {
  platformMessages,
  platformTranslator,
  resourceLabel,
  notificationEventLabel,
} from "../../web/src/features/platform/messages.js";
test("platform navigation/search catalogs cover eight locales with explicit defensive fallback", () => {
  const keys = Object.keys(platformMessages["pt-BR"]).sort();
  assert.equal(Object.keys(platformMessages).length, 8);
  assert.equal(platformTranslator("en-US")("commentSubmit"), "Comment");
  assert.equal(platformTranslator("ja-JP")("commentsMore"), "さらにコメントを読み込む");
  for (const dictionary of Object.values(platformMessages)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    assert.ok(
      Object.values(dictionary).every(
        (value) => typeof value === "string" && value.trim().length > 0,
      ),
    );
  }
  assert.equal(
    platformTranslator("en-US")("searchOrganization"),
    "Search the organization",
  );
  assert.equal(
    platformTranslator("ja-JP")("noResults"),
    "検索結果がありません。",
  );
  assert.equal(platformTranslator("unknown")("search"), "Pesquisar");
  assert.equal(
    platformTranslator("fr-FR")("results", { count: "1 234" }),
    "1 234 résultats",
  );
  assert.equal(
    resourceLabel("project", platformTranslator("de-DE")),
    "Projekte",
  );
  assert.equal(
    resourceLabel("private-internal-kind", platformTranslator("en-US")),
    "Other resources",
  );
  for(const locale of Object.keys(platformMessages)){
    assert.notEqual(notificationEventLabel('InvitationAccepted','InvitationAccepted',locale),'InvitationAccepted');
    assert.notEqual(notificationEventLabel('InvitationDeliveryFailed','InvitationDeliveryFailed',locale),'InvitationDeliveryFailed');
    assert.notEqual(resourceLabel('invitation',platformTranslator(locale)),resourceLabel('private-internal-kind',platformTranslator(locale)));
  }
});
