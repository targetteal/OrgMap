import type {FeatureDefinition} from '../../feature-contract';
import {matchesAdministrationRoute} from './routes';

export const administrationMetadata = {
  id: 'administration',
  module: 'administration',
  label: 'Administração',
  matches: matchesAdministrationRoute,
  navigation: [{path:'/administration/settings',label:'Administração',location:'identity'}],
} satisfies Pick<FeatureDefinition,'id'|'module'|'label'|'matches'|'navigation'>;
