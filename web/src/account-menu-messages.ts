import { createMessageTranslator, SUPPORTED_LOCALES, type Locale } from '../../packages/i18n/index.js';

const rows = {
  menu: ['Menu da conta','Account menu','Menú de la cuenta','Menu du compte','Kontomenü','Menu account','アカウントメニュー','Accountmenu'],
  manageAccount: ['Gerenciar minha conta','Manage my account','Gestionar mi cuenta','Gérer mon compte','Mein Konto verwalten','Gestisci il mio account','アカウントを管理','Mijn account beheren'],
  closeMenu: ['Fechar menu da conta','Close account menu','Cerrar menú de la cuenta','Fermer le menu du compte','Kontomenü schließen','Chiudi menu account','アカウントメニューを閉じる','Accountmenu sluiten'],
  currentOrganization: ['Organização atual','Current organization','Organización actual','Organisation actuelle','Aktuelle Organisation','Organizzazione attuale','現在の組織','Huidige organisatie'],
  favorites: ['Favoritos','Favorites','Favoritos','Favoris','Favoriten','Preferiti','お気に入り','Favorieten'],
  organizationSettings: ['Configurações da organização','Organization settings','Configuración de la organización','Paramètres de l’organisation','Organisationseinstellungen','Impostazioni organizzazione','組織設定','Organisatie-instellingen'],
  integrationsResources: ['Integrações e recursos','Integrations and resources','Integraciones y recursos','Intégrations et ressources','Integrationen und Ressourcen','Integrazioni e risorse','連携とリソース','Integraties en bronnen'],
  signOut: ['Sair da conta','Sign out','Cerrar sesión','Se déconnecter','Abmelden','Esci','ログアウト','Uitloggen'],
  backToMenu: ['Voltar ao menu da conta','Back to account menu','Volver al menú de la cuenta','Retour au menu du compte','Zurück zum Kontomenü','Torna al menu account','アカウントメニューに戻る','Terug naar accountmenu'],
  yourOrganizations: ['Suas organizações','Your organizations','Tus organizaciones','Vos organisations','Ihre Organisationen','Le tue organizzazioni','あなたの組織','Jouw organisaties'],
  searchOrganization: ['Buscar organização','Search organizations','Buscar organizaciones','Rechercher une organisation','Organisationen suchen','Cerca organizzazioni','組織を検索','Organisaties zoeken'],
  searchPlaceholder: ['Buscar organização…','Search organizations…','Buscar organizaciones…','Rechercher une organisation…','Organisationen suchen…','Cerca organizzazioni…','組織を検索…','Organisaties zoeken…'],
  noOrganizationsFound: ['Nenhuma organização encontrada.','No organizations found.','No se encontraron organizaciones.','Aucune organisation trouvée.','Keine Organisation gefunden.','Nessuna organizzazione trovata.','組織が見つかりません。','Geen organisaties gevonden.'],
  createOrganization: ['Criar organização','Create organization','Crear organización','Créer une organisation','Organisation erstellen','Crea organizzazione','組織を作成','Organisatie maken'],
  acceptInvite: ['Aceitar convite','Accept invitation','Aceptar invitación','Accepter une invitation','Einladung annehmen','Accetta invito','招待を承諾','Uitnodiging accepteren'],
} as const satisfies Record<string, readonly [string,string,string,string,string,string,string,string]>;

export type AccountMenuMessage = keyof typeof rows;
export const accountMenuMessages = Object.fromEntries(SUPPORTED_LOCALES.map((locale,index) => [
  locale, Object.fromEntries(Object.entries(rows).map(([key,values]) => [key,values[index]])),
])) as Record<Locale,Record<AccountMenuMessage,string>>;
export const accountMenuTranslator = (locale:string) => createMessageTranslator(locale,accountMenuMessages);
