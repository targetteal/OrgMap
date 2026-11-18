import { useEffect, useState } from "react";
import type { FeatureComponent, FeatureDefinition } from "../feature-contract";
import { formatError, localizationValue } from "../localization";

/** Keep route metadata in the shell and fetch the feature implementation on entry. */
export function deferredFeature(
  load: () => Promise<{ feature: FeatureDefinition }>,
  part: "Component" | "sidebar" = "Component",
): FeatureComponent {
  let resolved: FeatureComponent | null = null;
  let pending: Promise<FeatureComponent> | null = null;
  const component = () => {
    if (resolved) return Promise.resolve(resolved);
    pending ??= load().then(({ feature }) => {
      const loaded = feature[part];
      if (!loaded) throw Error(`FEATURE_PART_MISSING:${feature.id}:${part}`);
      resolved = loaded;
      return resolved;
    }).finally(() => { pending = null; });
    return pending;
  };

  return function DeferredFeature({ context }) {
    const [Loaded, setLoaded] = useState<FeatureComponent | null>(() => resolved);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (Loaded) return;
      let active = true;
      void component().then(
        value => { if (active) setLoaded(() => value); },
        () => { if (active) setFailed(true); },
      );
      return () => { active = false; };
    }, [Loaded]);

    if (Loaded) return <Loaded context={context} />;
    const locale = context.accountPreferences?.locale;
    const { t } = localizationValue(context.accountPreferences);
    if (failed) return <div className="loading-screen" role="alert">
      <p>{formatError(new Error("FEATURE_LOAD_FAILED"), locale)}</p>
      <button type="button" onClick={() => window.location.reload()}>{t("common.retry")}</button>
    </div>;
    return <div className="loading-screen" role="status">{t("common.loading")}</div>;
  };
}
