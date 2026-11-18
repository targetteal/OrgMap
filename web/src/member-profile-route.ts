import {memberReturnPath} from './member-directory';
export type MemberProfileTab='general'|'structure'|'activity'|'metrics'|'checklists'|'projects'|'goals';
export function memberProfileTab(path:string):MemberProfileTab {
 const tab=new URL(path,'https://orgmap.invalid').searchParams.get('tab');
 const pathTab=new URL(path,'https://orgmap.invalid').pathname.split('/')[3];
 const value=tab??pathTab;
 return value==='structure'||value==='activity'||value==='metrics'||value==='checklists'||value==='projects'||value==='goals'?value:'general';
}
export function memberProfilePath(memberId:string,tab:MemberProfileTab,from:string|null):string {
 const query=new URLSearchParams();if(tab!=='general')query.set('tab',tab);
 if(from)query.set('from',memberReturnPath(from));
 return '/members/'+encodeURIComponent(memberId)+(query.size?'?'+query:'');
}
const labels={
 'pt-BR':{general:'Geral',metrics:'Métricas',checklists:'Checklists',projects:'Projetos',goals:'Objetivos',tabs:'Perfil do membro',permissions:'Permissões dos meus indicadores'},
 'en-US':{general:'General',metrics:'Metrics',checklists:'Checklists',projects:'Projects',goals:'Goals',tabs:'Member profile',permissions:'My indicator permissions'},
 'es-ES':{general:'General',metrics:'Métricas',checklists:'Listas de verificación',projects:'Proyectos',goals:'Objetivos',tabs:'Perfil del miembro',permissions:'Permisos de mis indicadores'},
 'fr-FR':{general:'Général',metrics:'Indicateurs',checklists:'Listes de contrôle',projects:'Projets',goals:'Objectifs',tabs:'Profil du membre',permissions:'Autorisations de mes indicateurs'},
 'de-DE':{general:'Allgemein',metrics:'Kennzahlen',checklists:'Checklisten',projects:'Projekte',goals:'Ziele',tabs:'Mitgliedsprofil',permissions:'Berechtigungen meiner Kennzahlen'},
 'it-IT':{general:'Generale',metrics:'Metriche',checklists:'Liste di controllo',projects:'Progetti',goals:'Obiettivi',tabs:'Profilo del membro',permissions:'Permessi dei miei indicatori'},
 'nl-NL':{general:'Algemeen',metrics:'Metrieken',checklists:'Checklists',projects:'Projecten',goals:'Doelen',tabs:'Ledenprofiel',permissions:'Rechten voor mijn indicatoren'},
 'ja-JP':{general:'概要',metrics:'指標',checklists:'チェックリスト',projects:'プロジェクト',goals:'目標',tabs:'メンバープロフィール',permissions:'自分の指標の権限'},
};
export function memberProfileLabels(locale:string|undefined){return labels[locale as keyof typeof labels]??labels['pt-BR'];}
