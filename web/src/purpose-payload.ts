import type {RichDocument} from '../../packages/content';
export function purposePayload(draft: RichDocument | undefined, creating = false): {purposeRich: RichDocument} | {purpose: string} | Record<string, never> {
 return draft !== undefined ? {purposeRich: draft} : creating ? {purpose: ''} : {};
}
