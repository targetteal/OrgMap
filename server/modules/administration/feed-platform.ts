import { fail, Failure, id } from "../../src/core.js";
import type { ResourceAccessPort } from "../platform/ports.js";
import type { PublicationExportSource } from "./feed-source.js";

/** The resource is a frozen selection, bound to the current account and member by the source. */
export function publicationExportResourceAdapter(
  source: PublicationExportSource,
): ResourceAccessPort {
  return {
    exportKinds: ["PUBLICATIONS"],
    async authorize(ctx, selectionId, action) {
      if (action !== "read" && action !== "export") return false;
      try {
        await source.authorizeCurrent(ctx, { selectionId: id(selectionId) });
        return true;
      } catch (e) {
        if (e instanceof Failure && (e.status === 403 || e.status === 404))
          return false;
        throw e;
      }
    },
    async export(ctx, ids, kind, options) {
      if (
        kind !== "PUBLICATIONS" ||
        ids.length !== 1 ||
        options?.format !== "ZIP" ||
        options.includePrivate
      )
        fail(422, "INVALID_PUBLICATION_EXPORT");
      const selectionId = id(ids[0]);
      const publicationPackage = await source.materialize(ctx, { selectionId });
      return {
        records: [],
        coverage:
          "Published versions in currently authorized selected groups; excludes drafts, attachments, chat and comments",
        estimated: false,
        publicationPackage,
      };
    },
  };
}
