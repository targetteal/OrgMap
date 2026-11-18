import { isFoundationMigration } from "../../src/migration-selection.js";
import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
const adminUrl =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://orgmap_migrator:orgmap_local_only@127.0.0.1:55432/orgmap";
const admin = new pg.Pool({ connectionString: adminUrl });
const name = "orgmap_structure_" + randomBytes(8).toString("hex");
const url = new URL(adminUrl);
url.pathname = "/" + name;
const runtime = new URL(
  process.env.DATABASE_URL ??
    "postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap",
);
runtime.pathname = "/" + name;
let legacySubjectFixture: Record<string, string> | undefined;
let legacyDefinitionFixture: Record<string, string> | undefined;
async function seedLegacyDefinition(migrator: pg.Pool) {
  const ids = {org:randomUUID(), circle:randomUUID(), field:randomUUID()};
  const c=await migrator.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[ids.org]);
    await c.query("INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Pre-O2 fixture','pt-BR','America/Sao_Paulo')",[ids.org]);
    await c.query("INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose,purpose_rich,version) VALUES($1,$2,$3,'CIRCLE',NULL,'Círculo anterior','Propósito anterior',$4,7)",[ids.org,ids.circle,randomUUID(),JSON.stringify({format:'orgmap-richtext',version:1,doc:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Propósito anterior',marks:[{type:'bold'}]}]}]}})]);
    const schema={type:'TEXT',required:false};
    await c.query("INSERT INTO structure_fields(organization_id,id,key,label,target,schema) VALUES($1,$2,'legacy-responsibilities','Responsabilidades','BOTH',$3)",[ids.org,ids.field,JSON.stringify(schema)]);
    await c.query("INSERT INTO structure_field_revisions(organization_id,field_id,version,definition) VALUES($1,$2,1,$3)",[ids.org,ids.field,JSON.stringify(schema)]);
    await c.query("INSERT INTO structure_values(organization_id,entity_id,field_id,value,schema_version) VALUES($1,$2,$3,$4,1)",[ids.org,ids.circle,ids.field,JSON.stringify('Texto personalizado anterior')]);
    await c.query("COMMIT");
    legacyDefinitionFixture=ids;
  } catch(error) {await c.query("ROLLBACK");throw error;} finally {c.release();}
}
async function seedLegacyIndicators(migrator: pg.Pool) {
  const ids = Object.fromEntries(
    [
      "org",
      "account",
      "member",
      "circle",
      "role",
      "metric",
      "checklist",
      "record",
      "checkRecord",
      "history",
    ].map((key) => [key, randomUUID()]),
  );
  const c = await migrator.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('orgmap.organization_id',$1,true)", [
      ids.org,
    ]);
    await c.query(
      "INSERT INTO accounts(id,email,display_name,password_hash) VALUES($1,$2,'Legacy migration fixture','not-a-login-credential')",
      [ids.account, ids.account + "@example.test"],
    );
    await c.query(
      "INSERT INTO organizations(id,name,locale,time_zone) VALUES($1,'Legacy indicator migration','pt-BR','America/Sao_Paulo')",
      [ids.org],
    );
    await c.query(
      "INSERT INTO members(organization_id,id,account_id,org_role) VALUES($1,$2,$3,'OWNER')",
      [ids.org, ids.member, ids.account],
    );
    await c.query(
      "INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose) VALUES($1,$2,$3,'CIRCLE',NULL,'Legacy circle','')",
      [ids.org, ids.circle, randomUUID()],
    );
    await c.query(
      "INSERT INTO entities(organization_id,id,node_id,kind,parent_id,name,purpose) VALUES($1,$2,$3,'ROLE',$4,'Legacy role','')",
      [ids.org, ids.role, randomUUID(), ids.circle],
    );
    await c.query(
      "INSERT INTO structure_indicators(organization_id,id,entity_id,name,kind,value_type,unit,required_units,version) VALUES($1,$2,$3,'Legacy metric','METRIC','NUMBER','pontos','[\"unit\"]',4)",
      [ids.org, ids.metric, ids.circle],
    );
    await c.query(
      "INSERT INTO structure_indicators(organization_id,id,entity_id,name,kind,value_type,unit,required_units,version) VALUES($1,$2,$3,'Legacy checklist','CHECKLIST','BOOLEAN','','[\"unit\"]',2)",
      [ids.org, ids.checklist, ids.role],
    );
    await c.query(
      "INSERT INTO structure_records(organization_id,id,indicator_id,period,unit_key,value,recorded_by,version) VALUES($1,$2,$3,'legacy','unit','7',$4,3)",
      [ids.org, ids.record, ids.metric, ids.member],
    );
    await c.query(
      "INSERT INTO structure_records(organization_id,id,indicator_id,period,unit_key,value,recorded_by,version) VALUES($1,$2,$3,'legacy','unit','true',$4,2)",
      [ids.org, ids.checkRecord, ids.checklist, ids.member],
    );
    await c.query(
      "INSERT INTO structure_history(organization_id,id,resource_id,action,after_value,actor_id) VALUES($1,$2,$3,'MetricRecorded','{\"legacy\":true}',$4)",
      [ids.org, ids.history, ids.circle, ids.member],
    );
    await c.query("COMMIT");
    legacySubjectFixture = ids;
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
}
try {
  await admin.query('CREATE DATABASE "' + name + '"');
  const migrator = new pg.Pool({ connectionString: url.href });
  try {
    for (const f of (await readdir("server/migrations"))
      .filter(
        (f) =>
          isFoundationMigration(f) ||
          /^0[2-9][0-9]_.*sql$/.test(f) ||
          ((process.argv.includes("--purpose") || process.argv.includes("--definition")) && /^10[0-9]_.*sql$/.test(f)) ||
          (process.argv.includes("--member-authority") &&
            /^40[0-9]_.*sql$/.test(f)) ||
          (process.argv.includes("--integration") &&
            /^(2[0-4][0-9]|40[0-9])_.*sql$/.test(f)),
      )
      .sort()) {
      if (process.argv.includes("--subjects") && f.startsWith("030_"))
        await seedLegacyIndicators(migrator);
      if (process.argv.includes("--definition") && f.startsWith("033_"))
        await seedLegacyDefinition(migrator);
      await migrator.query(await readFile("server/migrations/" + f, "utf8"));
    }
  } finally {
    await migrator.end();
  }
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--test",
        ...(process.argv.includes("--definition")
          ? ["tests/server/structure-definition.test.ts", "tests/server/structure-purpose-direct.test.ts", "tests/server/structure-purpose.test.ts", "tests/server/structure-guest-leadlink.test.ts"]
          : process.argv.includes("--member-authority")
          ? ["tests/server/structure-member-authority.test.ts"]
          : process.argv.includes("--subjects")
            ? ["tests/server/structure-member-subject.test.ts"]
            : process.argv.includes("--capacity")
              ? ["tests/server/structure-role-capacity.test.ts"]
              : process.argv.includes("--purpose-direct")
                ? ["tests/server/structure-purpose-direct.test.ts"]
                : process.argv.includes("--purpose")
                  ? ["tests/server/structure-purpose.test.ts"]
                  : process.argv.includes("--integration")
                    ? [
                        "tests/server/structure-policy-events.test.ts",
                        "tests/server/structure-guest-leadlink.test.ts",
                      ]
                    : process.argv.includes("--views")
                      ? ["tests/server/structure-views.test.ts"]
                      : [
                          "tests/server/structure.test.ts",
                          "tests/server/structure-views.test.ts",
                        ]),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: runtime.href,
          ...(legacyDefinitionFixture ? {STRUCTURE_LEGACY_DEFINITION_FIXTURE:JSON.stringify(legacyDefinitionFixture)} : {}),
          ...(legacySubjectFixture
            ? {
                STRUCTURE_LEGACY_SUBJECT_FIXTURE:
                  JSON.stringify(legacySubjectFixture),
              }
            : {}),
        },
      },
    );
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("test exit " + code)),
    );
    p.on("error", reject);
  });
} finally {
  await admin.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
  await admin.end();
}
