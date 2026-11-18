import {createMessageTranslator,SUPPORTED_LOCALES,type Locale} from '../../packages/i18n/index.js';

const rows={
 structureSection:['Estrutura organizacional','Organization structure','Estructura organizativa','Structure de l’organisation','Organisationsstruktur','Struttura organizzativa','組織構造','Organisatiestructuur'],
 rolesCircles:['Papéis e Círculos','Roles and Circles','Roles y Círculos','Rôles et Cercles','Rollen und Kreise','Ruoli e Cerchi','ロールとサークル','Rollen en Kringen'],
 history:['Histórico','History','Historial','Historique','Verlauf','Cronologia','履歴','Geschiedenis'],
 historyTitle:['Histórico da organização','Organization history','Historial de la organización','Historique de l’organisation','Organisationsverlauf','Cronologia dell’organizzazione','組織の履歴','Organisatiegeschiedenis'],
 proposals:['Propostas','Proposals','Propuestas','Propositions','Vorschläge','Proposte','提案','Voorstellen'],
 restrictions:['Restrições','Restrictions','Restricciones','Restrictions','Einschränkungen','Restrizioni','制約','Beperkingen'],
 tensions:['Tensões','Tensions','Tensiones','Tensions','Spannungen','Tensioni','テンション','Spanningen'],
 settings:['Configurações','Settings','Configuración','Paramètres','Einstellungen','Impostazioni','設定','Instellingen'],
 mainNavigation:['Navegação principal','Main navigation','Navegación principal','Navigation principale','Hauptnavigation','Navigazione principale','メインナビゲーション','Hoofdnavigatie'],
 openNavigation:['Abrir navegação','Open navigation','Abrir navegación','Ouvrir la navigation','Navigation öffnen','Apri navigazione','ナビゲーションを開く','Navigatie openen'],
 closeNavigation:['Fechar navegação','Close navigation','Cerrar navegación','Fermer la navigation','Navigation schließen','Chiudi navigazione','ナビゲーションを閉じる','Navigatie sluiten'],
 expandNavigation:['Expandir navegação','Expand navigation','Ampliar navegación','Développer la navigation','Navigation erweitern','Espandi navigazione','ナビゲーションを展開','Navigatie uitvouwen'],
 collapseNavigation:['Recolher navegação','Collapse navigation','Contraer navegación','Réduire la navigation','Navigation einklappen','Comprimi navigazione','ナビゲーションを折りたたむ','Navigatie invouwen'],
} as const satisfies Record<string,readonly [string,string,string,string,string,string,string,string]>;

export type ShellMessage=keyof typeof rows;
export const shellMessages=Object.fromEntries(SUPPORTED_LOCALES.map((locale,index)=>[
 locale,Object.fromEntries(Object.entries(rows).map(([key,values])=>[key,values[index]])),
])) as Record<Locale,Record<ShellMessage,string>>;
export const shellTranslator=(locale:string)=>createMessageTranslator(locale,shellMessages);
