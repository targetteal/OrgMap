import { createRoot } from "react-dom/client";
import { useState } from "react";
import { RichTextEditor, RichTextView } from "./index.ts";
import {
  fromPlainText,
  type RichDocument,
} from "../../../packages/content/index.ts";
import "../../src/styles.css";
import "./preview.css";

function Preview() {
  const [value, setValue] = useState<RichDocument>(
    fromPlainText(
      "Organizar o trabalho com clareza, autonomia e responsabilidade compartilhada.",
    ),
  );
  const [readOnly, setReadOnly] = useState(false),
    [pending, setPending] = useState(false),
    [conflict, setConflict] = useState(false);
  const [empty, setEmpty] = useState<RichDocument>(fromPlainText(""));
  return (
    <main className="editor-preview">
      <header>
        <h1>Editor compartilhado</h1>
        <p>
          Ambiente de verificação com dados sintéticos. O envio e a colaboração
          dependem dos contextos integrados.
        </p>
      </header>
      <section aria-label="Estados do editor" className="editor-preview-states">
        <label>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
          />{" "}
          Somente leitura
        </label>
        <label>
          <input
            type="checkbox"
            checked={pending}
            onChange={(e) => setPending(e.target.checked)}
          />{" "}
          Envio pendente
        </label>
        <label>
          <input
            type="checkbox"
            checked={conflict}
            onChange={(e) => setConflict(e.target.checked)}
          />{" "}
          Conflito
        </label>
      </section>
      <section>
        <RichTextEditor
          label="Propósito"
          value={value}
          onChange={setValue}
          readOnly={readOnly}
          pending={pending}
          conflict={conflict}
          placeholder="Descreva o propósito…"
        />
      </section>
      <section>
        <h2>Prévia do conteúdo</h2>
        <RichTextView value={value} />
      </section>
      <section>
        <RichTextEditor
          label="Comentário"
          value={empty}
          onChange={setEmpty}
          required
          placeholder="Escreva um comentário…"
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
