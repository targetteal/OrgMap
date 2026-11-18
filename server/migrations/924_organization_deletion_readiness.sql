-- Shared private fingerprint computation; no job-independent access to the digest.
CREATE FUNCTION orgmap_deletion_schema_fingerprint_internal()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result text;
BEGIN
 PERFORM public.orgmap_deletion_require_schema_lock();
 SELECT encode(sha256(convert_to(jsonb_build_object('tables',COALESCE(jsonb_agg(jsonb_build_object(
  'schema',n.nspname,'schemaAcl',COALESCE(n.nspacl::text,''),'schemaAppCreate',has_schema_privilege('orgmap_app',n.oid,'CREATE'),'table',c.relname,'kind',c.relkind,'owner',(SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles WHERE oid=c.relowner),'acl',COALESCE(c.relacl,acldefault('r',c.relowner))::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
  'appPrivileges',jsonb_build_array(has_table_privilege('orgmap_app',c.oid,'SELECT'),has_table_privilege('orgmap_app',c.oid,'INSERT'),has_table_privilege('orgmap_app',c.oid,'UPDATE'),has_table_privilege('orgmap_app',c.oid,'DELETE')),
  'maintenancePrivileges',jsonb_build_array(has_table_privilege('orgmap_lifecycle_maintenance',c.oid,'SELECT'),has_table_privilege('orgmap_lifecycle_maintenance',c.oid,'INSERT'),has_table_privilege('orgmap_lifecycle_maintenance',c.oid,'UPDATE'),has_table_privilege('orgmap_lifecycle_maintenance',c.oid,'DELETE')),
  'drainPrivileges',jsonb_build_array(has_table_privilege('orgmap_lifecycle_drain',c.oid,'SELECT'),has_table_privilege('orgmap_lifecycle_drain',c.oid,'INSERT'),has_table_privilege('orgmap_lifecycle_drain',c.oid,'UPDATE'),has_table_privilege('orgmap_lifecycle_drain',c.oid,'DELETE')),
  'acceptancePrivileges',jsonb_build_array(has_table_privilege('orgmap_lifecycle_acceptance',c.oid,'SELECT'),has_table_privilege('orgmap_lifecycle_acceptance',c.oid,'INSERT'),has_table_privilege('orgmap_lifecycle_acceptance',c.oid,'UPDATE'),has_table_privilege('orgmap_lifecycle_acceptance',c.oid,'DELETE')),
  'ledgerPrivileges',jsonb_build_array(has_table_privilege('orgmap_lifecycle_ledger_confirm',c.oid,'SELECT'),has_table_privilege('orgmap_lifecycle_ledger_confirm',c.oid,'INSERT'),has_table_privilege('orgmap_lifecycle_ledger_confirm',c.oid,'UPDATE'),has_table_privilege('orgmap_lifecycle_ledger_confirm',c.oid,'DELETE')),
  'blobPrivileges',jsonb_build_array(has_table_privilege('orgmap_lifecycle_blob',c.oid,'SELECT'),has_table_privilege('orgmap_lifecycle_blob',c.oid,'INSERT'),has_table_privilege('orgmap_lifecycle_blob',c.oid,'UPDATE'),has_table_privilege('orgmap_lifecycle_blob',c.oid,'DELETE')),
  'finalizePrivileges',jsonb_build_array(has_table_privilege('orgmap_lifecycle_finalize',c.oid,'SELECT'),has_table_privilege('orgmap_lifecycle_finalize',c.oid,'INSERT'),has_table_privilege('orgmap_lifecycle_finalize',c.oid,'UPDATE'),has_table_privilege('orgmap_lifecycle_finalize',c.oid,'DELETE')),
  'columns',(SELECT COALESCE(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,COALESCE(a.attacl::text,''),COALESCE(pg_get_expr(d.adbin,d.adrelid),'')) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT COALESCE(jsonb_agg(jsonb_build_array(k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,k.connoinherit,pg_get_constraintdef(k.oid,true)) ORDER BY k.conname),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid),
  'triggers',(SELECT COALESCE(jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true),pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname),'[]'::jsonb) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal),
  'indexes',(SELECT COALESCE(jsonb_agg(jsonb_build_array(i.relname,x.indisunique,x.indisprimary,x.indisvalid,x.indisready,x.indislive,x.indimmediate,pg_get_indexdef(i.oid)) ORDER BY i.relname),'[]'::jsonb) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid WHERE x.indrelid=c.oid),
  'policies',(SELECT COALESCE(jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,(SELECT COALESCE(jsonb_agg(COALESCE(r.rolname,'PUBLIC') ORDER BY COALESCE(r.rolname,'PUBLIC')),'[]'::jsonb) FROM unnest(p.polroles) roleid LEFT JOIN pg_roles r ON r.oid=roleid),COALESCE(pg_get_expr(p.polqual,p.polrelid),''),COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),'')) ORDER BY p.polname),'[]'::jsonb) FROM pg_policy p WHERE p.polrelid=c.oid)
 ) ORDER BY n.nspname,c.relname),'[]'::jsonb),
 'functions',(SELECT COALESCE(jsonb_agg(jsonb_build_array(fn.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prokind,p.prosecdef,to_jsonb(p.proconfig),(SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles WHERE oid=p.proowner),COALESCE(p.proacl::text,''),pg_get_functiondef(p.oid),has_function_privilege('orgmap_app',p.oid,'EXECUTE'),has_function_privilege('orgmap_lifecycle_maintenance',p.oid,'EXECUTE'),has_function_privilege('orgmap_lifecycle_drain',p.oid,'EXECUTE'),has_function_privilege('orgmap_lifecycle_acceptance',p.oid,'EXECUTE'),has_function_privilege('orgmap_lifecycle_ledger_confirm',p.oid,'EXECUTE'),has_function_privilege('orgmap_lifecycle_blob',p.oid,'EXECUTE'),has_function_privilege('orgmap_lifecycle_finalize',p.oid,'EXECUTE')) ORDER BY fn.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace fn ON fn.oid=p.pronamespace WHERE fn.nspname<>'information_schema' AND left(fn.nspname,3)<>'pg_' AND p.prokind IN ('f','p'))
,
 'schemas',(SELECT COALESCE(jsonb_agg(jsonb_build_array(ns.nspname,(SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles WHERE oid=ns.nspowner),COALESCE(ns.nspacl::text,'')) ORDER BY ns.nspname),'[]'::jsonb) FROM pg_namespace ns WHERE ns.nspname<>'information_schema' AND left(ns.nspname,3)<>'pg_'),
 'types',(SELECT COALESCE(jsonb_agg(jsonb_build_array(nt.nspname,t.typname,t.typtype,t.typcategory,t.typnotnull,CASE WHEN t.typbasetype<>0 THEN format_type(t.typbasetype,t.typtypmod) ELSE NULL END,t.typdefault,COALESCE(t.typacl::text,''),(SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles WHERE oid=t.typowner),(SELECT COALESCE(jsonb_agg(e.enumlabel ORDER BY e.enumsortorder),'[]'::jsonb) FROM pg_enum e WHERE e.enumtypid=t.oid),(SELECT COALESCE(jsonb_agg(jsonb_build_array(k.conname,k.convalidated,pg_get_constraintdef(k.oid,true)) ORDER BY k.conname),'[]'::jsonb) FROM pg_constraint k WHERE k.contypid=t.oid)) ORDER BY nt.nspname,t.typname),'[]'::jsonb) FROM pg_type t JOIN pg_namespace nt ON nt.oid=t.typnamespace WHERE nt.nspname<>'information_schema' AND left(nt.nspname,3)<>'pg_' AND t.typisdefined),
 'otherRelations',(SELECT COALESCE(jsonb_agg(jsonb_build_array(nn.nspname,cc.relname,cc.relkind,(SELECT jsonb_build_array(rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles WHERE oid=cc.relowner),COALESCE(cc.relacl::text,''),CASE WHEN cc.relkind IN ('v','m') THEN pg_get_viewdef(cc.oid,true) ELSE NULL END,(SELECT jsonb_build_array(srv.srvname,srv.srvtype,srv.srvversion,ft.ftoptions) FROM pg_foreign_table ft JOIN pg_foreign_server srv ON srv.oid=ft.ftserver WHERE ft.ftrelid=cc.oid),(SELECT to_jsonb(seq) - 'seqrelid' FROM pg_sequence seq WHERE seq.seqrelid=cc.oid)) ORDER BY nn.nspname,cc.relname),'[]'::jsonb) FROM pg_class cc JOIN pg_namespace nn ON nn.oid=cc.relnamespace WHERE nn.nspname<>'information_schema' AND left(nn.nspname,3)<>'pg_' AND cc.relkind IN ('v','m','f','S')),
 'roles',(SELECT COALESCE(jsonb_agg(jsonb_build_array(r.rolname,r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolbypassrls) ORDER BY r.rolname),'[]'::jsonb) FROM pg_roles r WHERE r.rolname IN ('orgmap_app','orgmap_lifecycle_maintenance','orgmap_lifecycle_drain','orgmap_lifecycle_acceptance','orgmap_lifecycle_ledger_confirm','orgmap_lifecycle_blob','orgmap_lifecycle_finalize','orgmap_platform_dispatcher','orgmap_iam_mail_dispatcher')),
 'roleMembership',(WITH RECURSIVE seeds AS (
   SELECT oid FROM pg_roles WHERE rolname IN ('orgmap_app','orgmap_lifecycle_maintenance','orgmap_lifecycle_drain','orgmap_lifecycle_acceptance','orgmap_lifecycle_ledger_confirm','orgmap_lifecycle_blob','orgmap_lifecycle_finalize','orgmap_platform_dispatcher','orgmap_iam_mail_dispatcher')
   UNION SELECT c2.relowner FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid=c2.relnamespace WHERE n2.nspname<>'information_schema' AND left(n2.nspname,3)<>'pg_' AND c2.relkind IN ('r','p','v','m','f','S')
   UNION SELECT p2.proowner FROM pg_proc p2 JOIN pg_namespace n2 ON n2.oid=p2.pronamespace WHERE n2.nspname<>'information_schema' AND left(n2.nspname,3)<>'pg_' AND p2.prokind IN ('f','p')
   UNION SELECT n2.nspowner FROM pg_namespace n2 WHERE n2.nspname<>'information_schema' AND left(n2.nspname,3)<>'pg_'
   UNION SELECT t2.typowner FROM pg_type t2 JOIN pg_namespace n2 ON n2.oid=t2.typnamespace WHERE n2.nspname<>'information_schema' AND left(n2.nspname,3)<>'pg_' AND t2.typisdefined
  ), walk(root,ancestor,path) AS (
   SELECT m.member,m.roleid,ARRAY[m.member,m.roleid] FROM pg_auth_members m JOIN seeds seed ON seed.oid=m.member
   UNION ALL SELECT w.root,m.roleid,w.path||m.roleid FROM walk w JOIN pg_auth_members m ON m.member=w.ancestor WHERE NOT m.roleid=ANY(w.path)
  ), reachable AS (SELECT oid FROM seeds UNION SELECT ancestor FROM walk)
  SELECT COALESCE(jsonb_agg(pair ORDER BY pair),'[]'::jsonb) FROM (
   SELECT DISTINCT jsonb_build_array(child.rolname,parent.rolname,grantor.rolname,to_jsonb(m)-'member'-'roleid'-'grantor') AS pair
   FROM reachable reach JOIN pg_auth_members m ON m.member=reach.oid JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles grantor ON grantor.oid=m.grantor
  ) pairs),
 'defaultAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_array(r.rolname,nsp.nspname,d.defaclobjtype,COALESCE(d.defaclacl::text,'')) ORDER BY r.rolname,nsp.nspname,d.defaclobjtype),'[]'::jsonb) FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace nsp ON nsp.oid=d.defaclnamespace WHERE nsp.nspname IS NULL OR (nsp.nspname<>'information_schema' AND left(nsp.nspname,3)<>'pg_'))
 )::text,'UTF8')),'hex') INTO result
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname<>'information_schema' AND left(n.nspname,3)<>'pg_' AND c.relkind IN ('r','p');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_schema_fingerprint_internal() FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain,orgmap_lifecycle_acceptance;
CREATE OR REPLACE FUNCTION orgmap_deletion_schema_fingerprint(p_org uuid,p_job uuid,p_fence bigint,p_token uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.orgmap_deletion_require_schema_lock();
 PERFORM public.orgmap_assert_deletion_maintenance(p_org,p_job,p_fence,p_token);
 RETURN public.orgmap_deletion_schema_fingerprint_internal();
END $$;
CREATE FUNCTION orgmap_deletion_preflight_schema_ready() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE expected text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'DELETION_READ_COMMITTED_REQUIRED' USING ERRCODE='25001'; END IF;
 IF NOT pg_has_role(session_user,'orgmap_lifecycle_acceptance','MEMBER') OR pg_has_role('orgmap_app','orgmap_lifecycle_acceptance','MEMBER') OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orgmap_lifecycle_acceptance' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)) THEN RAISE EXCEPTION 'DELETION_ACCEPTANCE_AUTHORITY_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM public.orgmap_deletion_require_schema_lock();
 SELECT fingerprint INTO expected FROM public.organization_deletion_schema_baseline WHERE singleton;
 RETURN expected IS NOT NULL AND public.orgmap_deletion_schema_fingerprint_internal()=expected;
END $$;
REVOKE ALL ON FUNCTION orgmap_deletion_preflight_schema_ready() FROM PUBLIC,orgmap_app,orgmap_lifecycle_maintenance,orgmap_lifecycle_drain;
GRANT EXECUTE ON FUNCTION orgmap_deletion_preflight_schema_ready() TO orgmap_lifecycle_acceptance;
