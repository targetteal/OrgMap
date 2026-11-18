export type AccessibilityPreferences = {
  textSize: 'default'|'large'|'extraLarge'; lineSpacing:boolean; letterSpacing:boolean; bold:boolean; dyslexia:boolean;
  contrast:boolean; saturation:boolean; invert:boolean; highContrast:boolean; links:boolean; headings:boolean;
  guide:boolean; images:boolean; pointer:boolean; motion:boolean; speech:boolean;
};
export const DEFAULT_ACCESSIBILITY: Readonly<AccessibilityPreferences> = Object.freeze({textSize:'default',lineSpacing:false,letterSpacing:false,bold:false,dyslexia:false,contrast:false,saturation:false,invert:false,highContrast:false,links:false,headings:false,guide:false,images:false,pointer:false,motion:false,speech:false});
export type AccessibilityScope = {accountId:string;organizationId?:string|null};
export function accessibilityStorageKey(scope:AccessibilityScope):string {
  return `orgmap.accessibility.v1:${encodeURIComponent(scope.accountId)}:${scope.organizationId ? `org:${encodeURIComponent(scope.organizationId)}` : 'account'}`;
}
export function normalizeAccessibility(value: unknown):AccessibilityPreferences {
  const result = {...DEFAULT_ACCESSIBILITY};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const record=value as Record<string,unknown>;
  for (const key of Object.keys(result) as (keyof AccessibilityPreferences)[]) {
    if(key === 'textSize') { if(['default','large','extraLarge'].includes(String(record[key]))) result.textSize=record[key] as AccessibilityPreferences['textSize']; }
    else result[key]=record[key] === true;
  }
  return result;
}
export type PreferenceStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export function readAccessibility(storage:PreferenceStorage,scope:AccessibilityScope):AccessibilityPreferences {
  try { return normalizeAccessibility(JSON.parse(storage.getItem(accessibilityStorageKey(scope)) ?? 'null')); } catch { return {...DEFAULT_ACCESSIBILITY}; }
}
export function saveAccessibility(storage:PreferenceStorage,scope:AccessibilityScope,value:AccessibilityPreferences):boolean {
  try { storage.setItem(accessibilityStorageKey(scope),JSON.stringify(normalizeAccessibility(value))); return true; } catch { return false; }
}
export function resetAccessibility(storage:PreferenceStorage,scope:AccessibilityScope):boolean {
  try { storage.removeItem(accessibilityStorageKey(scope)); return true; } catch { return false; }
}
