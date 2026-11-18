import type { VisibleStructureNode } from './api';

/** Label a role using only its directly visible, authorized parent circle. */
export function roleChoiceLabel(role: VisibleStructureNode, nodes: readonly VisibleStructureNode[], hiddenCircle = 'Círculo não compartilhado'): string {
  const parent = !role.pathRedacted && role.parentNodeId
    ? nodes.find(node => node.kind === 'CIRCLE' && node.nodeId === role.parentNodeId)
    : undefined;
  return `${role.name} · ${parent?.name ?? hiddenCircle}`;
}
