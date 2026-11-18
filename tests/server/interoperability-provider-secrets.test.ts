import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProviderEncryptionKey, sealProviderToken, openProviderToken } from "../../server/modules/interoperability/providers/secrets.js";
test("provider token encryption binds tenant/grant/member/provider/field and private operator key without plaintext fallback", async () => {
  const key = randomBytes(32), scope = { organizationId: randomUUID(), grantId: randomUUID(), memberId: randomUUID(), provider: "TRELLO" as const };
  const token = "synthetic-private-refresh-token";
  const sealed = sealProviderToken(key, scope, "REFRESH_TOKEN", token);
  assert.ok(!sealed.includes(token));
  assert.notEqual(sealed, sealProviderToken(key, scope, "REFRESH_TOKEN", token));
  assert.equal(openProviderToken(key, scope, "REFRESH_TOKEN", sealed), token);
  for (const changed of [{ ...scope, organizationId: randomUUID() }, { ...scope, grantId: randomUUID() }, { ...scope, memberId: randomUUID() }])
    assert.throws(() => openProviderToken(key, changed, "REFRESH_TOKEN", sealed), { message: "PROVIDER_SECRET_UNAVAILABLE" });
  assert.throws(() => openProviderToken(key, scope, "ACCESS_TOKEN", sealed));
  assert.throws(() => openProviderToken(randomBytes(32), scope, "REFRESH_TOKEN", sealed));
  const parts = sealed.split("."); parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  assert.throws(() => openProviderToken(key, scope, "REFRESH_TOKEN", parts.join(".")));
  assert.throws(() => openProviderToken(key, scope, "REFRESH_TOKEN", token));
  const directory = await mkdtemp(join(tmpdir(), "orgmap-provider-key-")), path = join(directory, "provider.key");
  try {
    await writeFile(path, key.toString("hex"), { mode: 0o600 });
    assert.deepEqual(await readProviderEncryptionKey(path), key);
    await chmod(path, 0o644);
    await assert.rejects(() => readProviderEncryptionKey(path), { message: "PROVIDER_ENCRYPTION_CONFIGURATION_REQUIRED" });
    await chmod(path, 0o600);
    await symlink(path, join(directory, "linked.key"));
    await assert.rejects(() => readProviderEncryptionKey(join(directory, "linked.key")));
    await assert.rejects(() => readProviderEncryptionKey("relative.key"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
