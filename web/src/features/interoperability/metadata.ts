import type {FeatureDefinition} from '../../feature-contract';

export const interoperabilityMetadata = {
  id: 'interoperability',
  module: 'interoperability',
  label: 'Integrações',
  matches: (path:string) => path === '/interoperability' || path.startsWith('/interoperability/'),
  navigation: [{path:'/interoperability',label:'Integrações',location:'identity'}],
} satisfies Pick<FeatureDefinition,'id'|'module'|'label'|'matches'|'navigation'>;
