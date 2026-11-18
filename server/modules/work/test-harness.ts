/** Explicit local/test composition. Never imported by the production Work module or root. */
import type { FastifyInstance } from "fastify";
import type { ModuleRuntime } from "../../src/runtime.js";
import { createFoundationDefaultAdmissionPolicyProvider } from "../../src/admission-contract.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResourceRegistry,
  FilesystemBlobStore,
  createPlatform,
  createPlatformGuestAccessAdapter,
} from "../platform/index.js";
import { createCommentThreadPort } from "../platform/comments.js";
import {
  createWorkModule,
  createWorkResourceAdapters,
  createWorkLegacyCommentSource,
  type WorkOptions,
} from "./index.js";
export async function mountWorkTestHarness(
  app: FastifyInstance,
  core: ModuleRuntime,
  input: {
    registry?: ResourceRegistry;
    blobs?: FilesystemBlobStore;
    workOptions?: WorkOptions;
  } = {},
) {
  core.registerAdmissionPolicyProvider(
    createFoundationDefaultAdmissionPolicyProvider(),
  );
  const mapping = {
    resolveOriginalResource: async (
      _ctx: any,
      ref: { type: string; id: string },
    ) =>
      ["task", "project"].includes(ref.type)
        ? { context: "work", kind: ref.type, id: ref.id }
        : undefined,
  };
  core.registerGuestAccessAdapter(
    createPlatformGuestAccessAdapter(core, mapping),
  );
  const registry =
    input.registry ??
    new ResourceRegistry({
      guestAccess: async (ctx, ref, action) => {
        if (action !== "read") return false;
        const resource = await mapping.resolveOriginalResource(ctx, ref);
        if (!resource) return false;
        try {
          await core.requireGuestResource(ctx, resource, "read");
          return true;
        } catch {
          return false;
        }
      },
    });
  if (!input.registry)
    for (const [type, adapter] of Object.entries(
      createWorkResourceAdapters({ ...input.workOptions, guest: core }),
    ))
      registry.registerResourceAdapter(type, adapter);
  let root: string | undefined;
  const blobs =
    input.blobs ??
    new FilesystemBlobStore(
      (root = await mkdtemp(join(tmpdir(), "orgmap-work-comments-"))),
    );
  const comments = createCommentThreadPort({
    core,
    registry,
    legacyTaskComments: createWorkLegacyCommentSource({ guest: core }),
  });
  const workOptions = input.workOptions ?? {};
  Object.assign(workOptions, { guest: core, comments });
  await createWorkModule(workOptions)(app, core);
  await createPlatform({ registry, blobs, comments })(app, core);
  if (root)
    app.addHook("onClose", async () => {
      await rm(root!, { recursive: true, force: true });
    });
  return { registry, comments, blobs };
}
