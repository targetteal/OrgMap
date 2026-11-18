import { readDraft, writeDraft } from "./drafts";
import { useState } from "react";
import { RichTextEditor, type RichDocument } from "../../editor";
import { fromPlainText, toPlainText } from "../../../../packages/content/index.js";
import { useLocalization } from "../../localization";
import { workTranslator } from "./messages";
export function DescriptionEditor({
  value = "",
  pending = false,
  draftKey,
}: {
  value?: RichDocument | string | null;
  pending?: boolean;
  draftKey?: string;
}) {
  const { locale } = useLocalization(),
    text = workTranslator(locale);
  const [draft, setDraft] = useState<RichDocument | string>(() => {
    const saved = draftKey ? readDraft(draftKey) : null;
    if (saved) { try { return JSON.parse(saved) as RichDocument | string; } catch { /* Ignore malformed local draft. */ } }
    return value ?? "";
  });
  const document = typeof draft === "string" ? fromPlainText(draft) : draft;
  return (
    <div className="work-description-editor">
      <RichTextEditor
        label={text("Descrição")}
        value={draft}
        onChange={(next) => { setDraft(next); if (draftKey) writeDraft(draftKey, JSON.stringify(next)); }}
        pending={pending}
        readOnly={pending}
      />
      <input
        type="hidden"
        name="descriptionRich"
        value={JSON.stringify(document)}
      />
    </div>
  );
}
export function descriptionPayload(form: FormData, inheritTemplateWhenEmpty = false) {
  const rich = form.get("descriptionRich");
  if(inheritTemplateWhenEmpty && (rich ? !toPlainText(JSON.parse(String(rich))).trim() : !String(form.get("description") ?? "").trim()))return {};
  return rich
    ? { descriptionRich: JSON.parse(String(rich)) }
    : { description: form.get("description") ?? "" };
}
