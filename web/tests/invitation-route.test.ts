import test from "node:test";
import assert from "node:assert/strict";
import { invitationPath, invitationRoute } from "../src/invitation-route";

test("invitation route consumes only a valid fragment proof and returns a clean safe path", () => {
  const token = "a".repeat(64);
  assert.deepEqual(invitationRoute(`/invitations/accept/#token=${token}&other=value`), { path: invitationPath, token });
  assert.deepEqual(invitationRoute(`/invitations/accept?token=${token}&email=private@example.test`), { path: invitationPath });
  assert.deepEqual(invitationRoute(`/invitations/accept?token=ignored#token=${token}`), { path: invitationPath, token });
  assert.deepEqual(invitationRoute("/invitations/accept#token=bad"), { path: invitationPath });
});

test("invitation route rejects external origins and unrelated paths", () => {
  assert.equal(invitationRoute("https://outside.example/invitations/accept#token=" + "a".repeat(64)), null);
  assert.equal(invitationRoute("//outside.example/invitations/accept"), null);
  assert.equal(invitationRoute("/invitations/accept/extra"), null);
  assert.equal(invitationRoute("/enrollment#token=" + "a".repeat(64)), null);
});
