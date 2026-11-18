import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Local operator-only provisioning. Never expose this function as an HTTP route. */
export async function configureLocalDispatcher(
  options: {
    adminUrl?: string;
    file?: string;
    role?: string;
  } = {},
) {
  const url = new URL(
    options.adminUrl ??
      process.env.MIGRATION_DATABASE_URL ??
      "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap",
  );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !["postgres:", "postgresql:"].includes(url.protocol)
  )
    throw Error("LOCAL_DATABASE_REQUIRED");

  const role = options.role ?? "orgmap_platform_dispatcher_local";
  if (!/^orgmap_platform_dispatcher_local(?:_[a-f0-9]{16})?$/.test(role))
    throw Error("INVALID_DISPATCH_ROLE");
  const file = resolve(options.file ?? ".orgmap/platform-dispatcher.env");
  const admin = new pg.Pool({ connectionString: url.href });
  const secret = randomBytes(32).toString("hex");
  let temporary: string | undefined;
  let createdRole = false;
  let completed = false;
  try {
    const group = (
      await admin.query(
        "SELECT oid,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='orgmap_platform_dispatcher'",
      )
    ).rows[0];
    if (!group || group.rolsuper || group.rolbypassrls || group.rolcanlogin)
      throw Error("MIGRATION_432_REQUIRED");

    // These exact overloads are the runtime ABI used by PostgresScopeDispatch.
    const functions = [
      "public.platform_claim_scope(uuid,text[])",
      "public.platform_release_scope(uuid,uuid,uuid,boolean,text[])",
      "public.platform_heartbeat_scope(uuid,uuid,uuid)",
    ] as const;
    for (const signature of functions) {
      const row = (
        await admin.query("SELECT to_regprocedure($1) AS fn", [signature])
      ).rows[0];
      if (!row.fn) throw Error("MIGRATION_432_REQUIRED");
      if (
        !(
          await admin.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
            ["orgmap_platform_dispatcher", row.fn],
          )
        ).rows[0].allowed
      )
        throw Error("MIGRATION_432_REQUIRED");
    }

    const existing = (
      await admin.query(
        "SELECT oid,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname=$1",
        [role],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.rolsuper ||
        existing.rolbypassrls ||
        existing.rolcreatedb ||
        existing.rolcreaterole ||
        existing.rolreplication
      )
        throw Error("EXISTING_DISPATCH_ROLE_UNSAFE");
      if (
        (
          await admin.query(
            "SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=$1 AND r.rolname<>'orgmap_platform_dispatcher'",
            [existing.oid],
          )
        ).rowCount
      )
        throw Error("EXISTING_DISPATCH_ROLE_HAS_OTHER_MEMBERSHIP");
      if (
        (
          await admin.query(
            "SELECT 1 FROM pg_class WHERE relowner=$1 UNION ALL SELECT 1 FROM pg_proc WHERE proowner=$1",
            [existing.oid],
          )
        ).rowCount
      )
        throw Error("EXISTING_DISPATCH_ROLE_OWNS_OBJECTS");
    } else {
      await admin.query(
        "CREATE ROLE " +
          role +
          " LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION",
      );
      createdRole = true;
    }
    await admin.query("GRANT orgmap_platform_dispatcher TO " + role);
    // The generated password is hex-only, so it cannot alter the statement.
    await admin.query(
      "ALTER ROLE " + role + " LOGIN PASSWORD '" + secret + "'",
    );

    // No direct read access to any public relation is needed by the definer functions.
    const relations = (
      await admin.query(
        "SELECT format('%I.%I',n.nspname,c.relname) AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')",
      )
    ).rows;
    for (const { name } of relations) {
      if (
        (
          await admin.query(
            "SELECT has_table_privilege($1,$2,'SELECT') AS allowed",
            [role, name],
          )
        ).rows[0].allowed
      )
        throw Error("DISPATCH_ROLE_CAN_READ_PRIVATE_TABLES");
    }

    // Store credentials only in the ignored, operator-readable local env file.
    url.username = role;
    url.password = secret;
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    temporary = file + "." + randomUUID() + ".tmp";
    await writeFile(
      temporary,
      "PLATFORM_DISPATCH_DATABASE_URL=" + url.href + "\n",
      { mode: 0o600, flag: "wx" },
    );
    await rename(temporary, file);
    temporary = undefined;
    completed = true;
    return {
      file,
      role,
      host: url.hostname,
      port: url.port,
      database: url.pathname.slice(1),
    };
  } finally {
    if (temporary) await rm(temporary, { force: true });
    if (createdRole && !completed)
      await admin.query("DROP ROLE IF EXISTS " + role);
    await admin.end();
  }
}
