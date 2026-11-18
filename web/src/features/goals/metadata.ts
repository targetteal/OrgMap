import type {FeatureDefinition} from '../../feature-contract';

export const goalsMetadata = {
  id: 'goals',
  module: 'goals',
  label: 'Objetivos',
  matches: (path:string) => path === '/goals' || path.startsWith('/goals/') || path.startsWith('/goals?'),
} satisfies Pick<FeatureDefinition,'id'|'module'|'label'|'matches'>;
