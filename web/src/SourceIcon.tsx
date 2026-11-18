import {Bell,CalendarDays,Clock3,FileText,Flag,ListTree,Megaphone,ScrollText,Target,Users,Zap} from 'lucide-react';
import {StructureIcon} from './StructureIcon';
export type SourceIconName='structure'|'goals'|'projects'|'meetings'|'members'|'explore'|'directory'|'proposals'|'agreements'|'history'|'feedback'|'tensions'|'notifications';
export function SourceIcon({name,size=20}:{name:SourceIconName;size?:number;active?:boolean}){
 if(name==='structure'||name==='explore')return <StructureIcon size={size}/>;
 const Icon={goals:Target,projects:Flag,meetings:CalendarDays,members:Users,directory:ListTree,proposals:ScrollText,agreements:FileText,history:Clock3,feedback:Megaphone,tensions:Zap,notifications:Bell}[name];
 return <Icon size={size} strokeWidth={1.65} aria-hidden="true"/>;
}
