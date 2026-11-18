import { requestBlob, RequestError } from '../../api';
import type { FeatureContext } from '../../feature-contract';
import type { BrandingAsset, BrandingPurpose, BrandingTransport } from './branding-settings';

const purposePaths: Record<BrandingPurpose, string> = { WORKSPACE_LOGO: 'workspace-logo', EMAIL_LOGO: 'email-logo', LOGIN_BACKGROUND: 'login-background' };
export function createBrandingTransport(organizationId: string, api: FeatureContext['api']): BrandingTransport {
  const base = `/organizations/${organizationId}/administration/branding-assets`;
  return {
    list: async signal => (await api<{ assets: BrandingAsset[]; ready: boolean }>(base, { signal })).data,
    upload: async (purpose, file, revision, publish, key, signal) => {
      const data = new FormData();
      data.append('file', file);
      if (publish) data.append('publish', 'true');
      const asset = (await api<{ asset: BrandingAsset }>(`${base}/${purposePaths[purpose]}`, { method: 'POST', body: data, version: revision, key, signal })).data.asset;
      window.dispatchEvent(new Event('orgmap:branding-changed'));
      return asset;
    },
    remove: async (purpose, revision, key, signal) => {
      const asset = (await api<{ asset: BrandingAsset }>(`${base}/${purposePaths[purpose]}`, { method: 'DELETE', version: revision, key, signal })).data.asset;
      window.dispatchEvent(new Event('orgmap:branding-changed'));
      return asset;
    },
    read: async (purpose, asset, signal) => {
      const expected = purpose === 'WORKSPACE_LOGO' ? `/api/v1/organizations/${organizationId}/branding/workspace-logo` : null;
      if (!asset.readUrl || (expected ? asset.readUrl !== expected : !/^\/api\/v1\/public\/branding\/[a-f0-9-]{36}$/.test(asset.readUrl)))
        throw new RequestError('INVALID_RESPONSE', 'A prévia não está disponível.');
      return requestBlob(asset.readUrl.slice('/api/v1'.length), signal);
    },
  };
}
