import {RichTextEditor,RichTextView} from '../../editor';
import type {RichDocument} from '../../../../packages/content/index';
import {useLocalization} from '../../localization';
import {goalTranslator} from './messages';
export function RichText({value}:{value:string|RichDocument}){
 const {locale}=useLocalization();const t=goalTranslator(locale);
 return <RichTextView value={value} className="goals-rich-text" emptyText={t('Sem descrição')}/>;
}
export function RichEditor({id,value,onChange,placeholder,pending=false,error}:{id?:string;value:string|RichDocument;onChange:(value:RichDocument)=>void;placeholder?:string;pending?:boolean;error?:string}){
 const {locale}=useLocalization();const t=goalTranslator(locale);
 return <RichTextEditor id={id} label={t('Descrição')} value={value} onChange={onChange} placeholder={placeholder} pending={pending} readOnly={pending} error={error} className="goals-rich-editor"/>;
}
