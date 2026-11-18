import { validateRichDocument, toPlainText, ContentValidationError, type RichDocument } from "../../../packages/content/index.js";
import { fail, optionalText } from "../../src/core.js";
/** Rich source is explicit. Legacy strings are always literal, including JSON/HTML-looking strings. */
export function agreementContent(input: {content?:unknown;richContent?:unknown}, required=false): {content:string;richContent:RichDocument|null} {
  if (input.richContent !== undefined) {
    if (input.content !== undefined) fail(400,"AMBIGUOUS_DOCUMENT_CONTENT");
    try {
      const richContent=validateRichDocument(input.richContent);
      const content=optionalText(toPlainText(richContent),50000);
      return {content,richContent};
    } catch (error) {
      if (error instanceof ContentValidationError) fail(422,"INVALID_RICH_DOCUMENT");
      throw error;
    }
  }
  if (required && input.content === undefined) fail(400,"DOCUMENT_CONTENT_REQUIRED");
  return {content:optionalText(input.content,50000),richContent:null};
}
/** Plain legacy remains literal; rich descriptions use an explicit, validated AST. */
export function tensionDescription(input:{description?:unknown;descriptionRich?:unknown}):{description:string;descriptionRich:RichDocument|null}{
  if(input.descriptionRich!==undefined){
    if(input.description!==undefined)fail(400,'AMBIGUOUS_TENSION_DESCRIPTION');
    try{
      const descriptionRich=validateRichDocument(input.descriptionRich);
      return {description:optionalText(toPlainText(descriptionRich),10000),descriptionRich};
    }catch(error){if(error instanceof ContentValidationError)fail(422,'INVALID_RICH_DOCUMENT');throw error;}
  }
  return {description:optionalText(input.description,10000),descriptionRich:null};
}
