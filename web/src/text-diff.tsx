import { toPlainText, type RichDocument } from "../../packages/content";
import type { DefinitionItem } from "./structure-definition";
import "./text-diff.css";

export type DiffPart = { type: "same" | "added" | "removed"; text: string };
function diffTokens(before: string[], after: string[]): DiffPart[] {
  const m = before.length, n = after.length, width = n + 1;
  const dp = new Uint32Array((m + 1) * (n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i * width + j] = before[i] === after[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (before[i] === after[j]) { push("same", before[i]); i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) { push("removed", before[i]); i++; }
    else { push("added", after[j]); j++; }
  }
  while (i < m) push("removed", before[i++]);
  while (j < n) push("added", after[j++]);
  return parts;
}
const MAX_DIFF_CELLS = 900_000;
export function diffText(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+|\s+/g) ?? [], b = after.match(/\S+|\s+/g) ?? [];
  if (a.length * b.length <= MAX_DIFF_CELLS) return diffTokens(a, b);
  const lines = (text: string) => text.split(/\n/).map((line) => line + "\n");
  const oldLines=lines(before),newLines=lines(after);
  if(oldLines.length*newLines.length<=MAX_DIFF_CELLS)return diffTokens(oldLines,newLines);
  // Keep exceptionally long documents readable without allocating a quadratic matrix.
  return [...(before?[{type:'removed' as const,text:before}]:[]),...(after?[{type:'added' as const,text:after}]:[])];
}
export function DiffParts({ parts }: { parts: DiffPart[] }) {
  return <span className="word-diff">{parts.map((part, i) =>
    part.type === "same" ? part.text
      : part.type === "added" ? <ins key={i}>{part.text}</ins>
      : <del key={i}>{part.text}</del>)}</span>;
}
export function DiffText({ parts }: { parts: DiffPart[] }) {
  return <p className="word-diff word-diff-text"><DiffParts parts={parts} /></p>;
}
export const plain = (rich: RichDocument | null | undefined, text: string | null | undefined) =>
  rich ? toPlainText(rich) : text ?? "";
export const definitionItemText = (item: DefinitionItem) => item.richText ? toPlainText(item.richText) : item.text;
export const definitionItems = (list: any[] | undefined): DefinitionItem[] =>
  (list ?? []).map((item) => (typeof item === "string" ? { id: item, text: item } : item));
export function DefinitionsDiff({ proposed, current, empty }: { proposed?: DefinitionItem[]; current?: DefinitionItem[]; empty?: string }) {
  const before = new Map(definitionItems(current).map((item) => [item.id, item]));
  const after = new Set(definitionItems(proposed).map((item) => item.id));
  const list = [...definitionItems(proposed), ...definitionItems(current).filter((item) => !after.has(item.id))];
  if (!list.length) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ul className="word-diff word-diff-list">
      {list.map((item) => {
        const old = before.get(item.id);
        if (!old) return <li key={item.id} className="is-added"><ins>{definitionItemText(item)}</ins></li>;
        if (!after.has(item.id)) return <li key={item.id} className="is-removed"><del>{definitionItemText(old)}</del></li>;
        return <li key={item.id}><DiffParts parts={diffText(definitionItemText(old), definitionItemText(item))} /></li>;
      })}
    </ul>
  );
}
