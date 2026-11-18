var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// packages/i18n/messages.ts
function catalog(values) {
  if (values.length !== keys.length) throw new Error(`Catalog has ${values.length}; expected ${keys.length}`);
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}
var keys, catalogs;
var init_messages = __esm({
  "packages/i18n/messages.ts"() {
    "use strict";
    keys = ["common.save", "common.cancel", "common.reset", "common.loading", "common.retry", "common.close", "common.none", "common.saved", "nav.structure", "nav.governance", "nav.work", "nav.goals", "nav.meetings", "nav.members", "nav.account", "nav.preferences", "nav.security", "nav.sessions", "nav.administration", "nav.search", "nav.signOut", "account.language", "account.timeZone", "account.dateFormat", "a11y.title", "a11y.preferences", "a11y.statement", "a11y.personalize", "a11y.scope", "a11y.speech", "a11y.text", "a11y.textSize", "a11y.default", "a11y.large", "a11y.extraLarge", "a11y.lineSpacing", "a11y.letterSpacing", "a11y.bold", "a11y.dyslexia", "a11y.color", "a11y.contrast", "a11y.saturation", "a11y.invert", "a11y.highContrast", "a11y.reading", "a11y.links", "a11y.headings", "a11y.guide", "a11y.images", "a11y.interaction", "a11y.pointer", "a11y.motion", "a11y.reset", "a11y.storageError", "a11y.speechUnavailable", "a11y.speechAction", "a11y.speechStop", "a11y.skip", "a11y.statementText", "a11y.speechHint"];
    catalogs = {
      "pt-BR": catalog(["Salvar", "Cancelar", "Redefinir", "Carregando\u2026", "Tentar novamente", "Fechar", "Nenhum", "Prefer\xEAncias salvas.", "Estrutura", "Governan\xE7a", "Projetos", "Objetivos", "Reuni\xF5es", "Membros", "Minha conta", "Prefer\xEAncias", "Autentica\xE7\xE3o", "Sess\xF5es", "Administra\xE7\xE3o", "Pesquisar", "Sair", "Idioma", "Fuso hor\xE1rio", "Formato de data", "Acessibilidade", "Prefer\xEAncias", "Declara\xE7\xE3o de acessibilidade", "Personalize sua experi\xEAncia", "Estes controles se aplicam neste navegador \xE0 conta e organiza\xE7\xE3o atuais.", "Texto para fala", "Texto", "Tamanho do texto", "Padr\xE3o", "Grande", "Muito grande", "Espa\xE7amento entre linhas", "Espa\xE7amento entre letras", "Texto em negrito", "Fonte para dislexia", "Cor", "Contraste", "Satura\xE7\xE3o", "Inverter cores", "Modo de alto contraste", "Leitura", "Destacar links", "Destacar t\xEDtulos", "Guia de leitura", "Ocultar imagens", "Intera\xE7\xE3o", "Ponteiro grande", "Pausar anima\xE7\xF5es", "Redefinir prefer\xEAncias de acessibilidade", "N\xE3o foi poss\xEDvel salvar neste navegador. O ajuste vale apenas nesta sess\xE3o.", "A voz para este idioma n\xE3o est\xE1 dispon\xEDvel neste dispositivo.", "Ouvir exemplo", "Parar leitura", "Ir para o conte\xFAdo", "Nosso alvo \xE9 WCAG 2.2 AA. Esta interface ainda requer auditoria de todos os fluxos com teclado e leitores de tela. Os ajustes visuais n\xE3o comprovam conformidade.", "Ap\xF3s ativar, controles identificados s\xE3o lidos ao receber foco. A leitura usa a voz do navegador; campos privados e credenciais n\xE3o s\xE3o lidos."]),
      "en-US": catalog(["Save", "Cancel", "Reset", "Loading\u2026", "Try again", "Close", "None", "Preferences saved.", "Structure", "Governance", "Projects", "Goals", "Meetings", "Members", "My account", "Preferences", "Authentication", "Sessions", "Administration", "Search", "Sign out", "Language", "Time zone", "Date format", "Accessibility", "Preferences", "Accessibility statement", "Personalize your experience", "These controls apply in this browser to the current account and organization.", "Text to speech", "Text", "Text size", "Default", "Large", "Extra large", "Line spacing", "Letter spacing", "Bold text", "Dyslexia font", "Color", "Contrast", "Saturation", "Invert colors", "High contrast mode", "Reading", "Highlight links", "Highlight headings", "Reading guide", "Hide images", "Interaction", "Large pointer", "Pause animations", "Reset accessibility preferences", "Unable to save in this browser. This adjustment applies to this session only.", "A voice for this language is unavailable on this device.", "Listen to example", "Stop reading", "Skip to content", "Our target is WCAG 2.2 AA. All flows still require keyboard and screen reader auditing. Visual adjustments do not prove conformance.", "Once enabled, marked controls are read when focused. Speech uses the browser voice; private fields and credentials are never read."]),
      "es-ES": catalog(["Guardar", "Cancelar", "Restablecer", "Cargando\u2026", "Reintentar", "Cerrar", "Ninguno", "Preferencias guardadas.", "Estructura", "Gobernanza", "Proyectos", "Objetivos", "Reuniones", "Miembros", "Mi cuenta", "Preferencias", "Autenticaci\xF3n", "Sesiones", "Administraci\xF3n", "Buscar", "Salir", "Idioma", "Zona horaria", "Formato de fecha", "Accesibilidad", "Preferencias", "Declaraci\xF3n de accesibilidad", "Personaliza tu experiencia", "Estos controles se aplican en este navegador a la cuenta y organizaci\xF3n actuales.", "Texto a voz", "Texto", "Tama\xF1o del texto", "Predeterminado", "Grande", "Muy grande", "Espaciado entre l\xEDneas", "Espaciado entre letras", "Texto en negrita", "Fuente para dislexia", "Color", "Contraste", "Saturaci\xF3n", "Invertir colores", "Modo de alto contraste", "Lectura", "Resaltar enlaces", "Resaltar t\xEDtulos", "Gu\xEDa de lectura", "Ocultar im\xE1genes", "Interacci\xF3n", "Puntero grande", "Pausar animaciones", "Restablecer preferencias de accesibilidad", "No se pudo guardar en este navegador. El ajuste solo se aplica a esta sesi\xF3n.", "No hay voz para este idioma en este dispositivo.", "Escuchar ejemplo", "Detener lectura", "Ir al contenido", "Nuestro objetivo es WCAG 2.2 AA. Todos los flujos a\xFAn requieren auditor\xEDa con teclado y lectores de pantalla. Los ajustes visuales no prueban conformidad.", "Al activar, los controles identificados se leen al recibir el foco. Se usa la voz del navegador; no se leen campos privados ni credenciales."]),
      "fr-FR": catalog(["Enregistrer", "Annuler", "R\xE9initialiser", "Chargement\u2026", "R\xE9essayer", "Fermer", "Aucun", "Pr\xE9f\xE9rences enregistr\xE9es.", "Structure", "Gouvernance", "Projets", "Objectifs", "R\xE9unions", "Membres", "Mon compte", "Pr\xE9f\xE9rences", "Authentification", "Sessions", "Administration", "Rechercher", "D\xE9connexion", "Langue", "Fuseau horaire", "Format de date", "Accessibilit\xE9", "Pr\xE9f\xE9rences", "D\xE9claration d\u2019accessibilit\xE9", "Personnalisez votre exp\xE9rience", "Ces r\xE9glages s\u2019appliquent dans ce navigateur au compte et \xE0 l\u2019organisation actuels.", "Synth\xE8se vocale", "Texte", "Taille du texte", "Par d\xE9faut", "Grand", "Tr\xE8s grand", "Espacement des lignes", "Espacement des lettres", "Texte en gras", "Police pour dyslexie", "Couleur", "Contraste", "Saturation", "Inverser les couleurs", "Mode contraste \xE9lev\xE9", "Lecture", "Souligner les liens", "Mettre en \xE9vidence les titres", "Guide de lecture", "Masquer les images", "Interaction", "Grand pointeur", "Suspendre les animations", "R\xE9initialiser les pr\xE9f\xE9rences d\u2019accessibilit\xE9", "Impossible d\u2019enregistrer dans ce navigateur. Le r\xE9glage ne vaut que pour cette session.", "Aucune voix pour cette langue sur cet appareil.", "\xC9couter un exemple", "Arr\xEAter la lecture", "Aller au contenu", "Notre objectif est WCAG 2.2 AA. Tous les parcours doivent encore \xEAtre audit\xE9s au clavier et avec des lecteurs d\u2019\xE9cran. Les r\xE9glages visuels ne prouvent pas la conformit\xE9.", "Une fois activ\xE9e, la lecture annonce les contr\xF4les identifi\xE9s au focus. Elle utilise la voix du navigateur ; les champs priv\xE9s et identifiants ne sont pas lus."]),
      "de-DE": catalog(["Speichern", "Abbrechen", "Zur\xFCcksetzen", "Wird geladen\u2026", "Erneut versuchen", "Schlie\xDFen", "Keine", "Einstellungen gespeichert.", "Struktur", "Governance", "Projekte", "Ziele", "Besprechungen", "Mitglieder", "Mein Konto", "Einstellungen", "Authentifizierung", "Sitzungen", "Verwaltung", "Suchen", "Abmelden", "Sprache", "Zeitzone", "Datumsformat", "Barrierefreiheit", "Einstellungen", "Erkl\xE4rung zur Barrierefreiheit", "Passen Sie Ihre Nutzung an", "Diese Einstellungen gelten in diesem Browser f\xFCr das aktuelle Konto und die aktuelle Organisation.", "Sprachausgabe", "Text", "Textgr\xF6\xDFe", "Standard", "Gro\xDF", "Sehr gro\xDF", "Zeilenabstand", "Buchstabenabstand", "Fettdruck", "Schrift f\xFCr Legasthenie", "Farbe", "Kontrast", "S\xE4ttigung", "Farben umkehren", "Hoher Kontrast", "Lesen", "Links hervorheben", "\xDCberschriften hervorheben", "Lesehilfe", "Bilder ausblenden", "Interaktion", "Gro\xDFer Mauszeiger", "Animationen anhalten", "Einstellungen zur Barrierefreiheit zur\xFCcksetzen", "Speichern im Browser nicht m\xF6glich. Die Einstellung gilt nur f\xFCr diese Sitzung.", "Auf diesem Ger\xE4t ist keine Stimme f\xFCr diese Sprache verf\xFCgbar.", "Beispiel anh\xF6ren", "Vorlesen beenden", "Zum Inhalt springen", "Unser Ziel ist WCAG 2.2 AA. Alle Abl\xE4ufe erfordern noch Pr\xFCfungen mit Tastatur und Screenreadern. Visuelle Anpassungen belegen keine Konformit\xE4t.", "Nach dem Aktivieren werden markierte Bedienelemente beim Fokussieren vorgelesen. Die Browserstimme liest keine privaten Felder oder Zugangsdaten."]),
      "it-IT": catalog(["Salva", "Annulla", "Ripristina", "Caricamento\u2026", "Riprova", "Chiudi", "Nessuno", "Preferenze salvate.", "Struttura", "Governance", "Progetti", "Obiettivi", "Riunioni", "Membri", "Il mio account", "Preferenze", "Autenticazione", "Sessioni", "Amministrazione", "Cerca", "Esci", "Lingua", "Fuso orario", "Formato data", "Accessibilit\xE0", "Preferenze", "Dichiarazione di accessibilit\xE0", "Personalizza la tua esperienza", "Questi controlli si applicano in questo browser all\u2019account e all\u2019organizzazione attuali.", "Sintesi vocale", "Testo", "Dimensione del testo", "Predefinita", "Grande", "Molto grande", "Spaziatura tra righe", "Spaziatura tra lettere", "Testo in grassetto", "Carattere per dislessia", "Colore", "Contrasto", "Saturazione", "Inverti colori", "Modalit\xE0 contrasto elevato", "Lettura", "Evidenzia link", "Evidenzia titoli", "Guida alla lettura", "Nascondi immagini", "Interazione", "Puntatore grande", "Sospendi animazioni", "Ripristina preferenze di accessibilit\xE0", "Impossibile salvare nel browser. La modifica vale solo per questa sessione.", "Nessuna voce per questa lingua su questo dispositivo.", "Ascolta esempio", "Interrompi lettura", "Vai al contenuto", "Il nostro obiettivo \xE8 WCAG 2.2 AA. Tutti i flussi richiedono ancora una verifica con tastiera e lettori di schermo. Le modifiche visive non provano la conformit\xE0.", "Dopo l\u2019attivazione, i controlli identificati vengono letti al focus. Si usa la voce del browser; campi privati e credenziali non vengono letti."]),
      "ja-JP": catalog(["\u4FDD\u5B58", "\u30AD\u30E3\u30F3\u30BB\u30EB", "\u30EA\u30BB\u30C3\u30C8", "\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026", "\u518D\u8A66\u884C", "\u9589\u3058\u308B", "\u306A\u3057", "\u8A2D\u5B9A\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002", "\u7D44\u7E54\u69CB\u9020", "\u30AC\u30D0\u30CA\u30F3\u30B9", "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8", "\u76EE\u6A19", "\u4F1A\u8B70", "\u30E1\u30F3\u30D0\u30FC", "\u30DE\u30A4\u30A2\u30AB\u30A6\u30F3\u30C8", "\u8A2D\u5B9A", "\u8A8D\u8A3C", "\u30BB\u30C3\u30B7\u30E7\u30F3", "\u7BA1\u7406", "\u691C\u7D22", "\u30ED\u30B0\u30A2\u30A6\u30C8", "\u8A00\u8A9E", "\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3", "\u65E5\u4ED8\u5F62\u5F0F", "\u30A2\u30AF\u30BB\u30B7\u30D3\u30EA\u30C6\u30A3", "\u8A2D\u5B9A", "\u30A2\u30AF\u30BB\u30B7\u30D3\u30EA\u30C6\u30A3\u306B\u95A2\u3059\u308B\u58F0\u660E", "\u8868\u793A\u3092\u30AB\u30B9\u30BF\u30DE\u30A4\u30BA", "\u3053\u306E\u8A2D\u5B9A\u306F\u73FE\u5728\u306E\u30D6\u30E9\u30A6\u30B6\u30FC\u3001\u30A2\u30AB\u30A6\u30F3\u30C8\u3001\u7D44\u7E54\u306B\u9069\u7528\u3055\u308C\u307E\u3059\u3002", "\u30C6\u30AD\u30B9\u30C8\u8AAD\u307F\u4E0A\u3052", "\u30C6\u30AD\u30B9\u30C8", "\u6587\u5B57\u30B5\u30A4\u30BA", "\u6A19\u6E96", "\u5927", "\u7279\u5927", "\u884C\u9593\u3092\u5E83\u3052\u308B", "\u6587\u5B57\u9593\u9694\u3092\u5E83\u3052\u308B", "\u592A\u5B57", "\u30C7\u30A3\u30B9\u30EC\u30AF\u30B7\u30A2\u7528\u30D5\u30A9\u30F3\u30C8", "\u8272", "\u30B3\u30F3\u30C8\u30E9\u30B9\u30C8", "\u5F69\u5EA6", "\u8272\u3092\u53CD\u8EE2", "\u30CF\u30A4\u30B3\u30F3\u30C8\u30E9\u30B9\u30C8", "\u8AAD\u307F\u3084\u3059\u3055", "\u30EA\u30F3\u30AF\u3092\u5F37\u8ABF", "\u898B\u51FA\u3057\u3092\u5F37\u8ABF", "\u8AAD\u66F8\u30AC\u30A4\u30C9", "\u753B\u50CF\u3092\u975E\u8868\u793A", "\u64CD\u4F5C", "\u5927\u304D\u306A\u30DD\u30A4\u30F3\u30BF\u30FC", "\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3\u3092\u505C\u6B62", "\u30A2\u30AF\u30BB\u30B7\u30D3\u30EA\u30C6\u30A3\u8A2D\u5B9A\u3092\u30EA\u30BB\u30C3\u30C8", "\u30D6\u30E9\u30A6\u30B6\u30FC\u306B\u4FDD\u5B58\u3067\u304D\u307E\u305B\u3093\u3002\u3053\u306E\u8A2D\u5B9A\u306F\u73FE\u5728\u306E\u30BB\u30C3\u30B7\u30E7\u30F3\u306B\u306E\u307F\u9069\u7528\u3055\u308C\u307E\u3059\u3002", "\u3053\u306E\u30C7\u30D0\u30A4\u30B9\u3067\u306F\u3001\u3053\u306E\u8A00\u8A9E\u306E\u97F3\u58F0\u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002", "\u30B5\u30F3\u30D7\u30EB\u3092\u805E\u304F", "\u8AAD\u307F\u4E0A\u3052\u3092\u505C\u6B62", "\u672C\u6587\u3078\u79FB\u52D5", "WCAG 2.2 AA\u3092\u76EE\u6A19\u3068\u3057\u3066\u3044\u307E\u3059\u3002\u3059\u3079\u3066\u306E\u64CD\u4F5C\u306B\u3064\u3044\u3066\u3001\u30AD\u30FC\u30DC\u30FC\u30C9\u3068\u30B9\u30AF\u30EA\u30FC\u30F3\u30EA\u30FC\u30C0\u30FC\u306B\u3088\u308B\u76E3\u67FB\u304C\u5FC5\u8981\u3067\u3059\u3002\u8868\u793A\u8ABF\u6574\u3060\u3051\u3067\u306F\u6E96\u62E0\u3092\u8A3C\u660E\u3067\u304D\u307E\u305B\u3093\u3002", "\u6709\u52B9\u306B\u3059\u308B\u3068\u3001\u5BFE\u5FDC\u3059\u308B\u64CD\u4F5C\u9805\u76EE\u306B\u30D5\u30A9\u30FC\u30AB\u30B9\u3057\u305F\u969B\u306B\u30D6\u30E9\u30A6\u30B6\u30FC\u306E\u97F3\u58F0\u3067\u8AAD\u307F\u4E0A\u3052\u307E\u3059\u3002\u975E\u516C\u958B\u306E\u5165\u529B\u6B04\u3084\u8A8D\u8A3C\u60C5\u5831\u306F\u8AAD\u307F\u307E\u305B\u3093\u3002"]),
      "nl-NL": catalog(["Opslaan", "Annuleren", "Herstellen", "Laden\u2026", "Opnieuw proberen", "Sluiten", "Geen", "Voorkeuren opgeslagen.", "Structuur", "Governance", "Projecten", "Doelen", "Vergaderingen", "Leden", "Mijn account", "Voorkeuren", "Authenticatie", "Sessies", "Beheer", "Zoeken", "Afmelden", "Taal", "Tijdzone", "Datumnotatie", "Toegankelijkheid", "Voorkeuren", "Toegankelijkheidsverklaring", "Pas uw ervaring aan", "Deze instellingen gelden in deze browser voor het huidige account en de huidige organisatie.", "Tekst naar spraak", "Tekst", "Tekstgrootte", "Standaard", "Groot", "Extra groot", "Regelafstand", "Letterafstand", "Vetgedrukte tekst", "Lettertype voor dyslexie", "Kleur", "Contrast", "Verzadiging", "Kleuren omkeren", "Hoog contrast", "Lezen", "Links markeren", "Koppen markeren", "Leesgids", "Afbeeldingen verbergen", "Interactie", "Grote aanwijzer", "Animaties pauzeren", "Toegankelijkheidsvoorkeuren herstellen", "Opslaan in deze browser is niet mogelijk. De aanpassing geldt alleen voor deze sessie.", "Er is geen stem voor deze taal beschikbaar op dit apparaat.", "Voorbeeld beluisteren", "Lezen stoppen", "Naar de inhoud", "Ons doel is WCAG 2.2 AA. Alle processen vereisen nog een controle met toetsenbord en schermlezers. Visuele aanpassingen bewijzen geen conformiteit.", "Na inschakeling worden gemarkeerde bedieningselementen bij focus voorgelezen. De browserstem leest geen priv\xE9velden of inloggegevens."])
    };
  }
});

// packages/i18n/errors.ts
function translatedError(error, locale) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  return messages[locale][categories.indexOf(codes[code] ?? "generic")];
}
var categories, messages, codes;
var init_errors = __esm({
  "packages/i18n/errors.ts"() {
    "use strict";
    categories = ["authentication", "denied", "invalid", "conflict", "network", "generic"];
    messages = {
      "pt-BR": ["Entre novamente para continuar.", "Voc\xEA n\xE3o tem permiss\xE3o para esta a\xE7\xE3o.", "Revise os campos preenchidos e tente novamente.", "Os dados ou o estado foram alterados. Atualize e revise antes de tentar novamente.", "N\xE3o foi poss\xEDvel conectar ao servidor. Verifique a conex\xE3o e tente novamente.", "N\xE3o foi poss\xEDvel concluir a a\xE7\xE3o. Tente novamente."],
      "en-US": ["Sign in again to continue.", "You do not have permission for this action.", "Review the completed fields and try again.", "The data or state changed. Refresh and review before trying again.", "Unable to connect to the server. Check your connection and try again.", "Unable to complete this action. Try again."],
      "es-ES": ["Vuelve a iniciar sesi\xF3n para continuar.", "No tienes permiso para esta acci\xF3n.", "Revisa los campos completados y reintenta.", "Los datos o el estado cambiaron. Actualiza y revisa antes de reintentar.", "No se pudo conectar al servidor. Comprueba la conexi\xF3n y reintenta.", "No se pudo completar la acci\xF3n. Reintenta."],
      "fr-FR": ["Reconnectez-vous pour continuer.", "Vous n\u2019avez pas l\u2019autorisation pour cette action.", "V\xE9rifiez les champs remplis et r\xE9essayez.", "Les donn\xE9es ou l\u2019\xE9tat ont chang\xE9. Actualisez et v\xE9rifiez avant de r\xE9essayer.", "Connexion au serveur impossible. V\xE9rifiez votre connexion et r\xE9essayez.", "Impossible de terminer cette action. R\xE9essayez."],
      "de-DE": ["Melden Sie sich erneut an, um fortzufahren.", "Sie haben keine Berechtigung f\xFCr diese Aktion.", "Pr\xFCfen Sie die ausgef\xFCllten Felder und versuchen Sie es erneut.", "Daten oder Zustand wurden ge\xE4ndert. Aktualisieren und pr\xFCfen Sie sie vor einem neuen Versuch.", "Keine Verbindung zum Server. Pr\xFCfen Sie Ihre Verbindung und versuchen Sie es erneut.", "Die Aktion konnte nicht abgeschlossen werden. Versuchen Sie es erneut."],
      "it-IT": ["Accedi di nuovo per continuare.", "Non hai il permesso per questa azione.", "Verifica i campi compilati e riprova.", "I dati o lo stato sono cambiati. Aggiorna e verifica prima di riprovare.", "Impossibile connettersi al server. Verifica la connessione e riprova.", "Impossibile completare l\u2019azione. Riprova."],
      "ja-JP": ["\u7D9A\u884C\u3059\u308B\u306B\u306F\u518D\u5EA6\u30ED\u30B0\u30A4\u30F3\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u64CD\u4F5C\u3092\u884C\u3046\u6A29\u9650\u304C\u3042\u308A\u307E\u305B\u3093\u3002", "\u5165\u529B\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u30C7\u30FC\u30BF\u3084\u72B6\u614B\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F\u3002\u66F4\u65B0\u3057\u3066\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u30B5\u30FC\u30D0\u30FC\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3002\u63A5\u7D9A\u3092\u78BA\u8A8D\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u64CD\u4F5C\u3092\u5B8C\u4E86\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"],
      "nl-NL": ["Meld u opnieuw aan om door te gaan.", "U hebt geen toestemming voor deze actie.", "Controleer de ingevulde velden en probeer opnieuw.", "Gegevens of status zijn gewijzigd. Vernieuw en controleer ze voordat u opnieuw probeert.", "Geen verbinding met de server. Controleer uw verbinding en probeer opnieuw.", "De actie kon niet worden voltooid. Probeer opnieuw."]
    };
    codes = { UNAUTHENTICATED: "authentication", CSRF_INVALID: "authentication", REAUTHENTICATION_REQUIRED: "authentication", ACTION_DENIED: "denied", MODULE_DISABLED: "denied", INVALID_REQUEST: "invalid", INVALID_PASSWORD: "invalid", PASSWORD_TOO_SHORT: "invalid", VERSION_CONFLICT: "conflict", PRECONDITION_REQUIRED: "conflict", STATE_CONFLICT: "conflict", IDEMPOTENCY_CONFLICT: "conflict", NETWORK_ERROR: "network", INVALID_RESPONSE: "network" };
  }
});

// packages/i18n/index.ts
function formatError(error, locale) {
  return translatedError(error, resolveLocale(locale));
}
function resolveLocale(value) {
  try {
    const canonical = Intl.getCanonicalLocales(value ?? "")[0];
    return SUPPORTED_LOCALES.find((l) => l === canonical) ?? SUPPORTED_LOCALES.find((l) => l.split("-")[0] === canonical?.split("-")[0]) ?? "pt-BR";
  } catch {
    return "pt-BR";
  }
}
function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
function normalizePreferences(value) {
  return {
    locale: resolveLocale(value?.locale),
    timeZone: value?.timeZone && validTimeZone(value.timeZone) ? value.timeZone : DEFAULT_PREFERENCES.timeZone,
    dateFormat: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"].includes(value?.dateFormat ?? "") ? value.dateFormat : "DD/MM/YYYY",
    reducedMotion: value?.reducedMotion === true
  };
}
function ownMessage(dictionary, key) {
  if (!dictionary || !Object.hasOwn(dictionary, key)) return void 0;
  const value = dictionary[key];
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function createMessageTranslator(locale, dictionaries) {
  const resolved = resolveLocale(locale);
  return (key, params = {}) => {
    const message = ownMessage(dictionaries[resolved], key) ?? ownMessage(dictionaries["pt-BR"], key) ?? key;
    return message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
  };
}
function createTranslator(locale, overrides) {
  const resolved = resolveLocale(locale);
  const message = (key) => ownMessage(overrides, key) ?? ownMessage(catalogs[resolved], key) ?? ownMessage(catalogs["pt-BR"], key) ?? key;
  return {
    locale: resolved,
    t(key, params = {}) {
      return message(key).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, name) => Object.hasOwn(params, name) ? String(params[name]) : token);
    }
  };
}
function orderedDate(year, month, day, format) {
  return format === "YYYY-MM-DD" ? `${year}-${month}-${day}` : format === "MM/DD/YYYY" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}
function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = /* @__PURE__ */ new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}
function formatDate(value, preferences, options) {
  const date = value ? parseDateOnly(value) : null;
  if (!date) return missing;
  const p = normalizePreferences(preferences);
  if (options) return new Intl.DateTimeFormat(p.locale, { ...options, timeZone: "UTC", calendar: "gregory" }).format(date);
  return orderedDate(String(date.getUTCFullYear()).padStart(4, "0"), pad(date.getUTCMonth() + 1), pad(date.getUTCDate()), p.dateFormat);
}
function parseInstant(value) {
  if (!(value instanceof Date) && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return null;
  if (typeof value === "string" && !parseDateOnly(value.slice(0, 10))) return null;
  if (typeof value === "string") {
    const time = value.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59) return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function formatInstant(value, preferences, includeTime = true, options) {
  const date = parseInstant(value);
  if (!date) return missing;
  const p = normalizePreferences(preferences);
  if (options) return new Intl.DateTimeFormat(p.locale, { ...options, timeZone: p.timeZone, calendar: "gregory" }).format(date);
  const parts = new Intl.DateTimeFormat("en-US-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: p.timeZone, calendar: "gregory" }).formatToParts(date);
  const part = (type) => parts.find((p2) => p2.type === type)?.value ?? "";
  const result = orderedDate(part("year"), part("month"), part("day"), p.dateFormat);
  return includeTime ? `${result} ${new Intl.DateTimeFormat(p.locale, { hour: "2-digit", minute: "2-digit", timeZone: p.timeZone }).format(date)}` : result;
}
function formatNumber(value, preferences, options) {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat(resolveLocale(preferences?.locale), options).format(value) : missing;
}
function compareText(a, b, locale) {
  return new Intl.Collator(resolveLocale(locale), { numeric: true, sensitivity: "base" }).compare(a, b);
}
function dateAtInstant(value, preferences) {
  return parseInstant(value) ? formatInstant(value, { ...preferences, dateFormat: "YYYY-MM-DD" }, false) : null;
}
function pluralKey(count, locale) {
  return new Intl.PluralRules(resolveLocale(locale)).select(count);
}
var SUPPORTED_LOCALES, LOCALE_LABELS, DEFAULT_PREFERENCES, missing, pad;
var init_i18n = __esm({
  "packages/i18n/index.ts"() {
    "use strict";
    init_messages();
    init_errors();
    init_messages();
    SUPPORTED_LOCALES = ["pt-BR", "en-US", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP", "nl-NL"];
    LOCALE_LABELS = {
      "pt-BR": "Portugu\xEAs (Brasil)",
      "en-US": "English",
      "es-ES": "Espa\xF1ol",
      "fr-FR": "Fran\xE7ais",
      "de-DE": "Deutsch",
      "it-IT": "Italiano",
      "ja-JP": "\u65E5\u672C\u8A9E",
      "nl-NL": "Nederlands"
    };
    DEFAULT_PREFERENCES = Object.freeze({ locale: "pt-BR", timeZone: "America/Sao_Paulo", dateFormat: "DD/MM/YYYY", reducedMotion: false });
    missing = "\u2014";
    pad = (n) => String(n).padStart(2, "0");
  }
});

// web/src/features/governance/process-messages.ts
var keys2, rows, processMessages, governanceProcessTranslator;
var init_process_messages = __esm({
  "web/src/features/governance/process-messages.ts"() {
    "use strict";
    init_i18n();
    keys2 = ["noCircle", "loadingPolicy", "effectivePolicy", "localPolicy", "orgPolicy", "defaultPolicy", "overrideForbidden", "draftAccess", "authorOnly", "authorLeads", "circleMembers", "leadUnavailable", "workflow", "fullFlow", "simpleFlow", "customFlow", "method", "quorumPercent", "responses", "quorum", "allParticipants", "duration", "revote", "abstain", "policyEffect", "savePolicy", "agendaDenied", "loadingMeetings", "noMeetings", "destinationMeeting", "selectMeeting", "checkingMeeting", "agendaExplanation", "refreshMeeting", "addToAgenda", "toAgenda", "agendaAction"];
    rows = {
      "pt-BR": ["N\xE3o h\xE1 c\xEDrculo dispon\xEDvel para configurar o processo.", "Carregando processo em vigor\u2026", "Processo em vigor:", "configura\xE7\xE3o deste c\xEDrculo", "padr\xE3o da organiza\xE7\xE3o", "padr\xE3o inicial", "A organiza\xE7\xE3o n\xE3o permite configura\xE7\xF5es locais diferentes.", "Acesso aos rascunhos", "Apenas o autor", "Autor e elos principais", "Membros do c\xEDrculo", "A autoriza\xE7\xE3o de elos principais ainda n\xE3o est\xE1 dispon\xEDvel. As op\xE7\xF5es de autor e membros do c\xEDrculo est\xE3o dispon\xEDveis.", "Fluxo de decis\xE3o", "Completo: apresentar, esclarecer, reagir, objetar e decidir", "Simplificado: apresentar e decidir", "Personalizado \u2014 preservar etapas existentes", "M\xE9todo", "Qu\xF3rum (%)", "Respostas exigidas", "Qu\xF3rum", "Todos os participantes", "Dura\xE7\xE3o da revis\xE3o (horas)", "Permitir substituir o voto, preservando o anterior", "Permitir absten\xE7\xE3o", "Altera\xE7\xF5es do processo valem para novas rodadas. Cada rodada mant\xE9m o processo e o eleitorado registrados na submiss\xE3o. O acesso aos rascunhos passa a valer ao salvar.", "Salvar processo", "Voc\xEA n\xE3o pode adicionar itens \xE0 agenda desta reuni\xE3o no estado atual.", "Carregando reuni\xF5es dispon\xEDveis\u2026", "N\xE3o h\xE1 reuni\xF5es abertas deste c\xEDrculo dispon\xEDveis para voc\xEA.", "Reuni\xE3o de destino", "Selecione uma reuni\xE3o", "Verificando permiss\xE3o e vers\xE3o da reuni\xE3o\u2026", "A tens\xE3o ser\xE1 adicionada \xE0 agenda de {meeting}. O t\xEDtulo e o v\xEDnculo com a origem ser\xE3o preservados.", "Atualizar reuni\xE3o", "Adicionar \xE0 agenda", "Levar tens\xE3o para agenda", "Levar para agenda"],
      "en-US": ["No circle is available to configure the process.", "Loading the effective process\u2026", "Effective process:", "this circle\u2019s configuration", "organization default", "initial default", "The organization does not allow different local settings.", "Draft access", "Author only", "Author and lead links", "Circle members", "Lead-link authorization is not available yet. Author and circle-member options are available.", "Decision workflow", "Full: present, clarify, react, object and decide", "Simplified: present and decide", "Custom \u2014 preserve existing steps", "Method", "Quorum (%)", "Required responses", "Quorum", "All participants", "Review duration (hours)", "Allow replacing a vote while preserving the previous vote", "Allow abstention", "Process changes apply to new rounds. Each round retains the process and electorate recorded at submission. Draft access changes take effect when saved.", "Save process", "You cannot add agenda items to this meeting in its current state.", "Loading available meetings\u2026", "No open meetings in this circle are available to you.", "Destination meeting", "Select a meeting", "Checking meeting permission and version\u2026", "The tension will be added to the agenda of {meeting}. Its title and source link will be preserved.", "Refresh meeting", "Add to agenda", "Send tension to agenda", "Send to agenda"],
      "es-ES": ["No hay ning\xFAn c\xEDrculo disponible para configurar el proceso.", "Cargando el proceso vigente\u2026", "Proceso vigente:", "configuraci\xF3n de este c\xEDrculo", "valor predeterminado de la organizaci\xF3n", "valor inicial", "La organizaci\xF3n no permite configuraciones locales diferentes.", "Acceso a borradores", "Solo el autor", "Autor y enlaces principales", "Miembros del c\xEDrculo", "La autorizaci\xF3n de enlaces principales a\xFAn no est\xE1 disponible. Las opciones de autor y miembros del c\xEDrculo est\xE1n disponibles.", "Flujo de decisi\xF3n", "Completo: presentar, aclarar, reaccionar, objetar y decidir", "Simplificado: presentar y decidir", "Personalizado \u2014 conservar etapas existentes", "M\xE9todo", "Cu\xF3rum (%)", "Respuestas requeridas", "Cu\xF3rum", "Todos los participantes", "Duraci\xF3n de la revisi\xF3n (horas)", "Permitir sustituir el voto conservando el anterior", "Permitir abstenci\xF3n", "Los cambios del proceso se aplican a nuevas rondas. Cada ronda conserva el proceso y el electorado registrados al enviarse. El acceso a borradores cambia al guardar.", "Guardar proceso", "No puedes a\xF1adir elementos a la agenda de esta reuni\xF3n en su estado actual.", "Cargando reuniones disponibles\u2026", "No hay reuniones abiertas de este c\xEDrculo disponibles para ti.", "Reuni\xF3n de destino", "Selecciona una reuni\xF3n", "Verificando permiso y versi\xF3n de la reuni\xF3n\u2026", "La tensi\xF3n se a\xF1adir\xE1 a la agenda de {meeting}. Se conservar\xE1n el t\xEDtulo y el v\xEDnculo de origen.", "Actualizar reuni\xF3n", "A\xF1adir a la agenda", "Llevar tensi\xF3n a la agenda", "Llevar a la agenda"],
      "fr-FR": ["Aucun cercle n\u2019est disponible pour configurer le processus.", "Chargement du processus en vigueur\u2026", "Processus en vigueur :", "configuration de ce cercle", "param\xE8tre de l\u2019organisation", "param\xE8tre initial", "L\u2019organisation n\u2019autorise pas de configurations locales diff\xE9rentes.", "Acc\xE8s aux brouillons", "Auteur uniquement", "Auteur et premiers liens", "Membres du cercle", "L\u2019autorisation des premiers liens n\u2019est pas encore disponible. Les options auteur et membres du cercle sont disponibles.", "D\xE9roulement de la d\xE9cision", "Complet : pr\xE9senter, clarifier, r\xE9agir, objecter et d\xE9cider", "Simplifi\xE9 : pr\xE9senter et d\xE9cider", "Personnalis\xE9 \u2014 conserver les \xE9tapes existantes", "M\xE9thode", "Quorum (%)", "R\xE9ponses requises", "Quorum", "Tous les participants", "Dur\xE9e de r\xE9vision (heures)", "Autoriser le remplacement du vote en conservant le pr\xE9c\xE9dent", "Autoriser l\u2019abstention", "Les changements du processus s\u2019appliquent aux nouveaux tours. Chaque tour conserve le processus et l\u2019\xE9lectorat enregistr\xE9s \xE0 la soumission. L\u2019acc\xE8s aux brouillons change \xE0 l\u2019enregistrement.", "Enregistrer le processus", "Vous ne pouvez pas ajouter de points \xE0 l\u2019ordre du jour dans l\u2019\xE9tat actuel de cette r\xE9union.", "Chargement des r\xE9unions disponibles\u2026", "Aucune r\xE9union ouverte de ce cercle n\u2019est disponible pour vous.", "R\xE9union de destination", "S\xE9lectionner une r\xE9union", "V\xE9rification de l\u2019autorisation et de la version de la r\xE9union\u2026", "La tension sera ajout\xE9e \xE0 l\u2019ordre du jour de {meeting}. Le titre et le lien avec la source seront conserv\xE9s.", "Actualiser la r\xE9union", "Ajouter \xE0 l\u2019ordre du jour", "Envoyer la tension \xE0 l\u2019ordre du jour", "Envoyer \xE0 l\u2019ordre du jour"],
      "de-DE": ["Kein Kreis ist zum Konfigurieren des Verfahrens verf\xFCgbar.", "Aktuelles Verfahren wird geladen\u2026", "Aktuelles Verfahren:", "Konfiguration dieses Kreises", "Organisationsstandard", "Anfangsstandard", "Die Organisation erlaubt keine abweichenden lokalen Einstellungen.", "Zugriff auf Entw\xFCrfe", "Nur Autor", "Autor und Lead Links", "Kreismitglieder", "Die Berechtigung f\xFCr Lead Links ist noch nicht verf\xFCgbar. Autor- und Kreismitgliederoptionen sind verf\xFCgbar.", "Entscheidungsablauf", "Vollst\xE4ndig: vorstellen, kl\xE4ren, reagieren, Einw\xE4nde pr\xFCfen und entscheiden", "Vereinfacht: vorstellen und entscheiden", "Benutzerdefiniert \u2014 vorhandene Schritte beibehalten", "Methode", "Quorum (%)", "Erforderliche Antworten", "Quorum", "Alle Teilnehmenden", "Pr\xFCfdauer (Stunden)", "Stimme ersetzen und vorherige Stimme aufbewahren", "Enthaltung erlauben", "Verfahrens\xE4nderungen gelten f\xFCr neue Runden. Jede Runde beh\xE4lt das bei der Einreichung erfasste Verfahren und die Wahlberechtigten. Entwurfszugriff gilt nach dem Speichern.", "Verfahren speichern", "Im aktuellen Zustand dieser Sitzung k\xF6nnen Sie keine Tagesordnungspunkte hinzuf\xFCgen.", "Verf\xFCgbare Sitzungen werden geladen\u2026", "Keine offene Sitzung dieses Kreises ist f\xFCr Sie verf\xFCgbar.", "Zielsitzung", "Sitzung ausw\xE4hlen", "Berechtigung und Version der Sitzung werden gepr\xFCft\u2026", "Die Spannung wird der Tagesordnung von {meeting} hinzugef\xFCgt. Titel und Verkn\xFCpfung zur Quelle bleiben erhalten.", "Sitzung aktualisieren", "Zur Tagesordnung hinzuf\xFCgen", "Spannung zur Tagesordnung hinzuf\xFCgen", "Zur Tagesordnung"],
      "it-IT": ["Nessun cerchio \xE8 disponibile per configurare il processo.", "Caricamento del processo in vigore\u2026", "Processo in vigore:", "configurazione di questo cerchio", "valore predefinito dell\u2019organizzazione", "valore iniziale", "L\u2019organizzazione non consente configurazioni locali diverse.", "Accesso alle bozze", "Solo autore", "Autore e lead link", "Membri del cerchio", "L\u2019autorizzazione dei lead link non \xE8 ancora disponibile. Sono disponibili le opzioni autore e membri del cerchio.", "Flusso decisionale", "Completo: presentare, chiarire, reagire, obiettare e decidere", "Semplificato: presentare e decidere", "Personalizzato \u2014 conserva le fasi esistenti", "Metodo", "Quorum (%)", "Risposte richieste", "Quorum", "Tutti i partecipanti", "Durata della revisione (ore)", "Consenti di sostituire il voto conservando il precedente", "Consenti astensione", "I cambiamenti del processo valgono per i nuovi turni. Ogni turno conserva il processo e gli aventi diritto al voto registrati all\u2019invio. L\u2019accesso alle bozze cambia al salvataggio.", "Salva processo", "Non puoi aggiungere elementi all\u2019agenda di questa riunione nel suo stato attuale.", "Caricamento delle riunioni disponibili\u2026", "Nessuna riunione aperta di questo cerchio \xE8 disponibile per te.", "Riunione di destinazione", "Seleziona una riunione", "Verifica dei permessi e della versione della riunione\u2026", "La tensione sar\xE0 aggiunta all\u2019agenda di {meeting}. Il titolo e il collegamento all\u2019origine saranno conservati.", "Aggiorna riunione", "Aggiungi all\u2019agenda", "Invia tensione all\u2019agenda", "Invia all\u2019agenda"],
      "ja-JP": ["\u30D7\u30ED\u30BB\u30B9\u3092\u8A2D\u5B9A\u3067\u304D\u308B\u30B5\u30FC\u30AF\u30EB\u304C\u3042\u308A\u307E\u305B\u3093\u3002", "\u73FE\u5728\u306E\u30D7\u30ED\u30BB\u30B9\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026", "\u73FE\u5728\u306E\u30D7\u30ED\u30BB\u30B9\uFF1A", "\u3053\u306E\u30B5\u30FC\u30AF\u30EB\u306E\u8A2D\u5B9A", "\u7D44\u7E54\u306E\u65E2\u5B9A\u5024", "\u521D\u671F\u8A2D\u5B9A", "\u7D44\u7E54\u306F\u7570\u306A\u308B\u30ED\u30FC\u30AB\u30EB\u8A2D\u5B9A\u3092\u8A31\u53EF\u3057\u3066\u3044\u307E\u305B\u3093\u3002", "\u4E0B\u66F8\u304D\u3078\u306E\u30A2\u30AF\u30BB\u30B9", "\u4F5C\u6210\u8005\u306E\u307F", "\u4F5C\u6210\u8005\u3068\u30EA\u30FC\u30C9\u30EA\u30F3\u30AF", "\u30B5\u30FC\u30AF\u30EB\u306E\u30E1\u30F3\u30D0\u30FC", "\u30EA\u30FC\u30C9\u30EA\u30F3\u30AF\u306E\u6A29\u9650\u78BA\u8A8D\u306F\u307E\u3060\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u4F5C\u6210\u8005\u3068\u30B5\u30FC\u30AF\u30EB\u30E1\u30F3\u30D0\u30FC\u306E\u8A2D\u5B9A\u306F\u5229\u7528\u3067\u304D\u307E\u3059\u3002", "\u610F\u601D\u6C7A\u5B9A\u306E\u624B\u9806", "\u5B8C\u5168\uFF1A\u63D0\u793A\u3001\u78BA\u8A8D\u3001\u53CD\u5FDC\u3001\u7570\u8B70\u3001\u6C7A\u5B9A", "\u7C21\u7565\uFF1A\u63D0\u793A\u3068\u6C7A\u5B9A", "\u30AB\u30B9\u30BF\u30E0 \u2014 \u65E2\u5B58\u306E\u6BB5\u968E\u3092\u7DAD\u6301", "\u65B9\u5F0F", "\u5B9A\u8DB3\u6570\uFF08%\uFF09", "\u5FC5\u8981\u306A\u56DE\u7B54", "\u5B9A\u8DB3\u6570", "\u53C2\u52A0\u8005\u5168\u54E1", "\u5BE9\u67FB\u671F\u9593\uFF08\u6642\u9593\uFF09", "\u4EE5\u524D\u306E\u7968\u3092\u4FDD\u5B58\u3057\u3066\u6295\u7968\u306E\u5909\u66F4\u3092\u8A31\u53EF", "\u68C4\u6A29\u3092\u8A31\u53EF", "\u30D7\u30ED\u30BB\u30B9\u306E\u5909\u66F4\u306F\u65B0\u3057\u3044\u30E9\u30A6\u30F3\u30C9\u306B\u9069\u7528\u3055\u308C\u307E\u3059\u3002\u5404\u30E9\u30A6\u30F3\u30C9\u306F\u63D0\u51FA\u6642\u306E\u30D7\u30ED\u30BB\u30B9\u3068\u6709\u6A29\u8005\u3092\u7DAD\u6301\u3057\u307E\u3059\u3002\u4E0B\u66F8\u304D\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u306F\u4FDD\u5B58\u6642\u306B\u5909\u66F4\u3055\u308C\u307E\u3059\u3002", "\u30D7\u30ED\u30BB\u30B9\u3092\u4FDD\u5B58", "\u3053\u306E\u4F1A\u8B70\u306E\u73FE\u5728\u306E\u72B6\u614B\u3067\u306F\u8B70\u984C\u3092\u8FFD\u52A0\u3067\u304D\u307E\u305B\u3093\u3002", "\u5229\u7528\u53EF\u80FD\u306A\u4F1A\u8B70\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026", "\u3053\u306E\u30B5\u30FC\u30AF\u30EB\u3067\u53C2\u52A0\u53EF\u80FD\u306A\u672A\u7D42\u4E86\u306E\u4F1A\u8B70\u304C\u3042\u308A\u307E\u305B\u3093\u3002", "\u8FFD\u52A0\u5148\u306E\u4F1A\u8B70", "\u4F1A\u8B70\u3092\u9078\u629E", "\u4F1A\u8B70\u306E\u6A29\u9650\u3068\u30D0\u30FC\u30B8\u30E7\u30F3\u3092\u78BA\u8A8D\u4E2D\u2026", "\u30C6\u30F3\u30B7\u30E7\u30F3\u3092{meeting}\u306E\u8B70\u984C\u306B\u8FFD\u52A0\u3057\u307E\u3059\u3002\u30BF\u30A4\u30C8\u30EB\u3068\u5143\u306E\u8A18\u9332\u3078\u306E\u30EA\u30F3\u30AF\u306F\u7DAD\u6301\u3055\u308C\u307E\u3059\u3002", "\u4F1A\u8B70\u3092\u66F4\u65B0", "\u8B70\u984C\u306B\u8FFD\u52A0", "\u30C6\u30F3\u30B7\u30E7\u30F3\u3092\u8B70\u984C\u306B\u8FFD\u52A0", "\u8B70\u984C\u306B\u9001\u308B"],
      "nl-NL": ["Er is geen kring beschikbaar om het proces in te stellen.", "Het geldende proces wordt geladen\u2026", "Geldend proces:", "instelling van deze kring", "organisatiestandaard", "beginstandaard", "De organisatie staat geen afwijkende lokale instellingen toe.", "Toegang tot concepten", "Alleen auteur", "Auteur en lead links", "Kringleden", "Autorisatie voor lead links is nog niet beschikbaar. Opties voor auteur en kringleden zijn beschikbaar.", "Besluitvormingsverloop", "Volledig: presenteren, verduidelijken, reageren, bezwaren en besluiten", "Vereenvoudigd: presenteren en besluiten", "Aangepast \u2014 bestaande stappen behouden", "Methode", "Quorum (%)", "Vereiste antwoorden", "Quorum", "Alle deelnemers", "Beoordelingsduur (uren)", "Stem vervangen met behoud van de vorige stem toestaan", "Onthouding toestaan", "Proceswijzigingen gelden voor nieuwe rondes. Elke ronde behoudt het bij indiening vastgelegde proces en electoraat. Concepttoegang verandert bij opslaan.", "Proces opslaan", "U kunt in de huidige status van deze vergadering geen agendapunten toevoegen.", "Beschikbare vergaderingen laden\u2026", "Er zijn geen open vergaderingen van deze kring voor u beschikbaar.", "Doelvergadering", "Selecteer een vergadering", "Rechten en versie van de vergadering controleren\u2026", "De spanning wordt toegevoegd aan de agenda van {meeting}. De titel en de bronkoppeling blijven behouden.", "Vergadering vernieuwen", "Aan agenda toevoegen", "Spanning naar agenda sturen", "Naar agenda sturen"]
    };
    processMessages = Object.fromEntries(Object.entries(rows).map(([locale, values]) => {
      if (values.length !== keys2.length) throw Error("Incomplete governance process catalog: " + locale);
      return [locale, Object.fromEntries(keys2.map((key, index) => [key, values[index]]))];
    }));
    governanceProcessTranslator = (locale) => createMessageTranslator(locale, processMessages);
  }
});

// web/src/features/governance/detail-messages.ts
var keys3, rows2, detailMessages, governanceDetailTranslator;
var init_detail_messages = __esm({
  "web/src/features/governance/detail-messages.ts"() {
    "use strict";
    init_i18n();
    keys3 = ["back", "proposals", "agreements", "tensions", "branches", "process", "configureProcess", "addAgreement", "addTension", "createBranch", "addProposal", "submit", "refresh", "loading", "changes", "amend", "decisionRound", "step", "quorum", "nextStep", "recordDecision", "objections", "apply", "conflict", "appliedAt", "properties", "type", "author", "revision", "withdraw", "activity", "lockedVote", "objectionReason", "comment", "recordVote", "reviewOutcome", "humanReason", "recordOutcome", "decision", "automaticResult", "reason", "record", "voteNumber", "close", "saved"];
    rows2 = {
      "pt-BR": ["Voltar", "Propostas", "Acordos de trabalho", "Tens\xF5es", "Rascunhos de estrutura", "Processo de governan\xE7a", "Configurar processo", "Adicionar acordo", "Adicionar tens\xE3o", "Criar rascunho", "Adicionar proposta", "Submeter", "Atualizar dados", "Carregando\u2026", "Evolu\xE7\xE3o ({count})", "Revisar evolu\xE7\xE3o", "Rodada de decis\xE3o", "Etapa", "Qu\xF3rum", "Pr\xF3xima etapa", "Registrar decis\xE3o", "Obje\xE7\xF5es", "Aplicar evolu\xE7\xE3o", "Os dados de origem mudaram. Revise a evolu\xE7\xE3o e abra uma nova rodada.", "Aplica\xE7\xE3o registrada em {at}", "Propriedades", "Tipo", "Autor", "Revis\xE3o", "Retirar proposta", "Atividade", "Seu voto foi registrado. O processo desta rodada n\xE3o permite substitui\xE7\xE3o.", "Raz\xE3o da obje\xE7\xE3o", "Coment\xE1rio", "Registrar voto", "Encaminhamento", "Justificativa da avalia\xE7\xE3o humana", "Registrar encaminhamento", "Decis\xE3o", "O resultado ser\xE1 calculado conforme o qu\xF3rum, o prazo e as obje\xE7\xF5es desta rodada.", "Raz\xE3o", "Registrar", "(voto {number})", "Fechar", "Altera\xE7\xE3o registrada."],
      "en-US": ["Back", "Proposals", "Working agreements", "Tensions", "Structure drafts", "Governance process", "Configure process", "Add agreement", "Add tension", "Create draft", "Add proposal", "Submit", "Refresh data", "Loading\u2026", "Changes ({count})", "Revise changes", "Decision round", "Step", "Quorum", "Next step", "Record decision", "Objections", "Apply changes", "The source data changed. Revise the changes and open a new round.", "Application recorded on {at}", "Properties", "Type", "Author", "Revision", "Withdraw proposal", "Activity", "Your vote was recorded. This round does not allow it to be replaced.", "Reason for objection", "Comment", "Record vote", "Review outcome", "Reason for the human review", "Record review outcome", "Decision", "The result will be calculated using this round\u2019s quorum, deadline and objections.", "Reason", "Record", "(vote {number})", "Close", "Change recorded."],
      "es-ES": ["Volver", "Propuestas", "Acuerdos de trabajo", "Tensiones", "Borradores de estructura", "Proceso de gobernanza", "Configurar proceso", "A\xF1adir acuerdo", "A\xF1adir tensi\xF3n", "Crear borrador", "A\xF1adir propuesta", "Enviar", "Actualizar datos", "Cargando\u2026", "Cambios ({count})", "Revisar cambios", "Ronda de decisi\xF3n", "Etapa", "Cu\xF3rum", "Siguiente etapa", "Registrar decisi\xF3n", "Objeciones", "Aplicar cambios", "Los datos de origen cambiaron. Revisa los cambios y abre una nueva ronda.", "Aplicaci\xF3n registrada el {at}", "Propiedades", "Tipo", "Autor", "Revisi\xF3n", "Retirar propuesta", "Actividad", "Tu voto fue registrado. Esta ronda no permite sustituirlo.", "Motivo de la objeci\xF3n", "Comentario", "Registrar voto", "Resultado de la evaluaci\xF3n", "Justificaci\xF3n de la evaluaci\xF3n humana", "Registrar evaluaci\xF3n", "Decisi\xF3n", "El resultado se calcular\xE1 seg\xFAn el cu\xF3rum, el plazo y las objeciones de esta ronda.", "Motivo", "Registrar", "(voto {number})", "Cerrar", "Cambio registrado."],
      "fr-FR": ["Retour", "Propositions", "Accords de travail", "Tensions", "Brouillons de structure", "Processus de gouvernance", "Configurer le processus", "Ajouter un accord", "Ajouter une tension", "Cr\xE9er un brouillon", "Ajouter une proposition", "Soumettre", "Actualiser les donn\xE9es", "Chargement\u2026", "Modifications ({count})", "R\xE9viser les modifications", "Tour de d\xE9cision", "\xC9tape", "Quorum", "\xC9tape suivante", "Enregistrer la d\xE9cision", "Objections", "Appliquer les modifications", "Les donn\xE9es sources ont chang\xE9. R\xE9visez les modifications et ouvrez un nouveau tour.", "Application enregistr\xE9e le {at}", "Propri\xE9t\xE9s", "Type", "Auteur", "R\xE9vision", "Retirer la proposition", "Activit\xE9", "Votre vote a \xE9t\xE9 enregistr\xE9. Ce tour ne permet pas de le remplacer.", "Motif de l\u2019objection", "Commentaire", "Enregistrer le vote", "R\xE9sultat de l\u2019examen", "Motif de l\u2019examen humain", "Enregistrer l\u2019examen", "D\xE9cision", "Le r\xE9sultat sera calcul\xE9 selon le quorum, l\u2019\xE9ch\xE9ance et les objections de ce tour.", "Motif", "Enregistrer", "(vote {number})", "Fermer", "Modification enregistr\xE9e."],
      "de-DE": ["Zur\xFCck", "Vorschl\xE4ge", "Arbeitsvereinbarungen", "Spannungen", "Strukturentw\xFCrfe", "Governance-Verfahren", "Verfahren konfigurieren", "Vereinbarung hinzuf\xFCgen", "Spannung hinzuf\xFCgen", "Entwurf erstellen", "Vorschlag hinzuf\xFCgen", "Einreichen", "Daten aktualisieren", "Wird geladen\u2026", "\xC4nderungen ({count})", "\xC4nderungen \xFCberarbeiten", "Entscheidungsrunde", "Schritt", "Quorum", "N\xE4chster Schritt", "Entscheidung erfassen", "Einw\xE4nde", "\xC4nderungen anwenden", "Die Ausgangsdaten haben sich ge\xE4ndert. \xDCberarbeiten Sie die \xC4nderungen und \xF6ffnen Sie eine neue Runde.", "Anwendung erfasst am {at}", "Eigenschaften", "Typ", "Autor", "Revision", "Vorschlag zur\xFCckziehen", "Aktivit\xE4t", "Ihre Stimme wurde erfasst. Diese Runde erlaubt keinen Ersatz der Stimme.", "Grund des Einwands", "Kommentar", "Stimme erfassen", "Pr\xFCfergebnis", "Begr\xFCndung der menschlichen Pr\xFCfung", "Pr\xFCfergebnis erfassen", "Entscheidung", "Das Ergebnis wird anhand von Quorum, Frist und Einw\xE4nden dieser Runde berechnet.", "Begr\xFCndung", "Erfassen", "(Stimme {number})", "Schlie\xDFen", "\xC4nderung erfasst."],
      "it-IT": ["Indietro", "Proposte", "Accordi di lavoro", "Tensioni", "Bozze di struttura", "Processo di governance", "Configura processo", "Aggiungi accordo", "Aggiungi tensione", "Crea bozza", "Aggiungi proposta", "Invia", "Aggiorna dati", "Caricamento\u2026", "Modifiche ({count})", "Rivedi modifiche", "Turno decisionale", "Fase", "Quorum", "Fase successiva", "Registra decisione", "Obiezioni", "Applica modifiche", "I dati di origine sono cambiati. Rivedi le modifiche e apri un nuovo turno.", "Applicazione registrata il {at}", "Propriet\xE0", "Tipo", "Autore", "Revisione", "Ritira proposta", "Attivit\xE0", "Il tuo voto \xE8 stato registrato. Questo turno non consente di sostituirlo.", "Motivo dell\u2019obiezione", "Commento", "Registra voto", "Esito della valutazione", "Motivazione della valutazione umana", "Registra valutazione", "Decisione", "Il risultato sar\xE0 calcolato in base al quorum, alla scadenza e alle obiezioni di questo turno.", "Motivo", "Registra", "(voto {number})", "Chiudi", "Modifica registrata."],
      "ja-JP": ["\u623B\u308B", "\u63D0\u6848", "\u4F5C\u696D\u4E0A\u306E\u5408\u610F", "\u30C6\u30F3\u30B7\u30E7\u30F3", "\u69CB\u9020\u306E\u4E0B\u66F8\u304D", "\u30AC\u30D0\u30CA\u30F3\u30B9\u306E\u30D7\u30ED\u30BB\u30B9", "\u30D7\u30ED\u30BB\u30B9\u3092\u8A2D\u5B9A", "\u5408\u610F\u3092\u8FFD\u52A0", "\u30C6\u30F3\u30B7\u30E7\u30F3\u3092\u8FFD\u52A0", "\u4E0B\u66F8\u304D\u3092\u4F5C\u6210", "\u63D0\u6848\u3092\u8FFD\u52A0", "\u63D0\u51FA\u3059\u308B", "\u30C7\u30FC\u30BF\u3092\u66F4\u65B0", "\u8AAD\u307F\u8FBC\u307F\u4E2D\u2026", "\u5909\u66F4\uFF08{count}\u4EF6\uFF09", "\u5909\u66F4\u3092\u4FEE\u6B63", "\u610F\u601D\u6C7A\u5B9A\u30E9\u30A6\u30F3\u30C9", "\u6BB5\u968E", "\u5B9A\u8DB3\u6570", "\u6B21\u306E\u6BB5\u968E", "\u6C7A\u5B9A\u3092\u8A18\u9332", "\u7570\u8B70", "\u5909\u66F4\u3092\u9069\u7528", "\u5143\u306E\u30C7\u30FC\u30BF\u304C\u5909\u66F4\u3055\u308C\u307E\u3057\u305F\u3002\u5909\u66F4\u6848\u3092\u4FEE\u6B63\u3057\u3001\u65B0\u3057\u3044\u30E9\u30A6\u30F3\u30C9\u3092\u958B\u59CB\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u9069\u7528\u8A18\u9332\u65E5\u6642\uFF1A{at}", "\u30D7\u30ED\u30D1\u30C6\u30A3", "\u7A2E\u985E", "\u4F5C\u6210\u8005", "\u6539\u8A02", "\u63D0\u6848\u3092\u53D6\u308A\u4E0B\u3052", "\u5C65\u6B74", "\u6295\u7968\u306F\u8A18\u9332\u3055\u308C\u307E\u3057\u305F\u3002\u3053\u306E\u30E9\u30A6\u30F3\u30C9\u3067\u306F\u6295\u7968\u3092\u5909\u66F4\u3067\u304D\u307E\u305B\u3093\u3002", "\u7570\u8B70\u306E\u7406\u7531", "\u30B3\u30E1\u30F3\u30C8", "\u6295\u7968\u3092\u8A18\u9332", "\u5BE9\u67FB\u7D50\u679C", "\u4EBA\u306B\u3088\u308B\u5BE9\u67FB\u306E\u7406\u7531", "\u5BE9\u67FB\u7D50\u679C\u3092\u8A18\u9332", "\u6C7A\u5B9A", "\u3053\u306E\u30E9\u30A6\u30F3\u30C9\u306E\u5B9A\u8DB3\u6570\u3001\u671F\u9650\u3001\u7570\u8B70\u306B\u57FA\u3065\u3044\u3066\u7D50\u679C\u3092\u8A08\u7B97\u3057\u307E\u3059\u3002", "\u7406\u7531", "\u8A18\u9332\u3059\u308B", "\uFF08\u6295\u7968{number}\u56DE\u76EE\uFF09", "\u9589\u3058\u308B", "\u5909\u66F4\u3092\u8A18\u9332\u3057\u307E\u3057\u305F\u3002"],
      "nl-NL": ["Terug", "Voorstellen", "Werkafspraken", "Spanningen", "Structuurconcepten", "Governanceproces", "Proces instellen", "Afspraak toevoegen", "Spanning toevoegen", "Concept maken", "Voorstel toevoegen", "Indienen", "Gegevens vernieuwen", "Laden\u2026", "Wijzigingen ({count})", "Wijzigingen herzien", "Besluitvormingsronde", "Stap", "Quorum", "Volgende stap", "Besluit vastleggen", "Bezwaren", "Wijzigingen toepassen", "De brongegevens zijn gewijzigd. Herzie de wijzigingen en open een nieuwe ronde.", "Toepassing vastgelegd op {at}", "Eigenschappen", "Type", "Auteur", "Revisie", "Voorstel intrekken", "Activiteit", "Uw stem is vastgelegd. In deze ronde kunt u de stem niet vervangen.", "Reden voor het bezwaar", "Opmerking", "Stem vastleggen", "Beoordelingsresultaat", "Reden voor de menselijke beoordeling", "Beoordeling vastleggen", "Besluit", "Het resultaat wordt berekend op basis van het quorum, de deadline en de bezwaren van deze ronde.", "Reden", "Vastleggen", "(stem {number})", "Sluiten", "Wijziging vastgelegd."]
    };
    detailMessages = Object.fromEntries(Object.entries(rows2).map(([locale, values]) => {
      if (values.length !== keys3.length) throw Error("Incomplete governance detail catalog: " + locale);
      return [locale, Object.fromEntries(keys3.map((key, index) => [key, values[index]]))];
    }));
    governanceDetailTranslator = (locale) => createMessageTranslator(locale, detailMessages);
  }
});

// web/src/api.ts
async function request(path, options = {}) {
  const method = options.method ?? "GET";
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    if (options.body !== void 0)
      headers["Content-Type"] = "application/json";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
  }
  if (options.version !== void 0)
    headers["If-Match"] = `"${options.version}"`;
  let response;
  try {
    response = await fetch("/api/v1" + path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
      signal: options.signal
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new RequestError(
      "NETWORK_ERROR",
      "N\xE3o foi poss\xEDvel conectar ao servidor. Verifique a conex\xE3o e tente novamente."
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(
      "INVALID_RESPONSE",
      "O servidor n\xE3o respondeu como esperado. Tente novamente."
    );
  }
  if (response.status === 401 && csrf && result.error?.code === "UNAUTHENTICATED" && typeof window !== "undefined")
    window.dispatchEvent(new Event("orgmap:session-expired"));
  const blockedOrganization = credentialBlockedOrganization(path, response.status, result.error?.code);
  if (blockedOrganization && typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("orgmap:credential-required", { detail: { organizationId: blockedOrganization } }));
  if (!response.ok)
    throw new RequestError(
      result.error?.code ?? "REQUEST_FAILED",
      result.error?.message ?? "N\xE3o foi poss\xEDvel concluir a a\xE7\xE3o.",
      result.meta?.requestId
    );
  return result;
}
function credentialBlockedOrganization(path, status, code) {
  if (status !== 403 || code !== "ORG_CREDENTIAL_REQUIREMENT_UNMET") return null;
  const route = path.split("?")[0];
  const match = /^\/organizations\/([a-zA-Z0-9-]+)(?:\/|$)/.exec(route);
  return match && !route.includes("/security/attest") && !route.includes("/security/requirements") ? match[1] : null;
}
var RequestError, csrf;
var init_api = __esm({
  "web/src/api.ts"() {
    "use strict";
    RequestError = class extends Error {
      constructor(code, message, requestId) {
        super(message);
        this.code = code;
        this.requestId = requestId;
      }
      code;
      requestId;
    };
    csrf = "";
  }
});

// web/src/localization/index.tsx
var localization_exports = {};
__export(localization_exports, {
  DEFAULT_PREFERENCES: () => DEFAULT_PREFERENCES,
  LOCALE_LABELS: () => LOCALE_LABELS,
  LocalizationProvider: () => LocalizationProvider,
  SUPPORTED_LOCALES: () => SUPPORTED_LOCALES,
  catalogs: () => catalogs,
  compareText: () => compareText,
  createMessageTranslator: () => createMessageTranslator,
  createTranslator: () => createTranslator,
  dateAtInstant: () => dateAtInstant,
  formatDate: () => formatDate,
  formatError: () => formatError,
  formatInstant: () => formatInstant,
  formatNumber: () => formatNumber,
  localizationValue: () => localizationValue,
  normalizePreferences: () => normalizePreferences,
  parseDateOnly: () => parseDateOnly,
  parseInstant: () => parseInstant,
  pluralKey: () => pluralKey,
  resolveLocale: () => resolveLocale,
  useLocalization: () => useLocalization,
  validTimeZone: () => validTimeZone
});
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
function localizationValue(preferences) {
  const prefs = normalizePreferences(preferences);
  return {
    prefs,
    ...createTranslator(prefs.locale),
    formatDate: (value, options) => formatDate(value, prefs, options),
    formatInstant: (value, includeTime = true, options) => formatInstant(value, prefs, includeTime, options),
    formatNumber: (value, options) => formatNumber(value, prefs, options),
    compareText: (a, b) => compareText(a, b, prefs.locale),
    formatError: (error) => formatError(error, prefs.locale),
    dateAtInstant: (value) => dateAtInstant(value, prefs)
  };
}
function useLocalization() {
  return useContext(LocalizationContext);
}
function LocalizationProvider({ accountId, preferences, children }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ accountId: "", loading: false, error: "" });
  const controlled = preferences !== void 0;
  useEffect(() => {
    const update = () => setRevision((v) => v + 1);
    window.addEventListener("orgmap:preferences-changed", update);
    return () => window.removeEventListener("orgmap:preferences-changed", update);
  }, []);
  useEffect(() => {
    if (controlled || !accountId) return;
    const ctrl = new AbortController();
    setState((previous) => ({ accountId, preferences: previous.accountId === accountId ? previous.preferences : void 0, loading: true, error: "" }));
    request("/account/preferences", { signal: ctrl.signal }).then((result) => {
      if (!ctrl.signal.aborted) setState({ accountId, preferences: result.data.preferences, loading: false, error: "" });
    }).catch((error) => {
      if (!ctrl.signal.aborted) setState((previous) => ({ ...previous, accountId, loading: false, error }));
    });
    return () => ctrl.abort();
  }, [accountId, revision, controlled]);
  const current = controlled ? preferences : state.accountId === accountId ? state.preferences : void 0;
  const value = useMemo(() => ({ ...localizationValue(current), loading: !controlled && !!accountId && (state.accountId !== accountId || state.loading), error: !controlled && state.accountId === accountId && state.error ? formatError(state.error, current?.locale) : "", refresh: () => setRevision((v) => v + 1) }), [current, controlled, accountId, state]);
  useEffect(() => {
    const root = document.documentElement, before = root.lang;
    root.lang = value.locale;
    return () => {
      root.lang = before;
    };
  }, [value.locale]);
  return /* @__PURE__ */ jsx(LocalizationContext.Provider, { value, children });
}
var LocalizationContext;
var init_localization = __esm({
  "web/src/localization/index.tsx"() {
    "use strict";
    init_api();
    init_i18n();
    init_i18n();
    LocalizationContext = createContext({ ...localizationValue(), loading: false, error: "", refresh: () => {
    } });
  }
});

// packages/content/index.ts
function fail(path, reason) {
  throw new ContentValidationError(path, reason);
}
function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail(path, "objeto esperado");
  return value;
}
function keys4(value, allowed, path) {
  for (const k of Object.keys(value))
    if (!allowed.includes(k)) fail(`${path}.${k}`, "campo desconhecido");
}
function array(value, path, nonempty = false) {
  if (!Array.isArray(value) || nonempty && !value.length)
    fail(path, "lista inv\xE1lida");
  return value;
}
function isSafeLink(value) {
  if (typeof value !== "string" || !value || value.length > CONTENT_LIMITS.url || /[\s\u0000-\u001f\u007f<>"`\\]/u.test(value))
    return false;
  try {
    const u = new URL(value);
    if (u.protocol === "http:" || u.protocol === "https:")
      return /^https?:\/\/[^/]/i.test(value) && !!u.hostname && !u.username && !u.password;
    if (u.protocol === "mailto:") {
      const address = decodeURIComponent(u.pathname);
      return /^[^\s?@:<>"\\\u0000-\u001f\u007f]+@[^\s?@:<>"\\\u0000-\u001f\u007f]+$/u.test(
        address
      ) && !u.search && !u.hash;
    }
    return false;
  } catch {
    return false;
  }
}
function validateRichDocument(value) {
  let count = 0, chars = 0;
  const ancestors = /* @__PURE__ */ new Set();
  function node(input, parent, path, depth) {
    if (++count > CONTENT_LIMITS.nodes || depth > CONTENT_LIMITS.depth)
      fail(path, "documento excede os limites");
    if (ancestors.has(input)) fail(path, "refer\xEAncia circular");
    const n = object(input, path);
    ancestors.add(input);
    const type = n.type;
    const allowed = parent === "doc" ? ["paragraph", "bulletList", "orderedList"] : parent === "paragraph" ? ["text", "hardBreak"] : parent === "listItem" ? ["paragraph", "bulletList", "orderedList"] : ["listItem"];
    if (typeof type !== "string" || !allowed.includes(type))
      fail(`${path}.type`, "n\xF3 n\xE3o permitido");
    let out;
    if (type === "text") {
      keys4(n, ["type", "text", "marks"], path);
      if (typeof n.text !== "string" || !n.text.length || /[\u0000\ud800-\udfff]/u.test(
        n.text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "")
      ))
        fail(`${path}.text`, "texto inv\xE1lido");
      chars += n.text.length;
      if (chars > CONTENT_LIMITS.text) fail(path, "texto excede o limite");
      out = { type, text: n.text };
      if (n.marks !== void 0) {
        const seen = /* @__PURE__ */ new Set();
        const marks = array(n.marks, `${path}.marks`).map((m, i) => {
          const p = `${path}.marks[${i}]`, mark = object(m, p), t = mark.type;
          if (typeof t !== "string" || !["bold", "italic", "underline", "strike", "link"].includes(t) || seen.has(t))
            fail(p, "marca\xE7\xE3o inv\xE1lida ou duplicada");
          seen.add(t);
          keys4(mark, t === "link" ? ["type", "attrs"] : ["type"], p);
          if (t === "link") {
            const attrs = object(mark.attrs, `${p}.attrs`);
            keys4(attrs, ["href"], `${p}.attrs`);
            if (!isSafeLink(attrs.href))
              fail(`${p}.attrs.href`, "URL n\xE3o permitida");
            return { type: t, attrs: { href: attrs.href } };
          }
          return { type: t };
        });
        const order = ["bold", "italic", "underline", "strike", "link"];
        if (marks.length)
          out.marks = marks.sort(
            (a, b) => order.indexOf(a.type) - order.indexOf(b.type)
          );
      }
    } else if (type === "hardBreak") {
      keys4(n, ["type"], path);
      out = { type };
    } else {
      keys4(
        n,
        type === "orderedList" ? ["type", "content", "attrs"] : ["type", "content"],
        path
      );
      const children = n.content === void 0 && type === "paragraph" ? [] : array(n.content, `${path}.content`, type !== "paragraph");
      if (type === "listItem" && object(children[0], path).type !== "paragraph")
        fail(path, "item deve come\xE7ar com par\xE1grafo");
      out = { type };
      if (type === "orderedList") {
        const attrs = n.attrs === void 0 ? { start: 1 } : object(n.attrs, `${path}.attrs`);
        keys4(attrs, ["start"], path);
        if (!Number.isSafeInteger(attrs.start) || attrs.start < 1 || attrs.start > 1e6)
          fail(path, "in\xEDcio de lista inv\xE1lido");
        out.attrs = { start: attrs.start };
      }
      if (children.length || type !== "paragraph")
        out.content = children.map(
          (c, i) => node(c, type, `${path}.content[${i}]`, depth + 1)
        );
    }
    ancestors.delete(input);
    return out;
  }
  const root = object(value, "$");
  keys4(root, ["format", "version", "doc"], "$");
  if (root.format !== RICH_TEXT_FORMAT || root.version !== 1)
    fail("$", "formato ou vers\xE3o n\xE3o suportado");
  const doc = object(root.doc, "$.doc");
  keys4(doc, ["type", "content"], "$.doc");
  if (doc.type !== "doc") fail("$.doc.type", "doc esperado");
  const result = {
    format: RICH_TEXT_FORMAT,
    version: 1,
    doc: {
      type: "doc",
      content: array(doc.content, "$.doc.content", true).map(
        (n, i) => node(n, "doc", `$.doc.content[${i}]`, 1)
      )
    }
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > CONTENT_LIMITS.bytes)
    fail("$", "documento excede o limite em bytes");
  return result;
}
function fromPlainText(text) {
  if (typeof text !== "string") fail("$", "texto esperado");
  return validateRichDocument({
    format: RICH_TEXT_FORMAT,
    version: 1,
    doc: {
      type: "doc",
      content: text.replace(/\r\n?/g, "\n").split("\n").map((t) => ({
        type: "paragraph",
        ...t ? { content: [{ type: "text", text: t }] } : {}
      }))
    }
  });
}
function toPlainText(input) {
  const value = validateRichDocument(input);
  function text(n) {
    return n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(text).join(n.type === "paragraph" ? "" : "\n");
  }
  return value.doc.content.map(text).join("\n");
}
function serializeRichDocument(input) {
  return JSON.stringify(validateRichDocument(input));
}
function readContent(value) {
  return typeof value === "string" ? fromPlainText(value) : validateRichDocument(value);
}
var RICH_TEXT_FORMAT, CONTENT_LIMITS, ContentValidationError, emptyRichDocument;
var init_content = __esm({
  "packages/content/index.ts"() {
    "use strict";
    RICH_TEXT_FORMAT = "orgmap-richtext";
    CONTENT_LIMITS = Object.freeze({
      bytes: 1e6,
      text: 2e5,
      nodes: 1e4,
      depth: 12,
      url: 2048
    });
    ContentValidationError = class extends Error {
      constructor(path, reason) {
        super(`${path}: ${reason}`);
        this.path = path;
        this.name = "ContentValidationError";
      }
      path;
      code = "INVALID_RICH_DOCUMENT";
    };
    emptyRichDocument = () => fromPlainText("");
  }
});

// web/src/editor/extensions.ts
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { OrderedList } from "@tiptap/extension-list";
import Collaboration from "@tiptap/extension-collaboration";
function richEditorExtensions(options = {}) {
  const guard = Extension.create({
    name: "orgmapContentGuard",
    priority: 1e4,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction: (transaction) => {
            if (!transaction.docChanged) return true;
            try {
              validateRichDocument({
                format: "orgmap-richtext",
                version: 1,
                doc: transaction.doc.toJSON()
              });
              return true;
            } catch (e) {
              options.onInvalid?.(
                e instanceof Error ? e : new Error("Conte\xFAdo inv\xE1lido")
              );
              return false;
            }
          }
        })
      ];
    }
  });
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      link: false,
      orderedList: false,
      trailingNode: false,
      ...options.fragment ? { undoRedo: false } : {}
    }),
    ClosedLink,
    ClosedOrderedList,
    guard,
    ...options.fragment ? [Collaboration.configure({ fragment: options.fragment })] : []
  ];
}
var ClosedLink, ClosedOrderedList;
var init_extensions = __esm({
  "web/src/editor/extensions.ts"() {
    "use strict";
    init_content();
    ClosedLink = Link.extend({
      addAttributes() {
        return {
          href: { default: null, parseHTML: (e) => e.getAttribute("href") }
        };
      }
    }).configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: true,
      isAllowedUri: isSafeLink,
      HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null }
    });
    ClosedOrderedList = OrderedList.extend({
      addAttributes() {
        return {
          start: {
            default: 1,
            parseHTML: (e) => Number(e.getAttribute("start") ?? 1)
          }
        };
      }
    });
  }
});

// web/src/editor/RichTextView.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
function renderNode(node, key) {
  if (node.type === "text")
    return /* @__PURE__ */ jsx2("span", { children: (node.marks ?? []).reduce((text, mark) => {
      switch (mark.type) {
        case "bold":
          return /* @__PURE__ */ jsx2("strong", { children: text });
        case "italic":
          return /* @__PURE__ */ jsx2("em", { children: text });
        case "underline":
          return /* @__PURE__ */ jsx2("u", { children: text });
        case "strike":
          return /* @__PURE__ */ jsx2("s", { children: text });
        case "link":
          return /* @__PURE__ */ jsx2("a", { href: mark.attrs.href, rel: "noopener noreferrer nofollow", children: text });
      }
    }, node.text) }, key);
  const children = node.content?.map(renderNode);
  switch (node.type) {
    case "hardBreak":
      return /* @__PURE__ */ jsx2("br", {}, key);
    case "paragraph":
      return /* @__PURE__ */ jsx2("p", { children: children || /* @__PURE__ */ jsx2("br", {}) }, key);
    case "bulletList":
      return /* @__PURE__ */ jsx2("ul", { children }, key);
    case "orderedList":
      return /* @__PURE__ */ jsx2("ol", { start: node.attrs.start, children }, key);
    case "listItem":
      return /* @__PURE__ */ jsx2("li", { children }, key);
  }
}
function RichTextView({
  value,
  className = "",
  emptyText = "Sem conte\xFAdo.",
  label
}) {
  try {
    const doc = readContent(value);
    const empty = doc.doc.content.length === 1 && doc.doc.content[0].type === "paragraph" && !doc.doc.content[0].content?.length;
    return /* @__PURE__ */ jsx2("div", { className: `orgmap-rich-view ${className}`, "aria-label": label, children: empty ? /* @__PURE__ */ jsx2("p", { className: "orgmap-rich-empty", children: emptyText }) : doc.doc.content.map(renderNode) });
  } catch {
    return /* @__PURE__ */ jsx2("p", { className: "orgmap-rich-error", role: "alert", children: "Este conte\xFAdo n\xE3o p\xF4de ser aberto. Recarregue ou pe\xE7a uma vers\xE3o compat\xEDvel." });
  }
}
var init_RichTextView = __esm({
  "web/src/editor/RichTextView.tsx"() {
    "use strict";
    init_content();
  }
});

// web/src/editor/RichTextEditor.tsx
import { useEffect as useEffect2, useId, useRef, useState as useState2 } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link as Link2,
  Unlink,
  Undo2,
  Redo2
} from "lucide-react";
import { jsx as jsx3, jsxs } from "react/jsx-runtime";
function RichTextEditor(props) {
  return /* @__PURE__ */ jsx3(BoundEditor, { ...props });
}
function BoundEditor(props) {
  let initial, incomingError = "";
  try {
    initial = props.collaboration ? emptyRichDocument() : readContent(props.value ?? "");
  } catch {
    initial = emptyRichDocument();
    incomingError = "A vers\xE3o recebida \xE9 incompat\xEDvel. Seu rascunho permanece dispon\xEDvel para recupera\xE7\xE3o.";
  }
  const generatedId = useId(), id = props.id ?? `rich-${generatedId}`;
  const latest = useRef(props);
  latest.current = props;
  const initialRef = useRef(initial);
  const lastInput = useRef(serializeRichDocument(initial));
  const emissions = useRef(/* @__PURE__ */ new Map());
  const editSequence = useRef(0), acknowledgedSequence = useRef(0);
  const [localError, setLocalError] = useState2("");
  const [localConflict, setLocalConflict] = useState2(false);
  const [, rerender] = useState2(0);
  const [linkOpen, setLinkOpen] = useState2(false), [href, setHref] = useState2(""), [linkError, setLinkError] = useState2("");
  const linkInput = useRef(null), linkButton = useRef(null);
  const fragment = props.collaboration?.fragment;
  const editor = useEditor(
    {
      extensions: richEditorExtensions({
        fragment,
        onInvalid: () => queueMicrotask(
          () => setLocalError(
            "A altera\xE7\xE3o excede os limites ou cont\xE9m formata\xE7\xE3o incompat\xEDvel. O conte\xFAdo anterior foi preservado."
          )
        )
      }),
      ...fragment ? {} : { content: initialRef.current.doc },
      immediatelyRender: false,
      editable: !props.readOnly && !props.conflict && !incomingError,
      editorProps: {
        attributes: {
          id,
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": `${id}-label`,
          "aria-describedby": `${id}-status`,
          "aria-required": String(!!props.required),
          spellcheck: "true"
        }
      },
      onUpdate: ({ editor: editor2 }) => {
        try {
          const doc = validateRichDocument({
            format: "orgmap-richtext",
            version: 1,
            doc: editor2.getJSON()
          });
          const canonical = serializeRichDocument(doc);
          emissions.current.delete(canonical);
          emissions.current.set(canonical, ++editSequence.current);
          let size = [...emissions.current.keys()].reduce(
            (n, s) => n + s.length * 2,
            0
          );
          while (emissions.current.size > 64 || size > 8e6) {
            const oldest = emissions.current.keys().next().value;
            size -= oldest.length * 2;
            emissions.current.delete(oldest);
          }
          setLocalError("");
          latest.current.onChange?.(doc);
          rerender((n) => n + 1);
        } catch {
          setLocalError(
            "Conte\xFAdo incompat\xEDvel. Preserve seu rascunho e recarregue."
          );
          editor2.setEditable(false);
        }
      },
      onTransaction: () => rerender((n) => n + 1),
      onCreate: ({ editor: editor2 }) => latest.current.onReady?.(editor2)
    },
    [fragment]
  );
  useEffect2(() => {
    if (!editor || fragment || incomingError) return;
    const incoming = serializeRichDocument(initial);
    const ownSequence = emissions.current.get(incoming);
    if (ownSequence !== void 0) {
      acknowledgedSequence.current = Math.max(
        acknowledgedSequence.current,
        ownSequence
      );
      lastInput.current = incoming;
      return;
    }
    if (incoming === lastInput.current) return;
    lastInput.current = incoming;
    if (editSequence.current > acknowledgedSequence.current || props.pending || props.conflict) {
      setLocalConflict(true);
      props.onConflict?.(
        validateRichDocument({
          format: "orgmap-richtext",
          version: 1,
          doc: editor.getJSON()
        })
      );
      return;
    }
    editor.view.updateState(
      EditorState.create({
        schema: editor.schema,
        doc: editor.schema.nodeFromJSON(initial.doc),
        plugins: editor.state.plugins
      })
    );
    rerender((n) => n + 1);
  }, [initial, incomingError, editor, fragment, props.pending, props.conflict]);
  const locked = !!props.readOnly || !!props.conflict || localConflict || !!incomingError;
  useEffect2(() => {
    if (!editor) return;
    editor.setEditable(!locked, false);
    editor.setOptions({
      editorProps: {
        attributes: {
          id,
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": `${id}-label`,
          "aria-describedby": `${id}-status`,
          "aria-required": String(!!props.required),
          "aria-readonly": String(locked),
          "aria-invalid": String(!!props.error),
          "data-placeholder": props.placeholder ?? "Escreva aqui\u2026",
          spellcheck: "true"
        }
      }
    });
    if (locked) setLinkOpen(false);
  }, [
    editor,
    locked,
    id,
    props.label,
    props.placeholder,
    props.required,
    props.error
  ]);
  useEffect2(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  function toolbarKey(e) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = [
      ...e.currentTarget.querySelectorAll(
        "button:not(:disabled)"
      )
    ];
    const current = buttons.indexOf(
      document.activeElement
    );
    if (current < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (current + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  function closeLink() {
    setLinkOpen(false);
    setLinkError("");
    linkButton.current?.focus();
  }
  function applyLink() {
    if (!editor || locked) return;
    if (!isSafeLink(href)) {
      setLinkError(
        "Use uma URL completa https://, http:// ou mailto: sem dados de acesso."
      );
      return;
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      setLinkError("Selecione o texto que receber\xE1 o link.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setLinkError("");
  }
  const controls = [
    {
      name: "Negrito",
      icon: Bold,
      active: "bold",
      run: () => editor?.chain().focus().toggleBold().run(),
      shortcut: "Ctrl/\u2318 B"
    },
    {
      name: "It\xE1lico",
      icon: Italic,
      active: "italic",
      run: () => editor?.chain().focus().toggleItalic().run(),
      shortcut: "Ctrl/\u2318 I"
    },
    {
      name: "Sublinhado",
      icon: Underline,
      active: "underline",
      run: () => editor?.chain().focus().toggleUnderline().run(),
      shortcut: "Ctrl/\u2318 U"
    },
    {
      name: "Tachado",
      icon: Strikethrough,
      active: "strike",
      run: () => editor?.chain().focus().toggleStrike().run()
    },
    {
      name: "Lista com marcadores",
      icon: List,
      active: "bulletList",
      run: () => editor?.chain().focus().toggleBulletList().run()
    },
    {
      name: "Lista numerada",
      icon: ListOrdered,
      active: "orderedList",
      run: () => editor?.chain().focus().toggleOrderedList().run()
    }
  ];
  const message = incomingError || (props.conflict || localConflict ? typeof props.conflict === "string" ? props.conflict : "O conte\xFAdo mudou em outra sess\xE3o. Seu rascunho est\xE1 preservado; revise antes de recarregar." : props.error || localError || (props.pending ? "Enviando altera\xE7\xF5es\u2026" : props.readOnly ? "Somente leitura" : ""));
  const isEmpty = !editor || editor.isEmpty;
  let draft = null;
  if ((props.conflict || localConflict || incomingError) && editor) {
    try {
      draft = validateRichDocument({
        format: "orgmap-richtext",
        version: 1,
        doc: editor.getJSON()
      });
    } catch {
    }
  }
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `orgmap-rich-editor ${props.className ?? ""}`,
      "data-readonly": locked,
      "data-empty": isEmpty,
      "data-pending": !!props.pending,
      children: [
        /* @__PURE__ */ jsxs("label", { id: `${id}-label`, htmlFor: id, className: "orgmap-rich-label", children: [
          props.label,
          props.required && /* @__PURE__ */ jsx3("span", { children: " obrigat\xF3rio" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "orgmap-rich-frame", children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              className: "orgmap-rich-toolbar",
              role: "toolbar",
              "aria-label": `Formata\xE7\xE3o de ${props.label}`,
              "aria-controls": id,
              onKeyDown: toolbarKey,
              children: [
                controls.map(({ name, icon: Icon, active, run, shortcut }) => /* @__PURE__ */ jsx3(
                  "button",
                  {
                    type: "button",
                    "aria-label": name,
                    title: shortcut ? `${name} (${shortcut})` : name,
                    "aria-pressed": !!editor?.isActive(active),
                    disabled: !editor || locked,
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: run,
                    children: /* @__PURE__ */ jsx3(Icon, { size: 16, "aria-hidden": "true" })
                  },
                  name
                )),
                /* @__PURE__ */ jsx3(
                  "button",
                  {
                    ref: linkButton,
                    type: "button",
                    "aria-label": "Inserir link",
                    title: "Inserir link",
                    "aria-pressed": !!editor?.isActive("link"),
                    "aria-expanded": linkOpen,
                    "aria-controls": `${id}-link`,
                    disabled: !editor || locked,
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => {
                      setHref(editor?.getAttributes("link").href ?? "");
                      setLinkError("");
                      setLinkOpen((v) => !v);
                    },
                    children: /* @__PURE__ */ jsx3(Link2, { size: 16, "aria-hidden": "true" })
                  }
                ),
                /* @__PURE__ */ jsx3(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Remover link",
                    title: "Remover link",
                    disabled: !editor || locked || !editor.isActive("link"),
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => editor?.chain().focus().extendMarkRange("link").unsetLink().run(),
                    children: /* @__PURE__ */ jsx3(Unlink, { size: 16, "aria-hidden": "true" })
                  }
                ),
                /* @__PURE__ */ jsx3(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Desfazer",
                    title: "Desfazer (Ctrl/\u2318 Z)",
                    disabled: !editor || locked || !editor.can().undo(),
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => editor?.chain().focus().undo().run(),
                    children: /* @__PURE__ */ jsx3(Undo2, { size: 16, "aria-hidden": "true" })
                  }
                ),
                /* @__PURE__ */ jsx3(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Refazer",
                    title: "Refazer (Ctrl/\u2318 Shift Z)",
                    disabled: !editor || locked || !editor.can().redo(),
                    onMouseDown: (e) => e.preventDefault(),
                    onClick: () => editor?.chain().focus().redo().run(),
                    children: /* @__PURE__ */ jsx3(Redo2, { size: 16, "aria-hidden": "true" })
                  }
                )
              ]
            }
          ),
          linkOpen && /* @__PURE__ */ jsxs(
            "div",
            {
              id: `${id}-link`,
              className: "orgmap-rich-link",
              role: "group",
              "aria-label": "Editar link",
              onKeyDown: (e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeLink();
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyLink();
                }
              },
              children: [
                /* @__PURE__ */ jsx3("label", { htmlFor: `${id}-url`, children: "URL do link" }),
                /* @__PURE__ */ jsx3(
                  "input",
                  {
                    ref: linkInput,
                    id: `${id}-url`,
                    type: "url",
                    value: href,
                    onChange: (e) => setHref(e.target.value),
                    "aria-invalid": !!linkError,
                    "aria-describedby": linkError ? `${id}-link-error` : void 0,
                    placeholder: "https://exemplo.org",
                    autoComplete: "off"
                  }
                ),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx3(
                    "button",
                    {
                      type: "button",
                      className: "orgmap-rich-apply",
                      onClick: applyLink,
                      children: "Aplicar"
                    }
                  ),
                  /* @__PURE__ */ jsx3("button", { type: "button", onClick: closeLink, children: "Cancelar" })
                ] }),
                linkError && /* @__PURE__ */ jsx3("p", { id: `${id}-link-error`, role: "alert", children: linkError })
              ]
            }
          ),
          /* @__PURE__ */ jsx3(EditorContent, { editor, className: "orgmap-rich-content" })
        ] }),
        /* @__PURE__ */ jsx3(
          "p",
          {
            id: `${id}-status`,
            role: props.error || localError || props.conflict || localConflict || incomingError ? "alert" : "status",
            className: `orgmap-rich-status ${props.error || localError || props.conflict || localConflict || incomingError ? "orgmap-rich-error" : ""}`,
            children: message
          }
        ),
        draft && /* @__PURE__ */ jsxs("details", { className: "orgmap-rich-recovery", children: [
          /* @__PURE__ */ jsx3("summary", { children: "Rascunho preservado para recupera\xE7\xE3o" }),
          /* @__PURE__ */ jsx3(RichTextView, { value: draft }),
          /* @__PURE__ */ jsx3("label", { htmlFor: `${id}-recovery`, children: "Texto para copiar" }),
          /* @__PURE__ */ jsx3("textarea", { id: `${id}-recovery`, readOnly: true, value: toPlainText(draft) }),
          /* @__PURE__ */ jsx3(
            "button",
            {
              type: "button",
              onClick: () => {
                const url = URL.createObjectURL(
                  new Blob([serializeRichDocument(draft)], {
                    type: "application/json"
                  })
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "rascunho-orgmap-richtext-v1.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1e3);
              },
              children: "Baixar rascunho com formata\xE7\xE3o"
            }
          )
        ] })
      ]
    }
  );
}
var init_RichTextEditor = __esm({
  "web/src/editor/RichTextEditor.tsx"() {
    "use strict";
    init_content();
    init_extensions();
    init_RichTextView();
  }
});

// web/src/editor/index.ts
var init_editor = __esm({
  "web/src/editor/index.ts"() {
    "use strict";
    init_RichTextEditor();
    init_RichTextView();
    init_extensions();
  }
});

// web/src/features/governance/misc-messages.ts
function localizedGovernanceActivity(action, locale) {
  const t = governanceMiscTranslator(locale);
  return t(actions.has(action) ? action : "updated");
}
var keys5, rows3, miscMessages, governanceMiscTranslator, actions;
var init_misc_messages = __esm({
  "web/src/features/governance/misc-messages.ts"() {
    "use strict";
    init_i18n();
    keys5 = ["revisionOfChange", "current", "historical", "nominationsRegistered", "noNominations", "emptyProposals", "emptyAgreements", "emptyTensions", "emptyRecords", "firstRecordHelp", "editProcess", "actions", "createProposal", "createTask", "createGoal", "closeTension", "editDraft", "closeDraft", "editStructureDraft", "configureAgreementTypes", "createStructureDraft", "member", "ProposalCreated", "ProposalSubmitted", "ProposalRevised", "BallotRecorded", "ProposalStepChanged", "ProposalDecided", "ProposalWithdrawn", "CandidateNominated", "ObjectionReviewed", "ProposalApplicationConflicted", "StructureCommitted", "updated"];
    rows3 = {
      "pt-BR": ["Revis\xE3o da evolu\xE7\xE3o", "atual", "hist\xF3rica", "Indica\xE7\xF5es registradas", "Nenhuma indica\xE7\xE3o registrada.", "Ainda n\xE3o h\xE1 propostas", "Ainda n\xE3o h\xE1 acordos de trabalho", "Ainda n\xE3o h\xE1 tens\xF5es", "Ainda n\xE3o h\xE1 registros", "Use o bot\xE3o acima para criar o primeiro registro desta organiza\xE7\xE3o.", "Editar processo", "A\xE7\xF5es", "Criar proposta", "Criar tarefa", "Criar objetivo", "Encerrar", "Editar rascunho", "Fechar rascunho", "Editar rascunho de estrutura", "Configurar tipos de acordo", "Criar rascunho de estrutura", "Membro", "Proposta criada", "Proposta submetida", "Nova revis\xE3o registrada", "Voto registrado", "Etapa conclu\xEDda", "Decis\xE3o registrada", "Proposta retirada", "Candidato indicado", "Obje\xE7\xE3o avaliada", "Conflito na aplica\xE7\xE3o", "Evolu\xE7\xE3o aplicada", "Atualiza\xE7\xE3o registrada"],
      "en-US": ["Change revision", "current", "historical", "Recorded nominations", "No nominations recorded.", "No proposals yet", "No working agreements yet", "No tensions yet", "No records yet", "Use the button above to create the first record in this organization.", "Edit process", "Actions", "Create proposal", "Create task", "Create goal", "Close", "Edit draft", "Close draft", "Edit structure draft", "Configure agreement types", "Create structure draft", "Member", "Proposal created", "Proposal submitted", "New revision recorded", "Vote recorded", "Step completed", "Decision recorded", "Proposal withdrawn", "Candidate nominated", "Objection reviewed", "Application conflict", "Changes applied", "Update recorded"],
      "es-ES": ["Revisi\xF3n de cambios", "actual", "hist\xF3rica", "Nominaciones registradas", "No hay nominaciones registradas.", "A\xFAn no hay propuestas", "A\xFAn no hay acuerdos de trabajo", "A\xFAn no hay tensiones", "A\xFAn no hay registros", "Usa el bot\xF3n de arriba para crear el primer registro de esta organizaci\xF3n.", "Editar proceso", "Acciones", "Crear propuesta", "Crear tarea", "Crear objetivo", "Cerrar", "Editar borrador", "Cerrar borrador", "Editar borrador de estructura", "Configurar tipos de acuerdo", "Crear borrador de estructura", "Miembro", "Propuesta creada", "Propuesta enviada", "Nueva revisi\xF3n registrada", "Voto registrado", "Etapa completada", "Decisi\xF3n registrada", "Propuesta retirada", "Candidato nominado", "Objeci\xF3n evaluada", "Conflicto de aplicaci\xF3n", "Cambios aplicados", "Actualizaci\xF3n registrada"],
      "fr-FR": ["R\xE9vision des modifications", "actuelle", "historique", "Nominations enregistr\xE9es", "Aucune nomination enregistr\xE9e.", "Aucune proposition pour le moment", "Aucun accord de travail pour le moment", "Aucune tension pour le moment", "Aucune entr\xE9e pour le moment", "Utilisez le bouton ci-dessus pour cr\xE9er la premi\xE8re entr\xE9e de cette organisation.", "Modifier le processus", "Actions", "Cr\xE9er une proposition", "Cr\xE9er une t\xE2che", "Cr\xE9er un objectif", "Clore", "Modifier le brouillon", "Clore le brouillon", "Modifier le brouillon de structure", "Configurer les types d\u2019accord", "Cr\xE9er un brouillon de structure", "Membre", "Proposition cr\xE9\xE9e", "Proposition soumise", "Nouvelle r\xE9vision enregistr\xE9e", "Vote enregistr\xE9", "\xC9tape termin\xE9e", "D\xE9cision enregistr\xE9e", "Proposition retir\xE9e", "Candidat nomm\xE9", "Objection examin\xE9e", "Conflit d\u2019application", "Modifications appliqu\xE9es", "Mise \xE0 jour enregistr\xE9e"],
      "de-DE": ["\xC4nderungsrevision", "aktuell", "historisch", "Erfasste Nominierungen", "Keine Nominierungen erfasst.", "Noch keine Vorschl\xE4ge", "Noch keine Arbeitsvereinbarungen", "Noch keine Spannungen", "Noch keine Eintr\xE4ge", "Erstellen Sie \xFCber die Schaltfl\xE4che oben den ersten Eintrag dieser Organisation.", "Verfahren bearbeiten", "Aktionen", "Vorschlag erstellen", "Aufgabe erstellen", "Ziel erstellen", "Schlie\xDFen", "Entwurf bearbeiten", "Entwurf schlie\xDFen", "Strukturentwurf bearbeiten", "Vereinbarungstypen konfigurieren", "Strukturentwurf erstellen", "Mitglied", "Vorschlag erstellt", "Vorschlag eingereicht", "Neue Revision erfasst", "Stimme erfasst", "Schritt abgeschlossen", "Entscheidung erfasst", "Vorschlag zur\xFCckgezogen", "Kandidat nominiert", "Einwand gepr\xFCft", "Anwendungskonflikt", "\xC4nderungen angewendet", "Aktualisierung erfasst"],
      "it-IT": ["Revisione delle modifiche", "attuale", "storica", "Candidature registrate", "Nessuna candidatura registrata.", "Non ci sono ancora proposte", "Non ci sono ancora accordi di lavoro", "Non ci sono ancora tensioni", "Non ci sono ancora voci", "Usa il pulsante in alto per creare la prima voce di questa organizzazione.", "Modifica processo", "Azioni", "Crea proposta", "Crea attivit\xE0", "Crea obiettivo", "Chiudi", "Modifica bozza", "Chiudi bozza", "Modifica bozza di struttura", "Configura tipi di accordo", "Crea bozza di struttura", "Membro", "Proposta creata", "Proposta inviata", "Nuova revisione registrata", "Voto registrato", "Fase completata", "Decisione registrata", "Proposta ritirata", "Candidato nominato", "Obiezione valutata", "Conflitto di applicazione", "Modifiche applicate", "Aggiornamento registrato"],
      "ja-JP": ["\u5909\u66F4\u306E\u6539\u8A02", "\u73FE\u5728", "\u904E\u53BB", "\u8A18\u9332\u3055\u308C\u305F\u63A8\u85A6", "\u63A8\u85A6\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093\u3002", "\u63D0\u6848\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093", "\u4F5C\u696D\u4E0A\u306E\u5408\u610F\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093", "\u30C6\u30F3\u30B7\u30E7\u30F3\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093", "\u8A18\u9332\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093", "\u4E0A\u306E\u30DC\u30BF\u30F3\u304B\u3089\u3053\u306E\u7D44\u7E54\u306E\u6700\u521D\u306E\u8A18\u9332\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u30D7\u30ED\u30BB\u30B9\u3092\u7DE8\u96C6", "\u64CD\u4F5C", "\u63D0\u6848\u3092\u4F5C\u6210", "\u30BF\u30B9\u30AF\u3092\u4F5C\u6210", "\u76EE\u6A19\u3092\u4F5C\u6210", "\u7D42\u4E86", "\u4E0B\u66F8\u304D\u3092\u7DE8\u96C6", "\u4E0B\u66F8\u304D\u3092\u7D42\u4E86", "\u69CB\u9020\u306E\u4E0B\u66F8\u304D\u3092\u7DE8\u96C6", "\u5408\u610F\u306E\u7A2E\u985E\u3092\u8A2D\u5B9A", "\u69CB\u9020\u306E\u4E0B\u66F8\u304D\u3092\u4F5C\u6210", "\u30E1\u30F3\u30D0\u30FC", "\u63D0\u6848\u3092\u4F5C\u6210\u3057\u307E\u3057\u305F", "\u63D0\u6848\u3092\u63D0\u51FA\u3057\u307E\u3057\u305F", "\u65B0\u3057\u3044\u6539\u8A02\u3092\u8A18\u9332\u3057\u307E\u3057\u305F", "\u6295\u7968\u3092\u8A18\u9332\u3057\u307E\u3057\u305F", "\u6BB5\u968E\u3092\u5B8C\u4E86\u3057\u307E\u3057\u305F", "\u6C7A\u5B9A\u3092\u8A18\u9332\u3057\u307E\u3057\u305F", "\u63D0\u6848\u3092\u53D6\u308A\u4E0B\u3052\u307E\u3057\u305F", "\u5019\u88DC\u8005\u3092\u63A8\u85A6\u3057\u307E\u3057\u305F", "\u7570\u8B70\u3092\u5BE9\u67FB\u3057\u307E\u3057\u305F", "\u9069\u7528\u306E\u7AF6\u5408", "\u5909\u66F4\u3092\u9069\u7528\u3057\u307E\u3057\u305F", "\u66F4\u65B0\u3092\u8A18\u9332\u3057\u307E\u3057\u305F"],
      "nl-NL": ["Wijzigingsrevisie", "huidig", "historisch", "Vastgelegde nominaties", "Geen nominaties vastgelegd.", "Nog geen voorstellen", "Nog geen werkafspraken", "Nog geen spanningen", "Nog geen vermeldingen", "Gebruik de knop hierboven om de eerste vermelding in deze organisatie te maken.", "Proces bewerken", "Acties", "Voorstel maken", "Taak maken", "Doel maken", "Sluiten", "Concept bewerken", "Concept sluiten", "Structuurconcept bewerken", "Afspraaktypen instellen", "Structuurconcept maken", "Lid", "Voorstel gemaakt", "Voorstel ingediend", "Nieuwe revisie vastgelegd", "Stem vastgelegd", "Stap voltooid", "Besluit vastgelegd", "Voorstel ingetrokken", "Kandidaat genomineerd", "Bezwaar beoordeeld", "Toepassingsconflict", "Wijzigingen toegepast", "Update vastgelegd"]
    };
    miscMessages = Object.fromEntries(Object.entries(rows3).map(([locale, values]) => {
      if (values.length !== keys5.length) throw Error("Incomplete governance miscellaneous catalog: " + locale);
      return [locale, Object.fromEntries(keys5.map((key, index) => [key, values[index]]))];
    }));
    governanceMiscTranslator = (locale) => createMessageTranslator(locale, miscMessages);
    actions = new Set(keys5.slice(22, -1));
  }
});

// web/src/features/governance/form-messages.ts
var keys6, rows4, formMessages, governanceFormTranslator, isGovernanceFormMessage;
var init_form_messages = __esm({
  "web/src/features/governance/form-messages.ts"() {
    "use strict";
    init_i18n();
    keys6 = ["name", "purpose", "description", "linkedCircle", "agreementType", "noType", "publicationProcess", "directPublication", "governanceProposal", "visibility", "organization", "authorOnly", "content", "branchExact", "structureEvolution", "change", "update", "create", "move", "archive", "restore", "fieldChange", "role", "entity", "select", "field", "newValue", "empty", "yes", "no", "destination", "addChange", "removeChange", "remove", "publishAgreement", "agreement", "election", "candidate", "notChosen", "termUntil", "electedRole", "facilitatorCandidate", "chooseOnRevision", "electionHelp", "saving", "saveRevision", "saveDraft", "titleInvalid", "changeRequired", "agreementRequired", "dstFold", "dstGap", "nameRequired", "entityRequired", "fieldRequired", "nominations", "nominationReason", "recordNomination", "nominationHelp", "updateLabel", "proposedValue", "publication", "direct", "byGovernance", "createType", "activeType", "keepWorkflow", "saveType", "governance", "agreementToPublish", "termEnd", "revisionLower", "editAgreement", "publishRevision", "proposePublication", "versionHistory", "restoreRevision", "linkedTo", "notPublished", "governedPublication", "publishTitle"];
    rows4 = {
      "pt-BR": ["Nome", "Prop\xF3sito", "Descri\xE7\xE3o", "Vinculado ao c\xEDrculo", "Tipo de acordo", "Sem tipo espec\xEDfico", "Processo de publica\xE7\xE3o", "Publica\xE7\xE3o direta", "Proposta de governan\xE7a", "Visibilidade", "Organiza\xE7\xE3o", "Somente autor", "Conte\xFAdo do acordo", "As evolu\xE7\xF5es do rascunho ser\xE3o usadas exatamente como foram salvas. Edite o rascunho antes de criar a proposta para alterar a evolu\xE7\xE3o.", "Evolu\xE7\xE3o de estrutura", "Altera\xE7\xE3o", "Atualizar", "Criar", "Mover", "Arquivar", "Restaurar", "Alterar campo", "Papel", "C\xEDrculo ou papel", "Selecione", "Campo", "Novo valor", "Vazio", "Sim", "N\xE3o", "C\xEDrculo de destino", "Adicionar evolu\xE7\xE3o", "Remover evolu\xE7\xE3o {number}", "Remover", "Publica\xE7\xE3o de acordo", "Acordo", "Elei\xE7\xE3o", "Candidato", "Ainda n\xE3o escolhido", "Mandato at\xE9", "Papel eleito", "Candidato proposto pelo facilitador", "Escolher em nova revis\xE3o", "A escolha segue para consentimento; quantidade de votos n\xE3o escolhe o candidato.", "Salvando\u2026", "Salvar nova revis\xE3o", "Salvar rascunho", "O t\xEDtulo deve ter entre 1 e 200 caracteres, incluindo emojis.", "Adicione ao menos uma evolu\xE7\xE3o.", "Selecione um acordo.", "Este hor\xE1rio ocorre duas vezes na mudan\xE7a de fuso. Escolha outro hor\xE1rio para o fim do mandato.", "Este hor\xE1rio n\xE3o existe ou \xE9 inv\xE1lido no fuso da conta. Escolha outro hor\xE1rio.", "Preencha o nome.", "Selecione um c\xEDrculo ou papel.", "Selecione o campo a alterar.", "Indica\xE7\xF5es de candidatos", "Raz\xE3o da indica\xE7\xE3o", "Registrar indica\xE7\xE3o", "O facilitador escolhe um candidato na revis\xE3o da evolu\xE7\xE3o antes de submeter \xE0 rodada.", "Atualiza\xE7\xE3o", "Valor proposto", "Publica\xE7\xE3o", "Direta", "Por governan\xE7a", "Criar tipo", "Tipo ativo para cria\xE7\xE3o e publica\xE7\xE3o de acordos", "Acordos existentes preservam o processo definido na cria\xE7\xE3o.", "Salvar tipo", "Governan\xE7a", "Acordo a publicar", "Fim do mandato", "revis\xE3o", "Editar acordo", "Publicar revis\xE3o", "Propor publica\xE7\xE3o", "Hist\xF3rico de vers\xF5es", "Restaurar como nova revis\xE3o", "Vinculado a", "N\xE3o publicado", "Publica\xE7\xE3o por governan\xE7a", "Publicar {title}"],
      "en-US": ["Name", "Purpose", "Description", "Linked to circle", "Agreement type", "No specific type", "Publication process", "Direct publication", "Governance proposal", "Visibility", "Organization", "Author only", "Agreement content", "The draft changes will be used exactly as saved. Edit the draft before creating the proposal to change them.", "Structure changes", "Change", "Update", "Create", "Move", "Archive", "Restore", "Change field", "Role", "Circle or role", "Select", "Field", "New value", "Empty", "Yes", "No", "Destination circle", "Add change", "Remove change {number}", "Remove", "Agreement publication", "Agreement", "Election", "Candidate", "Not chosen yet", "Term ends on", "Elected role", "Candidate proposed by the facilitator", "Choose in a new revision", "The choice is submitted for consent; vote counts do not select the candidate.", "Saving\u2026", "Save new revision", "Save draft", "The title must contain 1 to 200 characters, including emoji.", "Add at least one change.", "Select an agreement.", "This time occurs twice during a time-zone transition. Choose another time for the end of the term.", "This time does not exist or is invalid in the account time zone. Choose another time.", "Enter a name.", "Select a circle or role.", "Select the field to change.", "Candidate nominations", "Reason for nomination", "Record nomination", "The facilitator selects a candidate in the change revision before submitting it to the round.", "Update", "Proposed value", "Publication", "Direct", "Through governance", "Create type", "Type enabled for creating and publishing agreements", "Existing agreements retain the process defined when they were created.", "Save type", "Governance", "Agreement to publish", "End of term", "revision", "Edit agreement", "Publish revision", "Propose publication", "Version history", "Restore as new revision", "Linked to", "Unpublished", "Publication through governance", "Publish {title}"],
      "es-ES": ["Nombre", "Prop\xF3sito", "Descripci\xF3n", "Vinculado al c\xEDrculo", "Tipo de acuerdo", "Sin tipo espec\xEDfico", "Proceso de publicaci\xF3n", "Publicaci\xF3n directa", "Propuesta de gobernanza", "Visibilidad", "Organizaci\xF3n", "Solo autor", "Contenido del acuerdo", "Los cambios del borrador se usar\xE1n exactamente como se guardaron. Edita el borrador antes de crear la propuesta para modificarlos.", "Cambios de estructura", "Cambio", "Actualizar", "Crear", "Mover", "Archivar", "Restaurar", "Cambiar campo", "Rol", "C\xEDrculo o rol", "Selecciona", "Campo", "Nuevo valor", "Vac\xEDo", "S\xED", "No", "C\xEDrculo de destino", "A\xF1adir cambio", "Eliminar cambio {number}", "Eliminar", "Publicaci\xF3n de acuerdo", "Acuerdo", "Elecci\xF3n", "Candidato", "A\xFAn no elegido", "Mandato hasta", "Rol electo", "Candidato propuesto por el facilitador", "Elegir en una nueva revisi\xF3n", "La elecci\xF3n pasa a consentimiento; la cantidad de votos no elige al candidato.", "Guardando\u2026", "Guardar nueva revisi\xF3n", "Guardar borrador", "El t\xEDtulo debe tener entre 1 y 200 caracteres, incluidos emojis.", "A\xF1ade al menos un cambio.", "Selecciona un acuerdo.", "Esta hora ocurre dos veces durante el cambio de zona horaria. Elige otra hora para el fin del mandato.", "Esta hora no existe o no es v\xE1lida en la zona horaria de la cuenta. Elige otra hora.", "Introduce el nombre.", "Selecciona un c\xEDrculo o rol.", "Selecciona el campo que deseas cambiar.", "Nominaciones de candidatos", "Motivo de la nominaci\xF3n", "Registrar nominaci\xF3n", "El facilitador elige un candidato en la revisi\xF3n de cambios antes de enviarla a la ronda.", "Actualizaci\xF3n", "Valor propuesto", "Publicaci\xF3n", "Directa", "Por gobernanza", "Crear tipo", "Tipo activo para crear y publicar acuerdos", "Los acuerdos existentes conservan el proceso definido al crearse.", "Guardar tipo", "Gobernanza", "Acuerdo que se publicar\xE1", "Fin del mandato", "revisi\xF3n", "Editar acuerdo", "Publicar revisi\xF3n", "Proponer publicaci\xF3n", "Historial de versiones", "Restaurar como nueva revisi\xF3n", "Vinculado a", "Sin publicar", "Publicaci\xF3n por gobernanza", "Publicar {title}"],
      "fr-FR": ["Nom", "Raison d\u2019\xEAtre", "Description", "Li\xE9 au cercle", "Type d\u2019accord", "Sans type sp\xE9cifique", "Processus de publication", "Publication directe", "Proposition de gouvernance", "Visibilit\xE9", "Organisation", "Auteur uniquement", "Contenu de l\u2019accord", "Les modifications du brouillon seront utilis\xE9es exactement comme enregistr\xE9es. Modifiez le brouillon avant de cr\xE9er la proposition pour les changer.", "Modifications de structure", "Modification", "Mettre \xE0 jour", "Cr\xE9er", "D\xE9placer", "Archiver", "Restaurer", "Modifier un champ", "R\xF4le", "Cercle ou r\xF4le", "S\xE9lectionner", "Champ", "Nouvelle valeur", "Vide", "Oui", "Non", "Cercle de destination", "Ajouter une modification", "Supprimer la modification {number}", "Supprimer", "Publication d\u2019accord", "Accord", "\xC9lection", "Candidat", "Pas encore choisi", "Mandat jusqu\u2019au", "R\xF4le \xE9lu", "Candidat propos\xE9 par le facilitateur", "Choisir dans une nouvelle r\xE9vision", "Le choix est soumis au consentement ; le nombre de votes ne s\xE9lectionne pas le candidat.", "Enregistrement\u2026", "Enregistrer une nouvelle r\xE9vision", "Enregistrer le brouillon", "Le titre doit contenir entre 1 et 200 caract\xE8res, y compris les emojis.", "Ajoutez au moins une modification.", "S\xE9lectionnez un accord.", "Cette heure appara\xEEt deux fois lors du changement de fuseau. Choisissez une autre heure de fin de mandat.", "Cette heure n\u2019existe pas ou n\u2019est pas valide dans le fuseau du compte. Choisissez une autre heure.", "Saisissez le nom.", "S\xE9lectionnez un cercle ou un r\xF4le.", "S\xE9lectionnez le champ \xE0 modifier.", "Nominations de candidats", "Motif de la nomination", "Enregistrer la nomination", "Le facilitateur choisit un candidat dans la r\xE9vision des modifications avant de la soumettre au tour.", "Mise \xE0 jour", "Valeur propos\xE9e", "Publication", "Directe", "Par gouvernance", "Cr\xE9er un type", "Type actif pour cr\xE9er et publier des accords", "Les accords existants conservent le processus d\xE9fini \xE0 leur cr\xE9ation.", "Enregistrer le type", "Gouvernance", "Accord \xE0 publier", "Fin du mandat", "r\xE9vision", "Modifier l\u2019accord", "Publier la r\xE9vision", "Proposer la publication", "Historique des versions", "Restaurer comme nouvelle r\xE9vision", "Li\xE9 \xE0", "Non publi\xE9", "Publication par gouvernance", "Publier {title}"],
      "de-DE": ["Name", "Zweck", "Beschreibung", "Mit Kreis verkn\xFCpft", "Vereinbarungstyp", "Kein bestimmter Typ", "Ver\xF6ffentlichungsverfahren", "Direkte Ver\xF6ffentlichung", "Governance-Vorschlag", "Sichtbarkeit", "Organisation", "Nur Autor", "Inhalt der Vereinbarung", "Die \xC4nderungen des Entwurfs werden genau wie gespeichert verwendet. Bearbeiten Sie den Entwurf vor dem Erstellen des Vorschlags, um sie zu \xE4ndern.", "Struktur\xE4nderungen", "\xC4nderung", "Aktualisieren", "Erstellen", "Verschieben", "Archivieren", "Wiederherstellen", "Feld \xE4ndern", "Rolle", "Kreis oder Rolle", "Ausw\xE4hlen", "Feld", "Neuer Wert", "Leer", "Ja", "Nein", "Zielkreis", "\xC4nderung hinzuf\xFCgen", "\xC4nderung {number} entfernen", "Entfernen", "Ver\xF6ffentlichung der Vereinbarung", "Vereinbarung", "Wahl", "Kandidat", "Noch nicht gew\xE4hlt", "Amtszeit bis", "Gew\xE4hlte Rolle", "Vom Moderator vorgeschlagener Kandidat", "In neuer Revision w\xE4hlen", "Die Auswahl wird zur Zustimmung vorgelegt; die Anzahl der Stimmen bestimmt nicht den Kandidaten.", "Wird gespeichert\u2026", "Neue Revision speichern", "Entwurf speichern", "Der Titel muss 1 bis 200 Zeichen einschlie\xDFlich Emojis enthalten.", "F\xFCgen Sie mindestens eine \xC4nderung hinzu.", "W\xE4hlen Sie eine Vereinbarung.", "Diese Uhrzeit tritt beim Zeitzonenwechsel zweimal auf. W\xE4hlen Sie eine andere Uhrzeit f\xFCr das Amtszeitende.", "Diese Uhrzeit existiert nicht oder ist in der Kontozeitzone ung\xFCltig. W\xE4hlen Sie eine andere Uhrzeit.", "Geben Sie einen Namen ein.", "W\xE4hlen Sie einen Kreis oder eine Rolle.", "W\xE4hlen Sie das zu \xE4ndernde Feld.", "Kandidatennominierungen", "Grund der Nominierung", "Nominierung erfassen", "Der Moderator w\xE4hlt vor der Einreichung zur Runde einen Kandidaten in der \xC4nderungsrevision.", "Aktualisierung", "Vorgeschlagener Wert", "Ver\xF6ffentlichung", "Direkt", "\xDCber Governance", "Typ erstellen", "Typ f\xFCr das Erstellen und Ver\xF6ffentlichen von Vereinbarungen aktiviert", "Bestehende Vereinbarungen behalten das bei ihrer Erstellung festgelegte Verfahren.", "Typ speichern", "Governance", "Zu ver\xF6ffentlichende Vereinbarung", "Ende der Amtszeit", "Revision", "Vereinbarung bearbeiten", "Revision ver\xF6ffentlichen", "Ver\xF6ffentlichung vorschlagen", "Versionsverlauf", "Als neue Revision wiederherstellen", "Verkn\xFCpft mit", "Nicht ver\xF6ffentlicht", "Ver\xF6ffentlichung \xFCber Governance", "{title} ver\xF6ffentlichen"],
      "it-IT": ["Nome", "Scopo", "Descrizione", "Collegato al cerchio", "Tipo di accordo", "Nessun tipo specifico", "Processo di pubblicazione", "Pubblicazione diretta", "Proposta di governance", "Visibilit\xE0", "Organizzazione", "Solo autore", "Contenuto dell\u2019accordo", "Le modifiche della bozza saranno usate esattamente come salvate. Modifica la bozza prima di creare la proposta per cambiarle.", "Modifiche alla struttura", "Modifica", "Aggiorna", "Crea", "Sposta", "Archivia", "Ripristina", "Modifica campo", "Ruolo", "Cerchio o ruolo", "Seleziona", "Campo", "Nuovo valore", "Vuoto", "S\xEC", "No", "Cerchio di destinazione", "Aggiungi modifica", "Rimuovi modifica {number}", "Rimuovi", "Pubblicazione dell\u2019accordo", "Accordo", "Elezione", "Candidato", "Non ancora scelto", "Mandato fino al", "Ruolo eletto", "Candidato proposto dal facilitatore", "Scegli in una nuova revisione", "La scelta viene sottoposta al consenso; il numero di voti non seleziona il candidato.", "Salvataggio\u2026", "Salva nuova revisione", "Salva bozza", "Il titolo deve contenere da 1 a 200 caratteri, incluse le emoji.", "Aggiungi almeno una modifica.", "Seleziona un accordo.", "Questo orario si ripete due volte durante il cambio di fuso. Scegli un altro orario per la fine del mandato.", "Questo orario non esiste o non \xE8 valido nel fuso del conto. Scegli un altro orario.", "Inserisci il nome.", "Seleziona un cerchio o ruolo.", "Seleziona il campo da modificare.", "Candidature", "Motivo della candidatura", "Registra candidatura", "Il facilitatore sceglie un candidato nella revisione delle modifiche prima di inviarla al turno.", "Aggiornamento", "Valore proposto", "Pubblicazione", "Diretta", "Tramite governance", "Crea tipo", "Tipo attivo per creare e pubblicare accordi", "Gli accordi esistenti mantengono il processo definito alla creazione.", "Salva tipo", "Governance", "Accordo da pubblicare", "Fine del mandato", "revisione", "Modifica accordo", "Pubblica revisione", "Proponi pubblicazione", "Cronologia delle versioni", "Ripristina come nuova revisione", "Collegato a", "Non pubblicato", "Pubblicazione tramite governance", "Pubblica {title}"],
      "ja-JP": ["\u540D\u524D", "\u76EE\u7684", "\u8AAC\u660E", "\u95A2\u9023\u3059\u308B\u30B5\u30FC\u30AF\u30EB", "\u5408\u610F\u306E\u7A2E\u985E", "\u7A2E\u985E\u306E\u6307\u5B9A\u306A\u3057", "\u516C\u958B\u30D7\u30ED\u30BB\u30B9", "\u76F4\u63A5\u516C\u958B", "\u30AC\u30D0\u30CA\u30F3\u30B9\u306E\u63D0\u6848", "\u516C\u958B\u7BC4\u56F2", "\u7D44\u7E54", "\u4F5C\u6210\u8005\u306E\u307F", "\u5408\u610F\u306E\u5185\u5BB9", "\u4E0B\u66F8\u304D\u306E\u5909\u66F4\u306F\u4FDD\u5B58\u3055\u308C\u305F\u3068\u304A\u308A\u306B\u4F7F\u7528\u3055\u308C\u307E\u3059\u3002\u5909\u66F4\u3059\u308B\u306B\u306F\u63D0\u6848\u306E\u4F5C\u6210\u524D\u306B\u4E0B\u66F8\u304D\u3092\u7DE8\u96C6\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u69CB\u9020\u306E\u5909\u66F4", "\u5909\u66F4", "\u66F4\u65B0", "\u4F5C\u6210", "\u79FB\u52D5", "\u30A2\u30FC\u30AB\u30A4\u30D6", "\u5FA9\u5143", "\u30D5\u30A3\u30FC\u30EB\u30C9\u3092\u5909\u66F4", "\u30ED\u30FC\u30EB", "\u30B5\u30FC\u30AF\u30EB\u307E\u305F\u306F\u30ED\u30FC\u30EB", "\u9078\u629E", "\u30D5\u30A3\u30FC\u30EB\u30C9", "\u65B0\u3057\u3044\u5024", "\u7A7A", "\u306F\u3044", "\u3044\u3044\u3048", "\u79FB\u52D5\u5148\u306E\u30B5\u30FC\u30AF\u30EB", "\u5909\u66F4\u3092\u8FFD\u52A0", "\u5909\u66F4{number}\u3092\u524A\u9664", "\u524A\u9664", "\u5408\u610F\u306E\u516C\u958B", "\u5408\u610F", "\u9078\u6319", "\u5019\u88DC\u8005", "\u672A\u9078\u629E", "\u4EFB\u671F\u7D42\u4E86", "\u9078\u51FA\u3055\u308C\u305F\u30ED\u30FC\u30EB", "\u30D5\u30A1\u30B7\u30EA\u30C6\u30FC\u30BF\u30FC\u304C\u63D0\u6848\u3059\u308B\u5019\u88DC\u8005", "\u65B0\u3057\u3044\u6539\u8A02\u3067\u9078\u629E", "\u5019\u88DC\u8005\u306F\u540C\u610F\u306B\u4ED8\u3055\u308C\u307E\u3059\u3002\u7968\u6570\u3067\u5019\u88DC\u8005\u3092\u9078\u3076\u308F\u3051\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002", "\u4FDD\u5B58\u4E2D\u2026", "\u65B0\u3057\u3044\u6539\u8A02\u3092\u4FDD\u5B58", "\u4E0B\u66F8\u304D\u3092\u4FDD\u5B58", "\u30BF\u30A4\u30C8\u30EB\u306F\u7D75\u6587\u5B57\u3092\u542B\u3081\u30661\u301C200\u6587\u5B57\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u5909\u66F4\u30921\u4EF6\u4EE5\u4E0A\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u5408\u610F\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3\u306E\u5207\u66FF\u3067\u3053\u306E\u6642\u523B\u306F2\u56DE\u767A\u751F\u3057\u307E\u3059\u3002\u4EFB\u671F\u7D42\u4E86\u306E\u6642\u523B\u3092\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u6642\u523B\u306F\u5B58\u5728\u3057\u306A\u3044\u304B\u3001\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u30BF\u30A4\u30E0\u30BE\u30FC\u30F3\u3067\u306F\u7121\u52B9\u3067\u3059\u3002\u5225\u306E\u6642\u523B\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u540D\u524D\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u30B5\u30FC\u30AF\u30EB\u307E\u305F\u306F\u30ED\u30FC\u30EB\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u5909\u66F4\u3059\u308B\u30D5\u30A3\u30FC\u30EB\u30C9\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u5019\u88DC\u8005\u306E\u63A8\u85A6", "\u63A8\u85A6\u306E\u7406\u7531", "\u63A8\u85A6\u3092\u8A18\u9332", "\u30D5\u30A1\u30B7\u30EA\u30C6\u30FC\u30BF\u30FC\u306F\u30E9\u30A6\u30F3\u30C9\u3078\u306E\u63D0\u51FA\u524D\u306B\u3001\u5909\u66F4\u306E\u6539\u8A02\u3067\u5019\u88DC\u8005\u3092\u9078\u629E\u3057\u307E\u3059\u3002", "\u66F4\u65B0", "\u63D0\u6848\u3055\u308C\u305F\u5024", "\u516C\u958B", "\u76F4\u63A5", "\u30AC\u30D0\u30CA\u30F3\u30B9\u7D4C\u7531", "\u7A2E\u985E\u3092\u4F5C\u6210", "\u5408\u610F\u306E\u4F5C\u6210\u3068\u516C\u958B\u306B\u3053\u306E\u7A2E\u985E\u3092\u4F7F\u7528\u3067\u304D\u308B", "\u65E2\u5B58\u306E\u5408\u610F\u306F\u4F5C\u6210\u6642\u306B\u8A2D\u5B9A\u3055\u308C\u305F\u30D7\u30ED\u30BB\u30B9\u3092\u7DAD\u6301\u3057\u307E\u3059\u3002", "\u7A2E\u985E\u3092\u4FDD\u5B58", "\u30AC\u30D0\u30CA\u30F3\u30B9", "\u516C\u958B\u3059\u308B\u5408\u610F", "\u4EFB\u671F\u7D42\u4E86", "\u6539\u8A02", "\u5408\u610F\u3092\u7DE8\u96C6", "\u6539\u8A02\u3092\u516C\u958B", "\u516C\u958B\u3092\u63D0\u6848", "\u30D0\u30FC\u30B8\u30E7\u30F3\u5C65\u6B74", "\u65B0\u3057\u3044\u6539\u8A02\u3068\u3057\u3066\u5FA9\u5143", "\u95A2\u9023\u5148", "\u672A\u516C\u958B", "\u30AC\u30D0\u30CA\u30F3\u30B9\u306B\u3088\u308B\u516C\u958B", "{title}\u3092\u516C\u958B"],
      "nl-NL": ["Naam", "Doel", "Beschrijving", "Gekoppeld aan kring", "Afspraaktype", "Geen specifiek type", "Publicatieproces", "Directe publicatie", "Governancevoorstel", "Zichtbaarheid", "Organisatie", "Alleen auteur", "Inhoud van de afspraak", "De conceptwijzigingen worden precies gebruikt zoals opgeslagen. Bewerk het concept v\xF3\xF3r het maken van het voorstel om ze te wijzigen.", "Structuurwijzigingen", "Wijziging", "Bijwerken", "Maken", "Verplaatsen", "Archiveren", "Herstellen", "Veld wijzigen", "Rol", "Kring of rol", "Selecteren", "Veld", "Nieuwe waarde", "Leeg", "Ja", "Nee", "Doelkring", "Wijziging toevoegen", "Wijziging {number} verwijderen", "Verwijderen", "Publicatie van afspraak", "Afspraak", "Verkiezing", "Kandidaat", "Nog niet gekozen", "Termijn tot", "Gekozen rol", "Door de facilitator voorgestelde kandidaat", "Kiezen in een nieuwe revisie", "De keuze wordt ter instemming voorgelegd; het aantal stemmen kiest de kandidaat niet.", "Opslaan\u2026", "Nieuwe revisie opslaan", "Concept opslaan", "De titel moet 1 tot 200 tekens bevatten, inclusief emoji.", "Voeg minstens \xE9\xE9n wijziging toe.", "Selecteer een afspraak.", "Dit tijdstip komt tweemaal voor bij de tijdzonewisseling. Kies een ander tijdstip voor het einde van de termijn.", "Dit tijdstip bestaat niet of is ongeldig in de tijdzone van het account. Kies een ander tijdstip.", "Voer een naam in.", "Selecteer een kring of rol.", "Selecteer het te wijzigen veld.", "Kandidaatnominaties", "Reden voor nominatie", "Nominatie vastleggen", "De facilitator kiest een kandidaat in de wijzigingsrevisie v\xF3\xF3r indiening bij de ronde.", "Update", "Voorgestelde waarde", "Publicatie", "Direct", "Via governance", "Type maken", "Type actief voor het maken en publiceren van afspraken", "Bestaande afspraken behouden het bij aanmaak vastgelegde proces.", "Type opslaan", "Governance", "Te publiceren afspraak", "Einde van termijn", "revisie", "Afspraak bewerken", "Revisie publiceren", "Publicatie voorstellen", "Versiegeschiedenis", "Als nieuwe revisie herstellen", "Gekoppeld aan", "Niet gepubliceerd", "Publicatie via governance", "{title} publiceren"]
    };
    formMessages = Object.fromEntries(Object.entries(rows4).map(([locale, values]) => {
      if (values.length !== keys6.length) throw Error("Incomplete governance form catalog: " + locale + " " + values.length + "/" + keys6.length);
      return [locale, Object.fromEntries(keys6.map((key, index) => [key, values[index]]))];
    }));
    governanceFormTranslator = (locale) => createMessageTranslator(locale, formMessages);
    isGovernanceFormMessage = (value) => typeof value === "string" && Object.hasOwn(formMessages["pt-BR"], value);
  }
});

// web/src/features/governance/list-messages.ts
var keys7, rows5, listMessages, governanceListTranslator;
var init_list_messages = __esm({
  "web/src/features/governance/list-messages.ts"() {
    "use strict";
    init_i18n();
    keys7 = ["view", "list", "cards", "search", "searchTitle", "statusFilter", "allStatuses", "sort", "newest", "oldest", "nameAZ", "group", "stateGroup", "circleGroup", "noGroup", "quick", "open", "adopted", "rejected", "mine", "myCircles", "waiting", "clear", "allProposals", "title", "circle", "evolutions", "state", "created", "votes", "yourVote", "deadline", "vote", "noResults", "adjustFilters", "configTypes"];
    rows5 = {
      "pt-BR": ["Visualiza\xE7\xE3o das propostas", "Lista", "Cart\xF5es", "Pesquisar", "Pesquisar por t\xEDtulo", "Filtrar por estado", "Todos os estados", "Ordenar propostas", "Mais recentes", "Mais antigas", "T\xEDtulo A\u2013Z", "Agrupar propostas", "Agrupar por estado", "Agrupar por c\xEDrculo", "Sem agrupamento", "Filtros r\xE1pidos", "Propostas em aberto", "Adotadas", "Recusadas", "Minhas propostas", "Meus c\xEDrculos", "Aguardando meu voto", "Limpar filtros", "Todas as propostas", "T\xEDtulo", "C\xEDrculo", "Evolu\xE7\xF5es", "Estado", "Criada em", "Votos", "O seu voto", "Prazo", "Votar", "Nenhum resultado", "Altere os filtros para consultar outros registros.", "Configurar tipos"],
      "en-US": ["Proposal view", "List", "Cards", "Search", "Search by title", "Filter by status", "All statuses", "Sort proposals", "Newest first", "Oldest first", "Title A\u2013Z", "Group proposals", "Group by status", "Group by circle", "No grouping", "Quick filters", "Open proposals", "Adopted", "Rejected", "My proposals", "My circles", "Awaiting my vote", "Clear filters", "All proposals", "Title", "Circle", "Changes", "Status", "Created on", "Votes", "Your vote", "Deadline", "Vote", "No results", "Change the filters to view other records.", "Configure types"],
      "es-ES": ["Vista de propuestas", "Lista", "Tarjetas", "Buscar", "Buscar por t\xEDtulo", "Filtrar por estado", "Todos los estados", "Ordenar propuestas", "M\xE1s recientes", "M\xE1s antiguas", "T\xEDtulo A\u2013Z", "Agrupar propuestas", "Agrupar por estado", "Agrupar por c\xEDrculo", "Sin agrupar", "Filtros r\xE1pidos", "Propuestas abiertas", "Adoptadas", "Rechazadas", "Mis propuestas", "Mis c\xEDrculos", "Esperando mi voto", "Borrar filtros", "Todas las propuestas", "T\xEDtulo", "C\xEDrculo", "Cambios", "Estado", "Creada el", "Votos", "Tu voto", "Plazo", "Votar", "Sin resultados", "Cambia los filtros para consultar otros registros.", "Configurar tipos"],
      "fr-FR": ["Vue des propositions", "Liste", "Cartes", "Rechercher", "Rechercher par titre", "Filtrer par statut", "Tous les statuts", "Trier les propositions", "Plus r\xE9centes", "Plus anciennes", "Titre A\u2013Z", "Regrouper les propositions", "Regrouper par statut", "Regrouper par cercle", "Sans regroupement", "Filtres rapides", "Propositions ouvertes", "Adopt\xE9es", "Rejet\xE9es", "Mes propositions", "Mes cercles", "En attente de mon vote", "Effacer les filtres", "Toutes les propositions", "Titre", "Cercle", "Modifications", "Statut", "Cr\xE9\xE9e le", "Votes", "Votre vote", "\xC9ch\xE9ance", "Voter", "Aucun r\xE9sultat", "Modifiez les filtres pour consulter d\u2019autres entr\xE9es.", "Configurer les types"],
      "de-DE": ["Vorschlagsansicht", "Liste", "Karten", "Suchen", "Nach Titel suchen", "Nach Status filtern", "Alle Status", "Vorschl\xE4ge sortieren", "Neueste zuerst", "\xC4lteste zuerst", "Titel A\u2013Z", "Vorschl\xE4ge gruppieren", "Nach Status gruppieren", "Nach Kreis gruppieren", "Keine Gruppierung", "Schnellfilter", "Offene Vorschl\xE4ge", "Angenommen", "Abgelehnt", "Meine Vorschl\xE4ge", "Meine Kreise", "Meine Stimme ausstehend", "Filter l\xF6schen", "Alle Vorschl\xE4ge", "Titel", "Kreis", "\xC4nderungen", "Status", "Erstellt am", "Stimmen", "Ihre Stimme", "Frist", "Abstimmen", "Keine Ergebnisse", "\xC4ndern Sie die Filter, um andere Eintr\xE4ge anzuzeigen.", "Typen konfigurieren"],
      "it-IT": ["Vista delle proposte", "Elenco", "Schede", "Cerca", "Cerca per titolo", "Filtra per stato", "Tutti gli stati", "Ordina proposte", "Pi\xF9 recenti", "Meno recenti", "Titolo A\u2013Z", "Raggruppa proposte", "Raggruppa per stato", "Raggruppa per cerchio", "Nessun raggruppamento", "Filtri rapidi", "Proposte aperte", "Adottate", "Rifiutate", "Le mie proposte", "I miei cerchi", "In attesa del mio voto", "Cancella filtri", "Tutte le proposte", "Titolo", "Cerchio", "Modifiche", "Stato", "Creata il", "Voti", "Il tuo voto", "Scadenza", "Vota", "Nessun risultato", "Modifica i filtri per consultare altri record.", "Configura tipi"],
      "ja-JP": ["\u63D0\u6848\u306E\u8868\u793A", "\u30EA\u30B9\u30C8", "\u30AB\u30FC\u30C9", "\u691C\u7D22", "\u30BF\u30A4\u30C8\u30EB\u3067\u691C\u7D22", "\u72B6\u614B\u3067\u7D5E\u308A\u8FBC\u3080", "\u3059\u3079\u3066\u306E\u72B6\u614B", "\u63D0\u6848\u3092\u4E26\u3079\u66FF\u3048", "\u65B0\u3057\u3044\u9806", "\u53E4\u3044\u9806", "\u30BF\u30A4\u30C8\u30EB\u9806", "\u63D0\u6848\u3092\u30B0\u30EB\u30FC\u30D7\u5316", "\u72B6\u614B\u3067\u30B0\u30EB\u30FC\u30D7\u5316", "\u30B5\u30FC\u30AF\u30EB\u3067\u30B0\u30EB\u30FC\u30D7\u5316", "\u30B0\u30EB\u30FC\u30D7\u5316\u306A\u3057", "\u30AF\u30A4\u30C3\u30AF\u30D5\u30A3\u30EB\u30BF\u30FC", "\u672A\u6C7A\u306E\u63D0\u6848", "\u63A1\u7528\u6E08\u307F", "\u5374\u4E0B\u6E08\u307F", "\u81EA\u5206\u306E\u63D0\u6848", "\u81EA\u5206\u306E\u30B5\u30FC\u30AF\u30EB", "\u81EA\u5206\u306E\u6295\u7968\u5F85\u3061", "\u30D5\u30A3\u30EB\u30BF\u30FC\u3092\u89E3\u9664", "\u3059\u3079\u3066\u306E\u63D0\u6848", "\u30BF\u30A4\u30C8\u30EB", "\u30B5\u30FC\u30AF\u30EB", "\u5909\u66F4", "\u72B6\u614B", "\u4F5C\u6210\u65E5", "\u6295\u7968", "\u81EA\u5206\u306E\u7968", "\u671F\u9650", "\u6295\u7968\u3059\u308B", "\u7D50\u679C\u304C\u3042\u308A\u307E\u305B\u3093", "\u4ED6\u306E\u8A18\u9332\u3092\u8868\u793A\u3059\u308B\u306B\u306F\u30D5\u30A3\u30EB\u30BF\u30FC\u3092\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u7A2E\u985E\u3092\u8A2D\u5B9A"],
      "nl-NL": ["Voorstelweergave", "Lijst", "Kaarten", "Zoeken", "Zoeken op titel", "Filteren op status", "Alle statussen", "Voorstellen sorteren", "Nieuwste eerst", "Oudste eerst", "Titel A\u2013Z", "Voorstellen groeperen", "Groeperen op status", "Groeperen op kring", "Niet groeperen", "Snelfilters", "Open voorstellen", "Aangenomen", "Afgewezen", "Mijn voorstellen", "Mijn kringen", "Wacht op mijn stem", "Filters wissen", "Alle voorstellen", "Titel", "Kring", "Wijzigingen", "Status", "Aangemaakt op", "Stemmen", "Uw stem", "Deadline", "Stemmen", "Geen resultaten", "Wijzig de filters om andere vermeldingen te bekijken.", "Typen instellen"]
    };
    listMessages = Object.fromEntries(Object.entries(rows5).map(([locale, values]) => {
      if (values.length !== keys7.length) throw Error("Incomplete governance list catalog: " + locale);
      return [locale, Object.fromEntries(keys7.map((key, index) => [key, values[index]]))];
    }));
    governanceListTranslator = (locale) => createMessageTranslator(locale, listMessages);
  }
});

// web/src/features/governance/count-messages.ts
function formatGovernanceCount(value, kind, locale) {
  const resolved = resolveLocale(locale);
  const singular = value !== 0 && pluralKey(value, resolved) === "one";
  return messages2[resolved][kind][singular ? 0 : 1].replace("{count}", formatNumber(value, { locale: resolved }));
}
var messages2;
var init_count_messages = __esm({
  "web/src/features/governance/count-messages.ts"() {
    "use strict";
    init_i18n();
    messages2 = {
      "pt-BR": { proposals: ["{count} proposta", "{count} propostas"], documents: ["{count} acordo", "{count} acordos"], tensions: ["{count} tens\xE3o", "{count} tens\xF5es"], records: ["{count} registro", "{count} registros"], evolutions: ["{count} evolu\xE7\xE3o", "{count} evolu\xE7\xF5es"], participants: ["{count} participante", "{count} participantes"] },
      "en-US": { proposals: ["{count} proposal", "{count} proposals"], documents: ["{count} agreement", "{count} agreements"], tensions: ["{count} tension", "{count} tensions"], records: ["{count} record", "{count} records"], evolutions: ["{count} change", "{count} changes"], participants: ["{count} participant", "{count} participants"] },
      "es-ES": { proposals: ["{count} propuesta", "{count} propuestas"], documents: ["{count} acuerdo", "{count} acuerdos"], tensions: ["{count} tensi\xF3n", "{count} tensiones"], records: ["{count} registro", "{count} registros"], evolutions: ["{count} cambio", "{count} cambios"], participants: ["{count} participante", "{count} participantes"] },
      "fr-FR": { proposals: ["{count} proposition", "{count} propositions"], documents: ["{count} accord", "{count} accords"], tensions: ["{count} tension", "{count} tensions"], records: ["{count} entr\xE9e", "{count} entr\xE9es"], evolutions: ["{count} modification", "{count} modifications"], participants: ["{count} participant", "{count} participants"] },
      "de-DE": { proposals: ["{count} Vorschlag", "{count} Vorschl\xE4ge"], documents: ["{count} Vereinbarung", "{count} Vereinbarungen"], tensions: ["{count} Spannung", "{count} Spannungen"], records: ["{count} Eintrag", "{count} Eintr\xE4ge"], evolutions: ["{count} \xC4nderung", "{count} \xC4nderungen"], participants: ["{count} teilnehmende Person", "{count} teilnehmende Personen"] },
      "it-IT": { proposals: ["{count} proposta", "{count} proposte"], documents: ["{count} accordo", "{count} accordi"], tensions: ["{count} tensione", "{count} tensioni"], records: ["{count} voce", "{count} voci"], evolutions: ["{count} modifica", "{count} modifiche"], participants: ["{count} partecipante", "{count} partecipanti"] },
      "ja-JP": { proposals: ["\u63D0\u6848{count}\u4EF6", "\u63D0\u6848{count}\u4EF6"], documents: ["\u5408\u610F{count}\u4EF6", "\u5408\u610F{count}\u4EF6"], tensions: ["\u30C6\u30F3\u30B7\u30E7\u30F3{count}\u4EF6", "\u30C6\u30F3\u30B7\u30E7\u30F3{count}\u4EF6"], records: ["\u8A18\u9332{count}\u4EF6", "\u8A18\u9332{count}\u4EF6"], evolutions: ["\u5909\u66F4{count}\u4EF6", "\u5909\u66F4{count}\u4EF6"], participants: ["\u53C2\u52A0\u8005{count}\u4EBA", "\u53C2\u52A0\u8005{count}\u4EBA"] },
      "nl-NL": { proposals: ["{count} voorstel", "{count} voorstellen"], documents: ["{count} afspraak", "{count} afspraken"], tensions: ["{count} spanning", "{count} spanningen"], records: ["{count} vermelding", "{count} vermeldingen"], evolutions: ["{count} wijziging", "{count} wijzigingen"], participants: ["{count} deelnemer", "{count} deelnemers"] }
    };
  }
});

// web/src/features/governance/state-messages.ts
function useGovernanceLocalization() {
  const regional = useLocalization();
  const translate = createMessageTranslator(regional.locale, stateMessages);
  return { ...regional, m: governanceMiscTranslator(regional.locale), p: governanceProcessTranslator(regional.locale), f: governanceFormTranslator(regional.locale), d: governanceDetailTranslator(regional.locale), ui: governanceListTranslator(regional.locale), countLabel: (value, kind) => formatGovernanceCount(value, kind, regional.locale), label: (value) => value ? Object.hasOwn(stateMessages["pt-BR"], value) ? translate(value) : value : "\u2014" };
}
var stateMessages;
var init_state_messages = __esm({
  "web/src/features/governance/state-messages.ts"() {
    "use strict";
    init_misc_messages();
    init_process_messages();
    init_form_messages();
    init_detail_messages();
    init_list_messages();
    init_localization();
    init_count_messages();
    stateMessages = {
      "pt-BR": {
        "PRESENT": "Apresenta\xE7\xE3o",
        "CLARIFY": "Perguntas de esclarecimento",
        "REACT": "Rea\xE7\xF5es",
        "DECIDE": "Decis\xE3o",
        "DRAFT": "Rascunho",
        "REVIEW": "Em decis\xE3o",
        "DECIDED": "Decidida",
        "WITHDRAWN": "Retirada",
        "OPEN": "Aberta",
        "PROCESSED": "Processada",
        "CLOSED": "Encerrada",
        "ADOPT": "Adotada",
        "REJECT": "Rejeitada",
        "REVIEW_REQUIRED": "Requer revis\xE3o",
        "APPLIED": "Aplicada",
        "APPLY_CONFLICT": "Conflito na aplica\xE7\xE3o",
        "PENDING": "Aplica\xE7\xE3o pendente",
        "CONSENT": "Consentimento",
        "ABSTAIN": "Absten\xE7\xE3o",
        "OBJECT": "Obje\xE7\xE3o",
        "RAISED": "Apresentada",
        "TESTING": "Em teste",
        "VALID": "V\xE1lida",
        "INTEGRATED": "Integrada",
        "INVALID": "Inv\xE1lida",
        "GOVERNANCE": "Evolu\xE7\xE3o de estrutura",
        "DOCUMENT": "Acordo de trabalho",
        "ELECTION": "Elei\xE7\xE3o",
        "MANUAL_FACILITATED": "Processo facilitado",
        "CONSENT_ROUND": "Rodada de consentimento",
        "CONSENT_WINDOW": "Janela de consentimento"
      },
      "en-US": {
        "PRESENT": "Presentation",
        "CLARIFY": "Clarifying questions",
        "REACT": "Reactions",
        "DECIDE": "Decision",
        "DRAFT": "Draft",
        "REVIEW": "Under review",
        "DECIDED": "Decided",
        "WITHDRAWN": "Withdrawn",
        "OPEN": "Open",
        "PROCESSED": "Processed",
        "CLOSED": "Closed",
        "ADOPT": "Adopted",
        "REJECT": "Rejected",
        "REVIEW_REQUIRED": "Review required",
        "APPLIED": "Applied",
        "APPLY_CONFLICT": "Application conflict",
        "PENDING": "Application pending",
        "CONSENT": "Consent",
        "ABSTAIN": "Abstention",
        "OBJECT": "Objection",
        "RAISED": "Raised",
        "TESTING": "Testing",
        "VALID": "Valid",
        "INTEGRATED": "Integrated",
        "INVALID": "Invalid",
        "GOVERNANCE": "Structure change",
        "DOCUMENT": "Working agreement",
        "ELECTION": "Election",
        "MANUAL_FACILITATED": "Facilitated process",
        "CONSENT_ROUND": "Consent round",
        "CONSENT_WINDOW": "Consent window"
      },
      "es-ES": {
        "PRESENT": "Presentaci\xF3n",
        "CLARIFY": "Preguntas aclaratorias",
        "REACT": "Reacciones",
        "DECIDE": "Decisi\xF3n",
        "DRAFT": "Borrador",
        "REVIEW": "En decisi\xF3n",
        "DECIDED": "Decidida",
        "WITHDRAWN": "Retirada",
        "OPEN": "Abierta",
        "PROCESSED": "Procesada",
        "CLOSED": "Cerrada",
        "ADOPT": "Adoptada",
        "REJECT": "Rechazada",
        "REVIEW_REQUIRED": "Requiere revisi\xF3n",
        "APPLIED": "Aplicada",
        "APPLY_CONFLICT": "Conflicto de aplicaci\xF3n",
        "PENDING": "Aplicaci\xF3n pendiente",
        "CONSENT": "Consentimiento",
        "ABSTAIN": "Abstenci\xF3n",
        "OBJECT": "Objeci\xF3n",
        "RAISED": "Presentada",
        "TESTING": "En prueba",
        "VALID": "V\xE1lida",
        "INTEGRATED": "Integrada",
        "INVALID": "Inv\xE1lida",
        "GOVERNANCE": "Cambio de estructura",
        "DOCUMENT": "Acuerdo de trabajo",
        "ELECTION": "Elecci\xF3n",
        "MANUAL_FACILITATED": "Proceso facilitado",
        "CONSENT_ROUND": "Ronda de consentimiento",
        "CONSENT_WINDOW": "Plazo de consentimiento"
      },
      "fr-FR": {
        "PRESENT": "Pr\xE9sentation",
        "CLARIFY": "Questions de clarification",
        "REACT": "R\xE9actions",
        "DECIDE": "D\xE9cision",
        "DRAFT": "Brouillon",
        "REVIEW": "En d\xE9lib\xE9ration",
        "DECIDED": "D\xE9cid\xE9e",
        "WITHDRAWN": "Retir\xE9e",
        "OPEN": "Ouverte",
        "PROCESSED": "Trait\xE9e",
        "CLOSED": "Cl\xF4tur\xE9e",
        "ADOPT": "Adopt\xE9e",
        "REJECT": "Rejet\xE9e",
        "REVIEW_REQUIRED": "R\xE9vision requise",
        "APPLIED": "Appliqu\xE9e",
        "APPLY_CONFLICT": "Conflit d\u2019application",
        "PENDING": "Application en attente",
        "CONSENT": "Consentement",
        "ABSTAIN": "Abstention",
        "OBJECT": "Objection",
        "RAISED": "Soulev\xE9e",
        "TESTING": "En examen",
        "VALID": "Valide",
        "INTEGRATED": "Int\xE9gr\xE9e",
        "INVALID": "Non valide",
        "GOVERNANCE": "Modification de structure",
        "DOCUMENT": "Accord de travail",
        "ELECTION": "\xC9lection",
        "MANUAL_FACILITATED": "Processus facilit\xE9",
        "CONSENT_ROUND": "Tour de consentement",
        "CONSENT_WINDOW": "D\xE9lai de consentement"
      },
      "de-DE": {
        "PRESENT": "Vorstellung",
        "CLARIFY": "Verst\xE4ndnisfragen",
        "REACT": "Reaktionen",
        "DECIDE": "Entscheidung",
        "DRAFT": "Entwurf",
        "REVIEW": "In Entscheidung",
        "DECIDED": "Entschieden",
        "WITHDRAWN": "Zur\xFCckgezogen",
        "OPEN": "Offen",
        "PROCESSED": "Bearbeitet",
        "CLOSED": "Geschlossen",
        "ADOPT": "Angenommen",
        "REJECT": "Abgelehnt",
        "REVIEW_REQUIRED": "\xDCberarbeitung erforderlich",
        "APPLIED": "Angewendet",
        "APPLY_CONFLICT": "Anwendungskonflikt",
        "PENDING": "Anwendung ausstehend",
        "CONSENT": "Zustimmung",
        "ABSTAIN": "Enthaltung",
        "OBJECT": "Einwand",
        "RAISED": "Vorgebracht",
        "TESTING": "In Pr\xFCfung",
        "VALID": "G\xFCltig",
        "INTEGRATED": "Integriert",
        "INVALID": "Ung\xFCltig",
        "GOVERNANCE": "Struktur\xE4nderung",
        "DOCUMENT": "Arbeitsvereinbarung",
        "ELECTION": "Wahl",
        "MANUAL_FACILITATED": "Moderiertes Verfahren",
        "CONSENT_ROUND": "Zustimmungsrunde",
        "CONSENT_WINDOW": "Zustimmungsfrist"
      },
      "it-IT": {
        "PRESENT": "Presentazione",
        "CLARIFY": "Domande di chiarimento",
        "REACT": "Reazioni",
        "DECIDE": "Decisione",
        "DRAFT": "Bozza",
        "REVIEW": "In decisione",
        "DECIDED": "Decisa",
        "WITHDRAWN": "Ritirata",
        "OPEN": "Aperta",
        "PROCESSED": "Elaborata",
        "CLOSED": "Chiusa",
        "ADOPT": "Adottata",
        "REJECT": "Respinta",
        "REVIEW_REQUIRED": "Revisione necessaria",
        "APPLIED": "Applicata",
        "APPLY_CONFLICT": "Conflitto di applicazione",
        "PENDING": "Applicazione in attesa",
        "CONSENT": "Consenso",
        "ABSTAIN": "Astensione",
        "OBJECT": "Obiezione",
        "RAISED": "Presentata",
        "TESTING": "In esame",
        "VALID": "Valida",
        "INTEGRATED": "Integrata",
        "INVALID": "Non valida",
        "GOVERNANCE": "Modifica della struttura",
        "DOCUMENT": "Accordo di lavoro",
        "ELECTION": "Elezione",
        "MANUAL_FACILITATED": "Processo facilitato",
        "CONSENT_ROUND": "Turno di consenso",
        "CONSENT_WINDOW": "Periodo di consenso"
      },
      "ja-JP": {
        "PRESENT": "\u63D0\u6848\u8AAC\u660E",
        "CLARIFY": "\u78BA\u8A8D\u306E\u8CEA\u554F",
        "REACT": "\u53CD\u5FDC",
        "DECIDE": "\u6C7A\u5B9A",
        "DRAFT": "\u4E0B\u66F8\u304D",
        "REVIEW": "\u5BE9\u8B70\u4E2D",
        "DECIDED": "\u6C7A\u5B9A\u6E08\u307F",
        "WITHDRAWN": "\u53D6\u308A\u4E0B\u3052\u6E08\u307F",
        "OPEN": "\u672A\u51E6\u7406",
        "PROCESSED": "\u51E6\u7406\u6E08\u307F",
        "CLOSED": "\u7D42\u4E86",
        "ADOPT": "\u63A1\u7528",
        "REJECT": "\u5374\u4E0B",
        "REVIEW_REQUIRED": "\u4FEE\u6B63\u304C\u5FC5\u8981",
        "APPLIED": "\u9069\u7528\u6E08\u307F",
        "APPLY_CONFLICT": "\u9069\u7528\u306E\u7AF6\u5408",
        "PENDING": "\u9069\u7528\u5F85\u3061",
        "CONSENT": "\u540C\u610F",
        "ABSTAIN": "\u68C4\u6A29",
        "OBJECT": "\u7570\u8B70",
        "RAISED": "\u63D0\u8D77\u6E08\u307F",
        "TESTING": "\u691C\u8A0E\u4E2D",
        "VALID": "\u6709\u52B9",
        "INTEGRATED": "\u7D71\u5408\u6E08\u307F",
        "INVALID": "\u7121\u52B9",
        "GOVERNANCE": "\u7D44\u7E54\u69CB\u9020\u306E\u5909\u66F4",
        "DOCUMENT": "\u696D\u52D9\u4E0A\u306E\u5408\u610F",
        "ELECTION": "\u9078\u6319",
        "MANUAL_FACILITATED": "\u9032\u884C\u5F79\u306B\u3088\u308B\u30D7\u30ED\u30BB\u30B9",
        "CONSENT_ROUND": "\u540C\u610F\u30E9\u30A6\u30F3\u30C9",
        "CONSENT_WINDOW": "\u540C\u610F\u671F\u9593"
      },
      "nl-NL": {
        "PRESENT": "Presentatie",
        "CLARIFY": "Verhelderende vragen",
        "REACT": "Reacties",
        "DECIDE": "Besluit",
        "DRAFT": "Concept",
        "REVIEW": "In besluitvorming",
        "DECIDED": "Besloten",
        "WITHDRAWN": "Ingetrokken",
        "OPEN": "Open",
        "PROCESSED": "Verwerkt",
        "CLOSED": "Gesloten",
        "ADOPT": "Aangenomen",
        "REJECT": "Afgewezen",
        "REVIEW_REQUIRED": "Herziening nodig",
        "APPLIED": "Toegepast",
        "APPLY_CONFLICT": "Toepassingsconflict",
        "PENDING": "Toepassing in afwachting",
        "CONSENT": "Instemming",
        "ABSTAIN": "Onthouding",
        "OBJECT": "Bezwaar",
        "RAISED": "Ingebracht",
        "TESTING": "In onderzoek",
        "VALID": "Geldig",
        "INTEGRATED": "Ge\xEFntegreerd",
        "INVALID": "Ongeldig",
        "GOVERNANCE": "Structuurwijziging",
        "DOCUMENT": "Werkafspraak",
        "ELECTION": "Verkiezing",
        "MANUAL_FACILITATED": "Begeleid proces",
        "CONSENT_ROUND": "Instemmingsronde",
        "CONSENT_WINDOW": "Instemmingsperiode"
      }
    };
  }
});

// web/src/features/governance/error-messages.ts
function governanceError(error, locale) {
  if (error instanceof RequestError && Object.hasOwn(errorMessages["pt-BR"], error.code)) return createMessageTranslator(locale, errorMessages)(error.code);
  return formatError(error, locale);
}
var keys8, rows6, errorMessages;
var init_error_messages = __esm({
  "web/src/features/governance/error-messages.ts"() {
    "use strict";
    init_i18n();
    init_api();
    keys8 = ["INVALID_RICH_DOCUMENT", "INVALID_PURPOSE_RICH", "INVALID_PURPOSE", "PURPOSE_TEXT_MISMATCH", "DOCUMENT_CONTENT_REQUIRED", "DRAFT_LEAD_LINK_SERVICE_REQUIRED", "GOVERNANCE_OVERRIDE_DENIED", "GOVERNANCE_POLICY_RECONCILIATION_REQUIRED", "DOCUMENT_TYPE_INACTIVE", "ACTIVE_PROPOSAL", "ROLE_NOT_ELECTABLE", "GOAL_PERIOD_SELECTION_REQUIRED", "ELECTION_CANDIDATE_REQUIRED", "WORKFLOW_INCOMPLETE", "CONSENT_REQUIREMENTS_UNMET", "ROUND_DEADLINE_PASSED", "ALREADY_VOTED", "STRUCTURE_APPLIER_REQUIRED", "FIELD_APPLIER_REQUIRED", "ELECTION_APPLIER_REQUIRED", "TENSION_TARGET_SERVICE_REQUIRED"];
    rows6 = {
      "pt-BR": ["O conte\xFAdo cont\xE9m uma formata\xE7\xE3o ou link n\xE3o permitido. Revise o texto antes de salvar.", "O prop\xF3sito cont\xE9m uma formata\xE7\xE3o ou link n\xE3o permitido. Revise o texto antes de salvar.", "O prop\xF3sito deve ter at\xE9 10.000 caracteres.", "O texto do prop\xF3sito diverge do conte\xFAdo formatado. Reabra a altera\xE7\xE3o e tente novamente.", "Inclua o conte\xFAdo do acordo antes de salvar.", "A autoriza\xE7\xE3o de elos principais ainda n\xE3o est\xE1 dispon\xEDvel nesta organiza\xE7\xE3o. Escolha outra pol\xEDtica de rascunhos por enquanto.", "A pol\xEDtica da organiza\xE7\xE3o n\xE3o permite um processo local diferente. Use a configura\xE7\xE3o organizacional.", "H\xE1 processos locais em conflito com a pol\xEDtica da organiza\xE7\xE3o. Reconcilie as configura\xE7\xF5es antes de abrir uma nova rodada.", "O tipo deste acordo est\xE1 inativo. Reative o tipo para publicar uma revis\xE3o.", "Existe uma proposta ativa vinculada. Conclua ou retire a proposta antes de encerrar este registro.", "Este papel ainda n\xE3o est\xE1 configurado como eleg\xEDvel para elei\xE7\xE3o. Revise suas propriedades.", "Configure um \xFAnico per\xEDodo ativo em Objetivos antes de encaminhar esta tens\xE3o.", "O facilitador precisa selecionar um candidato antes da submiss\xE3o.", "Conclua as etapas da rodada antes de registrar a decis\xE3o.", "A rodada ainda precisa das respostas exigidas ou da integra\xE7\xE3o das obje\xE7\xF5es.", "O prazo desta rodada terminou. Atualize a proposta para acompanhar a decis\xE3o.", "Seu voto j\xE1 foi registrado e esta rodada n\xE3o permite substitui\xE7\xE3o.", "A aplica\xE7\xE3o estrutural ainda n\xE3o est\xE1 dispon\xEDvel nesta instala\xE7\xE3o.", "A aplica\xE7\xE3o de campos ainda n\xE3o est\xE1 dispon\xEDvel nesta instala\xE7\xE3o.", "A aplica\xE7\xE3o do mandato ainda n\xE3o est\xE1 dispon\xEDvel nesta instala\xE7\xE3o.", "O encaminhamento desta tens\xE3o ainda n\xE3o est\xE1 dispon\xEDvel nesta instala\xE7\xE3o."],
      "en-US": ["The content contains unsupported formatting or a disallowed link. Review it before saving.", "The purpose contains unsupported formatting or a disallowed link. Review it before saving.", "The purpose must contain at most 10,000 characters.", "The purpose text differs from the formatted content. Reopen the change and try again.", "Add the agreement content before saving.", "Lead-link authorization is not yet available in this organization. Choose another draft-access policy for now.", "The organization policy does not allow a different local process. Use the organization settings.", "Local processes conflict with the organization policy. Reconcile the settings before opening a new round.", "This agreement type is inactive. Reactivate it to publish a revision.", "An active proposal is linked. Complete or withdraw it before closing this record.", "This role is not yet configured as eligible for election. Review its properties.", "Configure a single active period in Goals before forwarding this tension.", "The facilitator must select a candidate before submission.", "Complete the round\u2019s steps before recording the decision.", "The round still requires the necessary responses or integration of objections.", "The deadline for this round has passed. Refresh the proposal to follow the decision.", "Your vote is already recorded and this round does not allow replacement.", "Structure application is not yet available in this installation.", "Field application is not yet available in this installation.", "Term application is not yet available in this installation.", "Forwarding this tension is not yet available in this installation."],
      "es-ES": ["El contenido incluye formato o un enlace no permitido. Rev\xEDsalo antes de guardar.", "El prop\xF3sito incluye formato o un enlace no permitido. Rev\xEDsalo antes de guardar.", "El prop\xF3sito debe tener como m\xE1ximo 10.000 caracteres.", "El texto del prop\xF3sito difiere del contenido con formato. Reabre el cambio y reintenta.", "A\xF1ade el contenido del acuerdo antes de guardar.", "La autorizaci\xF3n de enlaces principales a\xFAn no est\xE1 disponible en esta organizaci\xF3n. Elige otra pol\xEDtica de borradores por ahora.", "La pol\xEDtica de la organizaci\xF3n no permite un proceso local diferente. Usa la configuraci\xF3n de la organizaci\xF3n.", "Hay procesos locales en conflicto con la pol\xEDtica de la organizaci\xF3n. Concilia los ajustes antes de abrir una nueva ronda.", "Este tipo de acuerdo est\xE1 inactivo. React\xEDvalo para publicar una revisi\xF3n.", "Hay una propuesta activa vinculada. Compl\xE9tala o ret\xEDrala antes de cerrar este registro.", "Este rol a\xFAn no es elegible para una elecci\xF3n. Revisa sus propiedades.", "Configura un \xFAnico per\xEDodo activo en Objetivos antes de derivar esta tensi\xF3n.", "El facilitador debe seleccionar un candidato antes del env\xEDo.", "Completa las etapas de la ronda antes de registrar la decisi\xF3n.", "La ronda a\xFAn requiere las respuestas exigidas o la integraci\xF3n de objeciones.", "El plazo de esta ronda termin\xF3. Actualiza la propuesta para seguir la decisi\xF3n.", "Tu voto ya est\xE1 registrado y esta ronda no permite sustituirlo.", "La aplicaci\xF3n de estructura a\xFAn no est\xE1 disponible en esta instalaci\xF3n.", "La aplicaci\xF3n de campos a\xFAn no est\xE1 disponible en esta instalaci\xF3n.", "La aplicaci\xF3n del mandato a\xFAn no est\xE1 disponible en esta instalaci\xF3n.", "La derivaci\xF3n de esta tensi\xF3n a\xFAn no est\xE1 disponible en esta instalaci\xF3n."],
      "fr-FR": ["Le contenu comporte une mise en forme ou un lien non autoris\xE9. V\xE9rifiez-le avant d\u2019enregistrer.", "La raison d\u2019\xEAtre comporte une mise en forme ou un lien non autoris\xE9. V\xE9rifiez-la avant d\u2019enregistrer.", "La raison d\u2019\xEAtre doit contenir au plus 10 000 caract\xE8res.", "Le texte de la raison d\u2019\xEAtre diff\xE8re du contenu format\xE9. Rouvrez la modification et r\xE9essayez.", "Ajoutez le contenu de l\u2019accord avant d\u2019enregistrer.", "L\u2019autorisation des premiers liens n\u2019est pas encore disponible dans cette organisation. Choisissez une autre politique de brouillons pour le moment.", "La politique de l\u2019organisation n\u2019autorise pas de processus local diff\xE9rent. Utilisez les param\xE8tres de l\u2019organisation.", "Des processus locaux sont en conflit avec la politique de l\u2019organisation. R\xE9conciliez les param\xE8tres avant d\u2019ouvrir un nouveau tour.", "Ce type d\u2019accord est inactif. R\xE9activez-le pour publier une r\xE9vision.", "Une proposition active est li\xE9e. Terminez-la ou retirez-la avant de clore cette entr\xE9e.", "Ce r\xF4le n\u2019est pas encore configur\xE9 pour \xEAtre \xE9lu. V\xE9rifiez ses propri\xE9t\xE9s.", "Configurez une seule p\xE9riode active dans Objectifs avant de transmettre cette tension.", "Le facilitateur doit choisir un candidat avant la soumission.", "Terminez les \xE9tapes du tour avant d\u2019enregistrer la d\xE9cision.", "Le tour n\xE9cessite encore les r\xE9ponses requises ou l\u2019int\xE9gration des objections.", "L\u2019\xE9ch\xE9ance de ce tour est pass\xE9e. Actualisez la proposition pour suivre la d\xE9cision.", "Votre vote est d\xE9j\xE0 enregistr\xE9 et ce tour n\u2019autorise pas son remplacement.", "L\u2019application de la structure n\u2019est pas encore disponible dans cette installation.", "L\u2019application des champs n\u2019est pas encore disponible dans cette installation.", "L\u2019application du mandat n\u2019est pas encore disponible dans cette installation.", "La transmission de cette tension n\u2019est pas encore disponible dans cette installation."],
      "de-DE": ["Der Inhalt enth\xE4lt unzul\xE4ssige Formatierung oder einen unzul\xE4ssigen Link. Pr\xFCfen Sie ihn vor dem Speichern.", "Der Zweck enth\xE4lt unzul\xE4ssige Formatierung oder einen unzul\xE4ssigen Link. Pr\xFCfen Sie ihn vor dem Speichern.", "Der Zweck darf h\xF6chstens 10.000 Zeichen enthalten.", "Der Zwecktext weicht vom formatierten Inhalt ab. \xD6ffnen Sie die \xC4nderung erneut und versuchen Sie es noch einmal.", "F\xFCgen Sie vor dem Speichern den Inhalt der Vereinbarung hinzu.", "Die Lead-Link-Berechtigung ist in dieser Organisation noch nicht verf\xFCgbar. W\xE4hlen Sie vorerst eine andere Entwurfsrichtlinie.", "Die Organisationsrichtlinie erlaubt kein abweichendes lokales Verfahren. Verwenden Sie die Organisationseinstellungen.", "Lokale Verfahren widersprechen der Organisationsrichtlinie. Gleichen Sie die Einstellungen vor einer neuen Runde ab.", "Dieser Vereinbarungstyp ist inaktiv. Aktivieren Sie ihn erneut, um eine Revision zu ver\xF6ffentlichen.", "Ein aktiver Vorschlag ist verkn\xFCpft. Schlie\xDFen Sie ihn ab oder ziehen Sie ihn vor dem Schlie\xDFen dieses Eintrags zur\xFCck.", "Diese Rolle ist noch nicht als w\xE4hlbar konfiguriert. Pr\xFCfen Sie ihre Eigenschaften.", "Konfigurieren Sie einen einzigen aktiven Zeitraum unter Ziele, bevor Sie diese Spannung weiterleiten.", "Der Moderator muss vor der Einreichung einen Kandidaten w\xE4hlen.", "Schlie\xDFen Sie die Rundenschritte ab, bevor Sie die Entscheidung erfassen.", "Der Runde fehlen noch erforderliche Antworten oder die Integration der Einw\xE4nde.", "Die Frist dieser Runde ist abgelaufen. Aktualisieren Sie den Vorschlag, um die Entscheidung zu verfolgen.", "Ihre Stimme ist bereits erfasst und kann in dieser Runde nicht ersetzt werden.", "Die Strukturanwendung ist in dieser Installation noch nicht verf\xFCgbar.", "Die Feldanwendung ist in dieser Installation noch nicht verf\xFCgbar.", "Die Anwendung der Amtszeit ist in dieser Installation noch nicht verf\xFCgbar.", "Die Weiterleitung dieser Spannung ist in dieser Installation noch nicht verf\xFCgbar."],
      "it-IT": ["Il contenuto include una formattazione o un collegamento non consentito. Controllalo prima di salvare.", "Lo scopo include una formattazione o un collegamento non consentito. Controllalo prima di salvare.", "Lo scopo deve contenere al massimo 10.000 caratteri.", "Il testo dello scopo differisce dal contenuto formattato. Riapri la modifica e riprova.", "Aggiungi il contenuto dell\u2019accordo prima di salvare.", "L\u2019autorizzazione dei lead link non \xE8 ancora disponibile in questa organizzazione. Scegli per ora un\u2019altra politica per le bozze.", "La politica dell\u2019organizzazione non consente un processo locale diverso. Usa le impostazioni dell\u2019organizzazione.", "I processi locali sono in conflitto con la politica dell\u2019organizzazione. Riconcilia le impostazioni prima di aprire un nuovo turno.", "Questo tipo di accordo \xE8 inattivo. Riattivalo per pubblicare una revisione.", "\xC8 collegata una proposta attiva. Completala o ritirala prima di chiudere questa voce.", "Questo ruolo non \xE8 ancora configurato come eleggibile. Controlla le sue propriet\xE0.", "Configura un solo periodo attivo in Obiettivi prima di inoltrare questa tensione.", "Il facilitatore deve scegliere un candidato prima dell\u2019invio.", "Completa le fasi del turno prima di registrare la decisione.", "Il turno richiede ancora le risposte necessarie o l\u2019integrazione delle obiezioni.", "La scadenza di questo turno \xE8 passata. Aggiorna la proposta per seguire la decisione.", "Il tuo voto \xE8 gi\xE0 registrato e questo turno non consente di sostituirlo.", "L\u2019applicazione della struttura non \xE8 ancora disponibile in questa installazione.", "L\u2019applicazione dei campi non \xE8 ancora disponibile in questa installazione.", "L\u2019applicazione del mandato non \xE8 ancora disponibile in questa installazione.", "L\u2019inoltro di questa tensione non \xE8 ancora disponibile in questa installazione."],
      "ja-JP": ["\u5185\u5BB9\u306B\u8A31\u53EF\u3055\u308C\u3066\u3044\u306A\u3044\u66F8\u5F0F\u307E\u305F\u306F\u30EA\u30F3\u30AF\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\u3002\u4FDD\u5B58\u524D\u306B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u76EE\u7684\u306B\u8A31\u53EF\u3055\u308C\u3066\u3044\u306A\u3044\u66F8\u5F0F\u307E\u305F\u306F\u30EA\u30F3\u30AF\u304C\u542B\u307E\u308C\u3066\u3044\u307E\u3059\u3002\u4FDD\u5B58\u524D\u306B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u76EE\u7684\u306F10,000\u6587\u5B57\u4EE5\u5185\u3067\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u76EE\u7684\u306E\u30C6\u30AD\u30B9\u30C8\u3068\u66F8\u5F0F\u4ED8\u304D\u306E\u5185\u5BB9\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002\u5909\u66F4\u3092\u958B\u304D\u76F4\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u4FDD\u5B58\u3059\u308B\u524D\u306B\u5408\u610F\u306E\u5185\u5BB9\u3092\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u7D44\u7E54\u3067\u306F\u30EA\u30FC\u30C9\u30EA\u30F3\u30AF\u306E\u6A29\u9650\u78BA\u8A8D\u304C\u307E\u3060\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u5225\u306E\u4E0B\u66F8\u304D\u30DD\u30EA\u30B7\u30FC\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u7D44\u7E54\u306E\u30DD\u30EA\u30B7\u30FC\u306F\u7570\u306A\u308B\u30ED\u30FC\u30AB\u30EB\u30D7\u30ED\u30BB\u30B9\u3092\u8A31\u53EF\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u7D44\u7E54\u306E\u8A2D\u5B9A\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u30ED\u30FC\u30AB\u30EB\u30D7\u30ED\u30BB\u30B9\u304C\u7D44\u7E54\u306E\u30DD\u30EA\u30B7\u30FC\u3068\u7AF6\u5408\u3057\u3066\u3044\u307E\u3059\u3002\u65B0\u3057\u3044\u30E9\u30A6\u30F3\u30C9\u3092\u958B\u59CB\u3059\u308B\u524D\u306B\u8A2D\u5B9A\u3092\u8ABF\u6574\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u5408\u610F\u306E\u7A2E\u985E\u306F\u7121\u52B9\u3067\u3059\u3002\u6539\u8A02\u3092\u516C\u958B\u3059\u308B\u306B\u306F\u518D\u3073\u6709\u52B9\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u6709\u52B9\u306A\u63D0\u6848\u304C\u95A2\u9023\u4ED8\u3051\u3089\u308C\u3066\u3044\u307E\u3059\u3002\u3053\u306E\u8A18\u9332\u3092\u7D42\u4E86\u3059\u308B\u524D\u306B\u63D0\u6848\u3092\u5B8C\u4E86\u3059\u308B\u304B\u53D6\u308A\u4E0B\u3052\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u30ED\u30FC\u30EB\u306F\u307E\u3060\u9078\u51FA\u53EF\u80FD\u306B\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u30D7\u30ED\u30D1\u30C6\u30A3\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u30C6\u30F3\u30B7\u30E7\u30F3\u3092\u9001\u308B\u524D\u306B\u3001\u76EE\u6A19\u3067\u6709\u52B9\u306A\u671F\u9593\u30921\u3064\u3060\u3051\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u63D0\u51FA\u524D\u306B\u30D5\u30A1\u30B7\u30EA\u30C6\u30FC\u30BF\u30FC\u304C\u5019\u88DC\u8005\u3092\u9078\u629E\u3059\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\u3002", "\u6C7A\u5B9A\u3092\u8A18\u9332\u3059\u308B\u524D\u306B\u30E9\u30A6\u30F3\u30C9\u306E\u6BB5\u968E\u3092\u5B8C\u4E86\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u3053\u306E\u30E9\u30A6\u30F3\u30C9\u306B\u306F\u5FC5\u8981\u306A\u56DE\u7B54\u307E\u305F\u306F\u7570\u8B70\u306E\u7D71\u5408\u304C\u307E\u3060\u5FC5\u8981\u3067\u3059\u3002", "\u3053\u306E\u30E9\u30A6\u30F3\u30C9\u306E\u671F\u9650\u306F\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002\u63D0\u6848\u3092\u66F4\u65B0\u3057\u3066\u6C7A\u5B9A\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002", "\u6295\u7968\u306F\u65E2\u306B\u8A18\u9332\u3055\u308C\u3066\u304A\u308A\u3001\u3053\u306E\u30E9\u30A6\u30F3\u30C9\u3067\u306F\u5909\u66F4\u3067\u304D\u307E\u305B\u3093\u3002", "\u3053\u306E\u74B0\u5883\u3067\u306F\u69CB\u9020\u306E\u9069\u7528\u304C\u307E\u3060\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002", "\u3053\u306E\u74B0\u5883\u3067\u306F\u30D5\u30A3\u30FC\u30EB\u30C9\u306E\u9069\u7528\u304C\u307E\u3060\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002", "\u3053\u306E\u74B0\u5883\u3067\u306F\u4EFB\u671F\u306E\u9069\u7528\u304C\u307E\u3060\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002", "\u3053\u306E\u74B0\u5883\u3067\u306F\u30C6\u30F3\u30B7\u30E7\u30F3\u306E\u9001\u4FE1\u304C\u307E\u3060\u5229\u7528\u3067\u304D\u307E\u305B\u3093\u3002"],
      "nl-NL": ["De inhoud bevat niet-toegestane opmaak of een link. Controleer deze v\xF3\xF3r het opslaan.", "Het doel bevat niet-toegestane opmaak of een link. Controleer het v\xF3\xF3r het opslaan.", "Het doel mag maximaal 10.000 tekens bevatten.", "De doeltekst wijkt af van de opgemaakte inhoud. Open de wijziging opnieuw en probeer het nogmaals.", "Voeg de inhoud van de afspraak toe v\xF3\xF3r het opslaan.", "Autorisatie voor lead links is nog niet beschikbaar in deze organisatie. Kies voorlopig een ander conceptbeleid.", "Het organisatiebeleid staat geen afwijkend lokaal proces toe. Gebruik de organisatie-instellingen.", "Lokale processen zijn in conflict met het organisatiebeleid. Stem de instellingen af v\xF3\xF3r een nieuwe ronde.", "Dit afspraaktype is inactief. Activeer het opnieuw om een revisie te publiceren.", "Er is een actief voorstel gekoppeld. Rond het af of trek het in voordat u deze vermelding sluit.", "Deze rol is nog niet ingesteld als verkiesbaar. Controleer de eigenschappen.", "Stel \xE9\xE9n actieve periode in bij Doelen voordat u deze spanning doorstuurt.", "De facilitator moet v\xF3\xF3r indiening een kandidaat kiezen.", "Voltooi de rondestappen voordat u het besluit vastlegt.", "De ronde vereist nog de nodige antwoorden of integratie van bezwaren.", "De deadline van deze ronde is verstreken. Vernieuw het voorstel om het besluit te volgen.", "Uw stem is al vastgelegd en kan in deze ronde niet vervangen worden.", "Structuurtoepassing is nog niet beschikbaar in deze installatie.", "Veldtoepassing is nog niet beschikbaar in deze installatie.", "Toepassing van de termijn is nog niet beschikbaar in deze installatie.", "Doorsturen van deze spanning is nog niet beschikbaar in deze installatie."]
    };
    errorMessages = Object.fromEntries(Object.entries(rows6).map(([locale, values]) => {
      if (values.length !== keys8.length) throw Error("Incomplete governance error catalog: " + locale);
      return [locale, Object.fromEntries(keys8.map((key, index) => [key, values[index]]))];
    }));
  }
});

// web/src/features/governance/date-input.ts
function mandateInput(instant, timeZone) {
  if (!instant) return "";
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA-u-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (key) => parts.find((part) => part.type === key).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
function mandateInstant(value, timeZone, original) {
  if (original && mandateInput(original, timeZone) === value) return new Date(original).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_MANDATE_TIME");
  const [, y, m, d, h, min] = match.map(Number), wall = Date.UTC(y, m - 1, d, h, min);
  if (new Date(wall).toISOString().slice(0, 16) !== value) throw new Error("INVALID_MANDATE_TIME");
  const candidates = /* @__PURE__ */ new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = wall + hours * 36e5;
    const local = mandateInput(new Date(probe).toISOString(), timeZone);
    const offset = Date.parse(local + ":00Z") - probe;
    const candidate = wall - offset;
    if (mandateInput(new Date(candidate).toISOString(), timeZone) === value) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error(candidates.size ? "AMBIGUOUS_MANDATE_TIME" : "NONEXISTENT_MANDATE_TIME");
  return new Date([...candidates][0]).toISOString();
}
var init_date_input = __esm({
  "web/src/features/governance/date-input.ts"() {
    "use strict";
  }
});

// web/src/features/governance/index.tsx
var index_exports = {};
__export(index_exports, {
  feature: () => feature
});
import {
  useEffect as useEffect3,
  useRef as useRef2,
  useState as useState3,
  useId as useId2,
  Children,
  isValidElement,
  cloneElement
} from "react";
import { Fragment, jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
function Field({
  label: caption,
  children
}) {
  const captionId = useId2();
  return /* @__PURE__ */ jsxs2("label", { className: "gov-field", children: [
    /* @__PURE__ */ jsx4("span", { id: captionId, children: caption }),
    Children.map(
      children,
      (child) => isValidElement(child) ? cloneElement(
        child,
        { "aria-labelledby": captionId }
      ) : child
    )
  ] });
}
function Modal({
  title,
  close,
  children
}) {
  const { d } = useGovernanceLocalization();
  const ref = useRef2(null);
  useEffect3(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return /* @__PURE__ */ jsxs2("dialog", { ref, className: "gov-dialog", onCancel: close, children: [
    /* @__PURE__ */ jsxs2("header", { children: [
      /* @__PURE__ */ jsx4("h2", { children: title }),
      /* @__PURE__ */ jsx4("button", { type: "button", onClick: close, "aria-label": d("close"), children: "\xD7" })
    ] }),
    children
  ] });
}
function GovernanceFeature({ context: c }) {
  const { p: processText } = useGovernanceLocalization();
  const { locale, formatInstant: formatInstant2, formatNumber: formatNumber2, label, countLabel, ui, d, f, m } = useGovernanceLocalization();
  const [items, setItems] = useState3([]), [types, setTypes] = useState3([]), [docs, setDocs] = useState3([]), [detail, setDetail] = useState3(null), [docDetail, setDocDetail] = useState3(null), [errorCause, setError] = useState3(null), [loading, setLoading] = useState3(true), [busy, setBusy] = useState3(false), [revision, setRevision] = useState3(0), [modal, setModal] = useState3(null), [filter, setFilter] = useState3(""), [search, setSearch] = useState3("");
  const error = errorCause ? governanceError(errorCause, locale) : "";
  const [viewRevision, setViewRevision] = useState3(null);
  const [proposalView, setProposalView] = useState3("list");
  const [proposalGroup, setProposalGroup] = useState3("state");
  const [proposalSort, setProposalSort] = useState3("newest");
  const [quickFilter, setQuickFilter] = useState3("");
  const path = c.path.split("?")[0], section = path.includes("working-agreements") ? "documents" : path.includes("tensions") ? "tensions" : path.includes("branches") ? "branches" : path.includes("governance-policy") ? "policies" : "proposals";
  const selectedId = path.match(
    /\/(?:proposals|working-agreements)\/([\da-f-]{36})$/
  )?.[1];
  const root = "/structure/" + (section === "documents" ? "working-agreements" : section === "policies" ? "governance-policy" : section);
  const apiRoot = "/organizations/" + c.organizationId;
  const guest = c.bootstrap.membership.memberType === "GUEST";
  const owner = c.bootstrap.capabilities?.["structure.direct"] === true, actor = c.bootstrap.membership.id;
  const entityName = (eid) => c.structure.nodes.find((n) => n.entityId === eid)?.name ?? "\u2014";
  const memberName = (mid) => c.members.find((m2) => m2.id === mid)?.displayName ?? m("member");
  useEffect3(() => {
    const abort = new AbortController();
    setItems([]);
    setDetail(null);
    setViewRevision(null);
    setDocDetail(null);
    setError("");
    setLoading(true);
    const resource = section === "branches" ? "governance/branches" : section === "policies" ? "governance/policies" : section;
    const load = async () => {
      try {
        const listAll = async (path2) => {
          let next = null;
          const items2 = [];
          do {
            const page = await c.api(path2 + (next ? "?cursor=" + encodeURIComponent(next) : ""), {
              signal: abort.signal
            });
            items2.push(...page.data.items);
            next = page.data.page.nextCursor;
          } while (next && !abort.signal.aborted);
          return { data: { items: items2 } };
        };
        const [list, agreements, documentTypes] = await Promise.all([
          listAll(apiRoot + "/" + resource),
          listAll(apiRoot + "/documents"),
          guest ? Promise.resolve({ data: { items: [] } }) : listAll(apiRoot + "/document-types")
        ]);
        if (abort.signal.aborted) return;
        setItems(list.data.items);
        setDocs(agreements.data.items);
        setTypes(documentTypes.data.items);
        if (selectedId) {
          const d2 = await c.api(
            apiRoot + "/" + (section === "documents" ? "documents" : "proposals") + "/" + selectedId,
            { signal: abort.signal }
          );
          if (abort.signal.aborted) return;
          if (section === "documents") setDocDetail(d2.data);
          else setDetail(d2.data);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(e);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => abort.abort();
  }, [c.organizationId, c.path, revision, guest]);
  async function command(path2, body = {}, version) {
    setError("");
    setBusy(true);
    try {
      const result = await c.api(apiRoot + path2, {
        method: "POST",
        body,
        version
      });
      setRevision((v) => v + 1);
      c.refresh();
      return result.data;
    } catch (e) {
      setError(e);
      if (e instanceof RequestError && e.code === "APPLY_CONFLICT")
        setRevision((v) => v + 1);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function act2(path2, body = {}, version) {
    try {
      await command(path2, body, version);
      c.notify(d("saved"));
    } catch {
    }
  }
  const filtered = items.filter(
    (i) => (!filter || i.state === filter) && (section !== "proposals" || !quickFilter || quickFilter === "open" && ["DRAFT", "REVIEW"].includes(i.state ?? "") || quickFilter === "adopted" && i.verdict === "ADOPT" || quickFilter === "rejected" && i.verdict === "REJECT" || quickFilter === "mine" && i.authorId === actor || quickFilter === "vote" && i.canVote === true || quickFilter === "circles" && c.structure.memberships.some((m2) => m2.memberId === actor && m2.circleId === i.circleId && Date.parse(m2.startsAt) <= Date.now() && (!m2.endsAt || Date.parse(m2.endsAt) > Date.now()))) && (!search || i.title?.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)))
  );
  const selected = detail?.proposal ?? docDetail?.document;
  return /* @__PURE__ */ jsxs2("main", { className: "gov-page", children: [
    /* @__PURE__ */ jsxs2("div", { className: "gov-heading", children: [
      /* @__PURE__ */ jsxs2("div", { children: [
        selectedId && /* @__PURE__ */ jsx4("button", { className: "gov-back", onClick: () => c.navigate(root), children: d("back") }),
        /* @__PURE__ */ jsx4("h1", { children: selected?.title ?? {
          proposals: d("proposals"),
          documents: d("agreements"),
          tensions: d("tensions"),
          branches: d("branches"),
          policies: d("process")
        }[section] }),
        detail && /* @__PURE__ */ jsxs2("div", { className: "gov-title-state", children: [
          /* @__PURE__ */ jsx4("span", { className: "badge", children: label(detail.proposal.state) }),
          detail.proposal.verdict && /* @__PURE__ */ jsx4("span", { children: label(detail.proposal.verdict) }),
          detail.proposal.applyState === "APPLIED" && /* @__PURE__ */ jsx4("span", { children: label(detail.proposal.applyState) })
        ] })
      ] }),
      /* @__PURE__ */ jsxs2("div", { className: "gov-actions", children: [
        !selectedId && !guest && /* @__PURE__ */ jsx4(
          "button",
          {
            onClick: () => setModal(section === "policies" ? "policy" : "create"),
            children: section === "policies" ? d("configureProcess") : section === "documents" ? d("addAgreement") : section === "tensions" ? d("addTension") : section === "branches" ? d("createBranch") : d("addProposal")
          }
        ),
        detail && detail.proposal.state === "DRAFT" && detail.proposal.canEdit && /* @__PURE__ */ jsx4(
          "button",
          {
            className: "primary",
            disabled: busy || detail.proposal.kind === "ELECTION" && !detail.revisions.at(-1)?.payload.winnerId,
            onClick: () => void act2(
              "/proposals/" + selectedId + "/actions/submit",
              {},
              detail.proposal.version
            ),
            children: d("submit")
          }
        )
      ] })
    ] }),
    error && /* @__PURE__ */ jsxs2("div", { className: "gov-notice", role: "alert", children: [
      error,
      " ",
      /* @__PURE__ */ jsx4("button", { onClick: () => setRevision((v) => v + 1), children: d("refresh") })
    ] }),
    loading ? /* @__PURE__ */ jsx4("p", { role: "status", className: "gov-loading", children: d("loading") }) : detail ? /* @__PURE__ */ jsxs2("div", { className: "gov-detail", children: [
      /* @__PURE__ */ jsxs2("section", { className: "gov-evolution", children: [
        /* @__PURE__ */ jsxs2("div", { className: "gov-detail-toolbar", children: [
          /* @__PURE__ */ jsx4("h2", { children: d("changes", { count: formatNumber2(detail.revisions.find((r) => r.number === (viewRevision ?? detail.proposal.revision))?.payload.changes?.length ?? 1) }) }),
          detail.proposal.canEdit && (detail.proposal.kind !== "ELECTION" || owner || !detail.revisions.at(-1)?.payload.winnerId) && detail.proposal.applyState !== "APPLIED" && detail.proposal.state !== "WITHDRAWN" && /* @__PURE__ */ jsx4("button", { onClick: () => {
            setViewRevision(null);
            setModal("amend");
          }, children: d("amend") })
        ] }),
        detail.revisions.length > 1 && /* @__PURE__ */ jsx4(Field, { label: m("revisionOfChange"), children: /* @__PURE__ */ jsx4("select", { value: viewRevision ?? detail.proposal.revision, onChange: (e) => setViewRevision(Number(e.target.value)), children: detail.revisions.map((r) => /* @__PURE__ */ jsxs2("option", { value: r.number, children: [
          d("revision"),
          " ",
          r.number,
          " (" + m(r.number === detail.proposal.revision ? "current" : "historical") + ")"
        ] }, r.number)) }) }),
        /* @__PURE__ */ jsx4(
          ProposalPayload,
          {
            detail,
            revision: viewRevision ?? void 0,
            entityName,
            docs,
            memberName
          }
        ),
        detail.proposal.kind === "ELECTION" && /* @__PURE__ */ jsxs2("section", { className: "gov-process", children: [
          /* @__PURE__ */ jsxs2("h2", { children: [
            m("nominationsRegistered"),
            " "
          ] }),
          detail.nominations.length ? /* @__PURE__ */ jsx4("ul", { children: detail.nominations.map((n) => /* @__PURE__ */ jsxs2("li", { children: [
            memberName(n.candidateId),
            ": ",
            n.rationale
          ] }, n.id)) }) : /* @__PURE__ */ jsxs2("p", { children: [
            m("noNominations"),
            " "
          ] }),
          detail.proposal.state === "DRAFT" && detail.proposal.canEdit && /* @__PURE__ */ jsx4(
            NominationForm,
            {
              c,
              disabled: busy,
              onSubmit: (candidateId, rationale) => void act2(
                "/proposals/" + selectedId + "/nominations",
                { candidateId, rationale },
                detail.proposal.version
              )
            }
          )
        ] }),
        detail.rounds.length > 0 && /* @__PURE__ */ jsxs2("section", { className: "gov-process", children: [
          /* @__PURE__ */ jsx4("h2", { children: d("decisionRound") }),
          detail.rounds.filter((r) => r.revision === detail.proposal.revision).map((round) => /* @__PURE__ */ jsxs2("div", { children: [
            /* @__PURE__ */ jsxs2("p", { children: [
              label(round.policy.method),
              " \xB7 ",
              d("step"),
              ":",
              " ",
              label(round.step)
            ] }),
            /* @__PURE__ */ jsxs2("p", { children: [
              d("quorum"),
              " ",
              formatNumber2(round.policy.quorumPercent / 100, { style: "percent" }),
              " \xB7",
              " ",
              countLabel(round.electorate.length, "participants"),
              round.deadline && /* @__PURE__ */ jsxs2(Fragment, { children: [
                " ",
                "\xB7 ",
                ui("deadline"),
                " ",
                formatInstant2(round.deadline)
              ] })
            ] }),
            round.state === "OPEN" && detail.proposal.canVote && round.electorate.includes(actor) && /* @__PURE__ */ jsx4(
              VoteForm,
              {
                disabled: busy,
                allowAbstain: round.policy.allowAbstain,
                locked: !round.policy.allowRevote && detail.ballots.some(
                  (b) => b.roundId === round.id && b.memberId === actor
                ),
                onSubmit: (choice, rationale) => act2(
                  "/proposals/" + selectedId + "/votes",
                  { choice, rationale },
                  detail.proposal.version
                )
              }
            ),
            /* @__PURE__ */ jsx4("ul", { className: "gov-votes", children: detail.ballots.filter((b) => b.roundId === round.id).map((b, i) => /* @__PURE__ */ jsxs2("li", { children: [
              memberName(b.memberId),
              ": ",
              label(b.choice),
              b.number > 1 && " " + d("voteNumber", { number: formatNumber2(b.number) }),
              b.rationale && /* @__PURE__ */ jsx4("p", { children: b.rationale })
            ] }, i)) }),
            round.state === "OPEN" && owner && /* @__PURE__ */ jsxs2("div", { className: "gov-actions", children: [
              /* @__PURE__ */ jsx4(
                "button",
                {
                  disabled: busy || round.policy.workflowSteps.at(-1) === round.step,
                  onClick: () => void act2(
                    "/proposals/" + selectedId + "/actions/step",
                    {
                      step: round.policy.workflowSteps[round.policy.workflowSteps.indexOf(
                        round.step
                      ) + 1]
                    },
                    detail.proposal.version
                  ),
                  children: d("nextStep")
                }
              ),
              /* @__PURE__ */ jsx4(
                "button",
                {
                  disabled: round.step !== round.policy.workflowSteps.at(-1),
                  onClick: () => setModal("decide"),
                  children: d("recordDecision")
                }
              )
            ] })
          ] }, round.id))
        ] }),
        detail.objections.length > 0 && /* @__PURE__ */ jsxs2("section", { className: "gov-process", children: [
          /* @__PURE__ */ jsx4("h2", { children: d("objections") }),
          detail.objections.map((o) => /* @__PURE__ */ jsxs2("article", { className: "gov-objection", children: [
            /* @__PURE__ */ jsx4("p", { children: o.rationale }),
            /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
              memberName(o.authorId),
              " \xB7 ",
              label(o.state)
            ] }),
            !["INTEGRATED", "INVALID", "WITHDRAWN"].includes(
              o.state
            ) && /* @__PURE__ */ jsx4(
              ObjectionForm,
              {
                owner,
                mine: o.authorId === actor,
                disabled: busy,
                onSubmit: (state, reason) => act2(
                  "/governance/objections/" + o.id + "/actions/review",
                  { state, reason },
                  o.version
                )
              }
            )
          ] }, o.id))
        ] }),
        detail.proposal.state === "DECIDED" && /* @__PURE__ */ jsxs2("section", { className: "gov-process", children: [
          /* @__PURE__ */ jsx4("h2", { children: label(detail.proposal.verdict) }),
          /* @__PURE__ */ jsx4("p", { children: label(detail.proposal.applyState) }),
          owner && detail.proposal.verdict === "ADOPT" && detail.proposal.applyState !== "APPLIED" && /* @__PURE__ */ jsx4(
            "button",
            {
              className: "primary",
              disabled: busy,
              onClick: () => void act2(
                "/proposals/" + selectedId + "/actions/apply",
                {},
                detail.proposal.version
              ),
              children: d("apply")
            }
          ),
          detail.proposal.applyState === "APPLY_CONFLICT" && /* @__PURE__ */ jsx4("p", { children: d("conflict") })
        ] }),
        detail.commits.map((commit) => /* @__PURE__ */ jsx4("p", { className: "muted", children: d("appliedAt", { at: formatInstant2(commit.at) }) }, commit.id))
      ] }),
      /* @__PURE__ */ jsxs2("aside", { className: "gov-properties", children: [
        /* @__PURE__ */ jsx4("h2", { children: d("properties") }),
        /* @__PURE__ */ jsxs2("dl", { children: [
          /* @__PURE__ */ jsx4("dt", { children: ui("circle") }),
          /* @__PURE__ */ jsx4("dd", { children: entityName(detail.proposal.circleId) }),
          /* @__PURE__ */ jsx4("dt", { children: ui("state") }),
          /* @__PURE__ */ jsx4("dd", { children: /* @__PURE__ */ jsx4("span", { className: "badge", children: label(detail.proposal.state) }) }),
          /* @__PURE__ */ jsx4("dt", { children: d("type") }),
          /* @__PURE__ */ jsx4("dd", { children: label(detail.proposal.kind) }),
          /* @__PURE__ */ jsx4("dt", { children: d("author") }),
          /* @__PURE__ */ jsx4("dd", { children: memberName(detail.proposal.authorId ?? "") }),
          /* @__PURE__ */ jsx4("dt", { children: d("revision") }),
          /* @__PURE__ */ jsx4("dd", { children: detail.proposal.revision })
        ] }),
        ["DRAFT", "REVIEW"].includes(detail.proposal.state ?? "") && !guest && (owner || detail.proposal.authorId === actor) && /* @__PURE__ */ jsx4("button", { onClick: () => setModal("withdraw"), children: d("withdraw") }),
        detail.history && /* @__PURE__ */ jsxs2("details", { className: "gov-history", children: [
          /* @__PURE__ */ jsxs2("summary", { children: [
            d("activity"),
            /* @__PURE__ */ jsx4("span", { className: "gov-count", children: formatNumber2(detail.history.length) })
          ] }),
          /* @__PURE__ */ jsx4("ol", { children: detail.history.map((item) => /* @__PURE__ */ jsxs2("li", { children: [
            /* @__PURE__ */ jsx4("strong", { children: localizedGovernanceActivity(item.action, locale) }),
            /* @__PURE__ */ jsx4("span", { children: memberName(item.actorId) }),
            /* @__PURE__ */ jsx4("time", { dateTime: item.at, children: formatInstant2(item.at) }),
            item.revision && /* @__PURE__ */ jsxs2("span", { children: [
              d("revision"),
              " ",
              formatNumber2(item.revision)
            ] }),
            item.verdict && /* @__PURE__ */ jsx4("span", { children: label(item.verdict) }),
            item.choice && /* @__PURE__ */ jsx4("span", { children: label(item.choice) }),
            item.reason && /* @__PURE__ */ jsx4("p", { children: item.reason })
          ] }, item.id)) })
        ] })
      ] })
    ] }) : docDetail ? /* @__PURE__ */ jsxs2("div", { className: "gov-detail", children: [
      /* @__PURE__ */ jsxs2("section", { className: "gov-document", children: [
        /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
          d("revision"),
          " ",
          docDetail.document.draftVersion,
          " \xB7",
          " ",
          docDetail.document.workflow === "DIRECT" ? f("directPublication") : f("governedPublication")
        ] }),
        /* @__PURE__ */ jsx4("div", { className: "gov-document-content", children: /* @__PURE__ */ jsx4(RichTextView, { value: versionContent(docDetail.versions.find(
          (v) => v.number === docDetail.document.draftVersion
        )) }) })
      ] }),
      /* @__PURE__ */ jsxs2("aside", { className: "gov-properties", children: [
        /* @__PURE__ */ jsxs2("h2", { children: [
          d("properties"),
          " "
        ] }),
        /* @__PURE__ */ jsxs2("dl", { children: [
          /* @__PURE__ */ jsxs2("dt", { children: [
            f("linkedTo"),
            " "
          ] }),
          /* @__PURE__ */ jsx4("dd", { children: entityName(docDetail.document.ownerId) }),
          /* @__PURE__ */ jsxs2("dt", { children: [
            f("publication"),
            " "
          ] }),
          /* @__PURE__ */ jsx4("dd", { children: docDetail.document.publishedVersion ? `Revis\xE3o ${docDetail.document.publishedVersion}` : f("notPublished") })
        ] }),
        !guest && (owner || docDetail.document.authorId === actor) && /* @__PURE__ */ jsxs2("div", { className: "gov-vertical-actions", children: [
          /* @__PURE__ */ jsxs2("button", { onClick: () => setModal("edit-document"), children: [
            f("editAgreement"),
            " "
          ] }),
          docDetail.document.workflow === "DIRECT" ? /* @__PURE__ */ jsxs2(
            "button",
            {
              disabled: busy,
              onClick: () => void act2(
                "/documents/" + selectedId + "/actions/publish",
                {},
                docDetail.document.version
              ),
              children: [
                f("publishRevision"),
                " "
              ]
            }
          ) : /* @__PURE__ */ jsxs2("button", { onClick: () => setModal("propose-document"), children: [
            f("proposePublication"),
            " "
          ] })
        ] }),
        /* @__PURE__ */ jsxs2("h2", { children: [
          f("versionHistory"),
          " "
        ] }),
        /* @__PURE__ */ jsx4("ol", { className: "gov-versions", children: docDetail.versions.map((v) => /* @__PURE__ */ jsxs2("li", { children: [
          d("revision"),
          " ",
          v.number,
          /* @__PURE__ */ jsx4("small", { children: formatInstant2(v.createdAt) }),
          !guest && (owner || docDetail.document.authorId === actor) && v.number !== docDetail.document.draftVersion && /* @__PURE__ */ jsxs2(
            "button",
            {
              disabled: busy,
              onClick: () => void act2(
                "/documents/" + selectedId + "/actions/restore",
                { number: v.number },
                docDetail.document.version
              ),
              children: [
                f("restoreRevision"),
                " "
              ]
            }
          )
        ] }, v.number)) })
      ] })
    ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsxs2("div", { className: "gov-toolbar", children: [
        section === "proposals" && /* @__PURE__ */ jsxs2("div", { className: "gov-actions", role: "group", "aria-label": ui("view"), children: [
          /* @__PURE__ */ jsx4("button", { "aria-pressed": proposalView === "list", onClick: () => setProposalView("list"), children: ui("list") }),
          /* @__PURE__ */ jsx4("button", { "aria-pressed": proposalView === "cards", onClick: () => setProposalView("cards"), children: ui("cards") })
        ] }),
        /* @__PURE__ */ jsx4("strong", { children: countLabel(filtered.length, section === "proposals" || section === "documents" || section === "tensions" ? section : "records") }),
        /* @__PURE__ */ jsxs2("div", { className: "gov-actions", children: [
          section === "documents" && owner && /* @__PURE__ */ jsx4("button", { onClick: () => setModal("document-type"), children: ui("configTypes") }),
          /* @__PURE__ */ jsxs2("label", { children: [
            /* @__PURE__ */ jsx4("span", { className: "gov-sr", children: ui("search") }),
            /* @__PURE__ */ jsx4(
              "input",
              {
                placeholder: ui("searchTitle"),
                value: search,
                onChange: (e) => setSearch(e.target.value)
              }
            )
          ] }),
          section === "proposals" && /* @__PURE__ */ jsxs2(Fragment, { children: [
            /* @__PURE__ */ jsxs2("label", { children: [
              /* @__PURE__ */ jsx4("span", { className: "gov-sr", children: ui("statusFilter") }),
              /* @__PURE__ */ jsxs2(
                "select",
                {
                  value: filter,
                  onChange: (e) => setFilter(e.target.value),
                  children: [
                    /* @__PURE__ */ jsx4("option", { value: "", children: ui("allStatuses") }),
                    ["DRAFT", "REVIEW", "DECIDED", "WITHDRAWN"].map((s) => /* @__PURE__ */ jsx4("option", { value: s, children: label(s) }, s))
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ jsxs2("label", { children: [
              /* @__PURE__ */ jsx4("span", { className: "gov-sr", children: ui("sort") }),
              /* @__PURE__ */ jsxs2("select", { "aria-label": ui("sort"), value: proposalSort, onChange: (e) => setProposalSort(e.target.value), children: [
                /* @__PURE__ */ jsx4("option", { value: "newest", children: ui("newest") }),
                /* @__PURE__ */ jsx4("option", { value: "oldest", children: ui("oldest") }),
                /* @__PURE__ */ jsx4("option", { value: "name", children: ui("nameAZ") })
              ] })
            ] }),
            /* @__PURE__ */ jsxs2("label", { children: [
              /* @__PURE__ */ jsx4("span", { className: "gov-sr", children: ui("group") }),
              /* @__PURE__ */ jsxs2("select", { "aria-label": ui("group"), value: proposalGroup, onChange: (e) => setProposalGroup(e.target.value), children: [
                /* @__PURE__ */ jsx4("option", { value: "state", children: ui("stateGroup") }),
                /* @__PURE__ */ jsx4("option", { value: "circle", children: ui("circleGroup") }),
                /* @__PURE__ */ jsx4("option", { value: "none", children: ui("noGroup") })
              ] })
            ] })
          ] })
        ] })
      ] }),
      section === "proposals" && /* @__PURE__ */ jsxs2("div", { className: "gov-quick-filters", role: "group", "aria-label": ui("quick"), children: [
        [["open", "open"], ["adopted", "adopted"], ["rejected", "rejected"], ["mine", "mine"], ["circles", "myCircles"], ["vote", "waiting"]].map(([value, title]) => /* @__PURE__ */ jsx4("button", { "aria-pressed": quickFilter === value, onClick: () => setQuickFilter(quickFilter === value ? "" : value), children: ui(title) }, value)),
        (search || filter || quickFilter) && /* @__PURE__ */ jsx4("button", { onClick: () => {
          setSearch("");
          setFilter("");
          setQuickFilter("");
        }, children: ui("clear") })
      ] }),
      filtered.length === 0 ? /* @__PURE__ */ jsxs2("div", { className: "empty-state", children: [
        /* @__PURE__ */ jsx4("h2", { children: search || filter || section === "proposals" && quickFilter ? ui("noResults") : m(section === "proposals" ? "emptyProposals" : section === "documents" ? "emptyAgreements" : section === "tensions" ? "emptyTensions" : "emptyRecords") }),
        /* @__PURE__ */ jsx4("p", { children: search || filter || section === "proposals" && quickFilter ? ui("adjustFilters") : m("firstRecordHelp") })
      ] }) : section === "policies" ? /* @__PURE__ */ jsx4("div", { className: "gov-policy-list", children: filtered.map((p) => /* @__PURE__ */ jsxs2("article", { children: [
        /* @__PURE__ */ jsx4("h2", { children: entityName(p.circleId) }),
        /* @__PURE__ */ jsxs2("p", { children: [
          label(p.configuration?.method),
          " \xB7 ",
          processText("quorum"),
          " ",
          formatNumber2((p.configuration?.quorumPercent ?? 0) / 100, { style: "percent" })
        ] }),
        /* @__PURE__ */ jsxs2("button", { onClick: () => setModal("policy:" + p.id), children: [
          m("editProcess"),
          " "
        ] })
      ] }, p.id)) }) : section === "proposals" ? /* @__PURE__ */ jsx4(
        ProposalList,
        {
          rows: filtered,
          entityName,
          navigate: c.navigate,
          view: proposalView,
          group: proposalGroup,
          sortOrder: proposalSort,
          onSort: setProposalSort
        }
      ) : /* @__PURE__ */ jsx4("div", { className: "gov-table-scroll", children: /* @__PURE__ */ jsxs2("table", { className: "gov-table", children: [
        /* @__PURE__ */ jsx4("thead", { children: /* @__PURE__ */ jsxs2("tr", { children: [
          /* @__PURE__ */ jsxs2("th", { children: [
            ui("title"),
            " "
          ] }),
          /* @__PURE__ */ jsx4("th", { children: section === "documents" ? f("linkedTo") : section === "branches" ? "Escopo" : ui("circle") }),
          /* @__PURE__ */ jsxs2("th", { children: [
            ui("state"),
            " "
          ] }),
          /* @__PURE__ */ jsxs2("th", { children: [
            d("author"),
            " "
          ] }),
          /* @__PURE__ */ jsxs2("th", { children: [
            d("revision"),
            " "
          ] }),
          /* @__PURE__ */ jsx4("th", { children: /* @__PURE__ */ jsxs2("span", { className: "gov-sr", children: [
            m("actions"),
            " "
          ] }) })
        ] }) }),
        /* @__PURE__ */ jsx4("tbody", { children: filtered.map((row) => /* @__PURE__ */ jsxs2("tr", { children: [
          /* @__PURE__ */ jsxs2("td", { children: [
            section === "documents" ? /* @__PURE__ */ jsx4(
              "button",
              {
                className: "gov-title-link",
                onClick: () => c.navigate(root + "/" + row.id),
                children: row.title
              }
            ) : row.title,
            section === "tensions" && (row.descriptionRich || row.description) && /* @__PURE__ */ jsxs2("details", { className: "gov-tension-description", children: [
              /* @__PURE__ */ jsxs2("summary", { children: [
                f("description"),
                " "
              ] }),
              /* @__PURE__ */ jsx4(RichTextView, { value: row.descriptionRich ?? row.description ?? "" })
            ] })
          ] }),
          /* @__PURE__ */ jsx4("td", { children: /* @__PURE__ */ jsx4("span", { className: "badge", children: section === "branches" ? f("organization") : entityName(row.circleId ?? row.ownerId) }) }),
          /* @__PURE__ */ jsx4("td", { children: section === "documents" ? row.publishedVersion ? "Publicado" : "Rascunho" : /* @__PURE__ */ jsx4("span", { className: "badge", children: label(row.state) }) }),
          /* @__PURE__ */ jsx4("td", { children: memberName(row.authorId ?? "") }),
          /* @__PURE__ */ jsx4("td", { children: row.revision ?? row.draftVersion ?? row.version }),
          /* @__PURE__ */ jsxs2("td", { children: [
            !guest && (owner || row.authorId === actor) && section === "tensions" && row.state !== "CLOSED" && /* @__PURE__ */ jsxs2("div", { className: "gov-actions", children: [
              /* @__PURE__ */ jsxs2(
                "button",
                {
                  onClick: () => setModal("tension-proposal:" + row.id),
                  children: [
                    m("createProposal"),
                    " "
                  ]
                }
              ),
              row.canProcess && /* @__PURE__ */ jsxs2(Fragment, { children: [
                /* @__PURE__ */ jsxs2(
                  "button",
                  {
                    disabled: busy,
                    onClick: () => void act2(
                      "/tensions/" + row.id + "/actions/process",
                      { targetKind: "TASK" },
                      row.version
                    ),
                    children: [
                      m("createTask"),
                      " "
                    ]
                  }
                ),
                /* @__PURE__ */ jsxs2(
                  "button",
                  {
                    disabled: busy,
                    onClick: () => void act2(
                      "/tensions/" + row.id + "/actions/process",
                      { targetKind: "GOAL" },
                      row.version
                    ),
                    children: [
                      m("createGoal"),
                      " "
                    ]
                  }
                )
              ] }),
              row.canProcessAgenda && c.bootstrap.modules.meetings !== false && /* @__PURE__ */ jsx4("button", { disabled: busy, onClick: () => setModal("agenda:" + row.id), children: processText("agendaAction") }),
              /* @__PURE__ */ jsxs2(
                "button",
                {
                  disabled: busy,
                  onClick: () => void act2(
                    "/tensions/" + row.id + "/actions/close",
                    {},
                    row.version
                  ),
                  children: [
                    m("closeTension"),
                    " "
                  ]
                }
              )
            ] }),
            section === "branches" && row.state === "OPEN" && /* @__PURE__ */ jsxs2("div", { className: "gov-actions", children: [
              /* @__PURE__ */ jsxs2(
                "button",
                {
                  onClick: () => setModal("edit-branch:" + row.id),
                  children: [
                    m("editDraft"),
                    " "
                  ]
                }
              ),
              /* @__PURE__ */ jsxs2(
                "button",
                {
                  disabled: busy,
                  onClick: () => void act2(
                    "/governance/branches/" + row.id + "/actions/close",
                    {},
                    row.version
                  ),
                  children: [
                    m("closeDraft"),
                    " "
                  ]
                }
              ),
              /* @__PURE__ */ jsxs2(
                "button",
                {
                  onClick: () => setModal("branch-proposal:" + row.id),
                  children: [
                    m("createProposal"),
                    " "
                  ]
                }
              )
            ] })
          ] })
        ] }, row.id)) })
      ] }) })
    ] }),
    modal && /* @__PURE__ */ jsxs2(
      Modal,
      {
        title: modal.startsWith("agenda:") ? processText("toAgenda") : modal.startsWith("edit-branch:") ? m("editStructureDraft") : modal === "document-type" ? m("configureAgreementTypes") : section === "branches" && modal === "create" ? m("createStructureDraft") : modal === "decide" ? d("recordDecision") : modal === "withdraw" ? d("withdraw") : modal.startsWith("policy") ? d("configureProcess") : modal === "amend" ? d("amend") : modal === "edit-document" ? f("editAgreement") : modal === "create" && section === "documents" ? d("addAgreement") : modal === "create" && section === "tensions" ? d("addTension") : d("addProposal"),
        close: () => setModal(null),
        children: [
          modal.startsWith("agenda:") ? /* @__PURE__ */ jsx4(AgendaForm, { c, tension: items.find((row) => row.id === modal.split(":")[1]), disabled: busy, error, onSubmit: async (values) => {
            const tension2 = items.find((row) => row.id === modal.split(":")[1]);
            if (!tension2) return;
            try {
              await command("/tensions/" + tension2.id + "/actions/process", { targetKind: "AGENDA", ...values }, tension2.version);
              setModal(null);
              c.navigate("/meetings/" + values.meetingId);
            } catch {
            }
          } }) : modal === "document-type" ? /* @__PURE__ */ jsx4(
            DocumentTypeForm,
            {
              types,
              disabled: busy,
              onSubmit: async (values, type) => {
                try {
                  await command(
                    "/document-types" + (type ? "/" + type.id + "/actions/configure" : ""),
                    values,
                    type?.version
                  );
                  setModal(null);
                } catch {
                }
              }
            }
          ) : modal === "decide" || modal === "withdraw" ? /* @__PURE__ */ jsx4(
            ReasonForm,
            {
              error,
              onRefresh: () => setRevision((v) => v + 1),
              decide: modal === "decide",
              manual: detail?.rounds.find(
                (r) => r.revision === detail.proposal.revision
              )?.policy.method === "MANUAL_FACILITATED",
              disabled: busy || loading || !detail,
              onSubmit: async (values) => {
                try {
                  await command(
                    "/proposals/" + selectedId + "/actions/" + modal,
                    values,
                    detail.proposal.version
                  );
                  setModal(null);
                } catch {
                }
              }
            }
          ) : modal.startsWith("policy") ? /* @__PURE__ */ jsx4(
            PolicyForm,
            {
              c,
              existing: items.find((i) => i.id === modal.split(":")[1]),
              disabled: busy,
              onSubmit: async (values, version) => {
                try {
                  await command("/governance/policies", values, version);
                  setModal(null);
                } catch {
                }
              }
            }
          ) : modal === "edit-document" ? /* @__PURE__ */ jsx4(
            ContentForm,
            {
              error,
              content: versionContent(docDetail?.versions.find(
                (v) => v.number === docDetail.document.draftVersion
              )),
              disabled: busy,
              onSubmit: async (content) => {
                try {
                  await command(
                    "/documents/" + selectedId + "/actions/draft",
                    { richContent: content },
                    docDetail.document.version
                  );
                  setModal(null);
                } catch {
                }
              }
            }
          ) : /* @__PURE__ */ jsx4(
            CreateForm,
            {
              c,
              section: modal.startsWith("edit-branch:") ? "branches" : modal === "create" ? section : "proposals",
              editingBranch: modal.startsWith("edit-branch:"),
              docs,
              types,
              branch: modal.startsWith("branch-proposal:") || modal.startsWith("edit-branch:") ? items.find((i) => i.id === modal.split(":")[1]) : void 0,
              tension: modal.startsWith("tension-proposal:") ? items.find((i) => i.id === modal.split(":")[1]) : void 0,
              detail: modal === "amend" ? detail : void 0,
              document: modal === "propose-document" ? docDetail?.document : void 0,
              disabled: busy,
              onSubmit: async (values) => {
                try {
                  let endpoint = "/" + (section === "branches" && modal === "create" ? "governance/branches" : modal === "create" ? section : "proposals");
                  if (modal === "amend")
                    endpoint = "/proposals/" + selectedId + "/revisions";
                  if (modal.startsWith("tension-proposal:"))
                    values.tensionId = modal.split(":")[1];
                  if (modal.startsWith("branch-proposal:")) {
                    values.branchId = modal.split(":")[1];
                    delete values.payload;
                  }
                  if (modal.startsWith("edit-branch:"))
                    endpoint = "/governance/branches/" + modal.split(":")[1] + "/actions/revise";
                  const result = await command(
                    endpoint,
                    values,
                    modal === "amend" ? detail.proposal.version : modal.startsWith("edit-branch:") ? items.find((i) => i.id === modal.split(":")[1]).version : void 0
                  );
                  setModal(null);
                  if (result.id && endpoint === "/proposals")
                    c.navigate("/structure/proposals/" + result.id);
                } catch {
                }
              }
            }
          ),
          error && /* @__PURE__ */ jsx4("p", { className: "gov-notice", role: "alert", children: error })
        ]
      }
    )
  ] });
}
function SortArrow({ ascending }) {
  return /* @__PURE__ */ jsx4(
    "svg",
    {
      "aria-hidden": "true",
      width: "12",
      height: "12",
      viewBox: "0 0 16 16",
      style: {
        marginLeft: 5,
        transform: ascending ? "rotate(180deg)" : void 0
      },
      children: /* @__PURE__ */ jsx4(
        "path",
        {
          d: "M8 3v10m-4-4 4 4 4-4",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.3"
        }
      )
    }
  );
}
function ProposalList({
  rows: rows7,
  entityName,
  navigate,
  view,
  group,
  sortOrder,
  onSort
}) {
  const { formatInstant: formatInstant2, formatNumber: formatNumber2, compareText: compareText2, label, countLabel, ui, d } = useGovernanceLocalization();
  const [collapsed, setCollapsed] = useState3({}), [sort, setSort] = useState3("date"), [ascending, setAscending] = useState3(false);
  useEffect3(() => {
    setSort(sortOrder === "name" ? "name" : "date");
    setAscending(sortOrder !== "newest");
  }, [sortOrder]);
  const sorted = [...rows7].sort((a, b) => {
    const result = sort === "name" ? compareText2(a.title, b.title) : (Date.parse(a.createdAt ?? "") || 0) - (Date.parse(b.createdAt ?? "") || 0);
    return (ascending ? result : -result) || a.id.localeCompare(b.id);
  });
  function order(value) {
    onSort(value === "name" ? "name" : sortOrder === "newest" ? "oldest" : "newest");
  }
  return /* @__PURE__ */ jsx4("div", { className: "gov-proposal-groups", children: (group === "state" ? ["REVIEW", "DRAFT", "DECIDED", "WITHDRAWN"] : group === "circle" ? [...new Set(sorted.map((row) => row.circleId ?? ""))].sort((a, b) => compareText2(entityName(a), entityName(b))) : ["all"]).map((state) => {
    const items = sorted.filter((row) => group === "none" || (group === "circle" ? (row.circleId ?? "") === state : row.state === state));
    if (!items.length) return null;
    return /* @__PURE__ */ jsxs2("section", { className: "gov-proposal-group", children: [
      /* @__PURE__ */ jsx4("h2", { children: /* @__PURE__ */ jsxs2(
        "button",
        {
          className: "gov-group-toggle",
          "aria-expanded": !collapsed[state],
          onClick: () => setCollapsed({ ...collapsed, [state]: !collapsed[state] }),
          children: [
            /* @__PURE__ */ jsx4("span", { children: group === "none" ? ui("allProposals") : group === "circle" ? entityName(state) : label(state) }),
            /* @__PURE__ */ jsx4("span", { className: "gov-count", children: formatNumber2(items.length) }),
            /* @__PURE__ */ jsx4(
              "svg",
              {
                "aria-hidden": "true",
                viewBox: "0 0 16 16",
                width: "16",
                height: "16",
                style: {
                  transform: collapsed[state] ? "rotate(-90deg)" : void 0
                },
                children: /* @__PURE__ */ jsx4(
                  "path",
                  {
                    d: "m4 6 4 4 4-4",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "1.4"
                  }
                )
              }
            )
          ]
        }
      ) }),
      !collapsed[state] && (view === "cards" ? /* @__PURE__ */ jsx4("div", { className: "gov-proposal-cards", children: items.map((row) => /* @__PURE__ */ jsxs2("article", { children: [
        /* @__PURE__ */ jsx4("span", { className: "badge", children: label(row.state) }),
        /* @__PURE__ */ jsx4("h3", { children: /* @__PURE__ */ jsx4("button", { className: "gov-title-link", onClick: () => navigate("/structure/proposals/" + row.id), children: row.title }) }),
        /* @__PURE__ */ jsxs2("p", { children: [
          entityName(row.circleId),
          row.kind ? " \xB7 " + label(row.kind) : ""
        ] }),
        /* @__PURE__ */ jsx4("p", { children: row.createdAt ? formatInstant2(row.createdAt, false) : "\u2014" }),
        row.electorateCount !== void 0 && /* @__PURE__ */ jsxs2("p", { children: [
          ui("votes"),
          ": ",
          formatNumber2(row.responseCount ?? 0),
          " / ",
          formatNumber2(row.electorateCount)
        ] }),
        row.deadline && /* @__PURE__ */ jsxs2("p", { children: [
          ui("deadline"),
          ": ",
          formatInstant2(row.deadline, true)
        ] }),
        row.canVote && /* @__PURE__ */ jsx4("button", { onClick: () => navigate("/structure/proposals/" + row.id), children: ui("vote") })
      ] }, row.id)) }) : /* @__PURE__ */ jsx4("div", { className: "gov-table-scroll", children: /* @__PURE__ */ jsxs2("table", { className: "gov-table gov-proposal-table", children: [
        /* @__PURE__ */ jsx4("thead", { children: /* @__PURE__ */ jsxs2("tr", { children: [
          /* @__PURE__ */ jsx4("th", { children: /* @__PURE__ */ jsxs2("button", { onClick: () => order("name"), children: [
            ui("title"),
            sort === "name" && /* @__PURE__ */ jsx4(SortArrow, { ascending }),
            " "
          ] }) }),
          /* @__PURE__ */ jsx4("th", { children: ui("circle") }),
          /* @__PURE__ */ jsx4("th", { children: ui("evolutions") }),
          /* @__PURE__ */ jsx4("th", { children: ui("state") }),
          /* @__PURE__ */ jsx4("th", { children: /* @__PURE__ */ jsxs2("button", { onClick: () => order("date"), children: [
            ui("created"),
            sort === "date" && /* @__PURE__ */ jsx4(SortArrow, { ascending }),
            " "
          ] }) }),
          /* @__PURE__ */ jsx4("th", { children: ui("votes") }),
          /* @__PURE__ */ jsx4("th", { children: ui("yourVote") }),
          /* @__PURE__ */ jsx4("th", { children: ui("deadline") })
        ] }) }),
        /* @__PURE__ */ jsx4("tbody", { children: items.map((row) => /* @__PURE__ */ jsxs2("tr", { children: [
          /* @__PURE__ */ jsxs2("td", { children: [
            /* @__PURE__ */ jsx4(
              "button",
              {
                className: "gov-title-link gov-proposal-title",
                onClick: () => navigate("/structure/proposals/" + row.id),
                children: row.title
              }
            ),
            row.kind && /* @__PURE__ */ jsx4("small", { className: "gov-row-description", children: label(row.kind) })
          ] }),
          /* @__PURE__ */ jsx4("td", { children: /* @__PURE__ */ jsx4("span", { className: "badge", children: entityName(row.circleId) }) }),
          /* @__PURE__ */ jsx4("td", { children: row.evolutionCount === void 0 ? "\u2014" : /* @__PURE__ */ jsx4(Fragment, { children: countLabel(row.evolutionCount, "evolutions") }) }),
          /* @__PURE__ */ jsx4("td", { children: /* @__PURE__ */ jsx4("span", { className: "badge", children: label(row.state) }) }),
          /* @__PURE__ */ jsx4("td", { children: row.createdAt ? formatInstant2(
            row.createdAt,
            false,
            {
              day: "numeric",
              month: "short",
              year: "numeric"
            }
          ) : "\u2014" }),
          /* @__PURE__ */ jsx4("td", { children: row.electorateCount ? `${formatNumber2(row.responseCount ?? 0)} / ${formatNumber2(row.electorateCount)}` : "\u2014" }),
          /* @__PURE__ */ jsx4("td", { children: row.canVote ? /* @__PURE__ */ jsx4(
            "button",
            {
              onClick: () => navigate("/structure/proposals/" + row.id),
              children: ui("vote")
            }
          ) : label(row.ownVote ?? void 0) }),
          /* @__PURE__ */ jsx4("td", { children: row.deadline ? formatInstant2(row.deadline, true, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
          }) : "\u2014" })
        ] }, row.id)) })
      ] }) }))
    ] }, state);
  }) });
}
function ProposalPayload({
  detail,
  revision,
  entityName,
  docs,
  memberName
}) {
  const { formatInstant: formatInstant2, f, ui, d, formatNumber: formatNumber2 } = useGovernanceLocalization();
  const payload = detail.revisions.find(
    (r) => r.number === (revision ?? detail.proposal.revision)
  )?.payload;
  return /* @__PURE__ */ jsxs2("article", { className: "gov-change", children: [
    payload?.changes?.map((change, i) => /* @__PURE__ */ jsxs2("div", { children: [
      /* @__PURE__ */ jsxs2("strong", { children: [
        {
          UPDATE: f("updateLabel"),
          MOVE: f("move"),
          ARCHIVE: f("archive"),
          RESTORE: f("restore"),
          FIELD: f("fieldChange"),
          CREATE: f("create")
        }[change.kind],
        " ",
        "\xB7 ",
        change.name ?? entityName(change.entityId)
      ] }),
      change.name && /* @__PURE__ */ jsxs2("p", { children: [
        f("name"),
        ": ",
        change.name
      ] }),
      (change.purpose !== void 0 || change.purposeRich !== void 0) && /* @__PURE__ */ jsxs2("div", { children: [
        f("purpose"),
        ": ",
        /* @__PURE__ */ jsx4(RichTextView, { value: change.purposeRich ?? change.purpose ?? "" })
      ] }),
      change.kind === "FIELD" && /* @__PURE__ */ jsxs2("p", { children: [
        f("proposedValue"),
        ": ",
        " ",
        Array.isArray(change.value) ? change.value.join(", ") : String(change.value ?? f("empty"))
      ] }),
      change.parentCircleId && /* @__PURE__ */ jsxs2("p", { children: [
        f("destination"),
        ": ",
        entityName(change.parentCircleId)
      ] })
    ] }, i)),
    payload?.documentId && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsxs2("strong", { children: [
        f("publishAgreement"),
        " "
      ] }),
      /* @__PURE__ */ jsxs2("p", { children: [
        docs.find((d2) => d2.id === payload.documentId)?.title ?? f("agreement"),
        " \xB7 ",
        f("revisionLower"),
        " ",
        formatNumber2(payload.documentVersion ?? 0)
      ] })
    ] }),
    payload?.roleId && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsxs2("strong", { children: [
        f("election"),
        " \xB7 ",
        entityName(payload.roleId)
      ] }),
      /* @__PURE__ */ jsxs2("p", { children: [
        f("candidate"),
        ": ",
        " ",
        payload.winnerId ? memberName(payload.winnerId) : f("notChosen")
      ] }),
      /* @__PURE__ */ jsxs2("p", { children: [
        f("termUntil"),
        " ",
        " ",
        payload.mandateEnd && formatInstant2(payload.mandateEnd)
      ] })
    ] })
  ] });
}
function AgendaForm({ c, tension: tension2, disabled, error, onSubmit }) {
  const { p: processText } = useGovernanceLocalization();
  const { formatInstant: formatInstant2, locale } = useGovernanceLocalization();
  const [meetings, setMeetings] = useState3([]), [loading, setLoading] = useState3(true), [loadFailure, setLoadError] = useState3(null), [selected, setSelected] = useState3(""), [target, setTarget] = useState3(null), [checking, setChecking] = useState3(false), [refresh, setRefresh] = useState3(0);
  const loadError = loadFailure === "AGENDA_TARGET_DENIED" ? processText("agendaDenied") : loadFailure ? governanceError(loadFailure, locale) : "";
  useEffect3(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError("");
    setMeetings([]);
    setSelected("");
    setTarget(null);
    void (async () => {
      try {
        let cursor = null;
        const items = [];
        do {
          const result = await c.api("/organizations/" + c.organizationId + "/meetings?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""), { signal: abort.signal });
          items.push(...result.data.items.filter((meeting2) => meeting2.circleId === tension2?.circleId && ["SCHEDULED", "RUNNING"].includes(meeting2.state)));
          cursor = result.data.page.nextCursor;
        } while (cursor && !abort.signal.aborted);
        if (!abort.signal.aborted) setMeetings(items);
      } catch (cause) {
        if (!abort.signal.aborted) setLoadError(cause);
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [c.api, c.organizationId, tension2?.circleId]);
  useEffect3(() => {
    const abort = new AbortController();
    setTarget(null);
    if (!selected) {
      setChecking(false);
      return () => abort.abort();
    }
    setChecking(true);
    setLoadError("");
    void c.api("/organizations/" + c.organizationId + "/meetings/" + selected, { signal: abort.signal }).then((result) => {
      if (abort.signal.aborted) return;
      const { meeting: meeting2, capabilities } = result.data;
      if (meeting2.circleId !== tension2?.circleId || !["SCHEDULED", "RUNNING"].includes(meeting2.state) || !capabilities.edit || meeting2.method === "HOLACRACY" && meeting2.state === "RUNNING" && !capabilities.manage) {
        setLoadError("AGENDA_TARGET_DENIED");
        return;
      }
      setTarget(meeting2);
    }).catch((cause) => {
      if (!abort.signal.aborted) setLoadError(cause);
    }).finally(() => {
      if (!abort.signal.aborted) setChecking(false);
    });
    return () => abort.abort();
  }, [c.api, c.organizationId, selected, refresh, tension2?.circleId]);
  return /* @__PURE__ */ jsxs2("form", { className: "gov-form", onSubmit: (event) => {
    event.preventDefault();
    if (target && !disabled && !checking) void onSubmit({ meetingId: target.id, meetingVersion: target.version });
  }, children: [
    /* @__PURE__ */ jsx4("p", { children: tension2?.title }),
    loading ? /* @__PURE__ */ jsxs2("p", { role: "status", children: [
      processText("loadingMeetings"),
      " "
    ] }) : loadError && meetings.length === 0 ? null : meetings.length === 0 ? /* @__PURE__ */ jsxs2("p", { role: "status", children: [
      processText("noMeetings"),
      " "
    ] }) : /* @__PURE__ */ jsx4(Field, { label: processText("destinationMeeting"), children: /* @__PURE__ */ jsxs2("select", { value: selected, disabled, required: true, onChange: (event) => {
      setTarget(null);
      setSelected(event.target.value);
    }, children: [
      /* @__PURE__ */ jsxs2("option", { value: "", children: [
        processText("selectMeeting"),
        " "
      ] }),
      meetings.map((meeting2) => /* @__PURE__ */ jsxs2("option", { value: meeting2.id, children: [
        meeting2.title,
        " \xB7 ",
        formatInstant2(meeting2.startAt)
      ] }, meeting2.id))
    ] }) }),
    checking && /* @__PURE__ */ jsxs2("p", { role: "status", children: [
      processText("checkingMeeting"),
      " "
    ] }),
    target && /* @__PURE__ */ jsx4("p", { className: "muted", children: processText("agendaExplanation", { meeting: target.title }) }),
    (loadError || error) && /* @__PURE__ */ jsx4("p", { role: "alert", children: loadError || error }),
    selected && /* @__PURE__ */ jsxs2("button", { type: "button", disabled: disabled || checking, onClick: () => setRefresh((value) => value + 1), children: [
      processText("refreshMeeting"),
      " "
    ] }),
    /* @__PURE__ */ jsxs2("button", { className: "primary", disabled: disabled || loading || checking || !target, children: [
      processText("addToAgenda"),
      " "
    ] })
  ] });
}
function NominationForm({
  c,
  disabled,
  onSubmit
}) {
  const { f, ui, d, formatNumber: formatNumber2 } = useGovernanceLocalization();
  return /* @__PURE__ */ jsxs2("section", { className: "gov-process", children: [
    /* @__PURE__ */ jsxs2("h2", { children: [
      f("nominations"),
      " "
    ] }),
    /* @__PURE__ */ jsxs2(
      "form",
      {
        className: "gov-form",
        onSubmit: (e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          onSubmit(
            String(values.get("candidateId")),
            String(values.get("rationale"))
          );
        },
        children: [
          /* @__PURE__ */ jsx4(Field, { label: f("candidate"), children: /* @__PURE__ */ jsxs2("select", { required: true, name: "candidateId", children: [
            /* @__PURE__ */ jsxs2("option", { value: "", children: [
              f("select"),
              " "
            ] }),
            c.members.filter((m) => m.status === "ACTIVE").map((m) => /* @__PURE__ */ jsx4("option", { value: m.id, children: m.displayName }, m.id))
          ] }) }),
          /* @__PURE__ */ jsx4(Field, { label: f("nominationReason"), children: /* @__PURE__ */ jsx4("textarea", { name: "rationale", required: true, maxLength: 1e4 }) }),
          /* @__PURE__ */ jsxs2("button", { disabled, children: [
            f("recordNomination"),
            " "
          ] })
        ]
      }
    ),
    /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
      f("nominationHelp"),
      " "
    ] })
  ] });
}
function DocumentTypeForm({
  types,
  disabled,
  onSubmit
}) {
  const { f, ui, d, formatNumber: formatNumber2 } = useGovernanceLocalization();
  const [selected, setSelected] = useState3("");
  const type = types.find((t) => t.id === selected);
  return /* @__PURE__ */ jsxs2(
    "form",
    {
      className: "gov-form",
      onSubmit: (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onSubmit(
          {
            name: data.get("name"),
            workflow: data.get("workflow"),
            ...type ? { active: data.get("active") === "on" } : {}
          },
          type
        );
      },
      children: [
        /* @__PURE__ */ jsx4(Field, { label: d("type"), children: /* @__PURE__ */ jsxs2("select", { value: selected, onChange: (e) => setSelected(e.target.value), children: [
          /* @__PURE__ */ jsxs2("option", { value: "", children: [
            f("createType"),
            " "
          ] }),
          types.map((t) => /* @__PURE__ */ jsx4("option", { value: t.id, children: t.name }, t.id))
        ] }) }),
        /* @__PURE__ */ jsx4(Field, { label: f("name"), children: /* @__PURE__ */ jsx4(
          "input",
          {
            name: "name",
            defaultValue: type?.name ?? "",
            required: true,
            maxLength: 200
          }
        ) }),
        /* @__PURE__ */ jsx4(Field, { label: f("publication"), children: /* @__PURE__ */ jsxs2("select", { name: "workflow", defaultValue: type?.workflow ?? "DIRECT", children: [
          /* @__PURE__ */ jsxs2("option", { value: "DIRECT", children: [
            f("direct"),
            " "
          ] }),
          /* @__PURE__ */ jsxs2("option", { value: "GOVERNANCE", children: [
            f("byGovernance"),
            " "
          ] })
        ] }) }),
        type && /* @__PURE__ */ jsxs2("label", { className: "gov-checkbox", children: [
          /* @__PURE__ */ jsx4("input", { type: "checkbox", name: "active", defaultChecked: type.active }),
          " ",
          f("activeType"),
          " "
        ] }),
        /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
          f("keepWorkflow"),
          " "
        ] }),
        /* @__PURE__ */ jsxs2("button", { className: "primary", disabled, children: [
          f("saveType"),
          " "
        ] })
      ]
    },
    selected
  );
}
function VoteForm({
  disabled,
  allowAbstain,
  locked,
  onSubmit
}) {
  const { label, d, ui } = useGovernanceLocalization();
  const [choice, setChoice] = useState3("CONSENT"), [rationale, setRationale] = useState3("");
  if (locked)
    return /* @__PURE__ */ jsx4("p", { children: d("lockedVote") });
  return /* @__PURE__ */ jsxs2(
    "form",
    {
      className: "gov-form",
      onSubmit: (e) => {
        e.preventDefault();
        onSubmit(choice, rationale);
      },
      children: [
        /* @__PURE__ */ jsx4(Field, { label: ui("yourVote"), children: /* @__PURE__ */ jsx4("select", { value: choice, onChange: (e) => setChoice(e.target.value), children: (allowAbstain ? ["CONSENT", "ABSTAIN", "OBJECT"] : ["CONSENT", "OBJECT"]).map((s) => /* @__PURE__ */ jsx4("option", { value: s, children: label(s) }, s)) }) }),
        /* @__PURE__ */ jsx4(Field, { label: choice === "OBJECT" ? d("objectionReason") : d("comment"), children: /* @__PURE__ */ jsx4(
          "textarea",
          {
            value: rationale,
            onChange: (e) => setRationale(e.target.value),
            required: choice === "OBJECT",
            maxLength: 1e4
          }
        ) }),
        /* @__PURE__ */ jsx4("button", { disabled, children: d("recordVote") })
      ]
    }
  );
}
function ObjectionForm({
  owner,
  mine,
  disabled,
  onSubmit
}) {
  const { label, d, ui } = useGovernanceLocalization();
  const [state, setState] = useState3(owner ? "TESTING" : "WITHDRAWN"), [reason, setReason] = useState3("");
  if (!owner && !mine) return null;
  return /* @__PURE__ */ jsxs2(
    "form",
    {
      className: "gov-form",
      onSubmit: (e) => {
        e.preventDefault();
        onSubmit(state, reason);
      },
      children: [
        /* @__PURE__ */ jsx4(Field, { label: d("reviewOutcome"), children: /* @__PURE__ */ jsx4("select", { value: state, onChange: (e) => setState(e.target.value), children: (owner ? ["TESTING", "VALID", "INTEGRATED", "INVALID", "WITHDRAWN"] : ["WITHDRAWN"]).map((s) => /* @__PURE__ */ jsx4("option", { value: s, children: label(s) }, s)) }) }),
        /* @__PURE__ */ jsx4(Field, { label: d("humanReason"), children: /* @__PURE__ */ jsx4(
          "textarea",
          {
            required: true,
            value: reason,
            onChange: (e) => setReason(e.target.value)
          }
        ) }),
        /* @__PURE__ */ jsx4("button", { disabled, children: d("recordOutcome") })
      ]
    }
  );
}
function ReasonForm({
  error,
  onRefresh,
  decide,
  manual = true,
  disabled,
  onSubmit
}) {
  const { label, d, ui } = useGovernanceLocalization();
  const [verdict, setVerdict] = useState3("ADOPT");
  return /* @__PURE__ */ jsxs2(
    "form",
    {
      className: "gov-form",
      onSubmit: (e) => {
        e.preventDefault();
        if (disabled) return;
        const f = new FormData(e.currentTarget);
        onSubmit({
          reason: f.get("reason"),
          ...decide && manual ? { verdict: f.get("verdict") } : {}
        });
      },
      children: [
        error && /* @__PURE__ */ jsxs2("div", { className: "gov-notice", role: "alert", children: [
          error,
          onRefresh && /* @__PURE__ */ jsx4("button", { type: "button", disabled, onClick: onRefresh, children: d("refresh") })
        ] }),
        decide && manual && /* @__PURE__ */ jsx4(Field, { label: d("decision"), children: /* @__PURE__ */ jsx4("select", { name: "verdict", value: verdict, disabled, onChange: (event) => setVerdict(event.target.value), children: ["ADOPT", "REVIEW_REQUIRED", "REJECT"].map((s) => /* @__PURE__ */ jsx4("option", { value: s, children: label(s) }, s)) }) }),
        decide && !manual && /* @__PURE__ */ jsx4("p", { children: d("automaticResult") }),
        /* @__PURE__ */ jsx4(Field, { label: d("reason"), children: /* @__PURE__ */ jsx4("textarea", { name: "reason", required: true, maxLength: 1e4, disabled }) }),
        /* @__PURE__ */ jsx4("button", { className: "primary", disabled, children: d("record") })
      ]
    }
  );
}
function ContentForm({
  content,
  disabled,
  error,
  onSubmit
}) {
  const { f, ui, d, formatNumber: formatNumber2 } = useGovernanceLocalization();
  const [value, setValue] = useState3(() => readContent(content));
  return /* @__PURE__ */ jsxs2(
    "form",
    {
      className: "gov-form",
      onSubmit: (e) => {
        e.preventDefault();
        onSubmit(value);
      },
      children: [
        /* @__PURE__ */ jsx4(RichTextEditor, { label: f("content"), value, onChange: setValue, readOnly: disabled, pending: disabled, error }),
        /* @__PURE__ */ jsxs2("button", { className: "primary", disabled, children: [
          f("saveRevision"),
          " "
        ] })
      ]
    }
  );
}
function CreateForm({
  c,
  section,
  docs,
  types,
  branch,
  editingBranch = false,
  tension: tension2,
  detail,
  document: document2,
  disabled,
  onSubmit
}) {
  const { label, prefs, f, ui, d, formatNumber: formatNumber2, locale } = useGovernanceLocalization();
  const original = detail?.revisions.find(
    (r) => r.number === detail.proposal.revision
  )?.payload;
  const [kind, setKind] = useState3(
    document2 ? "DOCUMENT" : detail?.proposal.kind ?? "GOVERNANCE"
  ), [circle2, setCircle] = useState3(
    detail?.proposal.circleId ?? tension2?.circleId ?? (c.bootstrap.rootCircleId ?? "")
  ), [selectedDocument, setSelectedDocument] = useState3(
    document2?.id ?? original?.documentId ?? ""
  ), [changeKind, setChangeKind] = useState3("UPDATE"), [entityId, setEntityId] = useState3(""), [list, setList] = useState3(
    original?.changes ?? branch?.changes ?? []
  ), [changeName, setChangeName] = useState3(""), [purpose, setPurpose] = useState3(""), [parent, setParent] = useState3(c.bootstrap.rootCircleId ?? ""), [entityKind, setEntityKind] = useState3("ROLE"), [governedFields, setGovernedFields] = useState3([]), [fieldId, setFieldId] = useState3(""), [fieldValue, setFieldValue] = useState3(null), [localFailure, setLocalError] = useState3(null);
  const localError = isGovernanceFormMessage(localFailure) ? f(localFailure) : localFailure ? governanceError(localFailure, locale) : "";
  const [richContent, setRichContent] = useState3();
  const [purposeRich, setPurposeRich] = useState3();
  const [purposeTouched, setPurposeTouched] = useState3(false);
  const [descriptionRich, setDescriptionRich] = useState3();
  useEffect3(() => {
    const abort = new AbortController();
    setGovernedFields([]);
    setFieldId("");
    if (entityId && changeKind === "FIELD")
      void c.api(
        "/organizations/" + c.organizationId + "/structure-advanced/entities/" + entityId + "/fields",
        { signal: abort.signal }
      ).then((result) => {
        if (abort.signal.aborted) return;
        setGovernedFields(
          result.data.filter((f2) => f2.field.schema.type !== "COMPUTED")
        );
      }).catch((e) => {
        if (!abort.signal.aborted) setLocalError(e);
      });
    return () => abort.abort();
  }, [entityId, changeKind, c.organizationId]);
  const circles = c.structure.nodes.filter((n) => n.kind === "CIRCLE"), roles = c.structure.nodes.filter((n) => n.kind === "ROLE");
  function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") ?? "");
    if (section === "tensions" && (!title.trim() || Array.from(title.trim()).length > 200)) {
      setLocalError("titleInvalid");
      return;
    }
    let values;
    if (section === "tensions")
      values = {
        title,
        circleId: circle2,
        ...descriptionRich ? { descriptionRich } : { description: "" }
      };
    else if (section === "documents")
      values = {
        title,
        ownerId: circle2,
        workflow: form.get("workflow"),
        visibility: form.get("visibility"),
        ...richContent ? { richContent } : { content: "" },
        ...form.get("typeId") ? { typeId: form.get("typeId") } : {}
      };
    else if (section === "branches") {
      if (!list.length) {
        setLocalError("changeRequired");
        return;
      }
      values = { title, changes: list };
    } else {
      let payload;
      if (kind === "GOVERNANCE") {
        if (!list.length) {
          setLocalError("changeRequired");
          return;
        }
        payload = { changes: list };
      } else if (kind === "DOCUMENT") {
        const d2 = docs.find((d3) => d3.id === selectedDocument);
        if (!d2) {
          setLocalError("agreementRequired");
          return;
        }
        payload = { documentId: d2.id, documentVersion: d2.draftVersion };
      } else {
        let mandateEnd;
        try {
          mandateEnd = mandateInstant(String(form.get("mandateEnd")), prefs.timeZone, original?.mandateEnd);
        } catch (error) {
          setLocalError(error instanceof Error && error.message === "AMBIGUOUS_MANDATE_TIME" ? "dstFold" : "dstGap");
          return;
        }
        payload = {
          roleId: form.get("roleId"),
          winnerId: form.get("winnerId") || null,
          mandateEnd
        };
      }
      values = detail ? { payload } : { title, circleId: circle2, kind, payload };
    }
    onSubmit(values);
  }
  function addChange() {
    let change;
    if (changeKind === "CREATE") {
      if (!changeName.trim()) {
        setLocalError("nameRequired");
        return;
      }
      change = {
        kind: changeKind,
        entityId: crypto.randomUUID(),
        entityKind,
        parentCircleId: parent,
        name: changeName,
        ...purposeRich ? { purposeRich } : { purpose }
      };
    } else {
      const node = c.structure.nodes.find((n) => n.entityId === entityId);
      if (!node) {
        setLocalError("entityRequired");
        return;
      }
      change = { kind: changeKind, entityId, baseVersion: node.version };
      if (changeKind === "FIELD") {
        const field = governedFields.find((f2) => f2.field.id === fieldId);
        if (!field) {
          setLocalError("fieldRequired");
          return;
        }
        change = {
          kind: "FIELD",
          entityId,
          fieldId,
          baseVersion: field.version,
          value: fieldValue
        };
      }
      if (changeKind === "UPDATE") {
        change.name = changeName || node.name;
        if (purposeTouched) {
          if (purposeRich) change.purposeRich = purposeRich;
          else change.purpose = purpose;
        }
      }
      if (changeKind === "MOVE") change.parentCircleId = parent;
    }
    setList([...list, change]);
    setLocalError("");
    setChangeName("");
    setPurpose("");
    setPurposeRich(void 0);
    setPurposeTouched(false);
  }
  return /* @__PURE__ */ jsxs2("form", { className: "gov-form", onSubmit: submit, children: [
    !detail && /* @__PURE__ */ jsx4(Field, { label: ui("title"), children: /* @__PURE__ */ jsx4(
      "input",
      {
        name: "title",
        required: true,
        maxLength: section === "tensions" ? 400 : 200,
        defaultValue: document2 ? f("publishTitle", { title: document2.title }) : branch?.title ?? tension2?.title ?? ""
      }
    ) }),
    !detail && section !== "branches" && /* @__PURE__ */ jsx4(
      Field,
      {
        label: section === "documents" ? f("linkedCircle") : ui("circle"),
        children: /* @__PURE__ */ jsx4("select", { value: circle2, onChange: (e) => setCircle(e.target.value), children: circles.map((n) => /* @__PURE__ */ jsx4("option", { value: n.entityId, children: n.name }, n.entityId)) })
      }
    ),
    section === "tensions" && /* @__PURE__ */ jsx4(RichTextEditor, { label: f("description"), value: descriptionRich ?? "", onChange: setDescriptionRich, readOnly: disabled, pending: disabled }),
    section === "documents" && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx4(Field, { label: f("agreementType"), children: /* @__PURE__ */ jsxs2("select", { name: "typeId", children: [
        /* @__PURE__ */ jsxs2("option", { value: "", children: [
          f("noType"),
          " "
        ] }),
        types.filter((t) => t.active).map((t) => /* @__PURE__ */ jsxs2("option", { value: t.id, children: [
          t.name,
          " \xB7",
          " ",
          t.workflow === "DIRECT" ? "Direto" : f("governance")
        ] }, t.id))
      ] }) }),
      /* @__PURE__ */ jsx4(Field, { label: f("publicationProcess"), children: /* @__PURE__ */ jsxs2("select", { name: "workflow", children: [
        /* @__PURE__ */ jsxs2("option", { value: "DIRECT", children: [
          f("directPublication"),
          " "
        ] }),
        /* @__PURE__ */ jsxs2("option", { value: "GOVERNANCE", children: [
          f("governanceProposal"),
          " "
        ] })
      ] }) }),
      /* @__PURE__ */ jsx4(Field, { label: f("visibility"), children: /* @__PURE__ */ jsxs2("select", { name: "visibility", children: [
        /* @__PURE__ */ jsxs2("option", { value: "ORGANIZATION", children: [
          f("organization"),
          " "
        ] }),
        /* @__PURE__ */ jsxs2("option", { value: "AUTHOR", children: [
          f("authorOnly"),
          " "
        ] })
      ] }) }),
      /* @__PURE__ */ jsx4(RichTextEditor, { label: f("content"), value: richContent ?? "", onChange: setRichContent, readOnly: disabled, pending: disabled })
    ] }),
    section === "proposals" && !detail && !branch && /* @__PURE__ */ jsx4(Field, { label: d("type"), children: /* @__PURE__ */ jsx4("select", { value: kind, onChange: (e) => setKind(e.target.value), children: ["GOVERNANCE", "DOCUMENT", "ELECTION"].map((s) => /* @__PURE__ */ jsx4("option", { value: s, children: label(s) }, s)) }) }),
    branch && !editingBranch && /* @__PURE__ */ jsxs2("p", { children: [
      f("branchExact"),
      " "
    ] }),
    (!branch || editingBranch) && (section === "branches" || section === "proposals" && kind === "GOVERNANCE") && /* @__PURE__ */ jsxs2("fieldset", { className: "gov-change-builder", children: [
      /* @__PURE__ */ jsxs2("legend", { children: [
        f("structureEvolution"),
        " "
      ] }),
      /* @__PURE__ */ jsx4(Field, { label: f("change"), children: /* @__PURE__ */ jsx4(
        "select",
        {
          value: changeKind,
          onChange: (e) => setChangeKind(e.target.value),
          children: [
            ["UPDATE", f("update")],
            ["CREATE", f("create")],
            ["MOVE", f("move")],
            ["ARCHIVE", f("archive")],
            ["FIELD", f("fieldChange")]
          ].map(([v, l]) => /* @__PURE__ */ jsx4("option", { value: v, children: l }, v))
        }
      ) }),
      changeKind === "CREATE" ? /* @__PURE__ */ jsx4(Field, { label: f("create"), children: /* @__PURE__ */ jsxs2(
        "select",
        {
          value: entityKind,
          onChange: (e) => setEntityKind(e.target.value),
          children: [
            /* @__PURE__ */ jsxs2("option", { value: "ROLE", children: [
              f("role"),
              " "
            ] }),
            /* @__PURE__ */ jsxs2("option", { value: "CIRCLE", children: [
              ui("circle"),
              " "
            ] })
          ]
        }
      ) }) : /* @__PURE__ */ jsx4(Field, { label: f("entity"), children: /* @__PURE__ */ jsxs2(
        "select",
        {
          value: entityId,
          onChange: (e) => {
            setEntityId(e.target.value);
            const selectedPurpose = [...c.structure.circles, ...c.structure.roles].find((n) => n.id === e.target.value);
            setPurposeRich(selectedPurpose?.purposeRich ?? void 0);
            setPurposeTouched(false);
            setPurpose(
              [...c.structure.circles, ...c.structure.roles].find(
                (n) => n.id === e.target.value
              )?.purpose ?? ""
            );
            setChangeName(
              c.structure.nodes.find(
                (n) => n.entityId === e.target.value
              )?.name ?? ""
            );
          },
          children: [
            /* @__PURE__ */ jsxs2("option", { value: "", children: [
              f("select"),
              " "
            ] }),
            c.structure.nodes.map((n) => /* @__PURE__ */ jsx4("option", { value: n.entityId, children: n.name }, n.entityId))
          ]
        }
      ) }),
      changeKind === "FIELD" && /* @__PURE__ */ jsxs2(Fragment, { children: [
        /* @__PURE__ */ jsx4(Field, { label: f("field"), children: /* @__PURE__ */ jsxs2(
          "select",
          {
            value: fieldId,
            onChange: (e) => {
              setFieldId(e.target.value);
              setFieldValue(
                governedFields.find(
                  (f2) => f2.field.id === e.target.value
                )?.value ?? null
              );
            },
            children: [
              /* @__PURE__ */ jsxs2("option", { value: "", children: [
                f("select"),
                " "
              ] }),
              governedFields.map((f2) => /* @__PURE__ */ jsx4("option", { value: f2.field.id, children: f2.field.label }, f2.field.id))
            ]
          }
        ) }),
        fieldId && (() => {
          const schema = governedFields.find(
            (f2) => f2.field.id === fieldId
          ).field.schema;
          return /* @__PURE__ */ jsx4(Field, { label: f("newValue"), children: schema.type === "BOOLEAN" ? /* @__PURE__ */ jsxs2(
            "select",
            {
              value: fieldValue === null ? "" : String(fieldValue),
              onChange: (e) => setFieldValue(
                e.target.value === "" ? null : e.target.value === "true"
              ),
              children: [
                /* @__PURE__ */ jsxs2("option", { value: "", children: [
                  f("empty"),
                  " "
                ] }),
                /* @__PURE__ */ jsxs2("option", { value: "true", children: [
                  f("yes"),
                  " "
                ] }),
                /* @__PURE__ */ jsxs2("option", { value: "false", children: [
                  f("no"),
                  " "
                ] })
              ]
            }
          ) : schema.type === "SELECT" || schema.type === "MULTI" ? /* @__PURE__ */ jsxs2(
            "select",
            {
              multiple: schema.type === "MULTI",
              value: schema.type === "MULTI" ? Array.isArray(fieldValue) ? fieldValue : [] : String(fieldValue ?? ""),
              onChange: (e) => setFieldValue(
                schema.type === "MULTI" ? Array.from(e.target.selectedOptions).map(
                  (o) => o.value
                ) : e.target.value
              ),
              children: [
                schema.type === "SELECT" && /* @__PURE__ */ jsxs2("option", { value: "", children: [
                  f("select"),
                  " "
                ] }),
                schema.options?.map((option) => /* @__PURE__ */ jsx4("option", { value: option, children: option }, option))
              ]
            }
          ) : /* @__PURE__ */ jsx4(
            "input",
            {
              type: schema.type === "NUMBER" ? "number" : schema.type === "DATE" ? "date" : "text",
              value: String(fieldValue ?? ""),
              onChange: (e) => setFieldValue(
                e.target.value === "" ? null : schema.type === "NUMBER" ? Number(e.target.value) : e.target.value
              )
            }
          ) });
        })()
      ] }),
      ["UPDATE", "CREATE"].includes(changeKind) && /* @__PURE__ */ jsxs2(Fragment, { children: [
        /* @__PURE__ */ jsx4(Field, { label: f("name"), children: /* @__PURE__ */ jsx4(
          "input",
          {
            value: changeName,
            onChange: (e) => setChangeName(e.target.value),
            maxLength: 200
          }
        ) }),
        /* @__PURE__ */ jsx4(RichTextEditor, { label: f("purpose"), value: purposeRich ?? purpose, onChange: (value) => {
          setPurposeRich(value);
          setPurposeTouched(true);
        }, readOnly: disabled, pending: disabled }, entityId + ":" + list.length + ":" + changeKind)
      ] }),
      ["MOVE", "CREATE"].includes(changeKind) && /* @__PURE__ */ jsx4(Field, { label: f("destination"), children: /* @__PURE__ */ jsx4(
        "select",
        {
          value: parent,
          onChange: (e) => setParent(e.target.value),
          children: circles.map((n) => /* @__PURE__ */ jsx4("option", { value: n.entityId, children: n.name }, n.entityId))
        }
      ) }),
      /* @__PURE__ */ jsxs2("button", { type: "button", onClick: addChange, children: [
        f("addChange"),
        " "
      ] }),
      /* @__PURE__ */ jsx4("ol", { children: list.map((change, i) => /* @__PURE__ */ jsxs2("li", { children: [
        change.kind,
        " \xB7",
        " ",
        change.name ?? c.structure.nodes.find(
          (n) => n.entityId === change.entityId
        )?.name,
        /* @__PURE__ */ jsxs2(
          "button",
          {
            type: "button",
            onClick: () => setList(list.filter((_, index) => index !== i)),
            "aria-label": f("removeChange", { number: formatNumber2(i + 1) }),
            children: [
              f("remove"),
              " "
            ]
          }
        )
      ] }, i)) })
    ] }),
    section === "proposals" && kind === "DOCUMENT" && /* @__PURE__ */ jsx4(Field, { label: f("agreementToPublish"), children: /* @__PURE__ */ jsxs2(
      "select",
      {
        required: true,
        value: selectedDocument,
        onChange: (e) => setSelectedDocument(e.target.value),
        children: [
          /* @__PURE__ */ jsxs2("option", { value: "", children: [
            f("select"),
            " "
          ] }),
          docs.filter(
            (d2) => d2.workflow === "GOVERNANCE" && d2.visibility === "ORGANIZATION"
          ).map((d2) => /* @__PURE__ */ jsxs2("option", { value: d2.id, children: [
            d2.title,
            " \xB7 ",
            f("revisionLower"),
            " ",
            d2.draftVersion
          ] }, d2.id))
        ]
      }
    ) }),
    section === "proposals" && kind === "ELECTION" && /* @__PURE__ */ jsxs2(Fragment, { children: [
      /* @__PURE__ */ jsx4(Field, { label: f("electedRole"), children: /* @__PURE__ */ jsxs2("select", { name: "roleId", required: true, defaultValue: original?.roleId, children: [
        /* @__PURE__ */ jsxs2("option", { value: "", children: [
          f("select"),
          " "
        ] }),
        roles.map((n) => /* @__PURE__ */ jsx4("option", { value: n.entityId, children: n.name }, n.entityId))
      ] }) }),
      /* @__PURE__ */ jsx4(Field, { label: f("facilitatorCandidate"), children: /* @__PURE__ */ jsxs2(
        "select",
        {
          name: "winnerId",
          disabled: !c.bootstrap.capabilities?.["structure.direct"],
          defaultValue: original?.winnerId ?? "",
          children: [
            /* @__PURE__ */ jsxs2("option", { value: "", children: [
              f("chooseOnRevision"),
              " "
            ] }),
            c.members.filter((m) => m.status === "ACTIVE").map((m) => /* @__PURE__ */ jsx4("option", { value: m.id, children: m.displayName }, m.id))
          ]
        }
      ) }),
      /* @__PURE__ */ jsx4(Field, { label: f("termEnd") + " \xB7 " + prefs.timeZone, children: /* @__PURE__ */ jsx4("input", { type: "datetime-local", name: "mandateEnd", required: true, defaultValue: mandateInput(original?.mandateEnd, prefs.timeZone) }) }),
      /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
        f("electionHelp"),
        " "
      ] })
    ] }),
    localError && /* @__PURE__ */ jsx4("p", { role: "alert", children: localError }),
    /* @__PURE__ */ jsx4("button", { className: "primary", disabled, children: disabled ? f("saving") : detail ? f("saveRevision") : editingBranch ? f("saveDraft") : f("create") })
  ] });
}
function PolicyForm({
  c,
  existing,
  disabled,
  onSubmit
}) {
  const { p: processText } = useGovernanceLocalization();
  const { label, ui, locale } = useGovernanceLocalization();
  const [config, setConfig] = useState3(
    existing?.configuration ?? initialPolicy
  );
  const [circleId, setCircleId] = useState3(existing?.circleId ?? c.bootstrap.rootCircleId ?? "");
  const [resolution, setResolution] = useState3(null);
  const [policyFailure, setPolicyError] = useState3(null);
  const policyError = policyFailure === "NO_CIRCLE" ? processText("noCircle") : policyFailure ? governanceError(policyFailure, locale) : "";
  useEffect3(() => {
    const abort = new AbortController();
    setResolution(null);
    setPolicyError("");
    if (!circleId) {
      setPolicyError("NO_CIRCLE");
      return () => abort.abort();
    }
    void c.api(
      "/organizations/" + c.organizationId + "/governance/policies/" + circleId + "/effective",
      { signal: abort.signal }
    ).then((result) => {
      if (abort.signal.aborted) return;
      setConfig(result.data.configuration);
      setResolution(result.data);
    }).catch((error) => {
      if (!abort.signal.aborted) setPolicyError(error);
    });
    return () => abort.abort();
  }, [c.api, c.organizationId, circleId]);
  const locked = !resolution || !resolution.allowOverride;
  return /* @__PURE__ */ jsxs2(
    "form",
    {
      className: "gov-form",
      onSubmit: (e) => {
        e.preventDefault();
        if (locked || policyError) return;
        onSubmit(
          {
            circleId: new FormData(e.currentTarget).get("circleId"),
            configuration: config
          },
          resolution?.localVersion ?? existing?.version
        );
      },
      children: [
        /* @__PURE__ */ jsxs2(Field, { label: ui("circle"), children: [
          /* @__PURE__ */ jsx4(
            "select",
            {
              name: "circleId",
              value: circleId,
              onChange: (e) => {
                setResolution(null);
                setCircleId(e.target.value);
              },
              disabled: !!existing,
              children: c.structure.nodes.filter((n) => n.kind === "CIRCLE").map((n) => /* @__PURE__ */ jsx4("option", { value: n.entityId, children: n.name }, n.entityId))
            }
          ),
          existing && /* @__PURE__ */ jsx4("input", { type: "hidden", name: "circleId", value: existing.circleId })
        ] }),
        policyError ? /* @__PURE__ */ jsx4("p", { role: "alert", children: policyError }) : !resolution ? /* @__PURE__ */ jsxs2("p", { role: "status", children: [
          processText("loadingPolicy"),
          " "
        ] }) : /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
          processText("effectivePolicy"),
          " ",
          { LOCAL: processText("localPolicy"), ORGANIZATION: processText("orgPolicy"), DOMAIN: processText("defaultPolicy") }[resolution.policySource],
          ".",
          !resolution.allowOverride && " " + processText("overrideForbidden")
        ] }),
        /* @__PURE__ */ jsxs2("fieldset", { className: "gov-policy-fields", disabled: disabled || locked, children: [
          /* @__PURE__ */ jsx4(Field, { label: processText("draftAccess"), children: /* @__PURE__ */ jsxs2("select", { value: config.draftAccess ?? "AUTHOR_ONLY", onChange: (e) => setConfig({ ...config, draftAccess: e.target.value }), children: [
            /* @__PURE__ */ jsxs2("option", { value: "AUTHOR_ONLY", children: [
              processText("authorOnly"),
              " "
            ] }),
            /* @__PURE__ */ jsxs2("option", { value: "AUTHOR_AND_LEAD_LINKS", disabled: !resolution?.leadLinkAccessAvailable, children: [
              processText("authorLeads"),
              " "
            ] }),
            /* @__PURE__ */ jsxs2("option", { value: "CIRCLE_MEMBERS", children: [
              processText("circleMembers"),
              " "
            ] })
          ] }) }),
          !resolution?.leadLinkAccessAvailable && /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
            processText("leadUnavailable"),
            " "
          ] }),
          /* @__PURE__ */ jsx4(Field, { label: processText("workflow"), children: /* @__PURE__ */ jsxs2(
            "select",
            {
              value: JSON.stringify(config.workflowSteps) === JSON.stringify(initialPolicy.workflowSteps) ? "FULL" : JSON.stringify(config.workflowSteps) === JSON.stringify(["PRESENT", "DECIDE"]) ? "SIMPLIFIED" : "CUSTOM",
              onChange: (e) => {
                if (e.target.value !== "CUSTOM") setConfig({ ...config, workflowSteps: e.target.value === "FULL" ? [...initialPolicy.workflowSteps] : ["PRESENT", "DECIDE"] });
              },
              children: [
                /* @__PURE__ */ jsxs2("option", { value: "FULL", children: [
                  processText("fullFlow"),
                  " "
                ] }),
                /* @__PURE__ */ jsxs2("option", { value: "SIMPLIFIED", children: [
                  processText("simpleFlow"),
                  " "
                ] }),
                /* @__PURE__ */ jsxs2("option", { value: "CUSTOM", disabled: true, children: [
                  processText("customFlow"),
                  " "
                ] })
              ]
            }
          ) }),
          /* @__PURE__ */ jsx4(Field, { label: processText("method"), children: /* @__PURE__ */ jsx4(
            "select",
            {
              value: config.method,
              onChange: (e) => setConfig({ ...config, method: e.target.value }),
              children: ["MANUAL_FACILITATED", "CONSENT_ROUND", "CONSENT_WINDOW"].map(
                (s) => /* @__PURE__ */ jsx4("option", { value: s, children: label(s) }, s)
              )
            }
          ) }),
          /* @__PURE__ */ jsx4(Field, { label: processText("quorumPercent"), children: /* @__PURE__ */ jsx4(
            "input",
            {
              type: "number",
              min: "1",
              max: "100",
              required: true,
              value: config.quorumPercent,
              onChange: (e) => setConfig({ ...config, quorumPercent: Number(e.target.value) })
            }
          ) }),
          /* @__PURE__ */ jsx4(Field, { label: processText("responses"), children: /* @__PURE__ */ jsxs2(
            "select",
            {
              value: config.responseRequirement,
              onChange: (e) => setConfig({ ...config, responseRequirement: e.target.value }),
              children: [
                /* @__PURE__ */ jsxs2("option", { value: "QUORUM", children: [
                  processText("quorum"),
                  " "
                ] }),
                /* @__PURE__ */ jsxs2("option", { value: "ALL", children: [
                  processText("allParticipants"),
                  " "
                ] })
              ]
            }
          ) }),
          /* @__PURE__ */ jsx4(Field, { label: processText("duration"), children: /* @__PURE__ */ jsx4(
            "input",
            {
              type: "number",
              min: "1",
              max: "8760",
              value: config.reviewDurationHours,
              onChange: (e) => setConfig({
                ...config,
                reviewDurationHours: Number(e.target.value)
              })
            }
          ) }),
          /* @__PURE__ */ jsxs2("label", { className: "gov-checkbox", children: [
            /* @__PURE__ */ jsx4(
              "input",
              {
                type: "checkbox",
                checked: config.allowRevote,
                onChange: (e) => setConfig({ ...config, allowRevote: e.target.checked })
              }
            ),
            " ",
            processText("revote"),
            " "
          ] }),
          /* @__PURE__ */ jsxs2("label", { className: "gov-checkbox", children: [
            /* @__PURE__ */ jsx4(
              "input",
              {
                type: "checkbox",
                checked: config.allowAbstain,
                onChange: (e) => setConfig({ ...config, allowAbstain: e.target.checked })
              }
            ),
            " ",
            processText("abstain"),
            " "
          ] })
        ] }),
        /* @__PURE__ */ jsxs2("p", { className: "muted", children: [
          processText("policyEffect"),
          " "
        ] }),
        /* @__PURE__ */ jsxs2("button", { className: "primary", disabled: disabled || locked || !!policyError, children: [
          processText("savePolicy"),
          " "
        ] })
      ]
    }
  );
}
var initialPolicy, versionContent, feature;
var init_index = __esm({
  "web/src/features/governance/index.tsx"() {
    "use strict";
    init_api();
    init_editor();
    init_content();
    init_state_messages();
    init_form_messages();
    init_error_messages();
    init_misc_messages();
    init_date_input();
    initialPolicy = {
      draftAccess: "AUTHOR_ONLY",
      method: "MANUAL_FACILITATED",
      quorumPercent: 100,
      responseRequirement: "QUORUM",
      reviewDurationHours: 168,
      allowRevote: false,
      allowAbstain: true,
      workflowSteps: ["PRESENT", "CLARIFY", "REACT", "OBJECT", "DECIDE"]
    };
    versionContent = (version) => version?.richContent ?? version?.content ?? "";
    feature = {
      id: "governance",
      module: "structure",
      label: "Governan\xE7a",
      matches: (path) => /^\/(?:app\/)?structure\/(?:proposals|working-agreements|tensions|branches|governance-policy)(?:\/|$|\?)/.test(
        path
      ),
      Component: GovernanceFeature,
      navigation: [
        { path: "/structure/proposals", label: "Propostas", location: "sidebar" },
        {
          path: "/structure/working-agreements",
          label: "Acordos de trabalho",
          location: "sidebar"
        },
        { path: "/structure/tensions", label: "Tens\xF5es", location: "sidebar" },
        {
          path: "/structure/branches",
          label: "Rascunhos de estrutura",
          location: "sidebar",
          visible: (c) => c.bootstrap.membership.memberType !== "GUEST"
        },
        {
          path: "/structure/governance-policy",
          label: "Processo de governan\xE7a",
          location: "sidebar",
          visible: (c) => c.bootstrap.membership.memberType !== "GUEST"
        }
      ]
    };
  }
});

// web/src/features/governance/verify-process-dom.tsx
init_process_messages();
init_detail_messages();
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { act } from "react";
import { jsx as jsx5 } from "react/jsx-runtime";
var dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://governance.localhost" });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLFormElement", "FormData", "MutationObserver", "Event", "MouseEvent", "DOMException", "navigator"]) Object.defineProperty(globalThis, key, { value: key === "window" ? dom.window : dom.window[key], configurable: true });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
dom.window.HTMLDialogElement.prototype.showModal = function() {
  this.setAttribute("open", "");
};
var { createRoot } = await import("react-dom/client");
var { LocalizationProvider: LocalizationProvider2 } = await Promise.resolve().then(() => (init_localization(), localization_exports));
var { feature: feature2 } = await Promise.resolve().then(() => (init_index(), index_exports));
var Component = feature2.Component;
var container = dom.window.document.getElementById("root");
var circle = "00000000-0000-4000-8000-000000000001";
var tension = "00000000-0000-4000-8000-000000000002";
var meeting = "00000000-0000-4000-8000-000000000003";
var configuration = { draftAccess: "AUTHOR_ONLY", method: "MANUAL_FACILITATED", quorumPercent: 100, responseRequirement: "QUORUM", reviewDurationHours: 168, allowRevote: false, allowAbstain: true, workflowSteps: ["PRESENT", "CLARIFY", "REACT", "OBJECT", "DECIDE"] };
var results = [];
for (const locale of ["pt-BR", "en-US", "es-ES", "fr-FR", "de-DE", "it-IT", "ja-JP", "nl-NL"]) for (const mode of ["policy-allowed", "policy-locked", "agenda-allowed", "agenda-denied"]) {
  const p = governanceProcessTranslator(locale), d = governanceDetailTranslator(locale), writes = [], navigation = [];
  let meetingReads = 0;
  const policy = mode.startsWith("policy"), allowed = mode.endsWith("allowed");
  const context = { organizationId: "org", path: "/structure/" + (policy ? "governance-policy" : "tensions"), bootstrap: { membership: { id: "actor", orgRole: "OWNER", memberType: "MEMBER" }, rootCircleId: circle, modules: { meetings: true }, capabilities: { "structure.direct": true } }, structure: { nodes: [{ entityId: circle, kind: "CIRCLE", name: "Fixture Circle", version: 1 }], circles: [], roles: [], memberships: [], occupancies: [] }, members: [], session: {}, navigate: (path) => navigation.push(path), notify: () => {
  }, refresh: () => {
  }, api: async (path, options = {}) => {
    if (options.method === "POST") {
      writes.push({ path, body: options.body, version: options.version });
      return { data: { id: tension, version: 2 } };
    }
    if (path.endsWith("/effective")) return { data: { configuration, policySource: "ORGANIZATION", allowOverride: allowed, localVersion: 0, leadLinkAccessAvailable: false } };
    if (path.includes("/meetings?")) return { data: { items: [{ id: meeting, circleId: circle, title: "Fixture meeting", version: 7, state: "SCHEDULED", startAt: "2030-01-01T13:00:00Z", method: "STANDARD" }], page: { nextCursor: null } } };
    if (path.endsWith("/meetings/" + meeting)) return { data: { meeting: { id: meeting, circleId: circle, title: "Fixture meeting", version: 7 + ++meetingReads, state: "SCHEDULED", startAt: "2030-01-01T13:00:00Z", method: "STANDARD" }, capabilities: { edit: allowed, manage: false } } };
    assert.ok(path.endsWith("/governance/policies") || path.endsWith("/tensions") || path.endsWith("/documents") || path.endsWith("/document-types"));
    return { data: { items: path.endsWith("/tensions") ? [{ id: tension, circleId: circle, title: "Fixture tension", state: "OPEN", version: 1, authorId: "actor", canProcessAgenda: true }] : [], page: { nextCursor: null } } };
  } };
  const root = createRoot(container);
  await act(async () => root.render(/* @__PURE__ */ jsx5(LocalizationProvider2, { preferences: { locale }, children: /* @__PURE__ */ jsx5(Component, { context }) })));
  const button = (name, scope = container) => {
    const b = [...scope.querySelectorAll("button")].find((el) => el.textContent?.trim() === name);
    assert.ok(b, "Missing " + locale + " " + mode + " " + name);
    return b;
  };
  await act(async () => button(policy ? d("configureProcess") : p("agendaAction")).click());
  const dialog = container.querySelector("dialog");
  assert.ok(dialog);
  if (policy) {
    assert.ok(dialog.textContent?.includes(p("effectivePolicy")));
    assert.ok(dialog.textContent?.includes(p("leadUnavailable")));
    const field = (name) => {
      const l = [...dialog.querySelectorAll("label")].find((el) => el.querySelector(":scope > span")?.textContent === name);
      assert.ok(l);
      return l.querySelector("select");
    };
    assert.equal(field(p("draftAccess")).querySelector('option[value="AUTHOR_AND_LEAD_LINKS"]')?.disabled, true);
    const save = button(p("savePolicy"), dialog);
    if (!allowed) {
      assert.equal(save.disabled, true);
      assert.ok(dialog.textContent?.includes(p("overrideForbidden")));
      assert.equal(dialog.querySelector("fieldset")?.disabled, true);
    } else {
      for (const [name, value] of [[p("draftAccess"), "CIRCLE_MEMBERS"], [p("workflow"), "SIMPLIFIED"]]) {
        const select = field(name);
        await act(async () => {
          select.value = value;
          select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        });
      }
      await act(async () => save.click());
      assert.equal(writes.length, 1);
      assert.equal(writes[0].version, 0);
      assert.deepEqual(writes[0].body, { circleId: circle, configuration: { ...configuration, draftAccess: "CIRCLE_MEMBERS", workflowSteps: ["PRESENT", "DECIDE"] } });
    }
  } else {
    assert.equal(dialog.querySelector("h2")?.textContent, p("toAgenda"));
    const select = dialog.querySelector("select");
    await act(async () => {
      select.value = meeting;
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    const add = button(p("addToAgenda"), dialog);
    if (!allowed) {
      assert.equal(add.disabled, true);
      assert.ok(dialog.textContent?.includes(p("agendaDenied")));
      if (locale === "en-US") {
        const readsBefore = meetingReads;
        await act(async () => root.render(/* @__PURE__ */ jsx5(LocalizationProvider2, { preferences: { locale: "ja-JP" }, children: /* @__PURE__ */ jsx5(Component, { context }) })));
        assert.ok(dialog.querySelector('[role="alert"]')?.textContent?.includes(governanceProcessTranslator("ja-JP")("agendaDenied")));
        assert.equal(select.value, meeting);
        assert.equal(meetingReads, readsBefore);
        await act(async () => root.render(/* @__PURE__ */ jsx5(LocalizationProvider2, { preferences: { locale }, children: /* @__PURE__ */ jsx5(Component, { context }) })));
      }
    } else {
      assert.ok(dialog.textContent?.includes(p("agendaExplanation", { meeting: "Fixture meeting" })));
      await act(async () => button(p("refreshMeeting"), dialog).click());
      await act(async () => add.click());
      assert.deepEqual(writes, [{ path: "/organizations/org/tensions/" + tension + "/actions/process", body: { targetKind: "AGENDA", meetingId: meeting, meetingVersion: 9 }, version: 1 }]);
      assert.deepEqual(navigation, ["/meetings/" + meeting]);
    }
  }
  if (!allowed) assert.equal(writes.length, 0);
  results.push({ locale, mode, fixture: true, checks: policy ? ["effective policy text", "missing lead port disables option", allowed ? "draft access+workflow payload/version" : "org policy locks edits without writes"] : ["authorized list is not write authority", allowed ? "refresh uses latest target version and source version" : "denied target keeps submit disabled"], writes });
  await act(async () => root.unmount());
}
await writeFile("web/src/features/governance/evidence/process-localization-dom.json", JSON.stringify({ kind: "React/JSDOM with explicit fixtures; no real API/browser", verifiedAt: (/* @__PURE__ */ new Date()).toISOString(), results }, null, 2) + "\n");
console.log("Governance policy/agenda permissions and payloads passed in DOM for all 8 locales.");
