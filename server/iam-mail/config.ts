import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export async function configureIamMail(
  options: { adminUrl?: string; file?: string; role?: string } = {},
) {
  const url = new URL(
    options.adminUrl ??
      process.env.MIGRATION_DATABASE_URL ??
      "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
  );
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw Error("LOCAL_DATABASE_REQUIRED");
  const role = options.role ?? "orgmap_iam_mail_local";
  if (!/^orgmap_iam_mail_local(?:_[a-f0-9]{16})?$/.test(role))
    throw Error("INVALID_ROLE");
  const c = new pg.Pool({ connectionString: url.href });
  const secret = randomBytes(32).toString("hex");
  try {
    const group = (
      await c.query(
        "SELECT * FROM pg_roles WHERE rolname='orgmap_iam_mail_dispatcher'",
      )
    ).rows[0];
    if (!group || group.rolsuper || group.rolbypassrls || group.rolcanlogin)
      throw Error("MIGRATION_009_REQUIRED");
    if (
      (await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]))
        .rowCount
    )
      throw Error("ROLE_ALREADY_EXISTS");
    await c.query(
      "CREATE ROLE " +
        role +
        " LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" +
        secret +
        "'",
    );
    await c.query("GRANT orgmap_iam_mail_dispatcher TO " + role);
    url.username = role;
    url.password = secret;
    const file = resolve(options.file ?? ".orgmap/iam-mail.env");
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + "." + randomUUID() + ".tmp";
    await writeFile(tmp, "IAM_MAIL_DISPATCH_DATABASE_URL=" + url.href + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(tmp, file);
    return { role, file };
  } finally {
    await c.end();
  }
}
