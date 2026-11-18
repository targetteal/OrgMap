import {createContext, useContext, useMemo, type ReactNode} from "react";
import type {FeatureContext} from "../feature-contract";
import {richTextTranslator} from "./rich-text-messages";

export type MentionRole = {id:string; name:string; archived?:boolean};
export type RoleMentionScope = {organizationId:string; roles:MentionRole[]; navigate?:(path:string)=>void; locale?:string};
const MentionContext=createContext<RoleMentionScope|null>(null);
export const RoleMentionProvider=MentionContext.Provider;
export function useRoleMentions(){return useContext(MentionContext);}
/** Only the currently readable structure is offered; never search another tenant or a cached global list. */
export function FeatureRoleMentions({context,children}:{context:FeatureContext|null;children:ReactNode}){
 const value=useMemo(()=>context?({organizationId:context.organizationId,roles:context.bootstrap.membership.memberType==='GUEST'?[]:(context.structure?.nodes??[]).filter(n=>n.kind==='ROLE'&&!n.pathRedacted).map(n=>({id:n.entityId,name:n.name,archived:!!(n as {archived?:boolean}).archived})),navigate:context.navigate,locale:context.accountPreferences?.locale}):null,[context?.organizationId,context?.structure,context?.bootstrap.membership.memberType,context?.navigate,context?.accountPreferences?.locale]);
 return <RoleMentionProvider value={value}>{children}</RoleMentionProvider>;
}
export function mentionLabel(role:MentionRole|undefined,locale='pt-BR'){
 const t=richTextTranslator(locale);
 return role ? '@'+role.name+(role.archived?t('archivedRole'):'') : '@'+t('unavailableRole');
}
export function matchMentionRoles(roles:MentionRole[],query:string){
 const normalize=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
 const term=normalize(query);
 return roles.filter(role=>!role.archived&&normalize(role.name).includes(term)).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,20);
}
