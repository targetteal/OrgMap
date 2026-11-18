import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../../server/src/app.js";
import { pool } from "../../../server/src/db.js";
import { enterManagedWriter } from "../../../server/src/managed-writer.js";
import { OrganizationLedger } from "../../../server/ops/organization-ledger.js";

const ledgerPath=process.env.ORGMAP_TEST_LEDGER, token=process.env.ORGMAP_TEST_HOST_TOKEN;
if (!ledgerPath || !token) throw Error("MANAGED_HTTP_FIXTURE_REQUIRED");
const ledger=await OrganizationLedger.open(ledgerPath), app=await buildApp();
let registration: Awaited<ReturnType<typeof enterManagedWriter>> = null;
try {
 const counts=async()=> (await pool.query("SELECT (SELECT count(*)::int FROM accounts) accounts,(SELECT count(*)::int FROM sessions) sessions")).rows[0];
 const before=await counts();
 const payload={email:`fixture-${randomUUID()}@example.test`,password:`Synthetic-${randomUUID()}`,displayName:'Fixture'};
 const denied=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin:'http://localhost:5173'},payload});
 assert.notEqual(denied.statusCode,201);
 assert.deepEqual(await counts(),before);
 const diagnostic=await app.inject({method:'GET',url:'/api/health'});
 assert.notEqual(diagnostic.statusCode,404);
 registration=await enterManagedWriter({ledger,token});
 assert.ok(registration);
 const allowed=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin:'http://localhost:5173'},payload});
 assert.equal(allowed.statusCode,201,allowed.body);
 const after=await counts();
 assert.equal(after.accounts,before.accounts+1);assert.equal(after.sessions,before.sessions+1);
 process.stdout.write(JSON.stringify({deniedStatus:denied.statusCode,diagnosticStatus:diagnostic.statusCode,allowedStatus:allowed.statusCode,countsPreservedBeforeJoin:true})+'\n');
} finally { await app.close();await registration?.release();await pool.end(); }
