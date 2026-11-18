import type { Ctx } from './runtime.js';
/** Read-only cross-context references; every producer validates its own ACL in ctx.c. */
export type TraceKind = 'TENSION'|'TASK'|'PROJECT'|'GOAL'|'AGENDA'|'MEETING'|'PROPOSAL';
export type TraceReference = { kind: TraceKind; id: string; title: string; meetingId?: string };
export interface TraceabilityPort {
 tension(ctx: Ctx, id: string): Promise<TraceReference | null>;
 goalOrigin(ctx: Ctx, goalId: string): Promise<TraceReference | null>;
 meetingOrigin?(ctx: Ctx, kind:'TASK'|'PROJECT'|'GOAL'|'PROPOSAL', id: string): Promise<TraceReference | null>;
 destination(ctx: Ctx, kind: Exclude<TraceKind,'TENSION'>, id: string): Promise<TraceReference | null>;
}
