export type MigrationScope = "foundation" | "all";
export type MigrationSelection =
  | { scope: MigrationScope; maxPrefix?: never }
  | { maxPrefix: number; scope?: never };

/** Stable dependency predicate for domain-owned selective migration runners. */
export function isFoundationMigration(name: string): boolean {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) return false;
  const prefix = Number(name.slice(0, 3));
  return prefix <= 19 || (prefix >= 500 && prefix <= 519) || prefix === 943;
}

export function validateMigrationSelection(
  selection: MigrationSelection,
): MigrationSelection {
  if (selection.scope !== undefined && selection.maxPrefix !== undefined)
    throw Error("MIGRATION_SELECTION_CONFLICT");
  if (selection.scope !== undefined) {
    if (!["foundation", "all"].includes(selection.scope))
      throw Error("INVALID_MIGRATION_SCOPE");
    return selection;
  }
  if (
    !Number.isInteger(selection.maxPrefix) ||
    selection.maxPrefix < 0 ||
    selection.maxPrefix > 999
  )
    throw Error("INVALID_MIGRATION_MAX_PREFIX");
  return selection;
}

export function migrationSelectionFromEnvironment(
  env: NodeJS.ProcessEnv,
): MigrationSelection {
  if (env.MIGRATION_SCOPE !== undefined && env.MIGRATION_MAX_PREFIX !== undefined)
    throw Error("MIGRATION_SELECTION_CONFLICT");
  if (env.MIGRATION_SCOPE !== undefined) {
    if (env.MIGRATION_SCOPE !== "foundation" && env.MIGRATION_SCOPE !== "all")
      throw Error("INVALID_MIGRATION_SCOPE");
    return { scope: env.MIGRATION_SCOPE };
  }
  if (env.MIGRATION_MAX_PREFIX !== undefined) {
    if (!/^\d{1,3}$/.test(env.MIGRATION_MAX_PREFIX))
      throw Error("INVALID_MIGRATION_MAX_PREFIX");
    return validateMigrationSelection({ maxPrefix: Number(env.MIGRATION_MAX_PREFIX) });
  }
  return { scope: "all" };
}

export function selectMigrationNames(
  names: readonly string[],
  selection: MigrationSelection,
): string[] {
  validateMigrationSelection(selection);
  return names.filter((name) => {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) return false;
    const prefix = Number(name.slice(0, 3));
    if (selection.maxPrefix !== undefined) return prefix <= selection.maxPrefix;
    return selection.scope === "all" || isFoundationMigration(name);
  }).sort();
}
