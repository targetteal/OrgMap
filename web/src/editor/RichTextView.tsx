import type { ReactNode } from "react";
import {
  readContent,
  type RichDocument,
  type RichMark,
} from "../../../packages/content/index.ts";

import {mentionLabel, useRoleMentions, type RoleMentionScope} from "./role-mentions";
import {useLocalization} from "../localization";
import {richTextTranslator} from "./rich-text-messages";

function renderNode(node: any, key: number, scope:RoleMentionScope|null, locale:string): ReactNode {
  if(node.type === "roleMention") {
    const role=scope?.roles.find(role=>role.id===node.attrs.roleId);
    const label=mentionLabel(role,locale);
    return role&&!role.archived ? <a key={key} className="orgmap-role-mention" href={"/roles/"+role.id} onClick={event=>{if(scope?.navigate&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();scope.navigate("/roles/"+role.id);}}}>{label}</a> : <span key={key} className="orgmap-role-mention" data-unavailable="true">{label}</span>;
  }
  if (node.type === "text")
    return (
      <span key={key}>
        {(node.marks ?? []).reduce((text: ReactNode, mark: RichMark) => {
          switch (mark.type) {
            case "bold":
              return <strong>{text}</strong>;
            case "italic":
              return <em>{text}</em>;
            case "underline":
              return <u>{text}</u>;
            case "strike":
              return <s>{text}</s>;
            case "link":
              return (
                <a href={mark.attrs.href} rel="noopener noreferrer nofollow">
                  {text}
                </a>
              );
          }
        }, node.text)}
      </span>
    );
  const children = node.content?.map((child:any,index:number)=>renderNode(child,index,scope,locale));
  switch (node.type) {
    case "hardBreak":
      return <br key={key} />;
    case "paragraph":
      return <p key={key}>{children || <br />}</p>;
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={node.attrs.start}>
          {children}
        </ol>
      );
    case "listItem":
      return <li key={key}>{children}</li>;
  }
}
/** Read path renders semantic React elements; it never places supplied HTML into a sink. */
export function RichTextView({
  value,
  className = "",
  emptyText,
  label,
}: {
  value: RichDocument | string;
  className?: string;
  emptyText?: string;
  label?: string;
}) {
  const scope=useRoleMentions();
  const {locale}=useLocalization();
  const t=richTextTranslator(locale);
  try {
    const doc = readContent(value);
    const empty =
      doc.doc.content.length === 1 &&
      doc.doc.content[0].type === "paragraph" &&
      !doc.doc.content[0].content?.length;
    return (
      <div className={`orgmap-rich-view ${className}`} aria-label={label}>
        {empty ? (
          <p className="orgmap-rich-empty">{emptyText ?? t('emptyContent')}</p>
        ) : (
          doc.doc.content.map((node,index)=>renderNode(node,index,scope,locale))
        )}
      </div>
    );
  } catch {
    return (
      <p className="orgmap-rich-error" role="alert">
        {t('openError')}
      </p>
    );
  }
}
