import type { Ctx } from "../../src/runtime.js";
import type { ResourceRef } from "./ports.js";
import type { RichDocument } from "../../../packages/content/index.js";
export type CommentSource = "WORK_LEGACY" | "PLATFORM";
export type CommentPosition = Readonly<{
  createdAt: string;
  id: string;
  source: CommentSource;
}>;
export type ThreadComment = Readonly<{
  id: string;
  key: string;
  source: CommentSource;
  authorId: string | null;
  content: string;
  contentRich: RichDocument | null;
  createdAt: string;
  version: number | null;
  immutable: true;
}>;
export type NewComment =
  | { content: string; contentRich?: never }
  | { contentRich: RichDocument; content?: never };
export interface LegacyTaskCommentSource {
  list(
    ctx: Ctx,
    input: { taskId: string; after?: CommentPosition; take: number },
  ): Promise<
    readonly Readonly<{
      id: string;
      authorId: string;
      content: string;
      createdAt: string;
    }>[]
  >;
}
export interface CommentThreadPort {
  list(
    ctx: Ctx,
    input: { ref: ResourceRef; after?: CommentPosition; limit?: number },
  ): Promise<{
    items: readonly ThreadComment[];
    page: { hasMore: boolean; after: CommentPosition | null };
  }>;
  append(
    ctx: Ctx,
    input: { ref: ResourceRef; body: NewComment },
  ): Promise<ThreadComment>;
}
