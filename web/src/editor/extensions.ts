import { Extension, Node, type Extensions } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { OrderedList } from "@tiptap/extension-list";
import Collaboration from "@tiptap/extension-collaboration";
import type { XmlFragment } from "yjs";
import {
  isSafeLink,
  toPlainText,
  validateRichDocument,
} from "../../../packages/content/index.ts";

const RoleMention = Node.create({
  name: "roleMention",
  group: "inline",
  inline: true,
  atom: true,
  marks: "",
  selectable: true,
  addAttributes() { return {roleId:{default:null},label:{default:null}}; },
  // Pasted HTML remains literal text; identity can only be inserted through an explicit selection.
  parseHTML() { return []; },
  renderHTML({node}) { return ["span", {"data-role-id":node.attrs.roleId,class:"orgmap-role-mention"}, "@"+node.attrs.label]; },
  renderText({node}) { return "@"+node.attrs.label; },
});

const ClosedLink = Link.extend({
  addAttributes() {
    return {
      href: { default: null, parseHTML: (e) => e.getAttribute("href") },
    };
  },
}).configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: true,
  isAllowedUri: isSafeLink,
  HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
});
const ClosedOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (e) => Number(e.getAttribute("start") ?? 1),
      },
    };
  },
});

/** Clipboard parsing and commands use this exact closed schema; no heading/code/image fallback. */
export function richEditorExtensions(
  options: { fragment?: XmlFragment; onInvalid?: (error: Error) => void; mentionLabel?: (roleId:string)=>string; maxLength?:number } = {},
): Extensions {
  const guard = Extension.create({
    name: "orgmapContentGuard",
    priority: 10000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction: (transaction) => {
            if (!transaction.docChanged) return true;
            try {
              // Formatting a selection includes leaf atoms in ProseMirror. Keep the
              // identity atom unmarked while preserving formatting of adjacent text.
              const atoms:number[]=[];
              transaction.doc.descendants((node,pos)=>{if(node.type.name==='roleMention'&&node.marks.length)atoms.push(pos);});
              for(const pos of atoms)transaction.removeMark(pos,pos+1);
              const document=validateRichDocument({
                format: "orgmap-richtext",
                version: 1,
                doc: transaction.doc.toJSON(),
              });
              if(options.maxLength!==undefined&&[...toPlainText(document)].length>options.maxLength)throw new Error("Conteúdo excede o limite do campo");
              return true;
            } catch (e) {
              options.onInvalid?.(
                e instanceof Error ? e : new Error("Conteúdo inválido"),
              );
              return false;
            }
          },
        }),
      ];
    },
  });
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      link: false,
      orderedList: false,
      trailingNode: false,
      ...(options.fragment ? { undoRedo: false } : {}),
    }),
    RoleMention.extend({
      addNodeView(){return ({node})=>{
        const dom=document.createElement('span');dom.contentEditable='false';dom.className='orgmap-role-mention';
        const present=(value:typeof node)=>{dom.dataset.roleId=value.attrs.roleId;dom.textContent=options.mentionLabel?.(value.attrs.roleId)??'@Papel indisponível';};
        present(node);
        return {dom,ignoreMutation:()=>true,update(updated){if(updated.type.name!=='roleMention')return false;present(updated);return true;}};
      };},
    }),
    ClosedLink,
    ClosedOrderedList,
    guard,
    ...(options.fragment
      ? [Collaboration.configure({ fragment: options.fragment })]
      : []),
  ];
}
