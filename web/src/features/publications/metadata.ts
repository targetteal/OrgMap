import type {FeatureDefinition} from '../../feature-contract';

export const publicationsMetadata = {
  id: 'publications',
  module: 'administration',
  label: 'Publicações',
  matches: (path:string) => /^\/publications\/?(?:[?#].*)?$/.test(path),
  navigation: [
    {path:'/publications',label:'Publicações',location:'identity',visible:(context)=>context.bootstrap.membership.memberType!=='GUEST'},
    {path:'/publications',label:'Publicações',location:'sidebar',visible:(context)=>context.bootstrap.membership.memberType!=='GUEST'},
  ],
} satisfies Pick<FeatureDefinition,'id'|'module'|'label'|'matches'|'navigation'>;
