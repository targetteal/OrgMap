/** Dedicated QA harness, not the central integration factory. Existing Goals preview DB only. */
process.env.DATABASE_URL="postgres://orgmap_app:orgmap_app_local_only@127.0.0.1:55432/orgmap_goals_preview";
process.env.ALLOWED_ORIGINS="http://goals-guest.localhost:5179";
const {buildApp}=await import("../../src/app.js");
const {pool}=await import("../../src/db.js");
const {createGoalsModule}=await import("./plugin.js");
const {createGoalsGuestAccessAdapter}=await import("./guest.js");
const {foundationDefaultAdmissionPolicy}=await import("../../src/admission.js");
const app=await buildApp([foundationDefaultAdmissionPolicy,async (_app,core)=>{
 core.registerOrganizationSettings(async ctx=>({version:1,settings:{name:ctx.org.name,locale:ctx.org.locale,timezone:ctx.org.time_zone,modules:{structure:true,goals:true}}}));
 core.registerGuestAccessAdapter(createGoalsGuestAccessAdapter(core));
},createGoalsModule()],{migrationMaxPrefix:999});
await app.listen({host:"127.0.0.1",port:3009});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{await app.close();await pool.end();process.exit(0);});
