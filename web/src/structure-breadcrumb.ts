import type {VisibleStructureNode} from './api';
export function structureParentLabel(selected:VisibleStructureNode,nodes:VisibleStructureNode[],rootCircleId:string|null):string{
 if(selected.pathRedacted)return 'Caminho não compartilhado';
 if(selected.parentNodeId){const parent=nodes.find(node=>node.nodeId===selected.parentNodeId);return parent?.name??'Caminho não disponível';}
 if(selected.kind==='CIRCLE'&&selected.entityId===rootCircleId)return 'Círculo raiz';
 return rootCircleId===null?'Caminho não compartilhado':'Caminho não disponível';
}
