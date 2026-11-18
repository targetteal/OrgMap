/// <reference types="vite/client" />
import { lazy, Suspense } from "react";
import { useLocalization } from "../localization";
import type { RichTextEditorProps } from "./RichTextEditor";

const loadEditor = () => import("./RichTextEditor");
// Server rendering resolves the editor before rendering markup. Browser routes
// download the editing engine only when an editor is rendered.
const Editor = !import.meta.env || import.meta.env.SSR
  ? (await loadEditor()).RichTextEditor
  : lazy(async () => ({ default: (await loadEditor()).RichTextEditor }));

export function RichTextEditor(props: RichTextEditorProps) {
  const { t } = useLocalization();
  return (
    <Suspense fallback={<div className="orgmap-rich-editor orgmap-rich-editor-loading" aria-busy="true">
      <span className="orgmap-rich-label">{props.label}</span>
      <p className="muted" role="status">{t("common.loading")}</p>
    </div>}>
      <Editor {...props} />
    </Suspense>
  );
}
