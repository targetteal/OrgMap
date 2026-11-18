import { AccountMenu } from "./AccountMenu";
import { NotificationDropdown } from "./NotificationDropdown";
import {useMobileNavigation} from "./use-mobile-navigation";
import {FeatureRoleMentions} from "./editor";
import "./structure-desktop.css";
import "./entity-drawer-mare.css";
import {sessionOwnsBootstrap} from "./session-scope";
import {OrgAdmission} from "./admission/OrgAdmission";
import {admissionRoute,admissionPath} from "./admission-route";
import {invitationRoute,invitationPath} from './invitation-route';
import {InvitationAcceptance} from './invitations/InvitationAcceptance';
import {InvitationComposer} from './features/administration/InvitationComposer';
import {purposePayload} from "./purpose-payload";
import {DefinitionListEditor, DefinitionList, ArtifactAuthority, type EntityDefinition} from "./structure-definition";
import {RichTextEditor, RichTextView, type RichDocument} from "./editor";
import { OrganizationCredentialGate } from "./OrganizationCredentialGate";
import { structureParentLabel } from "./structure-breadcrumb";
import { OrganizationEntry } from "./OrganizationEntry";
import { AccountShell } from "./AccountShell";
import { WorkspaceBrand, WorkspaceBrandingShell } from './WorkspaceBrand';
import { OrgMapBrand, OrgMapHomeLink } from './OrgMapBrand';
import { isGuestBootstrap, guestModuleAvailable, guestRouteAvailable, guestRailPath, canLoadStructureHistory } from "./guest-navigation";
import { governanceVocabulary } from './governance-vocabulary';
import { MemberDirectoryPage } from "./MemberDirectoryPage";
import { MemberProfileContent } from "./MemberProfileContent";
import { GlobalAccessibilityProvider, AccessibilitySettings, AccessibilitySkipLink } from "./accessibility";
import { LocalizationProvider, localizationValue, formatError, resolveLocale, type Locale, type MessageKey } from "./localization";
import {AuthLayout,AuthNotice,AuthPasswordField,AuthSubmit,AuthTextField} from './account/AuthLayout';
import {applyAccountTheme} from './account/theme';
import {publicAuthTranslator} from './account/public-auth-messages';
import {shellTranslator} from "./shell-messages";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { PanelLeftOpen, PanelLeftClose, Scale,
  CircleDot,
  Target,
  PanelsTopLeft,
  CalendarDays,
  Users,
  Search,
  ChevronDown,
  Plus,
  Archive,
  FileText,
  History,
  Settings2,
  X,
  Menu,
  ArrowLeft,
  UserPlus,
  MailCheck,
  LogOut,
  Building2,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize,
  MoreHorizontal,
  Minimize,
  FolderTree,
  ExternalLink,
  FilePenLine,
  Workflow,
} from "lucide-react";
import {
  request,
  setCsrf,
  errorMessage,
  RequestError,
  type Session,
  type Structure,
  type StructureNode,
  type Member,
  type Bootstrap,
  type Relation,
} from "./api";
import { StructureDirectory } from "./StructureDirectory";
import { StructureExplorer, type ExplorerSnapshot } from "./StructureExplorer";
import { StructureIcon } from "./StructureIcon";
import { StructureRelated, StructureEntityNavigation, StructureDocumentPanel } from "./StructureRelated";
import { StructureRoleTree } from "./StructureRoleTree";
import { SourceIcon } from "./SourceIcon";
import { Button, Dialog, Field, Notice } from "./ui";
export { Button, Dialog, Field, Notice } from "./ui";
import {
  moduleLinks,
  canonicalRoute,
  routeParts,
  NavigationGate,
} from "./navigation";
import {
  formatAccountDate,
  type RegionalPreferences,
} from "./account/formatting";
import { EnrollmentPage } from "./features/interoperability/enrollment";
import { AccountPage, AccountNavigation, RecoveryPage } from "./account";
import { features } from "./features/registry";
import type { FeatureContext } from "./feature-contract";
import { packedNodes, initials, entityPath, structureReturnPath, platformEntityReturnPath, safeDestination } from "./model";
const modules = moduleLinks;
const unavailable: Record<string, string> = {
  "/goals": "Objetivos",
  "/projects": "Projetos",
  "/meetings": "Reuniões",
  "/proposals": "Propostas",
  "/structure/proposals": "Propostas",
  "/structure/working-agreements": "Acordos de trabalho",
  "/agreements": "Acordos de trabalho",
  "/settings/structure": "Configurações de estrutura",
  "/settings/members": "Configurações de membros",
};
function useRoute(canNavigate: () => boolean = () => true, clean: (value:string)=>string = value=>value) {
  const read = () => clean(canonicalRoute(location.pathname + location.search + location.hash));
  const [path, setPath] = useState(read);
  const current = useRef(path),
    check = useRef(canNavigate);
  check.current = canNavigate;
  useEffect(() => {
    if (location.pathname + location.search + location.hash !== current.current)
      history.replaceState({}, "", current.current);
    const fn = () => {
      const next = read();
      if (next === current.current) return;
      if (!check.current()) {
        history.pushState({}, "", current.current);
        return;
      }
      if (location.pathname + location.search + location.hash !== next)
        history.replaceState({}, "", next);
      current.current = next;
      setPath(next);
    };
    window.addEventListener("popstate", fn);
    window.addEventListener("hashchange", fn);
    return () => {
      window.removeEventListener("popstate", fn);
      window.removeEventListener("hashchange", fn);
    };
  }, []);
  const navigate = useCallback((value: string, replace = false) => {
    const next = clean(canonicalRoute(value));
    if (next === current.current || !check.current()) return;
    if(replace) history.replaceState({}, "", next); else history.pushState({}, "", next);
    const changedPage = next.split("?")[0] !== current.current.split("?")[0];
    current.current = next;
    setPath(next);
    if (changedPage) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.getElementById("main-content")?.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, []);
  return [path, navigate] as const;
}

function Auth({
  register,
  onSession,
  navigate,
  brandingRef,
  locale,
  onLocaleChange,
  sessionIssue,
  onRetrySession,
}: {
  register: boolean;
  onSession: (s: Session) => void;
  navigate: (s: string) => void;
  brandingRef?: string | null;
  locale:Locale;
  onLocaleChange:(locale:Locale)=>void;
  sessionIssue?:string;
  onRetrySession:()=>void;
}) {
  const a=publicAuthTranslator(locale);
  const publicBranding = brandingRef && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(brandingRef) ? brandingRef : null;
  const [failedBackground, setFailedBackground] = useState<string | null>(null);
  const showBackground = publicBranding && failedBackground !== publicBranding;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [authFailure,setAuthFailure]=useState<"credentials"|"session"|null>(null);
  const [attempted,setAttempted]=useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAuthFailure(null);
    setAttempted(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    let authenticated=false;
    let focusEmail=false;
    try {
      const r = await request<{
        account: Session["account"];
        csrfToken: string;
      }>(register ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: {
          email: data.get("email"),
          password: data.get("password"),
          ...(register ? { displayName: data.get("displayName") } : {}),
        },
      });
      authenticated=true;
      setCsrf(r.data.csrfToken);
      const me = await request<Session>("/me");
      onSession(me.data);
      navigate(
        safeDestination(
          sessionStorage.getItem("orgmap.returnTo") ?? "/structure",
        ),
      );
      sessionStorage.removeItem("orgmap.returnTo");
    } catch (e) {
      setError(e);
      if(e instanceof RequestError && e.code==="UNAUTHENTICATED") {
        setAuthFailure(authenticated ? "session" : register ? null : "credentials");
        focusEmail = !authenticated && !register;
      }
    } finally {
      setBusy(false);
      // The submit button is disabled while waiting; return focus to the first field to correct.
      if (focusEmail) requestAnimationFrame(() => form.querySelector<HTMLInputElement>('input[name="email"]')?.focus());
    }
  }
  const errorId=useId();
  const credentialsFailed=authFailure==='credentials';
  const brandingQuery=publicBranding ? '?branding=' + publicBranding : '';
  return (
    <AuthLayout locale={locale} onLocaleChange={onLocaleChange}
      background={showBackground ? '/api/v1/public/branding/' + publicBranding : null}
      onBackgroundError={() => setFailedBackground(publicBranding)}>
      <form className="auth-form" onSubmit={submit} aria-describedby={error !== null ? errorId : undefined}>
        <header className="auth-heading">
          <h1>{register ? a('registerTitle') : a('loginTitle')}</h1>
          <p>{register ? a('registerIntro') : a('loginIntro')}</p>
        </header>
        {sessionIssue && !attempted && <div className="auth-session-error"><AuthNotice><p>{sessionIssue}</p><Button onClick={onRetrySession}>{a('retry')}</Button></AuthNotice></div>}
        {error !== null && <AuthNotice id={errorId}>{authFailure ? a(authFailure==='credentials'?'invalidCredentials':'sessionExpired') : locale==='pt-BR'?errorMessage(error):formatError(error,locale)}</AuthNotice>}
        {register && (
          <AuthTextField label={a('name')} name="displayName" maxLength={200} autoComplete="name" />
        )}
        <AuthTextField label={a('email')} name="email" type="email" autoComplete="email" inputMode="email"
          invalid={credentialsFailed} describedBy={credentialsFailed ? errorId : undefined} />
        <div className="auth-password-group">
          <AuthPasswordField
            label={a('password')}
            showLabel={a('showPassword')}
            name="password"
            minLength={register ? 12 : 1}
            maxLength={register ? 1024 : undefined}
            help={register ? a('passwordPolicy') : undefined}
            autoComplete={register ? "new-password" : "current-password"}
            invalid={credentialsFailed}
            describedBy={credentialsFailed ? errorId : undefined}
          />
          {!register && (
            <Button className="auth-link auth-forgot" onClick={() => navigate("/forgot-password")}>
              {a('forgotPassword')}
            </Button>
          )}
        </div>
        <AuthSubmit busy={busy} label={register ? a('registerAction') : a('signIn')} waitLabel={a('wait')} />
        {register ? (
          <div className="auth-alternatives">
            <Button className="auth-link" onClick={() => navigate('/login' + brandingQuery)}>
              <ArrowLeft size={16} aria-hidden="true" />
              {a('haveAccount')}
            </Button>
          </div>
        ) : (
          <div className="auth-alternatives" role="group" aria-labelledby={errorId + '-alternatives'}>
            <p id={errorId + '-alternatives'}>{a('firstTime')}</p>
            <Button className="auth-secondary" onClick={() => navigate('/register' + brandingQuery)}>
              <UserPlus size={18} aria-hidden="true" />
              {a('registerLink')}
            </Button>
            <Button className="auth-secondary" onClick={() => navigate("/enrollment")}>
              <MailCheck size={18} aria-hidden="true" />
              {a('activateAccess')}
            </Button>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
type FormKind =
  | "organization"
  | "circle"
  | "role"
  | "edit"
  | "move"
  | "archive"
  | "assign"
  | "associate"
  | "member"
  | "member-edit"
  | "end"
  | "end-association"
  | "invite"
  | "accept-invite"
  | null;
export function App() {
  const navigationGuards = useRef(new NavigationGate());
  const [navigationIssue, setNavigationIssue] = useState("");
  const canNavigate = useCallback(() => {
    const reason = navigationGuards.current.reason();
    if (reason) {
      setNavigationIssue(reason);
      return false;
    }
    setNavigationIssue("");
    return true;
  }, []);
  const registerNavigationGuard = useCallback((guard: () => string | null) => {
    const unregister = navigationGuards.current.register(guard);
    return () => {
      unregister();
      queueMicrotask(() => {
        if (!navigationGuards.current.reason()) setNavigationIssue("");
      });
    };
  }, []);
  const admissionCapability = useRef<{organizationId:string;token:string}|null>(null);
  const invitationCapability = useRef<string|undefined>(undefined);
  const cleanAdmissionRoute = useCallback((value:string) => {
    const invitation=invitationRoute(value);
    if(invitation){
      if(invitation.token || value!==invitation.path)invitationCapability.current=invitation.token;
      if(location.pathname+location.search+location.hash===value && value!==invitation.path)history.replaceState({},'',invitation.path);
      return invitation.path;
    }
    const next=admissionRoute(value);
    if(!next)return value;
    if(next.linkToken)admissionCapability.current={organizationId:next.organizationId,token:next.linkToken};
    if(location.pathname+location.search+location.hash===value && value!==next.path)history.replaceState({},"",next.path);
    return next.path;
  },[]);
  const [route, navigate] = useRoute(canNavigate,cleanAdmissionRoute);
  const [invitationRevision,setInvitationRevision]=useState(0);
  useEffect(()=>{
    const changed=()=>{if(location.pathname===invitationPath)setInvitationRevision(value=>value+1);};
    window.addEventListener('hashchange',changed);
    return()=>window.removeEventListener('hashchange',changed);
  },[]);
  const implicitEntryLanding = useRef(location.pathname === "/" || (["/login","/register"].includes(location.pathname) && !sessionStorage.getItem("orgmap.returnTo")));
  const { pathname: path, matchPath, hash } = routeParts(route);
  const admission = admissionRoute(matchPath);
  const [session, setSession] = useState<Session | null>(null),
    [initial, setInitial] = useState(true),
    [sessionError, setSessionError] = useState<{kind:'expired'}|{kind:'request';error:unknown}|null>(null);
  const [publicLocale,setPublicLocale]=useState<Locale>(()=>{
    try{return resolveLocale(window.sessionStorage.getItem('orgmap.publicLocale')??navigator.language);}catch{return resolveLocale(navigator.language);}
  });
  const choosePublicLocale=(value:Locale)=>{const next=resolveLocale(value);setPublicLocale(next);try{window.sessionStorage.setItem('orgmap.publicLocale',next);}catch{/* private browsing may disable storage */}};
  useEffect(()=>{if(!session)document.documentElement.lang=publicLocale;},[publicLocale,session]);
  const [preferenceState, setPreferenceState] = useState<{accountId: string; preferences: RegionalPreferences}>();
  const accountPreferences = preferenceState?.accountId === session?.account.id ? preferenceState?.preferences : undefined;
  useEffect(() => {
    if (!session || !accountPreferences) {
      delete document.documentElement.dataset.accountTheme;
      return;
    }
    return applyAccountTheme(accountPreferences.theme);
  }, [session?.account.id, accountPreferences?.theme]);
  const { t } = localizationValue(accountPreferences);
  const shellText=shellTranslator(accountPreferences?.locale??'pt-BR');
  const moduleLabel = (module: string, fallback: string) => {
    const key: Record<string, MessageKey> = { structure: "nav.structure", goals: "nav.goals", projects: "nav.work", meetings: "nav.meetings", members: "nav.members" };
    return key[module] ? t(key[module]) : fallback;
  };
  const [preferencesRevision, setPreferencesRevision] = useState(0);
  const [preferenceError, setPreferenceError] = useState<{accountId: string; message: string} | null>(null);
  const [guestScope, setGuestScope] = useState("");
  const [guestSnapshotPath, setGuestSnapshotPath] = useState("");
  const [credentialGateOrg, setCredentialGateOrg] = useState("");
  const [purposeDraft, setPurposeDraft] = useState<RichDocument | undefined>(undefined);
  const [definitionDraft, setDefinitionDraft] = useState<EntityDefinition>({});
  const [orgId, setOrgId] = useState(""),
    [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [structure, setStructure] = useState<Structure | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const trackingOrganization = (path === "/organization-invitations" || /^\/(?:platform|roles|circles|projects|goals|meetings|structure)(?:\/|$)/.test(path))
    ? new URLSearchParams(matchPath.split("?")[1] ?? "").get("organizationId") : null;
  const trackingOrganizationId = trackingOrganization && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(trackingOrganization)
    && session?.organizations.some(organization => organization.id === trackingOrganization) ? trackingOrganization : null;
  const changingTrackingOrganization = !!trackingOrganizationId && trackingOrganizationId !== orgId;
  const [formDirty, setFormDirty] = useState(false);
  const releaseFormGuard = useRef<(() => void) | null>(null);
  const [form, setForm] = useState<FormKind>(null),
    [formError, setFormError] = useState(""),
    [saving, setSaving] = useState(false),
    [menu, setMenu] = useState(false),
    [newMenu, setNewMenu] = useState(false),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(""),
    [localQuery, setLocalQuery] = useState(""),
    [view, setView] = useState<"pack" | "tree">("pack"),
    [zoom, setZoom] = useState(1),
    [toast, setToast] = useState(""),
    [audit, setAudit] = useState<
      { id: string; action: string; at: string; resourceId: string }[]
    >([]),
    [auditRead, setAuditRead] = useState<{state:"loading"|"ready"|"denied"|"error"; message?:string}>({state:"loading"}),
    [endRelation, setEndRelation] = useState<Relation | null>(null);
  const mobileNavigation=useMobileNavigation(mobile,()=>setMobile(false));
  const generation = useRef(0);
  const installedAccount = useRef<string|null>(null);
  const tenantBootstrap = useRef(bootstrap);
  tenantBootstrap.current = bootstrap;
  const explorerState = useRef<{
    orgId: string;
    state: ExplorerSnapshot;
  } | null>(null);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const submitting = useRef(false);
  const createdOrganizationRef = useRef<{id:string; name:string} | null>(null);
  const [createdOrganization, setCreatedOrganization] = useState<{id:string; name:string} | null>(null);
  const owner = !isGuestBootstrap(bootstrap) && bootstrap?.capabilities["structure.direct"] === true;
  const hasGovernanceModel = !!bootstrap?.governanceModel;
  const derivedCircleMembership = bootstrap?.governanceModel?.rules.membership === 'OCCUPANCY';
  const vocabulary=governanceVocabulary(bootstrap);
  const structureNavLabel=vocabulary.circle==='Círculo'&&vocabulary.role==='Papel'?shellText('rolesCircles'):vocabulary.directory;
  const membersNavLabel=vocabulary.member==='Membro'?moduleLabel('members','Membros'):vocabulary.members;
  const directStructure = owner && (!hasGovernanceModel || bootstrap?.governanceModel?.phase === 'PREPARATION' || bootstrap?.governanceModel?.rules.structureChanges === 'LEGACY');
  const knownGuest = !!session && !!orgId && guestScope === session.account.id + ":" + orgId;
  const isGuest = isGuestBootstrap(bootstrap) || knownGuest;
  const guestRouteAllowed = (!knownGuest || !!bootstrap) && guestRouteAvailable(bootstrap, matchPath);
  const guestNoResources = isGuest && !!bootstrap && !(bootstrap.sharedResources?.length);
  const [entityFocusExpanded, setEntityFocusExpanded] = useState(false);
  const selectedId = /^\/(circles|roles)\/([^/]+)/.exec(path)?.[2];
  const selected = structure?.nodes.find((n) => n.entityId === selectedId);
  const entityReturnFocus=useRef<string|null>(null);
  const entityProfileReturn=useRef<{organizationId:string;accountId:string;entityId:string;memberId:string;scrollTop:number}|null>(null);
  const entityParams=new URLSearchParams(matchPath.split("?")[1]??"");
  const entityOrigin=entityParams.get("from");
  const entitySource=structureReturnPath(entityOrigin);
  const entityPlatformSource=platformEntityReturnPath(entityOrigin);
  const entityDocumentId=entityParams.get("document");
  const navigateWithinEntity=(target:string)=>navigate(target+"?from="+encodeURIComponent(entityPlatformSource??entitySource));
  const navigateFromEntity = useCallback((target:string) => {
    const member = /^\/members\/([a-f0-9-]{36})(?:\?|$)/i.exec(target);
    if (!selected || !member || !session) { navigate(target); return; }
    const content = document.querySelector(".mare-entity-drawer .structure-entity-content");
    entityProfileReturn.current = {organizationId:orgId,accountId:session.account.id,entityId:selected.entityId,memberId:member[1],scrollTop:content?.scrollTop ?? 0};
    const destination = new URL(target, "https://orgmap.invalid");
    destination.searchParams.set("from", matchPath);
    navigate(destination.pathname + destination.search);
  }, [selected?.entityId, orgId, session?.account.id, matchPath, navigate]);
  function closeEntityDrawer(){
    if(!selected)return;
    if (entityPlatformSource) {
      const source=new URL(entityPlatformSource,"https://orgmap.invalid");
      if(!source.searchParams.has("focus"))source.searchParams.set("focus",`resource-entry-${selected.kind.toLowerCase()}-${selected.entityId}`);
      navigate(source.pathname+source.search);
      return;
    }
    entityReturnFocus.current=selected.nodeId;
    navigate(entitySource);
  }
  useEffect(()=>{
    if(selected){document.getElementById("mare-entity-title")?.focus({preventScroll:true});return;}
    if(selectedId)return;
    setEntityFocusExpanded(false);
    const nodeId=entityReturnFocus.current;if(!nodeId)return;
    const restore = () => {
      if (entityReturnFocus.current !== nodeId) return true;
      const candidates=[...document.querySelectorAll<HTMLElement>('[data-node]')].filter(element=>element.dataset.node===nodeId&&(['link','button'].includes(element.getAttribute('role')??'')||element.tagName==='BUTTON'));
      const target=candidates.find(element=>element.hasAttribute("data-structure-search-node")) ?? candidates[0];
      if (!target) return false;
      target.focus({preventScroll:true});entityReturnFocus.current=null;return true;
    };
    const frame=requestAnimationFrame(restore);
    const root=document.getElementById("main-content");
    const observer=new MutationObserver(()=>{if(restore())observer.disconnect();});
    if(root)observer.observe(root,{childList:true,subtree:true});
    const fallback=setTimeout(()=>{observer.disconnect();if(entityReturnFocus.current===nodeId){document.getElementById("main-content")?.focus({preventScroll:true});entityReturnFocus.current=null;}},6000);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();clearTimeout(fallback);};
  },[selected?.nodeId,selectedId,path]);
  useEffect(() => {
    const origin = entityProfileReturn.current;
    if (!origin) return;
    if (origin.organizationId !== orgId || origin.accountId !== session?.account.id ||
      (!selected && !path.startsWith("/members/" + origin.memberId)) ||
      (selected && origin.entityId !== selected.entityId)) {entityProfileReturn.current=null;return;}
    if (!selected) return;
    const drawer = document.querySelector(".mare-entity-drawer");
    if (!drawer) return;
    const restore = () => {
      if (entityProfileReturn.current !== origin) return true;
      const marker = [...drawer.querySelectorAll<HTMLElement>("[data-entity-member]")].find(element => element.dataset.entityMember === origin.memberId);
      const opener = marker?.closest("button");
      if (!opener) return false;
      const content = drawer.querySelector(".structure-entity-content");
      if (content) content.scrollTop = origin.scrollTop;
      opener.focus({preventScroll:true});
      entityProfileReturn.current = null;
      return true;
    };
    if (restore()) return;
    // Occupancy data belongs to its domain and may arrive after the shell.
    const observer = new MutationObserver(() => { if (restore()) observer.disconnect(); });
    observer.observe(drawer, {childList:true,subtree:true});
    const fallback=setTimeout(()=>{observer.disconnect();entityProfileReturn.current=null;},6000);
    return () => {observer.disconnect();clearTimeout(fallback);};
  }, [selected?.entityId, orgId, session?.account.id, matchPath]);
  const memberId = /^\/members\/([^/]+)/.exec(path)?.[1];
  const selectedMember = members.find((m) => m.id === memberId);
  const memberModule =
    path.startsWith("/members") || path.startsWith("/settings/members");
  const feature = features.find((f) => f.matches(matchPath));
  const globalSearchFeature = features.find((f) => f.GlobalSearch);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const focusedSurface = !!feature?.collapseSidebar?.(matchPath);
  const settingsSurface = matchPath === "/structure/advanced" || /^\/(administration|settings)(?:\/|$)/.test(matchPath);
  const expandedBeforeFocus = useRef<boolean | null>(null);
  useEffect(() => {
    if (focusedSurface) {
      expandedBeforeFocus.current = sidebarExpanded;
      setSidebarExpanded(false);
    } else if (expandedBeforeFocus.current !== null) {
      setSidebarExpanded(expandedBeforeFocus.current);
      expandedBeforeFocus.current = null;
    }
  }, [focusedSurface]);
  const shouldCollapse = true;
  const secondaryCollapsed = !sidebarExpanded;
  const settingsPath =
    feature?.settingsPath ??
    (memberModule ? "/settings/members" : titlePlaceholder());
  function titlePlaceholder() {
    return !feature || feature.module === "structure"
      ? "/settings/structure"
      : null;
  }
  const title =
    feature && !modules.some((m) => m.path === "/" + feature.module)
      ? feature.label
      : memberModule
        ? membersNavLabel
        : feature?.module === "members" ? feature.label
        : (modules.find((m) => path.startsWith(m.path))?.label ?? "Estrutura");
  const primaryPages: Record<string,string> = {"/structure":structureNavLabel,"/structure/directory":structureNavLabel,"/structure/history":shellText('history'),"/structure/proposals":shellText('proposals'),"/structure/working-agreements":shellText('restrictions'),"/structure/tensions":shellText('tensions'),"/projects":moduleLabel('projects','Projetos'),"/goals":moduleLabel('goals','Objetivos'),"/meetings":moduleLabel('meetings','Reuniões'),"/members":membersNavLabel};
  const primaryPage = (/^\/(?:roles|circles)\//.test(path)?structureNavLabel:undefined) ?? primaryPages[path] ?? Object.entries(primaryPages).filter(([base])=>base!=="/structure").find(([base])=>path.startsWith(base+"/"))?.[1] ?? (path.startsWith("/administration") || path.startsWith("/settings/") || path === "/structure/advanced" ? shellText('settings') : "");
  const activeOrg = session?.organizations.find((o) => o.id === orgId);
  const isUnavailable = Object.keys(unavailable).find((p) => path === p);
  const current = structure?.nodes.find(
    (n) => n.entityId === bootstrap?.rootCircleId,
  );
  const displayNodes = (structure?.nodes ?? []).filter((n) =>
    n.name
      .toLocaleLowerCase()
      .includes((localQuery || query).toLocaleLowerCase()),
  );
  const activeRelations = (relations: Relation[]) =>
    relations.filter(
      (r) =>
        (!r.startsAt || Date.parse(r.startsAt) <= Date.now()) &&
        (!r.endsAt || Date.parse(r.endsAt) > Date.now()),
    );
  const clearTenantContext = useCallback(() => {
    ++generation.current;
    explorerState.current=null;
    navigationGuards.current.clear();
    setBootstrap(null);setStructure(null);setMembers([]);setAudit([]);
    setGuestScope("");setGuestSnapshotPath("");setCredentialGateOrg("");
    setForm(null);setFormDirty(false);setPurposeDraft(undefined);setFormError("");
    createdOrganizationRef.current=null;setCreatedOrganization(null);
    setQuery("");setLocalQuery("");setMenu(false);setNewMenu(false);
  },[]);
  const installSession = useCallback((s: Session) => {
    if(installedAccount.current!==s.account.id || !s.organizations.length || (tenantBootstrap.current && !sessionOwnsBootstrap(s,tenantBootstrap.current)))clearTenantContext();
    installedAccount.current=s.account.id;
    setSessionError(null);
    setSession((previous) =>
      previous && JSON.stringify(previous) === JSON.stringify(s) ? previous : s,
    );
    setCsrf(s.csrfToken);
    setOrgId((prev) =>
      s.organizations.some((o) => o.id === prev)
        ? prev
        : (s.organizations.find(
            (o) => o.id === sessionStorage.getItem("orgmap.activeOrg"),
          )?.id ??
          s.organizations[0]?.id ??
          ""),
    );
  }, [clearTenantContext]);
  const loadSession = useCallback(async () => {
    setSessionError(null);
    try {
      const r = await request<Session>("/me", {signal:AbortSignal.timeout(20000)});
      installSession(r.data);
    } catch (e) {
      if (!(e instanceof RequestError && e.code === "UNAUTHENTICATED"))
        setSessionError({kind:'request',error:e});
    } finally {
      setInitial(false);
    }
  }, [installSession]);
  useEffect(() => {
    void loadSession();
  }, [loadSession]);
  useEffect(() => {
    const update = () => setPreferencesRevision((v) => v + 1);
    window.addEventListener("orgmap:preferences-changed", update);
    return () =>
      window.removeEventListener("orgmap:preferences-changed", update);
  }, []);
  useEffect(() => {
    if (!session) {
      setPreferenceState(undefined);
      setPreferenceError(null);
      delete document.documentElement.dataset.reducedMotion;
      return;
    }
    const ctrl = new AbortController();
    setPreferenceError(null);
    request<{ preferences: RegionalPreferences }>("/account/preferences", {
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!ctrl.signal.aborted) {
          setPreferenceState({accountId: session.account.id, preferences: r.data.preferences});
          document.documentElement.dataset.reducedMotion = String(
            r.data.preferences.reducedMotion,
          );
        }
      })
      .catch((error) => {
        if (!ctrl.signal.aborted) setPreferenceError({accountId: session.account.id, message: errorMessage(error)});
      });
    return () => ctrl.abort();
  }, [session?.account.id, preferencesRevision]);
  useEffect(() => {
    const expired = () => {
      clearTenantContext();
      installedAccount.current=null;
      setSession(null);
      setStructure(null);
      setBootstrap(null);
      setMembers([]);
      setAudit([]);
      setForm(null);
      setCsrf("");
      setSessionError({kind:'expired'});
    };
    window.addEventListener("orgmap:session-expired", expired);
    return () => window.removeEventListener("orgmap:session-expired", expired);
  }, [clearTenantContext]);
  useEffect(() => {
    const required = (event: Event) => {
      const id = (event as CustomEvent<{organizationId:string}>).detail?.organizationId;
      if (id === orgId) setCredentialGateOrg(id);
    };
    window.addEventListener("orgmap:credential-required", required);
    return () => window.removeEventListener("orgmap:credential-required", required);
  }, [orgId]);
  useEffect(() => {
    if (
      !session &&
      !initial &&
      ![
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/enrollment",
        invitationPath,
      ].includes(path)
    ) {
      sessionStorage.setItem("orgmap.returnTo", route);
      navigate("/login");
    }
  }, [session, initial, path, navigate]);
  useEffect(() => {
    if (!orgId || !session || admission || path===invitationPath || changingTrackingOrganization) return;
    const controller = new AbortController(),
      epoch = ++generation.current;
    setLoading(true);
    setCredentialGateOrg("");
    setError("");
    setBootstrap(null);
    setStructure(null);
    setMembers([]);
    setAudit([]);
    const base = `/organizations/${orgId}`;
    Promise.all([
      request<Bootstrap>(base + "/bootstrap", { signal: controller.signal }),
      request<Structure>(base + "/structure", { signal: controller.signal }),
      request<{
        items: Member[];
        page: { hasMore: boolean; nextCursor: string | null };
      }>(base + "/members?limit=100", { signal: controller.signal }),
    ])
      .then(async ([b, s, m]) => {
        let all = m.data.items;
        let page = m.data.page;
        while (page?.hasMore && page.nextCursor) {
          const more = await request<{ items: Member[]; page: typeof page }>(
            base +
              "/members?limit=100&cursor=" +
              encodeURIComponent(page.nextCursor),
            { signal: controller.signal },
          );
          all = all.concat(more.data.items);
          page = more.data.page;
        }
        if (epoch === generation.current) {
          setGuestScope(isGuestBootstrap(b.data) ? session.account.id + ":" + orgId : "");
          setGuestSnapshotPath(matchPath);
          setBootstrap({
            ...b.data,
            capabilities: b.data.capabilities ?? b.capabilities,
          });
          setStructure({
            ...s.data,
            memberships: s.data.memberships.map((r) => ({
              ...r,
              origin: r.origin ?? "EXPLICIT",
            })),
          });
          setMembers(all);
        }
      })
      .catch((e) => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        if (e instanceof RequestError && e.code === "UNAUTHENTICATED") {
          setSession(null);
          setCsrf("");
        } else if (e instanceof RequestError && e.code === "ORG_CREDENTIAL_REQUIREMENT_UNMET") {
          if(epoch === generation.current) setCredentialGateOrg(orgId);
        } else setError(errorMessage(e));
      })
      .finally(() => {
        if (epoch === generation.current) setLoading(false);
      });
    return () => controller.abort();
  }, [orgId, session, refresh, admission?.organizationId, path===invitationPath, changingTrackingOrganization]);
  useEffect(() => {
    if (admission || !knownGuest || guestSnapshotPath === matchPath) return;
    ++generation.current;
    explorerState.current = null;
    setBootstrap(null);
    setStructure(null);
    setMembers([]);
    setAudit([]);
    setRefresh((value) => value + 1);
  }, [knownGuest, matchPath, admission?.organizationId]);
  useEffect(() => {
    if (admission || !knownGuest || !bootstrap) return;
    const controller = new AbortController();
    let checking = false;
    const invalidate = () => {
      if (controller.signal.aborted) return;
      ++generation.current;
      explorerState.current = null;
      setGuestSnapshotPath("");
      setBootstrap(null);
      setStructure(null);
      setMembers([]);
      setAudit([]);
      setRefresh((value) => value + 1);
    };
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const current = await request<Bootstrap>(`/organizations/${orgId}/bootstrap`, { signal: controller.signal });
        if (!controller.signal.aborted && current.data.authorizationRevision !== bootstrap.authorizationRevision) invalidate();
      } catch {
        if (!controller.signal.aborted) invalidate();
      } finally { checking = false; }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 30000);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [knownGuest, orgId, bootstrap, admission?.organizationId]);

  useEffect(() => {
    if (!orgId || !canLoadStructureHistory(bootstrap,path)) return;
    const controller = new AbortController();
    setAuditRead({state:"loading"});
    request<{ items: typeof audit }>(`/organizations/${orgId}/audit-events`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (controller.signal.aborted) return;
        setAudit(r.data.items);
        setAuditRead({state:"ready"});
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setAuditRead(e instanceof RequestError && e.code === "ACTION_DENIED"
          ? {state:"denied"}
          : {state:"error",message:errorMessage(e)});
      });
    return () => controller.abort();
  }, [orgId, path, refresh, bootstrap]);
  useEffect(() => {
    setMobile(false);
    setNewMenu(false);
    setMenu(false);
    setLocalQuery("");
  }, [path]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (session && ["/", "/login", "/register"].includes(path))
      navigate("/structure");
  }, [session, path, navigate]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const input = document.getElementById("orgmap-global-search");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
      if (event.key === "Escape") {
        setQuery("");
        setMenu(false);
        setNewMenu(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function changeOrg(id: string, destination = "/structure") {
    if (!canNavigate()) return false;
    if (id === orgId) {
      navigate(destination);
      return true;
    }
    implicitEntryLanding.current = destination === "/structure";
    navigationGuards.current.clear();
    ++generation.current;
    explorerState.current = null;
    sessionStorage.setItem("orgmap.activeOrg", id);
    setOrgId(id);
    setBootstrap(null);
    setStructure(null);
    setMembers([]);
    setAudit([]);
    setForm(null);
    setQuery("");
    setLocalQuery("");
    setMenu(false);
    setZoom(1);
    navigate(destination);
    return true;
  }
  useEffect(() => {
    if (trackingOrganizationId && changingTrackingOrganization)
      changeOrg(trackingOrganizationId, matchPath);
  }, [trackingOrganizationId, changingTrackingOrganization, matchPath]);
  function openForm(kind: FormKind) {
    if (kind === "organization" && !createdOrganizationRef.current && session) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(`orgmap.createdOrganization:${session.account.id}`) ?? "null");
        if (typeof saved?.id === "string" && typeof saved?.name === "string") {
          createdOrganizationRef.current = saved;
          setCreatedOrganization(saved);
        }
      } catch { /* The in-memory receipt remains available if storage is disabled. */ }
    }
    setPurposeDraft(undefined);
    setDefinitionDraft({});
    setFormDirty(false);
    submission.current = null;
    setFormError("");
    setForm(kind);
    setNewMenu(false);
    setMenu(false);
  }
  const base = `/organizations/${orgId}`;
  async function openCreatedOrganization(created: {id:string; name:string}) {
    const accountId = session?.account.id;
    const epoch = generation.current;
    const isCurrent = () => !!accountId && installedAccount.current === accountId && generation.current === epoch;
    const me = await request<Session>("/me", {signal:AbortSignal.timeout(20000)});
    if (!isCurrent()) return false;
    const membership = me.data.organizations.find((item) => item.id === created.id);
    if (me.data.account.id !== accountId || !membership)
      throw new Error("A organização foi criada, mas ainda não apareceu na sessão. Tente abrir novamente.");
    const checked = await request<Bootstrap>(`/organizations/${created.id}/bootstrap`, {signal:AbortSignal.timeout(20000)});
    if (!isCurrent()) return false;
    if (checked.data.organization.id !== created.id || checked.data.membership.id !== membership.memberId)
      throw new Error("Não foi possível confirmar o acesso à organização criada. Tente abrir novamente.");
    // Only this form's guard is released; other unsaved work still blocks the switch.
    releaseFormGuard.current?.();
    releaseFormGuard.current = null;
    if (!canNavigate()) {
      setFormError("A organização foi criada. Resolva as alterações pendentes antes de abri-la.");
      return false;
    }
    installSession(me.data);
    if (!changeOrg(created.id)) return false;
    try { sessionStorage.removeItem(`orgmap.createdOrganization:${me.data.account.id}`); } catch { /* Storage is optional. */ }
    createdOrganizationRef.current = null;
    setCreatedOrganization(null);
    setForm(null);
    setFormDirty(false);
    setToast("Organização criada.");
    return true;
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    const submissionAccount = session?.account.id;
    const submissionEpoch = generation.current;
    setSaving(true);
    setFormError("");
    const values = Object.fromEntries(new FormData(e.currentTarget).entries());
    const str = (key: string) => String(values[key] ?? "");
    const fingerprint = JSON.stringify({
      form,
      orgId,
      values,
      selectedId,
      memberId,
      purposeDraft,
      definitionDraft,
    });
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, key: crypto.randomUUID() };
    const command = <T,>(
      path: string,
      options: Parameters<typeof request<T>>[1] = {},
    ) => request<T>(path, { ...options, key: submission.current!.key });
    try {
      let destination: string | undefined;
      switch (form) {
        case "accept-invite": {
          const accepted = await command<{ organizationId: string }>(
            "/invitations/accept",
            { method: "POST", body: { token: str("token") } },
          );
          const me = await command<Session>("/me");
          installSession(me.data);
          changeOrg(accepted.data.organizationId);
          break;
        }
        case "organization": {
          let created = createdOrganizationRef.current;
          if (!created) {
            const r = await command<{ organization: { id: string; name: string } }>("/organizations", {
              method: "POST",
              body: {
                name: str("name"),
                locale: "pt-BR",
                timeZone: "America/Sao_Paulo",
              },
            });
            created = {id:r.data.organization.id, name:r.data.organization.name ?? str("name")};
            try { if (submissionAccount) sessionStorage.setItem(`orgmap.createdOrganization:${submissionAccount}`, JSON.stringify(created)); } catch { /* Keep the receipt in memory. */ }
            if (!submissionAccount || installedAccount.current !== submissionAccount || generation.current !== submissionEpoch) return;
            createdOrganizationRef.current = created;
            setCreatedOrganization(created);
            setFormDirty(false);
          }
          await openCreatedOrganization(created);
          return;
        }
        case "circle":
        case "role": {
          const kind = form;
          const r = await command<{
            circle?: { id: string };
            role?: { id: string };
          }>(base + (kind === "circle" ? "/circles" : "/roles"), {
            method: "POST",
            body: {
              name: str("name"),
              ...purposePayload(purposeDraft, true),
              ...definitionDraft,
              [kind === "circle" ? "parentCircleId" : "circleId"]:
                str("parentId"),
              mode: "DIRECT",
            },
          });
          destination = `/${kind === "circle" ? "circles" : "roles"}/${r.data.circle?.id ?? r.data.role?.id}`;
          break;
        }
        case "edit":
          await command(base + entityPath(selected!), {
            method: "PATCH",
            version: selected!.version,
            body: {
              name: str("name"),
              ...purposePayload(purposeDraft),
              ...definitionDraft,
              mode: "DIRECT",
            },
          });
          break;
        case "move":
          await command(base + `/structure/${selected!.entityId}/move`, {
            method: "POST",
            version: selected!.version,
            body: { targetCircleId: str("parentId"), mode: "DIRECT" },
          });
          break;
        case "archive":
          await command(base + `/structure/${selected!.entityId}/archive`, {
            method: "POST",
            version: selected!.version,
            body: {},
          });
          destination = "/structure";
          break;
        case "associate":
          await command(base + `/circles/${selected!.entityId}/memberships`, {
            method: "POST",
            body: { memberId: str("memberId") },
          });
          break;
        case "assign":
          await command(base + `/roles/${selected!.entityId}/occupancies`, {
            method: "POST",
            body: {
              memberId: str("memberId"),
              kind: str("kind"),
              scope: str("scope"),
              ...(str("endsAt")
                ? { endsAt: new Date(str("endsAt")).toISOString() }
                : {}),
            },
          });
          break;
        case "member":
          await command(base + "/members", {
            method: "POST",
            body: { accountId: str("accountId") },
          });
          break;
        case "member-edit":
          await command(base + `/members/${selectedMember!.id}`, {
            method: "PATCH",
            version: selectedMember!.version,
            body: { status: str("status") },
          });
          break;
        case "end":
        case "end-association":
          await command(base + (form === "end-association"
            ? `/circle-memberships/${endRelation!.id}/end`
            : `/occupancies/${endRelation!.id}/end`), {
            method: "POST",
            version: endRelation!.version,
            body: {},
          });
          break;
      }
      releaseFormGuard.current?.();
      releaseFormGuard.current = null;
      setForm(null);
      setRefresh((x) => x + 1);
      setToast("Alteração salva.");
      if (destination) navigate(destination);
    } catch (e) {
      if (form === "organization" && (installedAccount.current !== submissionAccount || generation.current !== submissionEpoch)) return;
      setFormError(errorMessage(e));
      if (e instanceof RequestError && e.code === "UNAUTHENTICATED") {
        setSession(null);
        setForm(null);
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }
  async function logout(preserveInvitation = false) {
    if (!canNavigate()) return;
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      clearTenantContext();
      installedAccount.current=null;
      admissionCapability.current=null;
      if(!preserveInvitation)invitationCapability.current=undefined;
      explorerState.current = null;
      setSession(null);
      setSessionError(null);
      setOrgId("");
      setStructure(null);
      setMembers([]);
      setCsrf("");
      sessionStorage.removeItem("orgmap.activeOrg");
      navigate("/login");
    } catch (e) {
      if (e instanceof RequestError && e.code === "UNAUTHENTICATED") {
        clearTenantContext();
        installedAccount.current=null;
        admissionCapability.current=null;
        if(!preserveInvitation)invitationCapability.current=undefined;
        explorerState.current = null;
        setSession(null);
        setStructure(null);
        setBootstrap(null);
        setMembers([]);
        setOrgId("");
        setCsrf("");
        sessionStorage.removeItem("orgmap.activeOrg");
        navigate("/login");
      } else setError(errorMessage(e));
    }
  }
  const circles = (structure?.nodes ?? []).filter((n) => n.kind === "CIRCLE");
  const purposeEntity = selected
    ? (selected.kind === "CIRCLE"
        ? structure?.circles
        : structure?.roles
      )?.find((c) => c.id === selected.entityId)
    : null;
  const purpose = purposeEntity?.purpose;
  const purposeRich = purposeEntity?.purposeRich;
  const formTitle: Record<Exclude<FormKind, null>, string> = {
    organization: "Criar organização",
    circle: "Criar " + vocabulary.circle.toLocaleLowerCase('pt-BR'),
    role: "Criar " + vocabulary.role.toLocaleLowerCase('pt-BR'),
    edit: "Editar " + vocabulary.entity(selected?.kind??'ROLE').toLocaleLowerCase('pt-BR'),
    move: "Mover " + vocabulary.entity(selected?.kind??'ROLE').toLocaleLowerCase('pt-BR'),
    archive: "Arquivar " + vocabulary.entity(selected?.kind??'ROLE').toLocaleLowerCase('pt-BR'),
    assign: "Atribuir " + vocabulary.role.toLocaleLowerCase('pt-BR'),
    associate: `Associar ${vocabulary.member.toLocaleLowerCase('pt-BR')} a ${vocabulary.circle.toLocaleLowerCase('pt-BR')}`,
    member: "Adicionar conta existente",
    "member-edit": selectedMember ? "Alterar acesso de " + selectedMember.displayName : "Alterar acesso",
    end: "Encerrar ocupação",
    "end-association": "Encerrar associação explícita",
    invite: "Convidar " + vocabulary.member.toLocaleLowerCase('pt-BR'),
    "accept-invite": "Aceitar convite",
  };
  const featureContext: FeatureContext | null =
    session && !changingTrackingOrganization && sessionOwnsBootstrap(session,bootstrap) && structure && bootstrap.organization.id===orgId
      ? {
          organizationId: orgId,
          selectedEntity: selected,
          session,
          bootstrap,
          structure,
          members,
          path: matchPath,
          hash,
          navigate: navigateFromEntity,
          api: request,
          registerNavigationGuard,
          refreshSession: loadSession,
          onOrganizationClosed: async result => {
            const destination='/account/organization-deletions/'+result.jobId;
            clearTenantContext();
            implicitEntryLanding.current=false;
            if(sessionStorage.getItem('orgmap.activeOrg')===result.organizationId)sessionStorage.removeItem('orgmap.activeOrg');
            setOrgId(current=>current===result.organizationId?'':current);
            if(result.reauthenticationRequired){setSession(null);setCsrf('');sessionStorage.setItem('orgmap.returnTo',destination);}
            else setSession(current=>current?{...current,organizations:current.organizations.filter(org=>org.id!==result.organizationId)}:null);
            navigate(destination);
            if(!result.reauthenticationRequired)await loadSession();
          },
          accountPreferences,
          formatDate: (value, includeTime) =>
            formatAccountDate(value, accountPreferences, includeTime),
          refresh: () => setRefresh((x) => x + 1),
          notify: setToast,
        }
      : null;
  useEffect(() => {
    if (!form || (!formDirty && !saving)) return;
    const reason = saving
      ? "Aguarde a confirmação da alteração antes de sair."
      : "Há alterações não salvas. Salve ou use Cancelar no formulário para descartá-las.";
    const unregister = registerNavigationGuard(() => reason);
    releaseFormGuard.current = unregister;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unregister();
      if (releaseFormGuard.current === unregister) releaseFormGuard.current = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [form, formDirty, saving, registerNavigationGuard]);
  const preferenceNotice = preferenceError?.accountId === session?.account.id && (
    <Notice>
      Não foi possível carregar as preferências da conta. {preferenceError?.message}
      <Button onClick={() => setPreferencesRevision((value) => value + 1)}>Tentar novamente</Button>
    </Notice>
  );
  const dialog = form === 'invite' ? featureContext && (
    <Dialog title={formTitle.invite} onClose={()=>{if(!navigationGuards.current.reason())setForm(null);}}>
      <InvitationComposer context={featureContext} onTrack={()=>{setForm(null);navigate("/organization-invitations");}}
        onAdvanced={bootstrap?.membership.orgRole==='OWNER'?()=>{setForm(null);navigate('/administration/settings?section=invitations&advanced=1');}:undefined}/>
      <div className="form-actions"><Button onClick={()=>{if(!navigationGuards.current.reason())setForm(null);}}>Fechar</Button></div>
    </Dialog>
  ) : form && (
    <Dialog
      title={form === "organization" && createdOrganization ? "Organização criada" : formTitle[form]}
      onClose={() => {
        if (saving) return;
        if (formDirty) {
          setFormError("Há alterações não salvas. Salve ou use Cancelar para descartá-las.");
          return;
        }
        setForm(null);
      }}
    >
      <form onSubmit={save} onInput={() => setFormDirty(true)} className="edit-form">
        {formError && <Notice>{formError}</Notice>}
        {form === "organization" && createdOrganization ? <>
          <p><strong>{createdOrganization.name}</strong> foi criada. Abra a organização para continuar.</p>
          <div className="form-actions">
            <Button onClick={() => setForm(null)} disabled={saving}>{session?.organizations.length ? "Voltar à organização anterior" : "Fechar"}</Button>
            <button className="primary" disabled={saving}>{saving ? "Abrindo…" : "Abrir organização"}</button>
          </div>
        </> : <>
        {["organization", "circle", "role", "edit"].includes(form) && (
          <>
            <Field
              label="Nome"
              name="name"
              required
              maxLength={200}
              value={form === "edit" ? selected?.name : ""}
            />
            {form !== "organization" && (
              <>
              <FeatureRoleMentions context={featureContext}><RichTextEditor key={orgId + ":" + form + ":" + (selected?.entityId ?? "new")}
                label="Propósito" value={purposeDraft ?? (form === "edit" ? (purposeRich ?? purpose ?? "") : "")}
                pending={saving} readOnly={saving}
                onChange={document => {setPurposeDraft(document);setFormDirty(true);}}
              /></FeatureRoleMentions>
              <FeatureRoleMentions context={featureContext}>{(["responsibilities", "artifacts"] as const).map(kind => <DefinitionListEditor
                key={orgId+":"+form+":"+(selected?.entityId??"new")+":"+kind} kind={kind} disabled={saving}
                items={definitionDraft[kind] ?? (form === "edit" ? purposeEntity?.[kind] ?? [] : [])}
                onChange={items => {setDefinitionDraft(current => ({...current, [kind]: items}));setFormDirty(true);}} />)}</FeatureRoleMentions>
              </>
            )}
          </>
        )}
        {["circle", "role", "move"].includes(form) && (
          <Field
            label={form === "move" ? "Círculo de destino" : "Círculo pai"}
            name="parentId"
          >
            <select
              name="parentId"
              required
              defaultValue={
                selected?.kind === "CIRCLE"
                  ? selected.entityId
                  : (bootstrap?.rootCircleId ?? undefined)
              }
            >
              {circles
                .filter(
                  (n) => form !== "move" || n.entityId !== selected?.entityId,
                )
                .map((n) => (
                  <option key={n.entityId} value={n.entityId}>
                    {n.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {form === "archive" && (
          <p>
            Arquivar “{selected?.name}”? A ação preserva o histórico. Círculos
            com conteúdo precisam ser esvaziados antes de serem arquivados.
          </p>
        )}
        {["assign", "associate"].includes(form) && (
          <Field label={vocabulary.member} name="memberId">
            <select name="memberId" required>
              {members
                .filter((m) => m.status === "ACTIVE")
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {form === "assign" && (
          <>
            <Field label="Tipo de ocupação" name="kind">
              <select name="kind" defaultValue="DIRECT">
                <option value="DIRECT">Direta</option>
                <option value="INTERIM">
                  Interina (data final obrigatória)
                </option>
              </select>
            </Field>
            <Field label="Escopo" name="scope" />
            <Field label="Data final" name="endsAt" type="datetime-local" />
          </>
        )}
        {form === "member" && (
          <>
            <p>
              Associe uma conta que já tenha sido criada no OrgMap. Você também
              pode registrar um convite para entrega local.
            </p>
            <Field label="ID da conta" name="accountId" required />
          </>
        )}
        {form === "member-edit" && selectedMember && (
          <>
            <p>Estado atual de <strong>{selectedMember.displayName}</strong>: {selectedMember.status === "ACTIVE" ? "Ativo" : selectedMember.status === "SUSPENDED" ? "Suspenso" : "Não informado"}.</p>
            <p>Ao suspender, esta pessoa perde o acesso à organização até que seja reativada.</p>
            <Field label="Estado" name="status">
              <select name="status" defaultValue={selectedMember.status}>
                <option value="ACTIVE">Ativo</option>
                <option value="SUSPENDED">Suspenso</option>
              </select>
            </Field>
          </>
        )}
        {form === "accept-invite" && (
          <>
            <p>
              Entre com a conta do e-mail convidado e informe o código recebido.
            </p>
            <Field label="Código do convite" name="token" required />
          </>
        )}
        {form === "end-association" && (
          <p>Encerrar agora a associação explícita de <strong>{members.find((member) => member.id === endRelation?.memberId)?.displayName ?? "este membro"}</strong> ao círculo <strong>{selected?.name}</strong>? As ocupações de papéis serão preservadas.</p>
        )}
        {form === "end" && (
          <p>
            Encerrar esta ocupação agora? A associação explícita ao círculo será
            preservada.
          </p>
        )}
        <div className="form-actions">
          <Button onClick={() => setForm(null)} disabled={saving}>
            Cancelar
          </Button>
          <button
            className={form === "archive" ? "danger" : "primary"}
            disabled={saving}
          >
            {saving ? "Salvando…" : form === "archive" ? "Arquivar" : form === "end-association" ? "Encerrar associação" : form === "end" ? "Encerrar ocupação" : "Salvar"}
          </button>
        </div>
        </>}
      </form>
    </Dialog>
  );
  if (initial)
    return (
      <main className="loading-screen" role="status">
        <OrgMapBrand variant="symbol" />
        {publicAuthTranslator(publicLocale)('loadingApp')}
      </main>
    );
  if (path === "/enrollment")
    return <AuthLayout embedded locale={publicLocale}>
      <EnrollmentPage navigate={navigate} api={request} locale={publicLocale} onLocaleChange={choosePublicLocale}/>
    </AuthLayout>;
  if(path===invitationPath)
    return <InvitationAcceptance key={invitationRevision} token={invitationCapability.current} session={session} locale={publicLocale} onLocaleChange={choosePublicLocale}
      onToken={token=>{invitationCapability.current=token;}}
      onAuth={register=>{sessionStorage.setItem('orgmap.returnTo',invitationPath);navigate(register?'/register':'/login');}}
      onSwitchAccount={async()=>{sessionStorage.setItem('orgmap.returnTo',invitationPath);await logout(true);if(installedAccount.current)throw new Error('Sign out failed');}}
      onAccepted={async organizationId=>{
        const result=await request<Session>('/me');
        if(!result.data.organizations.some(org=>org.id===organizationId))throw new Error('Association not available');
        installSession(result.data);changeOrg(organizationId);invitationCapability.current=undefined;
      }} onBack={()=>{invitationCapability.current=undefined;navigate(session?'/structure':'/login');}}/>;
  if (path === "/forgot-password" || path === "/reset-password")
    return (
      <RecoveryPage key={path} reset={path === "/reset-password"} navigate={navigate} locale={publicLocale} onLocaleChange={choosePublicLocale}/>
    );
  if (!session)
    return (
        <Auth
          register={path === "/register"}
          locale={publicLocale}
          onLocaleChange={choosePublicLocale}
          sessionIssue={sessionError ? sessionError.kind==='expired' ? publicAuthTranslator(publicLocale)('sessionExpired') : formatError(sessionError.error,publicLocale) : undefined}
          onRetrySession={() => void loadSession()}
          brandingRef={new URLSearchParams(matchPath.split('?')[1] ?? '').get('branding')}
          onSession={(value) => { implicitEntryLanding.current = !sessionStorage.getItem("orgmap.returnTo") || sessionStorage.getItem("orgmap.returnTo") === "/"; installSession(value); }}
          navigate={navigate}
        />
    );
  if (admission)
    return <LocalizationProvider key={session.account.id} accountId={session.account.id} preferences={accountPreferences ?? null}>
      <GlobalAccessibilityProvider accountId={session.account.id} organizationId={null} reducedMotion={accountPreferences?.reducedMotion}>
        <AccessibilitySkipLink targetId="admission-content"/>
        <main id="admission-content" tabIndex={-1} className="admission-shell">
          <OrgMapBrand className="admission-product-brand" />
          {preferenceNotice}
          <OrgAdmission key={admission.organizationId}
            orgId={admission.organizationId}
            linkToken={admissionCapability.current?.organizationId===admission.organizationId?admissionCapability.current.token:undefined}
            initialRequestId={admission.requestId}
            organizationName={session.organizations.find(o=>o.id===admission.organizationId)?.name}
            accountEmail={session.account.email}
            onLinkTokenConsumed={()=>{admissionCapability.current=null;}}
            onRequestIdChange={id=>navigate(admissionPath(admission.organizationId,id),true)}
            onSignIn={()=>{admissionCapability.current=null;clearTenantContext();setSession(null);setCsrf("");sessionStorage.setItem("orgmap.returnTo",admission.requestId?admissionPath(admission.organizationId,admission.requestId):"/account");navigate("/login");}}
            onCancel={()=>{admissionCapability.current=null;navigate(session.organizations.length?"/structure":"/account");}}
            onJoined={async()=>{const result=await request<Session>("/me");if(!result.data.organizations.some(o=>o.id===admission.organizationId))throw new Error("Association not available");admissionCapability.current=null;installSession(result.data);changeOrg(admission.organizationId);}}
          />
        </main>
      </GlobalAccessibilityProvider>
    </LocalizationProvider>;
  if (path.startsWith("/account"))
    return (
      <LocalizationProvider key={session.account.id} accountId={session.account.id} preferences={accountPreferences ?? null}>
      <GlobalAccessibilityProvider accountId={session.account.id} organizationId={orgId || null} reducedMotion={accountPreferences?.reducedMotion}>
      <AccountShell path={matchPath} session={session} bootstrap={bootstrap} context={featureContext} Search={globalSearchFeature?.GlobalSearch} navigate={navigate} onLogout={() => void logout()} onChangeOrg={changeOrg}>
          {preferenceNotice}
          {navigationIssue && (
            <Notice>
              {navigationIssue}
              <Button onClick={() => setNavigationIssue("")}>Fechar</Button>
            </Notice>
          )}
          {path === "/account/accessibility" ? <AccessibilitySettings /> : <AccountPage
            accountId={session.account.id}
            path={matchPath}
            navigate={navigate}
            notify={setToast}
            refreshSession={loadSession}
            registerNavigationGuard={registerNavigationGuard}
          />}
      </AccountShell>
      </GlobalAccessibilityProvider>
      </LocalizationProvider>
    );
  if (!session.organizations.length || path === "/organizations/new")
    return (
      <main className="auth-page">
        <OrgMapBrand className="auth-brand" />
        <div className="auth-form">
          <h1>Crie seu espaço de trabalho</h1>
          <p>
            Comece com uma organização vazia. Construa os círculos, os papéis e
            as relações que fazem sentido para vocês.
          </p>
          <Button className="primary" onClick={() => openForm("organization")}>
            <Plus size={16} /> Criar organização
          </Button>
          {session.organizations.length > 0 && (
            <Button onClick={() => navigate("/structure")}>
              Voltar à organização
            </Button>
          )}
          <Button onClick={() => navigate("/account/general")}>
            Minha conta
          </Button>
          <Button onClick={() => navigate(invitationPath)}>
            Aceitar convite
          </Button>
          <Button onClick={() => void logout()}>Sair</Button>
        </div>
        {dialog}
      </main>
    );
  return (
    <LocalizationProvider key={session.account.id} accountId={session.account.id} preferences={accountPreferences ?? null}>
      <GlobalAccessibilityProvider accountId={session.account.id} organizationId={orgId || null} reducedMotion={accountPreferences?.reducedMotion}>
    <AccessibilitySkipLink />
    <WorkspaceBrandingShell organizationId={bootstrap?.organization.id ?? null} accountId={session.account.id}
      className={
        "app-shell " + (secondaryCollapsed ? "secondary-collapsed" : "")
      }
    >
      {mobile && <div className="mobile-shade" onClick={() => setMobile(false)} />}
      <aside ref={mobileNavigation.sidebarRef} className={"sidebar mare-sidebar " + (mobile ? "open" : "")} aria-label={shellText('mainNavigation')} role={mobileNavigation.modalOpen ? "dialog" : undefined} aria-modal={mobileNavigation.modalOpen || undefined} inert={mobileNavigation.narrow && !mobile ? true : undefined}>
        {bootstrap && <>
          <div className="mare-sidebar-head"><OrgMapHomeLink navigate={navigate} /><Button ariaLabel={mobileNavigation.narrow ? shellText('closeNavigation') : secondaryCollapsed ? shellText('expandNavigation') : shellText('collapseNavigation')} title={mobileNavigation.narrow ? shellText('closeNavigation') : secondaryCollapsed ? shellText('expandNavigation') : shellText('collapseNavigation')} onClick={() => mobileNavigation.narrow ? setMobile(false) : setSidebarExpanded(v => !v)}>{mobileNavigation.narrow ? <X size={20}/> : secondaryCollapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</Button></div>
          <div className="mare-sidebar-scroll">
            {guestModuleAvailable(bootstrap, "structure") && <>
              <div className="mare-section-title"><StructureIcon/> <span>{shellText('structureSection')}</span></div>
              <Button className={"nav-item mare-subnav " + (path === "/structure" || path === "/structure/directory" || !!selectedId ? "selected" : "")} title={structureNavLabel} ariaCurrent={path === "/structure" || path === "/structure/directory" || !!selectedId ? "page" : undefined} onClick={() => { navigate("/structure"); setMobile(false); }}><SourceIcon name="explore"/><span>{structureNavLabel}</span></Button>
              {!isGuest && <Button className={"nav-item mare-subnav " + (path === "/structure/history" ? "selected" : "")} title={shellText('historyTitle')} ariaCurrent={path === "/structure/history" ? "page" : undefined} onClick={() => { navigate("/structure/history"); setMobile(false); }}><SourceIcon name="history"/><span>{shellText('history')}</span></Button>}
            </>}
            {guestModuleAvailable(bootstrap, "governance") && <><div className="mare-section-title"><Scale size={20}/><span>{t('nav.governance')}</span></div>
              {[["/structure/proposals", shellText('proposals'), "proposals"], ["/structure/working-agreements", shellText('restrictions'), "agreements"], ["/structure/tensions", shellText('tensions'), "tensions"]].filter(([url]) => guestRouteAvailable(bootstrap,url)).map(([url,label,icon]) => <Button key={url} className={"nav-item " + (path.startsWith(url) ? "selected" : "")} title={label} ariaCurrent={path.startsWith(url) ? "page" : undefined} onClick={() => { navigate(url); setMobile(false); }}><SourceIcon name={icon as "proposals" | "agreements" | "tensions"}/><span>{label}</span></Button>)}
            </>}
            <div className="mare-sidebar-rule"/>
            {modules.filter(m => ["projects", "goals", "meetings", "members"].includes(m.module) && guestRailPath(bootstrap,m.module,m.path)!==null).map(m => <Button key={m.path} className={"nav-item " + (path===m.path||path.startsWith(m.path+'/') ? "selected" : "")} title={m.module === "members" ? membersNavLabel : moduleLabel(m.module,m.label)} ariaCurrent={path===m.path||path.startsWith(m.path+'/') ? "page" : undefined} onClick={() => { navigate(guestRailPath(bootstrap,m.module,m.path) ?? m.path); setMobile(false); }}><SourceIcon name={m.icon}/><span>{m.module === "members" ? membersNavLabel : moduleLabel(m.module,m.label)}</span></Button>)}

          </div>
          {!isGuest && <Button className={"nav-item settings-link" + (settingsSurface ? " selected" : "")} title={shellText('settings')} ariaCurrent={settingsSurface ? "page" : undefined} onClick={() => { navigate("/administration/settings"); setMobile(false); }}><Settings2 size={16}/><span>{shellText('settings')}</span></Button>}
        </>}
      </aside>
      <div className="workspace" data-main-page={primaryPage ? path : undefined} inert={mobileNavigation.modalOpen ? true : undefined}>
        <header className="topbar">
          <Button
            className={
              "mobile-toggle " +
              (shouldCollapse ? "desktop-sidebar-toggle" : "")
            }
            ariaLabel={mobileNavigation.narrow ? shellText('openNavigation') : secondaryCollapsed ? shellText('expandNavigation') : shellText('collapseNavigation')}
            expanded={mobileNavigation.narrow ? mobile : !secondaryCollapsed}
            title={mobileNavigation.narrow ? (mobile ? shellText('closeNavigation') : shellText('openNavigation')) : secondaryCollapsed ? shellText('expandNavigation') : shellText('collapseNavigation')}
            onClick={event => {
              mobileNavigation.openerRef.current = event.currentTarget;
              if (
                shouldCollapse &&
                window.matchMedia("(min-width:768px)").matches
              )
                setSidebarExpanded((v) => !v);
              else setMobile(!mobile);
            }}
          >
            <Menu size={20} />
          </Button>
          <h1 className="mare-page-title">{primaryPage || title}</h1>
          {globalSearchFeature?.GlobalSearch && featureContext ? (
            <globalSearchFeature.GlobalSearch
              key={orgId}
              context={featureContext}
            />
          ) : (
            <div
              className="global-search"
              onClick={() =>
                document.getElementById("orgmap-global-search")?.focus()
              }
            >
              <Search size={16} />
              <input
                id="orgmap-global-search"
                aria-label={vocabulary.searchLabel}
                placeholder={vocabulary.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {!query && (
                <span className="search-shortcut" aria-hidden="true">
                  ⌘ K
                </span>
              )}
              {query && (
                <Button title="Limpar busca" onClick={() => setQuery("")}>
                  <X size={14} />
                </Button>
              )}
              {query && (
                <div
                  className="popover search-results"
                  role="region"
                  aria-label="Resultados da pesquisa"
                >
                  <strong>Estrutura</strong>
                  {(structure?.nodes ?? [])
                    .filter((n) =>
                      n.name
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    )
                    .map((n) => (
                      <Button
                        key={n.nodeId}
                        onClick={() => {
                          setQuery("");
                          navigate(entityPath(n));
                        }}
                      >
                        <CircleDot size={16} />
                        {n.name}
                      </Button>
                    ))}
                  <strong>{vocabulary.members}</strong>
                  {members
                    .filter((m) =>
                      m.displayName
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    )
                    .map((m) => (
                      <Button
                        key={m.id}
                        onClick={() => {
                          setQuery("");
                          navigate("/members/" + m.id);
                        }}
                      >
                        <Users size={16} />
                        {m.displayName}
                      </Button>
                    ))}
                  {!(structure?.nodes ?? []).some((n) =>
                    n.name
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()),
                  ) &&
                    !members.some((m) =>
                      m.displayName
                        .toLocaleLowerCase()
                        .includes(query.toLocaleLowerCase()),
                    ) && <p>Nenhum resultado nesta organização.</p>}
                </div>
              )}
            </div>
          )}
          {!!bootstrap && !isGuest && (
            <div className="header-actions">
              {featureContext &&
                features
                  .filter((f) => f.HeaderActions)
                  .map(
                    (f) =>
                      f.HeaderActions && (
                        <f.HeaderActions
                          key={f.id + orgId}
                          context={featureContext}
                        />
                      ),
                  )}
              <Button disabled title="Feedback ainda indisponível nesta versão" ariaLabel="Feedback indisponível"><SourceIcon name="feedback" size={20}/></Button>
              <Button title={shellText('tensions')} ariaLabel={shellText('tensions')} onClick={()=>navigate('/structure/tensions')}><SourceIcon name="tensions" size={20}/></Button>
              {featureContext && bootstrap.modules.platform !== false && <NotificationDropdown context={featureContext}/>}
            </div>
          )}
          <div className="identity relative">
            <Button
              className="identity-button"
              ariaLabel={`${activeOrg?.name ?? "Organização"} ${session.account.displayName}`}
              expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <WorkspaceBrand organizationId={bootstrap?.organization.id ?? null} accountId={session.account.id} name={bootstrap?.organization.name ?? activeOrg?.name ?? 'Organização'}/>
              <span className="avatar small">
                {initials(session.account.displayName)}
              </span>
              <ChevronDown size={13} />
            </Button>
            {menu && <AccountMenu name={session.account.displayName} organizations={session.organizations} organizationId={orgId} organizationName={activeOrg?.name ?? bootstrap?.organization.name ?? 'Organização'} guest={isGuest}
              links={featureContext?features.flatMap(f=>f.navigation??[]).filter(n=>n.location==='identity'&&guestRouteAvailable(bootstrap,n.path)&&(!n.visible||n.visible(featureContext))):[]}
              navigate={navigate} onOrganization={id=>void changeOrg(id)} onCreate={()=>openForm('organization')} onInvite={()=>navigate(invitationPath)} onLogout={()=>void logout()} onClose={()=>{setMenu(false);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.identity-button')?.focus({preventScroll:true}));}}/>}
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="main-content">
          {preferenceNotice}
          {navigationIssue && (
            <Notice>
              {navigationIssue}
              <Button onClick={() => setNavigationIssue("")}>Fechar</Button>
            </Notice>
          )}
          {error && (
            <Notice>
              {error}{" "}
              <Button onClick={() => setRefresh((x) => x + 1)}>
                Tentar novamente
              </Button>
            </Notice>
          )}
          {credentialGateOrg === orgId && orgId && !bootstrap ? <OrganizationCredentialGate key={session.account.id + ":" + orgId} organizationId={orgId} onVerified={()=>setRefresh(v=>v+1)} navigate={navigate}/> : changingTrackingOrganization || loading || (knownGuest && guestSnapshotPath !== matchPath && !error) ? (
            <div className="loading-screen" role="status">
              Carregando organização…
            </div>
          ) : !isGuest && bootstrap?.modules.goals === false && (path === "/goals" || path.startsWith("/goals/")) ? (
            <div className="empty-state"><h2>Objetivos desativados</h2><p>Este módulo está desativado nas configurações da organização.</p><Button onClick={() => navigate("/structure")}>Abrir estrutura</Button></div>
          ) : !guestRouteAllowed && bootstrap ? (
            <div className="empty-state"><h2>Este conteúdo não está disponível para esta conta</h2><p>Você pode consultar os recursos compartilhados com você.</p><Button onClick={() => navigate("/structure")}>Ver o que foi compartilhado</Button></div>
          ) : guestNoResources && path === "/structure" ? (
            <div className="empty-state"><h2>Nenhum recurso compartilhado</h2><p>Quando um recurso for compartilhado com você, ele aparecerá nos módulos disponíveis.</p><Button onClick={() => navigate("/members")}>Ver membros disponíveis</Button></div>
          ) : isGuest && path === "/structure" && !guestModuleAvailable(bootstrap,"structure") ? (
            <div className="empty-state"><h2>Recursos compartilhados</h2><p>Escolha um dos módulos disponíveis para abrir os recursos compartilhados com você.</p></div>
          ) : feature && featureContext ? (
            <feature.Component key={orgId} context={featureContext} />
          ) : isUnavailable ? (
            <div className="unavailable">
              <h2>{unavailable[isUnavailable]}</h2>
              <p>
                Este módulo ainda não está disponível nesta versão do OrgMap.
              </p>
              <p>
                A implementação está planejada. Nenhuma alteração pode ser
                registrada aqui por enquanto.
              </p>
              <Button onClick={() => navigate("/structure")}>
                Voltar à estrutura
              </Button>
            </div>
          ) : selected ? (
            <div className={"mare-entity-layout " + (entityFocusExpanded ? "expanded" : "")}>
              {featureContext && <div className="mare-entity-map">{entitySource.startsWith("/structure/directory")?<StructureDirectory key={orgId} selectedNodeId={selected.nodeId} context={{...featureContext,path:entitySource}} initialState={explorerState.current?.orgId===orgId?explorerState.current.state:undefined} onStateChange={state=>{explorerState.current={orgId,state};}}/>:<StructureExplorer key={orgId} context={{...featureContext,path:entitySource}} initialState={explorerState.current?.orgId === orgId ? explorerState.current.state : undefined} onStateChange={state => { explorerState.current = { orgId, state }; }} onCreateCircle={directStructure ? () => openForm("circle") : undefined}/>}</div>}
              {entityDocumentId && featureContext ? (
                <StructureDocumentPanel context={featureContext} entity={selected} documentId={entityDocumentId} expanded={entityFocusExpanded} onToggleExpand={() => setEntityFocusExpanded(v => !v)} onClose={closeEntityDrawer}/>
              ) : (
              <aside className="mare-entity-drawer" aria-label={`${vocabulary.entity(selected.kind)}: ${selected.name}`} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && !(event.target as Element).closest("dialog") && !(event.target as Element).closest("details[open]")) {event.preventDefault(); closeEntityDrawer();} }}>
              <header className="mare-entity-header">
                <div className="mare-entity-topline">
                  <div className="mare-entity-location">
                    <StructureIcon size={16}/>
                    {(() => {
                      const parent = !selected.pathRedacted && (structure?.nodes ?? []).find(node => node.nodeId === selected.parentNodeId);
                      const label = structureParentLabel(selected, structure?.nodes ?? [], bootstrap?.rootCircleId ?? null);
                      return parent ? <Button onClick={() => navigateWithinEntity(entityPath(parent))}>{label}</Button> : <span>{label}</span>;
                    })()}
                  </div>
                  <div className="mare-entity-header-actions">
                    {directStructure && <details className="structure-more-actions mare-entity-more" onKeyDown={event => {if(event.key === "Escape") {event.preventDefault();event.currentTarget.removeAttribute("open");event.currentTarget.querySelector("summary")?.focus();}}}>
                      <summary aria-label="Mais ações da entidade" title="Mais ações"><MoreHorizontal size={19}/></summary>
                      <div>
                        <Button onClick={event => {const menu = event.currentTarget.closest("details");menu?.removeAttribute("open");menu?.querySelector("summary")?.focus();openForm("edit");}}>Editar</Button>
                        {selected.entityId !== bootstrap?.rootCircleId && <>
                          <Button ariaLabel="Mover" onClick={event => {const menu = event.currentTarget.closest("details");menu?.removeAttribute("open");menu?.querySelector("summary")?.focus();openForm("move");}}>Mover</Button>
                          <Button ariaLabel="Arquivar" className="danger-text" onClick={event => {const menu = event.currentTarget.closest("details");menu?.removeAttribute("open");menu?.querySelector("summary")?.focus();openForm("archive");}}>Arquivar</Button>
                        </>}
                      </div>
                    </details>}
                    <Button className="mare-entity-expand" title={entityFocusExpanded ? "Reduzir painel" : "Expandir painel"} ariaLabel={entityFocusExpanded ? "Reduzir painel" : "Expandir painel"} onClick={() => setEntityFocusExpanded(v => !v)}>{entityFocusExpanded ? <Minimize size={18}/> : <Maximize size={18}/>}</Button>
                    <Button title="Fechar painel" ariaLabel="Fechar painel" onClick={closeEntityDrawer}><X size={20}/></Button>
                  </div>
                </div>
                <div className="mare-entity-heading">
                  <div className="mare-entity-kind">{selected.kind === "CIRCLE" ? <StructureIcon size={18}/> : <CircleDot size={18}/>}<span>{vocabulary.entity(selected.kind)}</span></div>
                  <h2 id="mare-entity-title" tabIndex={-1}>{selected.name}</h2>
                </div>
              </header>
              <StructureEntityNavigation key={orgId + selected.entityId} kind={selected.kind}/>
              <article className="entity-content structure-entity-content">
                <section id="entity-overview" className={purposeRich || purpose ? "" : "structure-purpose-empty"}>
                  <h3>Propósito</h3>
                  {purposeRich || purpose ? <FeatureRoleMentions context={featureContext}><RichTextView value={purposeRich ?? purpose ?? ""}/></FeatureRoleMentions> : <><p className="muted">Propósito ainda não definido.</p>{directStructure && <Button onClick={() => openForm("edit")}>Definir propósito</Button>}</>}
                </section>
                <FeatureRoleMentions context={featureContext}><DefinitionList kind="responsibilities" items={purposeEntity?.responsibilities} /></FeatureRoleMentions>
                <FeatureRoleMentions context={featureContext}><DefinitionList kind="artifacts" items={purposeEntity?.artifacts} /></FeatureRoleMentions>
                <details className="mare-artifact-authority mare-disclosure quiet"><summary>Autoridade sobre artefatos</summary><ArtifactAuthority kind={selected.kind} /></details>
                {(!hasGovernanceModel || selected.kind === 'CIRCLE' && !derivedCircleMembership) && <section id="entity-members">
                  <div className="section-heading">
                    <h3>{selected.kind === "ROLE" ? "Quem energiza" : "Integrantes"}</h3>
                    {owner && (
                      <Button
                        onClick={() =>
                          openForm(
                            selected.kind === "CIRCLE" ? "associate" : "assign",
                          )
                        }
                      >
                        <Plus size={15} />
                        {selected.kind === "CIRCLE"
                          ? "Associar membro"
                          : "Atribuir papel"}
                      </Button>
                    )}
                  </div>
                  {activeRelations(
                    selected.kind === "CIRCLE"
                      ? [
                          ...(structure?.memberships ?? []),
                          ...(structure?.occupancies ?? []),
                        ]
                      : (structure?.occupancies ?? []),
                  )
                    .filter((r) =>
                      selected.kind === "CIRCLE"
                        ? r.circleId === selected.entityId
                        : r.roleId === selected.entityId,
                    )
                    .map((r) => (
                      <div className="entity-row" key={r.id}>
                        <span className="avatar">
                          {initials(
                            members.find((m) => m.id === r.memberId)
                              ?.displayName ?? "?",
                          )}
                        </span>
                        <Button
                          onClick={() => navigateFromEntity("/members/" + r.memberId)}
                        >
                          <span data-entity-member={r.memberId}>{members.find((m) => m.id === r.memberId)
                            ?.displayName ?? "Membro"}</span>
                        </Button>
                        <small>
                          {r.origin === "EXPLICIT"
                            ? "Associação explícita"
                            : r.kind === "INTERIM"
                              ? "Ocupação interina"
                              : "Ocupação de papel"}
                        </small>
                        {owner && r.origin === "EXPLICIT" && !r.roleId && (
                          <Button onClick={() => {
                            setEndRelation(r);
                            openForm("end-association");
                          }}>
                            Encerrar associação
                          </Button>
                        )}
                        {owner && r.roleId && (
                          <Button
                            onClick={() => {
                              setEndRelation(r);
                              openForm("end");
                            }}
                          >
                            Encerrar
                          </Button>
                        )}
                      </div>
                    ))}
                  <p className="muted">
                    Associação a círculo e ocupação de papel são relações
                    independentes.
                  </p>
                </section>}
                {featureContext &&
                  features
                    .filter((f) => f.EntitySections && f.id === "governance-model" && !isGuest)
                    .map(
                      (f) =>
                        f.EntitySections && (
                          <f.EntitySections
                            key={f.id + orgId + selected.entityId}
                            context={featureContext}
                          />
                        ),
                    )}
                {selected.kind === "CIRCLE" && (
                  <section id="entity-roles">
                    <div className="section-heading">
                      <h3>Papéis e subcírculos</h3>
                      {directStructure && (
                        <>
                          <Button onClick={() => openForm("circle")}>
                            <Plus size={15} /> Criar {vocabulary.circle.toLocaleLowerCase('pt-BR')}
                          </Button>
                          <Button onClick={() => openForm("role")}>
                            <Plus size={15} /> Criar {vocabulary.role.toLocaleLowerCase('pt-BR')}
                          </Button>
                        </>
                      )}
                    </div>
                    <StructureRoleTree key={selected.nodeId} nodes={structure?.nodes ?? []} parentId={selected.nodeId} navigate={navigateWithinEntity} definitions={structure?.roles} members={members} relations={activeRelations(structure?.occupancies ?? [])}/>
                  </section>
                )}
                {featureContext && <StructureRelated key={orgId + selected.entityId} context={featureContext} entity={selected}/>}
                {featureContext && <details className="mare-entity-activity mare-disclosure"><summary>Atividade e mais detalhes</summary>
                  {features.filter(f => f.EntitySections && f.id !== "governance-model" && (!isGuest || f.id === "platform")).map(f => f.EntitySections && <f.EntitySections key={f.id + orgId + selected.entityId} context={featureContext}/>)}
                </details>}
              </article>
              </aside>
              )}
            </div>
          ) : selectedId && structure ? (
            <div className="empty-state"><h2>Este conteúdo não está disponível para esta conta</h2><Button onClick={() => navigate(entityPlatformSource ?? "/structure")}>{entityPlatformSource ? "Voltar aos recursos" : "Voltar à estrutura"}</Button></div>
          ) : selectedMember || path === "/members" ? (
            <MemberDirectoryPage key={orgId} organizationId={orgId} organizationName={bootstrap?.organization.name ?? activeOrg?.name ?? "Organização"} members={members} structure={structure} selectedMember={selectedMember} path={matchPath} guest={isGuest} owner={owner} currentMemberId={bootstrap?.membership.id ?? ""} navigate={navigate} canInvite={bootstrap?.capabilities["members.invite"]===true} onInvite={()=>openForm("invite")} onAdd={()=>openForm("member")}>
              {selectedMember && <MemberProfileContent member={selectedMember} structure={structure} context={featureContext} path={matchPath} guest={isGuest} owner={owner} currentMemberId={bootstrap?.membership.id ?? ""} navigate={navigate} onEdit={()=>openForm("member-edit")}/>}
            </MemberDirectoryPage>
          ) : path === "/structure/history" ? (
            <>
              <div className="page-heading">
                <h2>Histórico da organização</h2>
              </div>
              <div className="entity-content">
                {auditRead.state === "loading" && <p role="status">Carregando histórico…</p>}
                {auditRead.state === "denied" && <p role="status">Seu acesso não inclui o histórico da organização.</p>}
                {auditRead.state === "error" && <Notice>{auditRead.message} <Button onClick={() => setRefresh(value => value + 1)}>Tentar novamente</Button></Notice>}
                {auditRead.state === "ready" && audit.map((a) => (
                  <div className="audit-row" key={a.id}>
                    <History size={16} />
                    <span>{a.action}</span>
                    <time>
                      {formatAccountDate(a.at, accountPreferences, true)}
                    </time>
                  </div>
                ))}
                {auditRead.state === "ready" && !audit.length && <p>Nenhum evento registrado.</p>}
              </div>
            </>
          ) : path === "/structure/directory" ? (
            featureContext ? (
              <StructureDirectory key={orgId} context={featureContext} initialState={explorerState.current?.orgId === orgId ? explorerState.current.state : undefined} onStateChange={state => { explorerState.current = {orgId, state}; }} />
            ) : (
              <div className="empty-state">
                Não foi possível carregar o diretório.
              </div>
            )
          ) : path === "/structure" ? (
            featureContext ? (
              <StructureExplorer
                key={orgId}
                context={featureContext}
                initialState={
                  explorerState.current?.orgId === orgId
                    ? explorerState.current.state
                    : undefined
                }
                onStateChange={(state) => {
                  explorerState.current = { orgId, state };
                }}
                onCreateCircle={directStructure ? () => openForm("circle") : undefined}
              />
            ) : (
              <div className="empty-state">
                Não foi possível carregar a estrutura. Use Tentar novamente para
                recuperar os dados.
              </div>
            )
          ) : (
            <div className="empty-state">
              <h2>Página não encontrada</h2>
              <Button onClick={() => navigate("/structure")}>
                Voltar à estrutura
              </Button>
            </div>
          )}
        </main>
      </div>
      {dialog}
      {credentialGateOrg === orgId && orgId && bootstrap && <Dialog title="Confirme o acesso à organização" hideClose onClose={()=>{}}><OrganizationCredentialGate organizationId={orgId} onVerified={()=>setCredentialGateOrg("")} navigate={navigate}/>{navigationIssue&&<Notice>{navigationIssue}</Notice>}</Dialog>}
      {bootstrap && orgId && !changingTrackingOrganization && !loading && form !== 'invite' && <OrganizationEntry key={session.account.id + ":" + orgId} accountId={session.account.id} organizationId={orgId} bootstrap={bootstrap} path={matchPath} implicitLanding={implicitEntryLanding.current} onResolved={() => { implicitEntryLanding.current = false; }} navigate={navigate} />}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </WorkspaceBrandingShell>
    </GlobalAccessibilityProvider>
      </LocalizationProvider>
  );
}
