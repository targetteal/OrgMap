import { resolveLocale, type Locale } from "../../packages/i18n/index.js";

type Copy = {
  subject: string;
  title: string;
  greeting: string;
  invitation: string;
  accept: string;
  instructions: string;
  expires: string;
  fallback: string;
  ignore: string;
};

const messages: Record<Locale, Copy> = {
  "pt-BR": {
    subject: "{inviter} convidou você para {organization}",
    title: "Você recebeu um convite",
    greeting: "Olá, {name}!",
    invitation: "{inviter} convidou você para participar de {organization} no OrgMap.",
    accept: "Aceitar convite",
    instructions: "Entre ou crie uma conta com {email}. Depois, confirme sua participação na organização.",
    expires: "Este convite é válido até {date}.",
    fallback: "Se o botão não abrir, copie este link para o navegador:",
    ignore: "Se você não esperava este convite, pode ignorar esta mensagem.",
  },
  "en-US": {
    subject: "{inviter} invited you to {organization}",
    title: "You have been invited",
    greeting: "Hello, {name}!",
    invitation: "{inviter} invited you to join {organization} on OrgMap.",
    accept: "Accept invitation",
    instructions: "Sign in or create an account with {email}. Then confirm that you want to join the organization.",
    expires: "This invitation is valid until {date}.",
    fallback: "If the button does not open, copy this link into your browser:",
    ignore: "If you were not expecting this invitation, you can ignore this message.",
  },
  "es-ES": {
    subject: "{inviter} te ha invitado a {organization}",
    title: "Has recibido una invitación",
    greeting: "¡Hola, {name}!",
    invitation: "{inviter} te ha invitado a participar en {organization} en OrgMap.",
    accept: "Aceptar invitación",
    instructions: "Inicia sesión o crea una cuenta con {email}. Después, confirma tu participación en la organización.",
    expires: "Esta invitación es válida hasta el {date}.",
    fallback: "Si el botón no se abre, copia este enlace en el navegador:",
    ignore: "Si no esperabas esta invitación, puedes ignorar este mensaje.",
  },
  "fr-FR": {
    subject: "{inviter} vous invite à rejoindre {organization}",
    title: "Vous avez reçu une invitation",
    greeting: "Bonjour {name} !",
    invitation: "{inviter} vous invite à rejoindre {organization} sur OrgMap.",
    accept: "Accepter l’invitation",
    instructions: "Connectez-vous ou créez un compte avec {email}. Confirmez ensuite votre participation à l’organisation.",
    expires: "Cette invitation est valable jusqu’au {date}.",
    fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
    ignore: "Si vous n’attendiez pas cette invitation, vous pouvez ignorer ce message.",
  },
  "de-DE": {
    subject: "{inviter} hat Sie zu {organization} eingeladen",
    title: "Sie haben eine Einladung erhalten",
    greeting: "Hallo {name}!",
    invitation: "{inviter} hat Sie eingeladen, {organization} auf OrgMap beizutreten.",
    accept: "Einladung annehmen",
    instructions: "Melden Sie sich mit {email} an oder erstellen Sie ein Konto. Bestätigen Sie anschließend Ihren Beitritt zur Organisation.",
    expires: "Diese Einladung ist bis zum {date} gültig.",
    fallback: "Falls sich die Schaltfläche nicht öffnet, kopieren Sie diesen Link in Ihren Browser:",
    ignore: "Wenn Sie diese Einladung nicht erwartet haben, können Sie diese Nachricht ignorieren.",
  },
  "it-IT": {
    subject: "{inviter} ti ha invitato a {organization}",
    title: "Hai ricevuto un invito",
    greeting: "Ciao {name}!",
    invitation: "{inviter} ti ha invitato a partecipare a {organization} su OrgMap.",
    accept: "Accetta l’invito",
    instructions: "Accedi o crea un account con {email}. Poi conferma la tua partecipazione all’organizzazione.",
    expires: "Questo invito è valido fino al {date}.",
    fallback: "Se il pulsante non si apre, copia questo link nel browser:",
    ignore: "Se non aspettavi questo invito, puoi ignorare questo messaggio.",
  },
  "ja-JP": {
    subject: "{inviter}さんから{organization}への招待が届きました",
    title: "招待が届きました",
    greeting: "{name}さん、こんにちは。",
    invitation: "{inviter}さんが、OrgMapの{organization}にあなたを招待しています。",
    accept: "招待を受ける",
    instructions: "{email}でログインするか、アカウントを作成してください。その後、組織への参加を確認してください。",
    expires: "この招待の有効期限は{date}です。",
    fallback: "ボタンが開かない場合は、次のリンクをブラウザにコピーしてください。",
    ignore: "この招待に心当たりがない場合は、このメールを無視してください。",
  },
  "nl-NL": {
    subject: "{inviter} heeft je uitgenodigd voor {organization}",
    title: "Je hebt een uitnodiging ontvangen",
    greeting: "Hallo {name}!",
    invitation: "{inviter} heeft je uitgenodigd om deel te nemen aan {organization} op OrgMap.",
    accept: "Uitnodiging accepteren",
    instructions: "Log in of maak een account aan met {email}. Bevestig daarna je deelname aan de organisatie.",
    expires: "Deze uitnodiging is geldig tot {date}.",
    fallback: "Als de knop niet opent, kopieer deze link dan naar je browser:",
    ignore: "Als je deze uitnodiging niet verwachtte, kun je dit bericht negeren.",
  },
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
const fill = (value: string, parameters: Record<string, string>) =>
  value.replace(/\{(\w+)\}/g, (token, key: string) => parameters[key] ?? token);

/** Operator configuration only. Never derive invitation links from request headers. */
export function invitationOrigin(environment: Partial<Pick<NodeJS.ProcessEnv, "ORGMAP_PUBLIC_URL" | "ALLOWED_ORIGINS">> = process.env): string {
  const candidates = environment.ORGMAP_PUBLIC_URL !== undefined
    ? [environment.ORGMAP_PUBLIC_URL]
    : environment.ALLOWED_ORIGINS !== undefined
      ? environment.ALLOWED_ORIGINS.split(",").map(value => value.trim())
      : [];
  if (!candidates[0]?.trim()) throw Error("INVITATION_ORIGIN_REQUIRED");
  let url: URL;
  try { url = new URL(candidates[0].trim()); } catch { throw Error("INVITATION_ORIGIN_INVALID"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw Error("INVITATION_ORIGIN_INVALID");
  return url.origin;
}

export type InvitationMailContext = {
  organizationName: string;
  locale: string;
  inviterName: string;
  expiresAt: string;
  email: string;
  firstName: string;
  lastName: string;
  personalMessage: string;
};

export function renderInvitationMail(
  context: InvitationMailContext,
  token: string,
  origin = invitationOrigin(),
): { subject: string; text: string; html: string } {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw Error("INVALID_INVITATION_TOKEN");
  const safeOrigin = invitationOrigin({ ORGMAP_PUBLIC_URL: origin });
  const locale = resolveLocale(context.locale), copy = messages[locale];
  const expires = new Date(context.expiresAt);
  if (!Number.isFinite(expires.getTime())) throw Error("INVITATION_EXPIRY_INVALID");
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(expires) + " UTC";
  const parameters = { inviter: context.inviterName || "OrgMap", organization: context.organizationName,
    name: [context.firstName, context.lastName].filter(Boolean).join(" "), email: context.email, date };
  const translate = (key: keyof Copy) => fill(copy[key], parameters);
  const link = safeOrigin + "/invitations/accept#token=" + token;
  const paragraphs = [parameters.name ? translate("greeting") : "", translate("invitation"),
    context.personalMessage, translate("instructions"), translate("expires")].filter(Boolean);
  const text = [...paragraphs, translate("accept") + ":\n" + link, translate("ignore")].join("\n\n");
  const htmlParagraphs = paragraphs.map(paragraph => `<p style="margin:0 0 20px;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(paragraph)}</p>`).join("");
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#F3F8F8;color:#183237;font:16px/1.6 Manrope,Arial,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 16px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;border-collapse:collapse;background:#FFFFFF;border:1px solid #D5E1E2;border-radius:14px"><tr><td style="padding:32px"><p style="margin:0 0 24px;font-size:22px;font-weight:650;color:#105D63">OrgMap</p><h1 style="font-size:26px;line-height:1.25;margin:0 0 24px">${escapeHtml(translate("title"))}</h1>${htmlParagraphs}<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0B7077;color:#FFFFFF;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:10px">${escapeHtml(translate("accept"))}</a></p><p style="margin:0 0 8px;font-size:13px;color:#50666A">${escapeHtml(translate("fallback"))}</p><p style="margin:0 0 24px;font-size:13px;overflow-wrap:anywhere;word-break:break-all"><a href="${escapeHtml(link)}" style="color:#105D63">${escapeHtml(link)}</a></p><p style="font-size:13px;color:#50666A;margin:0">${escapeHtml(translate("ignore"))}</p></td></tr></table></td></tr></table></body></html>`;
  // Names may be multiline in body content, but never create additional mail headers.
  const subject = translate("subject").replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return { subject, text, html };
}
