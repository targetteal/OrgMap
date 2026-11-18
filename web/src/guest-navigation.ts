import type {Bootstrap} from './api';
export function isGuestBootstrap(bootstrap:Bootstrap|null):boolean{return bootstrap?.membership.memberType==='GUEST';}
export function guestModuleAvailable(bootstrap:Bootstrap|null,module:string):boolean{
 if(module==='goals' && bootstrap?.modules.goals !== true)return false;
 if(!isGuestBootstrap(bootstrap))return true;
 if(module==='members')return true;
 const key=module==='projects'?'work':module;return bootstrap?.modules[key]===true;
}
/** Display policy only; every target API must independently enforce the resource grant. */
export function guestRouteAvailable(bootstrap:Bootstrap|null,path:string):boolean{
 if(!isGuestBootstrap(bootstrap))return true;
 const url=new URL(path,'http://orgmap.local'),p=url.pathname;
 if(p.startsWith('/account'))return true;
 if(p==='/members')return url.searchParams.get('view')!=='hierarchy';
 if(/^\/members\/[^/]+$/.test(p))return !['metrics','checklists','projects','goals'].includes(url.searchParams.get('tab')??'');
 if(p==='/structure')return !url.searchParams.has('savedView');
 if(/^\/(circles|roles)\/[^/]+$/.test(p))return guestModuleAvailable(bootstrap,'structure');
 if(p==='/structure/directory')return guestModuleAvailable(bootstrap,'structure')&&!url.searchParams.has('viewId');
 if(/^\/structure\/(proposals|working-agreements|tensions)(?:\/|$)/.test(p))return guestModuleAvailable(bootstrap,'governance');
 if(['/platform','/platform/search','/platform/favorites','/platform/notifications'].includes(p)||/^\/platform\/resource\/[^/]+\/[^/]+$/.test(p))return true;
 for(const module of ['goals','projects','meetings'])if(p==='/'+module||p.startsWith('/'+module+'/'))return guestModuleAvailable(bootstrap,module);
 return false;
}

export function guestRailPath(bootstrap:Bootstrap|null,module:string,fallback:string):string|null {
 if(module==='structure' && isGuestBootstrap(bootstrap) && !guestModuleAvailable(bootstrap,'structure') && guestModuleAvailable(bootstrap,'governance')){
  const kind=bootstrap?.sharedResources?.find(r=>r.context==='governance')?.kind;
  return kind==='tension'?'/structure/tensions':kind==='agreement'?'/structure/working-agreements':'/structure/proposals';
 }
 return guestModuleAvailable(bootstrap,module)?fallback:null;
}
export function canLoadStructureHistory(bootstrap:Bootstrap|null,path:string):boolean {
 return !!bootstrap && !isGuestBootstrap(bootstrap) && path==='/structure/history';
}
