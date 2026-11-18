import {guestRailPath} from "./guest-navigation";
import type {Bootstrap} from './api';
import type {RichDocument} from '../../packages/content';
export type OrganizationEntry={revision:number;acknowledged:boolean;destination:'HOME'|'STRUCTURE'|'GOALS'|'WORK'|'MEETINGS'|'SHARED';welcome:{mode:'DEFAULT'|'CUSTOM';title:string;body:RichDocument;videoUrl:string|null;videoMode:'DEFAULT'|'CUSTOM';attachmentUrl:string|null};legal:{name:string;address:string;termsUrl:string|null;privacyUrl:string|null;contactName:string;contactEmail:string;contactPhone:string}};
/** A Guest can legitimately have no grant for the optional organization entry. */
export function skipGuestEntryError(bootstrap:Bootstrap,code:string):boolean{
 return bootstrap.membership.memberType==='GUEST'&&code==='RESOURCE_NOT_FOUND';
}
export function entryLanding(destination:OrganizationEntry['destination'],bootstrap:Bootstrap):string{
 const map={HOME:'/structure',STRUCTURE:'/structure',GOALS:'/goals',WORK:'/projects',MEETINGS:'/meetings',SHARED:'/structure'};
 if(destination==='SHARED'){
  for(const [key,path] of [['structure','/structure'],['goals','/goals'],['work','/projects'],['meetings','/meetings'],['governance','/structure/proposals']])if(bootstrap.modules[key]===true)return key==='governance'?(guestRailPath(bootstrap,'structure',path)??path):path;
  return '/structure';
 }
 if(bootstrap.membership.memberType==='GUEST')return entryLanding('SHARED',bootstrap);
 const module=({GOALS:'goals',WORK:'work',MEETINGS:'meetings'} as Record<string,string>)[destination];
 return module&&bootstrap.modules[module]===false?'/structure':Object.hasOwn(map,destination)?map[destination]:'/structure';
}
export function entryMediaUrl(value:string|null|undefined):string|null{
 if(!value)return null;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function canApplyEntryLanding(implicit:boolean,arrival:string,current:string):boolean{
 return implicit&&arrival===current&&['/','/structure','/login','/register'].includes(current);
}
