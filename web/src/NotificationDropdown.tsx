import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Bell, Check, CheckCheck, CircleCheck, FileText, MessageCircle, RefreshCw, Settings2, X } from "lucide-react";
import type { FeatureContext } from "./feature-contract";
import { useLocalization } from "./localization";
import { platformTranslator, resourceLabel, notificationEventLabel } from "./features/platform/messages";
import { resourceDestination } from "./features/platform/resource-route";
import { notificationTranslator } from "./notification-messages";
import { notificationLocale, notificationTime, notificationWorkspacePath, safeNotificationDestination, type NotificationItem } from "./features/platform/notification-presentation";
import "./notification-dropdown.css";

type Notification = NotificationItem & {event:string};
function destination(c:FeatureContext,item:Notification) {
  return safeNotificationDestination(item.presentation?.destination) ?? notificationWorkspacePath(resourceDestination(c.bootstrap,item.resourceType,item.resourceId),c.organizationId);
}
export function NotificationDropdown({context:c}:{context:FeatureContext}) {
  const {locale:accountLocale}=useLocalization();
  const [open,setOpen]=useState(false), [unreadOnly,setUnreadOnly]=useState(false), [revision,setRevision]=useState(0);
  const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), panel=useRef<HTMLElement>(null), titleId=useId();
  const scope=JSON.stringify([c.organizationId,c.session.account.id,c.bootstrap.membership.id,c.bootstrap.authorizationRevision]);
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const [state,setState]=useState<{scope:string;items:Notification[];locale?:string;loading:boolean;error:boolean}>({scope,items:[],loading:true,error:false});
  const [pending,setPending]=useState<string|null>(null);
  const current=state.scope===scope?state:{scope,items:[],loading:true,error:false,locale:undefined};
  const locale=notificationLocale(current.locale??current.items[0]?.presentation?.locale,accountLocale),t=platformTranslator(locale),n=notificationTranslator(locale);
  const endpoint="/organizations/"+c.organizationId+"/platform/notifications";
  useEffect(()=>{setOpen(false);setUnreadOnly(false);setPending(null);},[scope]);
  useEffect(()=>{
    const abort=new AbortController();
    setState(previous=>({scope,items:previous.scope===scope?previous.items:[],locale:previous.scope===scope?previous.locale:undefined,loading:true,error:false}));
    c.api<{items:Notification[];locale?:string}>(endpoint,{signal:abort.signal}).then(({data})=>{if(!abort.signal.aborted&&scopeRef.current===scope)setState({scope,items:data.items,locale:data.locale,loading:false,error:false});}).catch(()=>{if(!abort.signal.aborted&&scopeRef.current===scope)setState(previous=>({scope,items:previous.scope===scope?previous.items:[],locale:previous.scope===scope?previous.locale:undefined,loading:false,error:true}));});
    return()=>abort.abort();
  },[endpoint,scope,c.api,revision]);
  useEffect(()=>{
    const refresh=()=>{if(document.visibilityState!=='hidden')setRevision(value=>value+1);};
    const timer=window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[scope]);
  const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
  useEffect(()=>{
    if(!open)return;
    panel.current?.querySelector<HTMLButtonElement>('[data-notification-close]')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();close();}};
    document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape);};
  },[open]);
  const unread=current.items.filter(item=>!item.readAt).length, items=unreadOnly?current.items.filter(item=>!item.readAt):current.items;
  async function markRead(item:Notification) {
    if(item.readAt)return;
    setPending(item.id);
    try {
      await c.api(endpoint+"/"+encodeURIComponent(item.id)+"/read",{method:"POST",body:{}});
      if(scopeRef.current===scope)setState(previous=>previous.scope===scope?{...previous,error:false,items:previous.items.map(row=>row.id===item.id?{...row,readAt:new Date().toISOString()}:row)}:previous);
    } catch {
      if(scopeRef.current===scope)setState(previous=>previous.scope===scope?{...previous,error:true}:previous);
    } finally {if(scopeRef.current===scope)setPending(null);}
  }
  function eventLabel(item:Notification) {
    if(item.presentation?.heading)return item.presentation.heading;
    const known=notificationEventLabel(item.event,"",locale);if(known)return known;
    const labels={CommentCreated:"eventComment",CommentAdded:"eventComment",TaskAssigned:"eventTaskAssigned",TaskUpdated:"eventTaskUpdated",MeetingScheduled:"eventMeetingScheduled",MentionCreated:"eventMention"} as const;
    const key=labels[item.event as keyof typeof labels];
    return key?n(key):n("eventUpdateIn",{resource:resourceLabel(item.resourceType,t)});
  }
  return <div className="notification-dropdown" ref={root} lang={locale}>
    <button ref={trigger} type="button" className="notification-bell" title={n("notifications")} aria-label={unread===1?n("unreadBellOne"):unread?n("unreadBell",{count:unread}):n("notifications")} aria-expanded={open} aria-haspopup="dialog" aria-controls={open?titleId+"-panel":undefined} onClick={()=>{setOpen(!open);if(!open)setRevision(value=>value+1);}}><Bell size={20}/>{unread>0&&<span className="notification-count">{unread>99?"99+":unread}</span>}</button>
    {open&&<section ref={panel} id={titleId+"-panel"} className="notification-panel" role="dialog" aria-labelledby={titleId}>
      <header className="notification-heading"><div><h2 id={titleId}>{n("notifications")}</h2><p>{current.loading?n("loadingUpdates"):current.error?n("yourUpdates"):unread?n(unread===1?"unreadOne":"unreadMany",{count:unread}):n("allCaughtUp")}</p></div><div><button type="button" title={n("preferences")} aria-label={n("preferences")} onClick={()=>{close();c.navigate(notificationWorkspacePath("/platform/preferences",c.organizationId));}}><Settings2 size={17}/></button><button type="button" data-notification-close aria-label={n("close")} onClick={close}><X size={18}/></button></div></header>
      <div className="notification-filters" aria-label={n("filter")}><button type="button" aria-pressed={!unreadOnly} onClick={()=>setUnreadOnly(false)}>{n("all")}</button><button type="button" aria-pressed={unreadOnly} onClick={()=>setUnreadOnly(true)}>{n("unread")}{unread>0&&<span>{unread}</span>}</button><button type="button" className="notification-refresh" aria-label={n("refresh")} disabled={current.loading} onClick={()=>setRevision(value=>value+1)}><RefreshCw size={15}/></button></div>
      <div className="notification-list" aria-busy={current.loading}>
        {current.error&&<div className="notification-error" role="alert"><p>{t("notificationFailed")}</p><button type="button" onClick={()=>setRevision(value=>value+1)}>{n("retry")}</button></div>}
        {current.loading&&!current.items.length&&!current.error?<p className="notification-loading" role="status">{n("loading")}</p>:!items.length&&!current.error?<div className="notification-empty"><span><CheckCheck size={25}/></span><h3>{unreadOnly?n("allRead"):n("noneHere")}</h3><p>{unreadOnly?n("allReadDescription"):n("noneHereDescription")}</p></div>:items.map(item=>{const Icon=(item.event==="ProposalDecided"||item.event==="InvitationAccepted")?CircleCheck:item.event.includes("Comment")?MessageCircle:item.resourceType==="proposal"?FileText:Bell;const time=notificationTime(item.presentation?.occurredAt??item.availableAt,notificationLocale(item.presentation?.locale,locale));return <article key={item.id} className={item.readAt?"notification-item":"notification-item is-unread"}>
          <button type="button" className="notification-open" onClick={()=>{void markRead(item);setOpen(false);c.navigate(destination(c,item));}}><span className="notification-event-icon"><Icon size={18}/></span><span className="notification-copy"><span className="notification-event">{eventLabel(item)}</span><strong>{item.presentation?.resourceTitle||item.resourceTitle||resourceLabel(item.resourceType,t)}</strong>{item.presentation?.summary&&<span className="notification-summary">{item.presentation.summary}</span>}{item.presentation?.actorName&&<span className="notification-actor">{t("notificationBy",{name:item.presentation.actorName})}</span>}{item.presentation?.details?.slice(0,2).map((detail,index)=><span className="notification-detail" key={index}>{detail.label}: {detail.value}</span>)}{time&&<time dateTime={time.value} title={time.absolute}>{time.relative}</time>}</span></button>
          {!item.readAt&&<button type="button" className="notification-read" title={n("markRead")} aria-label={n("markReadItem",{title:item.presentation?.resourceTitle||item.resourceTitle||eventLabel(item)})} disabled={pending===item.id} onClick={()=>void markRead(item)}><span className="notification-unread-dot"/><Check size={15}/></button>}
        </article>;})}
      </div>
      <footer><button type="button" onClick={()=>{close();c.navigate(notificationWorkspacePath("/platform/notifications",c.organizationId));}}>{n("viewAll")}<ArrowUpRight size={16}/></button></footer>
    </section>}
  </div>;
}
