import { useEffect, useRef, useState } from "react";
import type { FeatureContext, FeatureDefinition } from "../../feature-contract";
import { RequestError } from "../../api";
import { Button, Notice } from "../../ui";
import { useLocalization } from "../../localization";
import { invitationTrackingTranslator, type InvitationTrackingMessage } from "./invitation-tracking-messages";
import "./invitation-tracking.css";
export type TrackedInvitation = {
  id: string; email: string; memberType: "MEMBER" | "GUEST"; version: number;
  accessPlan: { resource: {context:string;kind:string;id:string}; actions:string[] }[];
  firstName?: string; lastName?: string; personalMessage?: string;
  status?: "PENDING" | "ACCEPTED" | "REVOKED"; expired?: boolean; expiresAt: string;
  createdAt?: string | null; acceptedAt?: string | null; revokedAt?: string | null;
  canResend?: boolean; canCancel?: boolean;
  delivery?: { state: "PENDING" | "PROCESSING" | "DELIVERED" | "RETRYING" | "FAILED" | "OUTCOME_UNKNOWN" | "CANCELLED"; attempts:number; lastAttemptAt?:string|null;completedAt?:string|null;nextAttemptAt?:string|null } | null;
};
type Props = {context:FeatureContext; onEdit?:(invitation:TrackedInvitation)=>void; revision?:number};
export function InvitationTracking(props:Props) {
  if(props.context.bootstrap.membership.memberType==="GUEST")return null;
  return <Tracking key={props.context.organizationId + ":" + (props.context.session?.account.id ?? "")} {...props}/>;
}
function Tracking({context:c,onEdit,revision}:Props) {
  const {locale,formatInstant}=useLocalization(), t=invitationTrackingTranslator(locale);
  const requestedId=new URLSearchParams(c.path?.split("?")[1]??"").get("invitationId");
  const focusId=requestedId&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestedId)?requestedId:null;
  const [all,setAll]=useState(!!focusId),[items,setItems]=useState<TrackedInvitation[]>([]),[loading,setLoading]=useState(true),[ready,setReady]=useState(false),[error,setError]=useState<InvitationTrackingMessage|null>(null),[outcome,setOutcome]=useState<InvitationTrackingMessage|null>(null),[busy,setBusy]=useState<string|null>(null),[confirm,setConfirm]=useState<string|null>(null),[cursor,setCursor]=useState<string|null>(null);
  const active=useRef(true),inFlight=useRef(false),key=useRef<{fingerprint:string;key:string}|null>(null),abort=useRef<AbortController|null>(null),loadRevision=useRef(0),focused=useRef<HTMLLIElement|null>(null),focusedId=useRef<string|null>(null),loadedPages=useRef(1),loadedItems=useRef<TrackedInvitation[]>([]),loadingRef=useRef(false);
  const loadedFilter=useRef(all);
  const base="/organizations/"+c.organizationId+"/invitations";
  useEffect(()=>{active.current=true;return()=>{active.current=false;abort.current?.abort();};},[]);
  useEffect(()=>c.registerNavigationGuard?.(()=>inFlight.current?t("busy"):null),[c.registerNavigationGuard,locale]);
  async function load(next?:string,signal?:AbortSignal) {
    const requestRevision=++loadRevision.current;
    loadingRef.current=true;setLoading(true);
    try {
      type Page={items:TrackedInvitation[];nextCursor?:string|null};
      const read=(cursor?:string)=>c.api<Page>(base+"?"+(all?"status=ALL":"limit=50")+(cursor?"&cursor="+encodeURIComponent(cursor):""),{signal});
      const [response,target]=await Promise.all([
        read(next),
        !next&&all&&focusId?c.api<Page>(base+"?status=ALL&invitationId="+encodeURIComponent(focusId),{signal}):Promise.resolve(null),
      ]);
      let records=response.data.items,nextCursor=response.data.nextCursor??null,pages=1;
      // Re-read through the last visible record so new arrivals do not push
      // already opened history out of view. Stop at the end if access changed.
      const oldBoundary=loadedItems.current.at(-1)?.id;
      const previousPages=loadedPages.current;
      const visited=new Set<string>();
      while(!next&&nextCursor&&!visited.has(nextCursor)&&(pages<previousPages||(oldBoundary&&!records.some(item=>item.id===oldBoundary)))) {
        visited.add(nextCursor);
        if(!active.current||signal?.aborted||requestRevision!==loadRevision.current)return;
        const page=await read(nextCursor);records=[...records,...page.data.items];nextCursor=page.data.nextCursor??null;pages++;
      }
      if(!active.current||signal?.aborted||requestRevision!==loadRevision.current)return;
      const updated=Array.from(new Map([...(next?loadedItems.current:target?.data.items??[]),...records].map(item=>[item.id,item])).values());
      loadedItems.current=updated;loadedPages.current=next?previousPages+1:pages;
      setItems(updated);setCursor(nextCursor);setReady(true);
    } finally {if(active.current&&!signal?.aborted&&requestRevision===loadRevision.current){loadingRef.current=false;setLoading(false);}}
  }
  useEffect(()=>{
    const controller=new AbortController();
    if(loadedFilter.current!==all){loadedFilter.current=all;loadedItems.current=[];loadedPages.current=1;setItems([]);setCursor(null);setReady(false);setConfirm(null);}
    setError(null);void load(undefined,controller.signal).catch(()=>{if(!controller.signal.aborted)setError("unavailable");});return()=>controller.abort();
  },[base,revision,focusId,all]);
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=()=>{
      if(document.visibilityState!=="visible"||inFlight.current||loadingRef.current)return;
      void load(undefined,controller.signal).catch(()=>{/* Keep history on background failure; manual refresh can retry. */});
    };
    const timer=window.setInterval(refresh,30000);
    window.addEventListener("focus",refresh);
    return()=>{controller.abort();window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  },[base,focusId,all]);
  useEffect(()=>{focusedId.current=null;if(focusId)setAll(true);},[focusId]);
  useEffect(()=>{if(focusId&&ready&&focused.current&&focusedId.current!==focusId){focusedId.current=focusId;focused.current.focus({preventScroll:true});focused.current?.scrollIntoView?.({block:"nearest"});}},[focusId,ready,items,all]);
  async function act(invitation:TrackedInvitation,action:"resend"|"cancel") {
    if(inFlight.current)return;
    const fingerprint=JSON.stringify([base,invitation.id,action,invitation.version]);
    if(key.current?.fingerprint!==fingerprint)key.current={fingerprint,key:crypto.randomUUID()};
    ++loadRevision.current;loadingRef.current=false;setLoading(false);
    inFlight.current=true;setBusy(invitation.id);setError(null);setOutcome(null);
    const controller=new AbortController();abort.current=controller;
    try {
      await c.api(base+"/"+invitation.id+"/actions/"+action,{method:"POST",body:{},version:invitation.version,key:key.current.key,signal:controller.signal});
      if(!active.current||controller.signal.aborted)return;
      key.current=null;setConfirm(null);setOutcome(action==="resend"?"queued":"cancelled");
      try { await load(undefined,controller.signal); } catch { if(active.current&&!controller.signal.aborted)setError("unavailable"); }
    } catch(failure) {
      if(!active.current||controller.signal.aborted)return;
      if(failure instanceof RequestError && ["STATE_CONFLICT","VERSION_CONFLICT","PRECONDITION_FAILED"].includes(failure.code)) {
        key.current=null;setConfirm(null);setError("conflict");try{await load(undefined,controller.signal);}catch{/* keep recovery visible */}
      } else if(failure instanceof RequestError&&failure.code==="INVITATION_DELIVERY_IN_PROGRESS")setError("deliveryBusy");
      else setError("failed");
    } finally {inFlight.current=false;if(active.current)setBusy(null);}
  }
  const visible=items.filter(invite=>all||(invite.status??"PENDING")==="PENDING");
  if(c.bootstrap.membership.memberType==="GUEST")return null;
  return <section className="invitation-tracking" aria-labelledby="invitation-tracking-title" aria-busy={!!busy||loading}>
    <header><div><h2 id="invitation-tracking-title">{t("title")}</h2><p>{t("intro")}</p>{c.bootstrap.membership.orgRole!=="OWNER"&&<p className="muted">{t("own")}</p>}</div><Button disabled={!!busy||loading} onClick={()=>{setError(null);setOutcome(null);setConfirm(null);void load().catch(()=>setError("unavailable"));}}>{t("refresh")}</Button></header>
    <div className="invitation-tracking-filters" role="group" aria-label={t("title")}><Button disabled={!!busy} pressed={!all} onClick={()=>setAll(false)}>{t("pending")}</Button><Button disabled={!!busy} pressed={all} onClick={()=>setAll(true)}>{t("all")}</Button></div>
    {error&&<Notice>{t(error)}</Notice>}{outcome&&<p role="status">{t(outcome)}</p>}
    {loading&&!ready?<p role="status">{t("loading")}</p>:ready&&!visible.length?<p>{t("empty")}</p>:null}
    <ul className="invitation-tracking-list">{visible.map(invite=>{
      const status=invite.status??"PENDING",pending=status==="PENDING",state=pending&&invite.expired?"expired":status;
      return <li key={invite.id} tabIndex={focusId===invite.id?-1:undefined} ref={focusId===invite.id?focused:undefined} className={focusId===invite.id?"is-highlighted":undefined}>
        <div className="invitation-tracking-identity"><strong>{invite.email}</strong><span className={"invitation-tracking-state state-"+state.toLowerCase()}>{t("inviteState")}: {t(state)}</span></div>
        <dl><div><dt>{t("deliveryState")}</dt><dd>{t(invite.delivery?("mail_"+invite.delivery.state) as InvitationTrackingMessage:"mail_none")}</dd></div>{([
          ["createdAt",invite.createdAt],["expires",pending?invite.expiresAt:null],["acceptedAt",invite.acceptedAt],["revokedAt",invite.revokedAt],["nextAttempt",invite.delivery?.nextAttemptAt],
        ] as const).map(([label,value])=>value&&<div key={label}><dt>{t(label)}</dt><dd>{formatInstant(value)}</dd></div>)}{invite.delivery&&<div><dt>{t("attempts")}</dt><dd>{invite.delivery.attempts}</dd></div>}</dl>
        {pending&&(invite.canResend||invite.canCancel||onEdit)&&<div className="invitation-tracking-actions">
          {invite.canResend&&<Button disabled={!!busy} onClick={()=>void act(invite,"resend")}>{t("resend")}</Button>}
          {invite.canCancel&&<Button disabled={!!busy} onClick={()=>setConfirm(invite.id)}>{t("cancel")}</Button>}
          {onEdit&&(c.bootstrap.membership.orgRole==="OWNER"||invite.memberType!=="GUEST")&&<Button disabled={!!busy} onClick={()=>onEdit(invite)}>{t("edit")}</Button>}
        </div>}
        {pending&&invite.canResend&&<p className="invitation-tracking-help">{t("resendHelp")}</p>}
        {pending&&invite.delivery?.state==="OUTCOME_UNKNOWN"&&<p className="invitation-tracking-warning">{t("uncertain")}</p>}
        {confirm===invite.id&&pending&&invite.canCancel&&<div className="invitation-tracking-confirm"><p>{t("cancel")}: <strong>{invite.email}</strong>?</p><Button disabled={!!busy} onClick={()=>void act(invite,"cancel")}>{t("confirmCancel")}</Button><Button disabled={!!busy} onClick={()=>setConfirm(null)}>{t("keep")}</Button></div>}
      </li>;
    })}</ul>
    {cursor&&<Button disabled={loading||!!busy} onClick={()=>void load(cursor).catch(()=>setError("unavailable"))}>{t("more")}</Button>}
    <p className="invitation-tracking-help">{t("sentHelp")}</p>
  </section>;
}
export const invitationTrackingFeature:FeatureDefinition={id:"organization-invitations",module:"members",label:"Convites",matches:path=>/^\/organization-invitations\/?(?:[?#].*)?$/.test(path),Component:({context})=><InvitationTracking context={context}/>};
