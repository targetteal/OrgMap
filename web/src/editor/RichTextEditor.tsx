import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import type { XmlFragment } from "yjs";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link,
  Unlink,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  emptyRichDocument,
  isSafeLink,
  readContent,
  serializeRichDocument,
  toPlainText,
  validateRichDocument,
  type RichDocument,
} from "../../../packages/content/index.ts";
import { richEditorExtensions } from "./extensions.ts";
import {matchMentionRoles, mentionLabel, useRoleMentions} from "./role-mentions";
import { RichTextView } from "./RichTextView.tsx";
import {useLocalization} from "../localization";
import {richTextTranslator,type RichTextMessage} from "./rich-text-messages";

export interface RichTextEditorProps {
  value?: RichDocument | string;
  onChange?: (document: RichDocument) => void;
  label: string;
  id?: string;
  placeholder?: string;
  readOnly?: boolean;
  pending?: boolean;
  conflict?: string | boolean;
  error?: string;
  required?: boolean;
  className?: string;
  compact?: boolean;
  /** Hide formatting chrome for short structured entries; preserve rich content and shortcuts. */
  toolbar?: boolean;
  maxLength?:number;
  /** Must already contain the server-confirmed richtext snapshot. Never seed from value. */
  collaboration?: { fragment: XmlFragment };
  onConflict?: (draft: RichDocument) => void;
  onReady?: (editor: Editor) => void;
}

export function RichTextEditor(props: RichTextEditorProps) {
  const scope=useRoleMentions();
  return <BoundEditor key={scope?.organizationId} {...props} />;
}

export function currentMentionQuery(editor:Editor){
  const {selection}=editor.state;
  if(!selection.empty||!selection.$from.parent.isTextblock)return null;
  const before=selection.$from.parent.textBetween(0,selection.$from.parentOffset,"\n","\ufffc");
  const match=/(?:^|[\s(])@([^@\n\ufffc]{0,120})$/.exec(before);
  return match?{from:selection.from-match[1].length-1,to:selection.from,query:match[1]}:null;
}

function BoundEditor(props: RichTextEditorProps) {
  const {locale}=useLocalization();
  const t=richTextTranslator(locale);
  const localeRef=useRef(locale);localeRef.current=locale;
  const mentionScope=useRoleMentions();
  const scopeRef=useRef(mentionScope);scopeRef.current=mentionScope;
  const [mentionActive,setMentionActive]=useState(0);
  const activeMention=useRef(0);activeMention.current=mentionActive;
  const dismissedMention=useRef("");
  const mentionSignature=(query:{from:number;to:number;query:string})=>JSON.stringify(query);
  const isMentionLocked=()=>!!latest.current.readOnly||!!latest.current.pending||!!latest.current.conflict;
  function insertRole(editor:Editor,role:{id:string;name:string}){
    if(isMentionLocked())return;
    const query=currentMentionQuery(editor);
    if(!query||!scopeRef.current?.roles.some(r=>r.id===role.id&&!r.archived))return;
    editor.chain().focus(undefined,{scrollIntoView:false}).insertContentAt({from:query.from,to:query.to},[{type:"roleMention",attrs:{roleId:role.id,label:role.name}},{type:"text",text:" "}]).run();
    setMentionActive(0);
  }
  let initial: RichDocument,
    incomingError = "";
  try {
    initial = props.collaboration
      ? emptyRichDocument()
      : readContent(props.value ?? "");
  } catch {
    initial = emptyRichDocument();
    incomingError = t('incomingError');
  }
  const generatedId = useId(),
    id = props.id ?? `rich-${generatedId}`;
  const latest = useRef(props);
  latest.current = props;
  const initialRef = useRef(initial);
  const lastInput = useRef(serializeRichDocument(initial));
  const emissions = useRef(new Map<string, number>());
  const editSequence = useRef(0),
    acknowledgedSequence = useRef(0);
  const [localError, setLocalError] = useState<RichTextMessage|"">("");
  const [localConflict, setLocalConflict] = useState(false);
  const [, rerender] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false),
    [href, setHref] = useState(""),
    [linkError, setLinkError] = useState<RichTextMessage|"">("");
  const linkInput = useRef<HTMLInputElement>(null),
    linkButton = useRef<HTMLButtonElement>(null);
  const fragment = props.collaboration?.fragment;
  const editorRef=useRef<Editor|null>(null);
  const editor = useEditor(
    {
      extensions: richEditorExtensions({
        fragment,
        maxLength:props.maxLength,
        mentionLabel:roleId=>mentionLabel(scopeRef.current?.roles.find(role=>role.id===roleId),localeRef.current),
        onInvalid: () =>
          queueMicrotask(() =>
            setLocalError('invalidChange'),
          ),
      }),
      ...(fragment ? {} : { content: initialRef.current.doc }),
      immediatelyRender: false,
      editable: !props.readOnly && !props.conflict && !incomingError,
      editorProps: {
        handleKeyDown:(_view,event)=>{
          const current=editorRef.current;
          if(!current||isMentionLocked()||!scopeRef.current)return false;
          const query=currentMentionQuery(current);
          if(!query||dismissedMention.current===mentionSignature(query))return false;
          const options=matchMentionRoles(scopeRef.current.roles,query.query);
          if(event.key==='Escape'){dismissedMention.current=mentionSignature(query);rerender(n=>n+1);event.stopPropagation();return true;}
          if((event.key==='ArrowDown'||event.key==='ArrowUp')&&options.length){setMentionActive(n=>(n+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);return true;}
          if(event.key==='Enter'&&options.length){insertRole(current,options[Math.min(activeMention.current,options.length-1)]);return true;}
          return false;
        },
        attributes: {
          id,
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": `${id}-label`,
          "aria-describedby": `${id}-status`,
          "aria-required": String(!!props.required),
          spellcheck: "true",
        },
      },
      onUpdate: ({ editor }) => {
        try {
          const doc = validateRichDocument({
            format: "orgmap-richtext",
            version: 1,
            doc: editor.getJSON(),
          });
          const canonical = serializeRichDocument(doc);
          emissions.current.delete(canonical);
          emissions.current.set(canonical, ++editSequence.current);
          // Bounded echo window; each entry is validated <=1MB, with a combined 8MB cap.
          let size = [...emissions.current.keys()].reduce(
            (n, s) => n + s.length * 2,
            0,
          );
          while (emissions.current.size > 64 || size > 8_000_000) {
            const oldest = emissions.current.keys().next().value!;
            size -= oldest.length * 2;
            emissions.current.delete(oldest);
          }
          setLocalError("");
          latest.current.onChange?.(doc);
          rerender((n) => n + 1);
        } catch {
          setLocalError('incompatibleContent');
          editor.setEditable(false);
        }
      },
      onTransaction: () => rerender((n) => n + 1),
      onCreate: ({ editor }) => latest.current.onReady?.(editor),
    },
    [fragment],
  );

  editorRef.current=editor;
  useEffect(() => {
    if (!editor || fragment || incomingError) return;
    const incoming = serializeRichDocument(initial);
    const ownSequence = emissions.current.get(incoming);
    if (ownSequence !== undefined) {
      acknowledgedSequence.current = Math.max(
        acknowledgedSequence.current,
        ownSequence,
      );
      lastInput.current = incoming;
      return;
    }
    if (incoming === lastInput.current) return;
    lastInput.current = incoming;
    if (
      editSequence.current > acknowledgedSequence.current ||
      props.pending ||
      props.conflict
    ) {
      setLocalConflict(true);
      props.onConflict?.(
        validateRichDocument({
          format: "orgmap-richtext",
          version: 1,
          doc: editor.getJSON(),
        }),
      );
      return;
    }
    // A clean externally accepted revision starts a fresh history. It is not a local undo step.
    editor.view.updateState(
      EditorState.create({
        schema: editor.schema,
        doc: editor.schema.nodeFromJSON(initial.doc),
        plugins: editor.state.plugins,
      }),
    );
    rerender((n) => n + 1);
  }, [initial, incomingError, editor, fragment, props.pending, props.conflict]);
  const locked =
    !!props.readOnly || !!props.conflict || localConflict || !!incomingError;
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!locked, false);
    editor.setOptions({
      editorProps: {
        attributes: {
          id,
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": `${id}-label`,
          "aria-describedby": `${id}-status`,
          "aria-required": String(!!props.required),
          "aria-readonly": String(locked),
          "aria-invalid": String(!!props.error),
          "data-placeholder": props.placeholder ?? t('placeholder'),
          spellcheck: "true",
        },
      },
    });
    if (locked) setLinkOpen(false);
  }, [
    editor,
    locked,
    id,
    props.label,
    props.placeholder,
    props.required,
    props.error,
    locale,
  ]);
  useEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  function toolbarKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    ];
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (current < 0) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (current + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  }
  function closeLink() {
    setLinkOpen(false);
    setLinkError("");
    linkButton.current?.focus();
  }
  function applyLink() {
    if (!editor || locked) return;
    if (!isSafeLink(href)) {
      setLinkError('unsafeLink');
      return;
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      setLinkError('linkSelection');
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setLinkError("");
  }
  const controls = [
    {
      name: t('bold'),
      icon: Bold,
      active: "bold",
      run: () => editor?.chain().focus().toggleBold().run(),
      shortcut: "Ctrl/⌘ B",
    },
    {
      name: t('italic'),
      icon: Italic,
      active: "italic",
      run: () => editor?.chain().focus().toggleItalic().run(),
      shortcut: "Ctrl/⌘ I",
    },
    {
      name: t('underline'),
      icon: Underline,
      active: "underline",
      run: () => editor?.chain().focus().toggleUnderline().run(),
      shortcut: "Ctrl/⌘ U",
    },
    {
      name: t('strike'),
      icon: Strikethrough,
      active: "strike",
      run: () => editor?.chain().focus().toggleStrike().run(),
    },
    {
      name: t('bulletList'),
      icon: List,
      active: "bulletList",
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      name: t('numberedList'),
      icon: ListOrdered,
      active: "orderedList",
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
  ];
  const message =
    incomingError ||
    (props.conflict || localConflict
      ? typeof props.conflict === "string"
        ? props.conflict
        : t('conflict')
      : props.error ||
        (localError?t(localError):'') ||
        (props.pending
          ? t('pending')
          : props.readOnly
            ? t('readOnly')
            : ""));
  const query=editor&&!locked&&!props.pending&&mentionScope?currentMentionQuery(editor):null;
  const mentionOpen=!!query&&dismissedMention.current!==mentionSignature(query);
  const mentionOptions=query&&mentionScope?matchMentionRoles(mentionScope.roles,query.query):[];
  const signature=query?mentionSignature(query):'';
  useEffect(()=>setMentionActive(0),[signature]);
  useEffect(()=>{
    if(!editor)return;
    // Labels are a presentation of stable IDs, refreshed from current readable scope.
    for(const element of editor.view.dom.querySelectorAll<HTMLElement>('[data-role-id]')){
      const role=mentionScope?.roles.find(role=>role.id===element.dataset.roleId);
      element.textContent=mentionLabel(role,locale);
      element.dataset.unavailable=String(!role||!!role.archived);
    }
    editor.view.dom.setAttribute('aria-autocomplete','list');
    editor.view.dom.setAttribute('aria-haspopup','listbox');
    if(mentionOpen){
      editor.view.dom.setAttribute('aria-controls',id+'-roles');
      if(mentionOptions.length)editor.view.dom.setAttribute('aria-activedescendant',id+'-role-'+Math.min(mentionActive,mentionOptions.length-1));
      else editor.view.dom.removeAttribute('aria-activedescendant');
    }else{
      editor.view.dom.removeAttribute('aria-controls');editor.view.dom.removeAttribute('aria-activedescendant');
    }
  },[editor,mentionScope,signature,mentionOpen,mentionActive,mentionOptions.length,id,locale]);
  const isEmpty = !editor || editor.isEmpty;
  let draft: RichDocument | null = null;
  if ((props.conflict || localConflict || incomingError) && editor) {
    try {
      draft = validateRichDocument({
        format: "orgmap-richtext",
        version: 1,
        doc: editor.getJSON(),
      });
    } catch {
      /* unrenderable draft stays untouched in editor */
    }
  }
  return (
    <div
      className={`orgmap-rich-editor ${props.compact ? "orgmap-rich-compact" : ""} ${props.className ?? ""}`}
      data-readonly={locked}
      data-empty={isEmpty}
      data-pending={!!props.pending}
    >
      <label id={`${id}-label`} htmlFor={id} className="orgmap-rich-label">
        {props.label}
        {props.required && <span> {t('required')}</span>}
      </label>
      <div className="orgmap-rich-frame">
        {props.toolbar !== false && <div
          className="orgmap-rich-toolbar"
          role="toolbar"
          aria-label={t('toolbar',{label:props.label})}
          aria-controls={id}
          onKeyDown={toolbarKey}
        >
          {controls.map(({ name, icon: Icon, active, run, shortcut }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={shortcut ? `${name} (${shortcut})` : name}
              aria-pressed={!!editor?.isActive(active)}
              disabled={!editor || locked}
              onMouseDown={(e) => e.preventDefault()}
              onClick={run}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
          <button
            ref={linkButton}
            type="button"
            aria-label={t('insertLink')}
            title={t('insertLink')}
            aria-pressed={!!editor?.isActive("link")}
            aria-expanded={linkOpen}
            aria-controls={`${id}-link`}
            disabled={!editor || locked}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setHref(editor?.getAttributes("link").href ?? "");
              setLinkError("");
              setLinkOpen((v) => !v);
            }}
          >
            <Link size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('removeLink')}
            title={t('removeLink')}
            disabled={!editor || locked || !editor.isActive("link")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor?.chain().focus().extendMarkRange("link").unsetLink().run()
            }
          >
            <Unlink size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('undo')}
            title={`${t('undo')} (Ctrl/⌘ Z)`}
            disabled={!editor || locked || !editor.can().undo()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('redo')}
            title={`${t('redo')} (Ctrl/⌘ Shift Z)`}
            disabled={!editor || locked || !editor.can().redo()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
        </div>}
        {linkOpen && (
          <div
            id={`${id}-link`}
            className="orgmap-rich-link"
            role="group"
            aria-label={t('editLink')}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeLink();
              }
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
          >
            <label htmlFor={`${id}-url`}>{t('linkUrl')}</label>
            <input
              ref={linkInput}
              id={`${id}-url`}
              type="url"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              aria-invalid={!!linkError}
              aria-describedby={linkError ? `${id}-link-error` : undefined}
              placeholder={t('linkExample')}
              autoComplete="off"
            />
            <div>
              <button
                type="button"
                className="orgmap-rich-apply"
                onClick={applyLink}
              >
                {t('apply')}
              </button>
              <button type="button" onClick={closeLink}>
                {t('cancel')}
              </button>
            </div>
            {linkError && (
              <p id={`${id}-link-error`} role="alert">
                {t(linkError)}
              </p>
            )}
          </div>
        )}
        <EditorContent editor={editor} className="orgmap-rich-content" />
        {mentionOpen&&<div className="orgmap-mention-picker">
          <div id={id+'-roles'} role="listbox" aria-label={t('mentionRole')}>
            {mentionOptions.map((role,index)=><button type="button" role="option" id={id+'-role-'+index} key={role.id} aria-selected={index===Math.min(mentionActive,mentionOptions.length-1)} onMouseDown={event=>event.preventDefault()} onClick={()=>editor&&insertRole(editor,role)}>{'@'+role.name}</button>)}
          </div>
          <p role="status">{mentionOptions.length?t('mentionHelp'):t('mentionEmpty')}</p>
        </div>}

      </div>
      <p
        id={`${id}-status`}
        role={
          props.error ||
          localError ||
          props.conflict ||
          localConflict ||
          incomingError
            ? "alert"
            : "status"
        }
        className={`orgmap-rich-status ${props.error || localError || props.conflict || localConflict || incomingError ? "orgmap-rich-error" : ""}`}
      >
        {message}
      </p>
      {draft && (
        <details className="orgmap-rich-recovery">
          <summary>{t('recoverySummary')}</summary>
          <RichTextView value={draft} />
          <label htmlFor={`${id}-recovery`}>{t('recoveryCopy')}</label>
          <textarea id={`${id}-recovery`} readOnly value={toPlainText(draft)} />
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([serializeRichDocument(draft!)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "rascunho-orgmap-richtext-v1.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {t('recoveryDownload')}
          </button>
        </details>
      )}
    </div>
  );
}
