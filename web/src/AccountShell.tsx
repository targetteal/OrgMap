import {useMobileNavigation} from "./use-mobile-navigation";
import {sessionOwnsBootstrap} from "./session-scope";
import {WorkspaceBrandingShell} from "./WorkspaceBrand";
import {OrgMapHomeLink} from "./OrgMapBrand";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {ArrowLeft,Building2,Check,ChevronDown,LogOut,Menu,Search as SearchIcon,X} from "lucide-react";
import type {Bootstrap,Session} from "./api";
import type {FeatureContext,FeatureComponent} from "./feature-contract";
import {initials} from "./model";
import {Button} from "./ui";
import {AccountNavigation} from "./account";
import {accountUiTranslator} from "./account/ui-messages";
import {accountMenuTranslator} from "./account-menu-messages";
import {deletionTranslator} from "./organization-deletion/messages";
import {useLocalization} from "./localization";
import {AccessibilitySkipLink} from "./accessibility";
import "./account-shell.css";
export function AccountShell({session,bootstrap:tenantBootstrap,context:tenantContext,Search,path,navigate,onLogout,onChangeOrg,children}:{session:Session;bootstrap:Bootstrap|null;context:FeatureContext|null;Search?:FeatureComponent;path:string;navigate:(path:string)=>void;onLogout:()=>void;onChangeOrg:(id:string)=>void;children:ReactNode}){
 const bootstrap=sessionOwnsBootstrap(session,tenantBootstrap)?tenantBootstrap:null;
 const [open,setOpen]=useState(false),[identity,setIdentity]=useState(false),[orgQuery,setOrgQuery]=useState('');
 const {t,locale}=useLocalization(),a=accountUiTranslator(locale),m=accountMenuTranslator(locale);
 const searchKey=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase(locale);
 const visibleOrganizations=session.organizations.filter(org=>searchKey(org.name).includes(searchKey(orgQuery.trim())));
 const menu=useRef<HTMLDivElement>(null),identityPanel=useRef<HTMLDivElement>(null),opener=useRef<HTMLButtonElement>(null);
 const mobileNavigation=useMobileNavigation(open,()=>setOpen(false));
 const current=path.split('/')[2]?.split('?')[0]??'general';
 const titles:Record<string,string>={general:a('myAccount'),preferences:t('nav.preferences'),security:t('nav.security'),sessions:t('nav.sessions'),accessibility:t('a11y.title'),'organization-deletions':deletionTranslator(locale)('closures')};
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!menu.current?.contains(event.target)){setIdentity(false);setOrgQuery('');}};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 useEffect(()=>{if(identity)identityPanel.current?.focus({preventScroll:true});},[identity]);
 const closeIdentityMenu=()=>{setIdentity(false);setOrgQuery('');menu.current?.querySelector<HTMLButtonElement>('.identity-button')?.focus({preventScroll:true});};
 const hasOrganization = session.organizations.length > 0;
 return <WorkspaceBrandingShell organizationId={bootstrap?.organization.id??null} accountId={session.account.id} className="app-shell account-shell mare-account-shell">
  <AccessibilitySkipLink targetId="account-content"/>
  {open&&<div className="mobile-shade" onClick={()=>{setOpen(false);opener.current?.focus();}}/>}
  <aside ref={mobileNavigation.sidebarRef} inert={mobileNavigation.narrow&&!open?true:undefined} role={mobileNavigation.modalOpen?"dialog":undefined} aria-modal={mobileNavigation.modalOpen||undefined} className={'sidebar mare-sidebar account-navigation '+(open?'open':'')} aria-label={a('accountNavigation')} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);opener.current?.focus();}}}>
   <div className="mare-sidebar-head"><OrgMapHomeLink href={hasOrganization ? "/structure" : "/organizations/new"} navigate={navigate}/><button type="button" className="account-nav-close" aria-label={a('closeNavigation')} onClick={()=>{setOpen(false);opener.current?.focus();}}><X size={19}/></button></div>
   <div className="mare-sidebar-scroll"><div className="account-nav-heading">{a('myAccount')}</div><nav aria-label={a('accountSettings')}><AccountNavigation context={{path,navigate:next=>{setOpen(false);navigate(next);}}}/></nav></div>
  </aside>
  <div className="workspace" inert={mobileNavigation.modalOpen?true:undefined}><header className="topbar">
   <button ref={element=>{opener.current=element;mobileNavigation.openerRef.current=element;}} type="button" className="account-nav-toggle" aria-label={a('openNavigation')} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Menu size={20}/></button>
   <h1 className="mare-page-title">{titles[current]??a('myAccount')}</h1>
   <div className="identity relative account-identity" ref={menu}><Button className="identity-button" ariaLabel={a('accountMenu')} expanded={identity} onClick={()=>setIdentity(value=>!value)}><span className="avatar small">{initials(session.account.displayName)}</span><span>{session.account.displayName}</span><ChevronDown size={14}/></Button>
    {identity&&<div ref={identityPanel} tabIndex={-1} className="account-identity-menu" role="dialog" aria-label={a('accountMenu')} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeIdentityMenu();}}}><strong>{session.account.displayName}</strong>{session.organizations.length>0&&<><span>{a('yourOrganizations')}</span>{session.organizations.length>5&&<label className="account-identity-search"><SearchIcon size={16} aria-hidden="true"/><input aria-label={m('searchOrganization')} placeholder={m('searchPlaceholder')} value={orgQuery} onChange={event=>setOrgQuery(event.target.value)}/></label>}<div className="account-identity-organizations">{visibleOrganizations.length?visibleOrganizations.map(org=><button key={org.id} type="button" aria-current={org.id===bootstrap?.organization.id?'true':undefined} onClick={()=>{setIdentity(false);setOrgQuery('');onChangeOrg(org.id);}}><Building2 size={16}/><span>{org.name}</span>{org.id===bootstrap?.organization.id&&<Check size={15}/>}</button>):<p role="status">{m('noOrganizationsFound')}</p>}</div></>}<button type="button" onClick={onLogout}><LogOut size={16}/>{t('nav.signOut')}</button></div>}
   </div>
  </header><main id="account-content" tabIndex={-1} className="main-content account-main">
   {hasOrganization && <div className="account-return">
    <Button className="account-return-action" onClick={() => navigate("/structure")}>
     <ArrowLeft size={17} aria-hidden="true"/>{a('backToOrganization')}
    </Button>
   </div>}
   {children}
  </main></div>
 </WorkspaceBrandingShell>;
}
