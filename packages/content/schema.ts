import { Schema } from "@tiptap/pm/model";

/** The durable v1 grammar, also used for server-side Yjs conversion. */
export const richTextSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    bulletList: {
      group: "block",
      content: "listItem+",
      toDOM: () => ["ul", 0],
      parseDOM: [{ tag: "ul" }],
    },
    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: { start: { default: 1 } },
      toDOM: (n) => ["ol", { start: n.attrs.start }, 0],
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (n) => ({
            start: Number((n as HTMLElement).getAttribute("start") ?? 1),
          }),
        },
      ],
    },
    listItem: {
      content: "paragraph block*",
      defining: true,
      toDOM: () => ["li", 0],
      parseDOM: [{ tag: "li" }],
    },
    text: { group: "inline" },
    hardBreak: {
      group: "inline",
      inline: true,
      selectable: false,
      toDOM: () => ["br"],
      parseDOM: [{ tag: "br" }],
    },
    roleMention: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      marks: "",
      attrs: { roleId: { default: null }, label: { default: null } },
      // Clipboard HTML cannot introduce identities; selection inserts the node.
      parseDOM: [],
      toDOM: (node) => [
        "span",
        { "data-role-id": node.attrs.roleId, class: "orgmap-role-mention" },
        "@" + node.attrs.label,
      ],
    },
  },
  marks: {
    bold: {
      toDOM: () => ["strong", 0],
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
    },
    italic: { toDOM: () => ["em", 0], parseDOM: [{ tag: "em" }, { tag: "i" }] },
    underline: { toDOM: () => ["u", 0], parseDOM: [{ tag: "u" }] },
    strike: { toDOM: () => ["s", 0], parseDOM: [{ tag: "s" }] },
    link: {
      attrs: { href: { default: null } },
      inclusive: false,
      toDOM: (n) => [
        "a",
        { href: n.attrs.href, rel: "noopener noreferrer nofollow" },
        0,
      ],
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (n) => ({ href: (n as HTMLElement).getAttribute("href") }),
        },
      ],
    },
  },
});
