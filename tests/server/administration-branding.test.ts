import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { parseBrandingMultipart } from "../../server/modules/administration/branding-upload.js";
import { createBrandingDecoder, BRANDING_INPUT_BYTES } from "../../server/modules/administration/branding-image.js";

test("branding raster decoder normalizes purpose bounds and strips metadata", async () => {
  const decoder = createBrandingDecoder();
  const input = await sharp({ create: { width: 1200, height: 600, channels: 4, background: { r: 30, g: 80, b: 90, alpha: 0.5 } } }).png().withMetadata().toBuffer();
  for (const purpose of ["WORKSPACE_LOGO", "EMAIL_LOGO"] as const) {
    const result = await decoder.decodeAndNormalize(input, purpose);
    assert.equal(result.mime, "image/png");
    assert.deepEqual([result.width, result.height], purpose === "EMAIL_LOGO" ? [360, 180] : [720, 360]);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.exif, undefined);
  }
  const bg = await sharp({ create: { width: 3000, height: 1800, channels: 3, background: "#345678" } }).jpeg().toBuffer();
  const result = await decoder.decodeAndNormalize(bg, "LOGIN_BACKGROUND");
  assert.deepEqual([result.width, result.height], [2560, 1536]);
});

test("branding decoder rejects unsupported, corrupt, oversized and undersized backgrounds", async () => {
  const decoder = createBrandingDecoder();
  await assert.rejects(decoder.decodeAndNormalize(Buffer.from("<svg/>"), "WORKSPACE_LOGO"));
  await assert.rejects(decoder.decodeAndNormalize(Buffer.from([137,80,78,71,13,10,26,10]), "WORKSPACE_LOGO"));
  await assert.rejects(decoder.decodeAndNormalize(Buffer.alloc(BRANDING_INPUT_BYTES + 1), "WORKSPACE_LOGO"));
  const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(decoder.decodeAndNormalize(small, "LOGIN_BACKGROUND"));
});

test("multipart parser accepts one file and explicit publication; rejects extras and truncation", async () => {
  const image=await sharp({create:{width:4,height:4,channels:3,background:"red"}}).png().toBuffer();
  const prefix=Buffer.from('--br123\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n');
  const end=Buffer.from('\r\n--br123\r\nContent-Disposition: form-data; name="publish"\r\n\r\ntrue\r\n--br123--\r\n');
  const payload=Buffer.concat([prefix,image,end]);
  assert.deepEqual(parseBrandingMultipart('multipart/form-data; boundary=br123',payload),{base64:image.toString('base64'),publish:true});
  assert.throws(()=>parseBrandingMultipart('multipart/form-data; boundary=br123',payload.subarray(0,-2)));
  assert.throws(()=>parseBrandingMultipart('multipart/form-data; boundary=br123',Buffer.concat([prefix,image,Buffer.from('\r\n--br123\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\n\r\nx\r\n--br123--\r\n')])));
  assert.throws(()=>parseBrandingMultipart('multipart/form-data; boundary=br123',Buffer.concat([prefix,image,Buffer.from('\r\n--br123\r\nContent-Disposition: form-data; name="unexpected"\r\n\r\nx\r\n--br123--\r\n')])));
});

test("branding HTTP lifecycle with real PostgreSQL and private raster store", async () => {
  const { randomUUID } = await import("node:crypto");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { buildApp } = await import("../../server/src/app.js");
  const { pool, transaction } = await import("../../server/src/db.js");
  const { lockActiveOrganization } = await import("../../server/src/organization-lifecycle.js");
  const { createBrandingStorage } = await import("../../server/modules/administration/branding-image.js");
  const { createBrandingServices } = await import("../../server/modules/administration/branding.js");
  const dir=await mkdtemp(join(tmpdir(),"orgmap-branding-test-"));
  const svc=createBrandingServices({authorize: async ctx=>ctx.member.org_role==='OWNER',decoder:createBrandingDecoder(),storage:createBrandingStorage(dir),lifecycle:{assertTenantReadable:async()=>{},assertTenantWritable:async()=>{},assertPublicReadable:async(c,org)=>{await lockActiveOrganization(c,org);}}});
  const app=await buildApp([async (app,core)=>{ svc.register(app,core); app.get('/api/v1/organizations/:organizationId/test-mail-brand',r=>core.tenant(r,{mode:'read'},async ctx=>{const part=await svc.emailInline(ctx); return {mime:part?.contentType, cid:part?.cid, data:part ? Buffer.from(part.content).toString('base64') : null};})); }]);
  try {
    const register=await app.inject({method:'POST',url:'/api/v1/auth/register',headers:{origin:'http://localhost:5173'},payload:{email:`${randomUUID()}@example.test`,password:'a-secure-password-123',displayName:'Brand test'}});
    assert.equal(register.statusCode,201,register.body);
    const cookie=register.cookies[0].name+'='+register.cookies[0].value, csrf=register.json().data.csrfToken;
    const request=(method:string,url:string,payload?:any,revision?:number,requestKey=randomUUID())=>app.inject({method:method as any,url,headers:{origin:'http://localhost:5173',cookie,'x-csrf-token':csrf,'idempotency-key':requestKey,...(revision===undefined?{}:{'if-match':`"${revision}"`})},payload});
    const created=await request('POST','/api/v1/organizations',{name:'Branding test'}); assert.equal(created.statusCode,201,created.body);
    const org=created.json().data.organization.id, base=`/api/v1/organizations/${org}/administration/branding-assets`;
    await transaction(async c=>{await c.query("SELECT set_config('orgmap.organization_id',$1,true)",[org]); await c.query("INSERT INTO administration_settings(organization_id,id,settings) VALUES($1,$2,$3)",[org,randomUUID(),{branding:{logoUrl:'https://example.test/legacy.png'}}]);});
    const initial=await request('GET',base); assert.equal(initial.statusCode,200,initial.body); assert.equal(initial.json().data.assets[0].origin,'LEGACY_EXTERNAL');
    const stranger=await app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:'127.0.0.2',headers:{origin:'http://localhost:5173'},payload:{email:`${randomUUID()}@example.test`,password:'a-secure-password-123',displayName:'Stranger'}}); assert.equal(stranger.statusCode,201,stranger.body);
    const foreign=await app.inject({method:'GET',url:base,headers:{cookie:stranger.cookies[0].name+'='+stranger.cookies[0].value}}); assert.equal(foreign.statusCode,404);
    const logo=await sharp({create:{width:100,height:80,channels:4,background:'red'}}).png().toBuffer();
    const background=await sharp({create:{width:2000,height:1500,channels:3,background:'blue'}}).png().toBuffer();
    for(const purpose of ['workspace-logo','email-logo','login-background']) {
      const path=`${base}/${purpose}`, payload={base64:(purpose==='login-background'?background:logo).toString('base64'),...(purpose==='login-background'?{publish:true}:{})};
      const boundary='orgmap-test-boundary', parts=[Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`),purpose==='login-background'?background:logo,Buffer.from(purpose==='login-background'?`\r\n--${boundary}\r\nContent-Disposition: form-data; name="publish"\r\n\r\ntrue\r\n--${boundary}--\r\n`:`\r\n--${boundary}--\r\n`)];
      const upload=(revision:number,requestKey:string)=>app.inject({method:'POST',url:path,headers:{origin:'http://localhost:5173',cookie,'x-csrf-token':csrf,'idempotency-key':requestKey,'if-match':`"${revision}"`,'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat(parts)});
      const k=randomUUID(), first=await upload(0,k); assert.equal(first.statusCode,200,first.body);
      const firstAsset=first.json().data.asset; assert.equal(firstAsset.revision,1);
      const replay=await upload(0,k); assert.equal(replay.statusCode,200,replay.body);
      const oldUrl=firstAsset.readUrl;
      if(purpose==='email-logo') { const email=await request('GET',`/api/v1/organizations/${org}/test-mail-brand`); assert.equal(email.statusCode,200,email.body); const part=email.json().data; assert.equal(part.mime,'image/png'); assert.match(part.cid,/^orgmap-brand-/); assert.deepEqual((await sharp(Buffer.from(part.data,'base64')).metadata()).format,'png'); }
      if(purpose==='workspace-logo') { const imageRead=await request('GET',oldUrl); assert.equal(imageRead.statusCode,200); assert.equal(imageRead.headers['content-type'],'image/png'); }
      const replacement=await upload(1,randomUUID()); assert.equal(replacement.statusCode,200,replacement.body);
      assert.equal((await upload(0,k)).statusCode,409);
      if(purpose==='login-background') { assert.equal((await app.inject({method:'GET',url:oldUrl})).statusCode,404); assert.equal((await app.inject({method:'GET',url:replacement.json().data.asset.readUrl})).statusCode,200); }
      const removed=await request('DELETE',path,undefined,2); assert.equal(removed.statusCode,200,removed.body); assert.equal(removed.json().data.asset.origin,'NONE');
    }
    const list=await request('GET',base); assert.equal(list.statusCode,200,list.body); assert.ok(list.json().data.assets.every((a:any)=>a.origin==='NONE'&&a.revision===3)); assert.equal(list.json().data.assets[0].legacyUrl,null);
    const invalid=await request('POST',base+'/workspace-logo',{base64:Buffer.from('<svg/>').toString('base64')},3); assert.equal(invalid.statusCode,422);
  } finally { await app.close(); await pool.end(); await rm(dir,{recursive:true,force:true}); }
});
