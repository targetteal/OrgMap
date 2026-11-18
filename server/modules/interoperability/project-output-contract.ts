import type { Ctx, ModuleRuntime } from "../../src/runtime.js";
import type { FastifyInstance } from "fastify";
import type { TrelloOAuthConfiguration } from "./providers/trello-oauth.js";
export type WorkTaskCreatedSignal = { kind: "WORK_TASK_CREATED"; taskId: string; projectId: string; occurredAt: string };
export interface WorkProjectOutputSource {
  authorizeConfiguration(ctx: Ctx, input: { projectId: string }): Promise<void>;
  captureCreatedTask(ctx: Ctx, signal: WorkTaskCreatedSignal): Promise<{ taskId: string; projectId: string; taskVersion: number; title: string; descriptionPlain: string }>;
  authorizeDelivery(ctx: Ctx, input: { taskId: string; projectId: string }): Promise<void>;
}
export interface ProjectOutputSchedulingPort {
  schedule(ctx: Ctx, options?: { availableAt?: Date; memberId?: string }): Promise<void>;
}
export type TrelloAppConfiguration = TrelloOAuthConfiguration & { apiBaseUrl?: string };
export type ProjectOutputOptions = {
  core: ModuleRuntime;
  work: WorkProjectOutputSource;
  configuration: Record<string, TrelloAppConfiguration>;
  encryptionKey: () => Promise<Buffer>;
  scheduling: ProjectOutputSchedulingPort;
};
export interface ProjectOutputIntegration {
  register(app: FastifyInstance, base: string): Promise<void>;
  onTaskCreated(ctx: Ctx, signal: WorkTaskCreatedSignal): Promise<void>;
  runDelivery(organizationId: string, memberId: string): Promise<boolean>;
}
