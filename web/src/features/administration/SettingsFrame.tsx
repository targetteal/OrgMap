import {Building2, Network, ShieldCheck, CircleDot, Palette, SlidersHorizontal, ChevronRight, ChevronDown, LayoutGrid, ListTree, Target, Megaphone, ArrowLeftRight, LayoutTemplate, ScrollText, TextCursorInput, ClipboardList, UsersRound, IdCard, Globe, KeyRound, type LucideIcon} from 'lucide-react';
import type {ReactNode} from 'react';
import type {FeatureContext} from '../../feature-contract';
import {useLocalization, createMessageTranslator} from '../../localization';
import {administrationMessages, settingsMessages, type SettingsMessageKey} from './messages';
import './settings-frame.css';
type AdminKey=keyof (typeof administrationMessages)['pt-BR'];
type Section={id:string;label:SettingsMessageKey|`admin:${AdminKey}`;path:string;Icon:LucideIcon};
const groups:{id:string;title:SettingsMessageKey;sections:Section[]}[]=[
 {id:'general',title:'groupGeneral',sections:[
  {id:'organization',label:'navOrganization',path:'/administration/settings',Icon:Building2},
  {id:'appearance',label:'navAppearance',path:'/administration/settings#appearance',Icon:Palette},
 ]},
 {id:'governance',title:'groupGovernance',sections:[
  {id:'governance',label:'navStructure',path:'/settings/governance-model',Icon:Network},
  {id:'essential',label:'navEssential',path:'/settings/governance-model#essential',Icon:ShieldCheck},
  {id:'role-templates',label:'navRoleTemplates',path:'/structure/advanced#role-templates',Icon:LayoutTemplate},
  {id:'circle-options',label:'navCircleOptions',path:'/settings/governance-model#circle-options',Icon:CircleDot},
 ]},
 {id:'tools',title:'groupTools',sections:[
  {id:'advanced',label:'navAdvanced',path:'/structure/advanced',Icon:SlidersHorizontal},
  {id:'tools',label:'navAppTools',path:'/administration/settings#tools',Icon:LayoutGrid},
 ]},
 {id:'administration',title:'groupAdministration',sections:[
  {id:'admin-policies',label:'admin:policies',path:'/administration/policies',Icon:ScrollText},
  {id:'admin-fields',label:'admin:fields',path:'/administration/fields',Icon:TextCursorInput},
  {id:'admin-templates',label:'admin:templates',path:'/administration/templates',Icon:ClipboardList},
  {id:'admin-groups',label:'admin:groups',path:'/administration/groups',Icon:UsersRound},
  {id:'admin-profiles',label:'admin:profiles',path:'/administration/profiles',Icon:IdCard},
  {id:'admin-pages',label:'admin:pages',path:'/administration/pages',Icon:Globe},
  {id:'admin-grants',label:'admin:grants',path:'/administration/grants',Icon:KeyRound},
 ]},
];
function SettingsTools({context:c}:{context:FeatureContext}){
 const goalsDisabled=c.bootstrap.modules?.goals===false;
 const tools=[
  {label:'Hierarquia da estrutura',description:'Consulte círculos e papéis em ordem hierárquica.',path:c.bootstrap.governanceModel?'/structure/directory':'/structure?view=hierarchy',Icon:ListTree},
  {label:'Objetivos',description:goalsDisabled?'Módulo desativado nesta organização.':'Objetivos, resultados e acompanhamento.',path:'/goals',Icon:Target,disabled:goalsDisabled},
  {label:'Publicações',description:'Publicações e conteúdos da organização.',path:'/publications',Icon:Megaphone},
  {label:'Importação e exportação',description:'Transferências de dados e acompanhamento dos arquivos.',path:'/platform/jobs',Icon:ArrowLeftRight},
 ];
 return <section className="settings-tools" aria-labelledby="settings-tools-heading"><h2 id="settings-tools-heading">Ferramentas do app</h2><p>Outras visualizações e recursos da organização.</p><div className="settings-tools-list">{c.bootstrap.membership.memberType!=='GUEST'&&tools.map(({label,description,path,Icon,disabled})=><button type="button" key={path} disabled={disabled} onClick={()=>c.navigate(path)}><span className="settings-tool-icon"><Icon size={20}/></span><span><strong>{label}</strong><small>{description}</small></span>{!disabled&&<ChevronRight size={17}/>}</button>)}</div></section>;
}
export function SettingsFrame({context:c,children}:{context:FeatureContext;children:ReactNode}){
 const {locale}=useLocalization();
 const t=createMessageTranslator(locale,settingsMessages);
 const ta=createMessageTranslator(locale,administrationMessages);
 const label=(key:Section['label'])=>key.startsWith('admin:')?ta(key.slice(6) as AdminKey):t(key as SettingsMessageKey);
 const path=c.path.split(/[?#]/,1)[0],hash=(c.hash||c.path.split('#')[1]||'').replace(/^#/,'');
 const adminTab=/^\/administration\/(policies|fields|templates|groups|profiles|pages|grants)\/?$/.exec(path)?.[1];
 const active=adminTab?'admin-'+adminTab:path==='/structure/advanced'?(hash==='role-templates'?'role-templates':'advanced'):path==='/settings/governance-model'?(hash==='essential'?'essential':hash==='circle-options'?'circle-options':'governance'):path==='/administration/settings'||path==='/administration'?(hash==='appearance'?'appearance':hash==='tools'?'tools':'organization'):'';
 const selectedSection=groups.flatMap(group=>group.sections).find(section=>section.id===active)?.path??path;
 return <div className="settings-frame"><div className="settings-frame-wrap"><div className="settings-frame-layout">
  <label className="settings-frame-mobile-section"><span>{t('navMobile')}</span><span className="settings-frame-select"><select value={selectedSection} onChange={event=>c.navigate(event.target.value)}>{groups.map(group=><optgroup key={group.id} label={t(group.title)}>{group.sections.map(section=><option key={section.id} value={section.path}>{label(section.label)}</option>)}</optgroup>)}</select><ChevronDown size={16} aria-hidden="true"/></span></label>
  <nav className="settings-frame-nav" aria-label={t('navLabel')}>{groups.map(group=><div className="settings-frame-group" key={group.id} role="group" aria-labelledby={'settings-group-'+group.id}><div className="settings-frame-group-title" id={'settings-group-'+group.id}>{t(group.title)}</div>{group.sections.map(({id,label:key,path:target,Icon})=><button type="button" key={id} className={active===id?'active':''} aria-current={active===id?'page':undefined} onClick={()=>c.navigate(target)}><Icon size={16} strokeWidth={1.75} aria-hidden="true"/><span>{label(key)}</span></button>)}</div>)}</nav>
  <div className="settings-frame-content">{active==='tools'&&<SettingsTools context={c}/>}<div className="settings-frame-existing" hidden={active==='tools'}>{children}</div></div>
 </div></div></div>;
}
