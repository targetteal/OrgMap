export const invitationPath = '/invitations/accept';
/** Consume bearer proof from a fragment, never query parameters or storage. */
export function invitationRoute(value: string): {path: string; token?: string} | null {
  const url = new URL(value, 'https://orgmap.invalid');
  if (url.origin !== 'https://orgmap.invalid' || !/^\/invitations\/accept\/?$/.test(url.pathname)) return null;
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  return {path: invitationPath, ...(/^[a-f0-9]{64}$/i.test(token ?? '') ? {token: token!} : {})};
}
