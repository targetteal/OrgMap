import { resolveLocale } from "../../../../packages/i18n/index.js";

export type NotificationPresentation = {
  locale: string;
  heading: string;
  summary?: string;
  resourceTitle: string;
  actorName?: string;
  occurredAt?: string;
  details?: { label: string; value: string }[];
  destination: string;
  preferencesDestination: string;
};

export type NotificationItem = {
  id: string;
  event?: string;
  resourceType: string;
  resourceId: string;
  resourceTitle?: string | null;
  readAt?: string | null;
  availableAt?: string;
  presentation?: NotificationPresentation;
};

/** Notification actions remain inside the app even if an unexpected DTO reaches the client. */
export function safeNotificationDestination(value?: string): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) return null;
  const url = new URL(value, "https://orgmap.invalid");
  if (url.origin !== "https://orgmap.invalid" || !/^\/(?:organization-invitations|platform\/(?:preferences|notifications|resource)|circles|roles|members|projects|goals|structure|meetings)(?:\/|$)/.test(url.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

export function notificationWorkspacePath(path: string, organizationId: string): string {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(organizationId)) return path;
  const url = new URL(path, "https://orgmap.invalid");
  url.searchParams.set("organizationId", organizationId);
  return url.pathname + url.search;
}

export function notificationLocale(value: string | undefined, fallback: string) {
  return resolveLocale(value ?? fallback);
}

export function notificationTime(value: string | undefined, locale: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  const milliseconds = date.getTime() - Date.now();
  const minutes = Math.round(milliseconds / 60000), hours = Math.round(milliseconds / 3600000), days = Math.round(milliseconds / 86400000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return {
    value,
    absolute: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date),
    relative: Math.abs(minutes) < 60 ? relative.format(minutes, "minute") : Math.abs(hours) < 24 ? relative.format(hours, "hour") : relative.format(days, "day"),
  };
}
