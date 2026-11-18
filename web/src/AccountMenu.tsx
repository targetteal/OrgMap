import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Bookmark,Building2,Check,ChevronRight,LogOut,MailPlus,Plus,Search,Settings2,SlidersHorizontal,UserRound,X} from 'lucide-react';
import {initials} from './model';
import {useLocalization} from './localization';
import {accountMenuTranslator} from './account-menu-messages';
import './account-menu.css';
type Link={path:string;label:string};
export function AccountMenu({name,organizations,organizationId,organizationName,links,guest,onOrganization,onCreate,onInvite,onLogout,onClose,navigate}:{name:string;organizations:{id:string;name:string}[];organizationId:string;organizationName:string;links:Link[];guest:boolean;onOrganization:(id:string)=>void;onCreate:()=>void;onInvite:()=>void;onLogout:()=>void;onClose:()=>void;navigate:(path:string)=>void}){
 const [view,setView]=useState<'main'|'organizations'|'more'>('main'),[query,setQuery]=useState('');const root=useRef<HTMLDivElement>(null);
 const backButton=useRef<HTMLButtonElement>(null),organizationButton=useRef<HTMLButtonElement>(null),moreButton=useRef<HTMLButtonElement>(null);
 const returnTo=useRef<'organizations'|'more'|null>(null);
 const {locale}=useLocalization(),a=accountMenuTranslator(locale);
 useEffect(()=>{root.current?.focus({preventScroll:true});},[]);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(event.target instanceof Element&&!root.current?.contains(event.target)&&!event.target.closest('.identity-button'))onClose();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[onClose]);
 useEffect(()=>{if(view==='main'){if(returnTo.current==='organizations')organizationButton.current?.focus();else if(returnTo.current==='more')moreButton.current?.focus();}else backButton.current?.focus();},[view]);
 const openView=(next:'organizations'|'more')=>{returnTo.current=next;setView(next);};
 const go=(path:string)=>{onClose();navigate(path);},otherLinks=links.filter(link=>!['/account/general','/platform/favorites'].includes(link.path));
 const searchKey=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase(locale);
 const visibleOrganizations=organizations.filter(item=>searchKey(item.name).includes(searchKey(query)));
 return <div ref={root} tabIndex={-1} className="popover identity-menu mare-account-menu" role="dialog" aria-label={a('menu')} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();if(view!=='main')setView('main');else onClose();}}}>
  {view==='main'?<>
   <header className="account-menu-person"><span className="account-menu-avatar">{initials(name)}</span><div><strong>{name}</strong><button type="button" onClick={()=>go('/account/general')}>{a('manageAccount')}<ArrowRight size={12}/></button></div><button type="button" className="account-menu-close" aria-label={a('closeMenu')} onClick={onClose}><X size={16}/></button></header>
   <button type="button" ref={organizationButton} className="account-menu-organization" onClick={()=>openView('organizations')}><Building2 size={18}/><span><small>{a('currentOrganization')}</small><strong>{organizationName}</strong></span><ChevronRight size={16}/></button>
   <div className="account-menu-actions">
    {links.some(link=>link.path==='/platform/favorites')&&<button type="button" onClick={()=>go('/platform/favorites')}><Bookmark size={17}/><span>{a('favorites')}</span></button>}
    {!guest&&<button type="button" onClick={()=>go('/administration/settings')}><Settings2 size={17}/><span>{a('organizationSettings')}</span></button>}
    {otherLinks.length>0&&<button type="button" ref={moreButton} onClick={()=>openView('more')}><SlidersHorizontal size={17}/><span>{a('integrationsResources')}</span><ChevronRight size={15}/></button>}
   </div>
   <footer><button type="button" onClick={onLogout}><LogOut size={17}/><span>{a('signOut')}</span></button></footer>
  </>:<>
   <header className="account-menu-subhead"><button type="button" ref={backButton} aria-label={a('backToMenu')} onClick={()=>setView('main')}><ArrowLeft size={17}/></button><h2>{view==='organizations'?a('yourOrganizations'):a('integrationsResources')}</h2></header>
   {view==='organizations'?<>
    {organizations.length>5&&<label className="account-menu-search"><Search size={15}/><input aria-label={a('searchOrganization')} placeholder={a('searchPlaceholder')} value={query} onChange={event=>setQuery(event.target.value)}/></label>}
    <div className="account-menu-scroll">{visibleOrganizations.length?visibleOrganizations.map(item=><button type="button" key={item.id} aria-current={item.id===organizationId?'true':undefined} onClick={()=>{onClose();onOrganization(item.id);}}><Building2 size={17}/><span>{item.name}</span>{item.id===organizationId&&<Check size={15}/>}</button>):<p className="account-menu-empty" role="status">{a('noOrganizationsFound')}</p>}</div>
    <footer><button type="button" onClick={()=>{onClose();onCreate();}}><Plus size={17}/><span>{a('createOrganization')}</span></button><button type="button" onClick={()=>{onClose();onInvite();}}><MailPlus size={17}/><span>{a('acceptInvite')}</span></button></footer>
   </>:<div className="account-menu-scroll">{otherLinks.map(link=><button type="button" key={link.path} onClick={()=>go(link.path)}><span>{link.label}</span><ChevronRight size={14}/></button>)}</div>}
  </>}
 </div>;
}
