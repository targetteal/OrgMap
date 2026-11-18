import type {AccessibilityPreferences} from './preferences';

/** Text only: no SVG/canvas, no transforms/zoom, and no modification of input values or visibility. */
export function applyTextScale(root:HTMLElement,size:AccessibilityPreferences['textSize']):()=>void {
  if(size==='default') return ()=>{};
  const scale=size==='large'?1.25:1.5;
  const managed=new Map<HTMLElement,{value:string;priority:string;applied:string}>();
  const restore=()=>{
    for(const [element,previous] of managed) {
      if(element.style.getPropertyValue('font-size')!==previous.applied) continue;
      if(previous.value) element.style.setProperty('font-size',previous.value,previous.priority);
      else element.style.removeProperty('font-size');
    }
    managed.clear();
  };
  const scan=()=>{
    restore();
    const targets=[root,...root.querySelectorAll<HTMLElement>('*')].filter(element=>
      element instanceof HTMLElement && !element.closest('svg,canvas,script,style,[hidden],input[type="hidden"],[aria-hidden="true"],[data-a11y-preserve]') &&
      (['INPUT','SELECT','TEXTAREA'].includes(element.tagName) || [...element.childNodes].some(node=>node.nodeType===3 && !!node.textContent?.trim()))
    );
    const sizes=targets.map(element=>parseFloat(getComputedStyle(element).fontSize));
    targets.forEach((element,i)=>{
      if(!Number.isFinite(sizes[i])) return;
      const previous={value:element.style.getPropertyValue('font-size'),priority:element.style.getPropertyPriority('font-size'),applied:`${sizes[i]*scale}px`};
      element.style.setProperty('font-size',previous.applied,'important');managed.set(element,previous);
    });
  };
  scan();
  const observer=new MutationObserver(scan);
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  return ()=>{observer.disconnect();restore();};
}

/** Returns exact attribute/style cleanup; changing account cannot leave another account's settings active. */
export function applyAccessibilityAttributes(root:HTMLElement,p:AccessibilityPreferences,reducedMotion:boolean):()=>void {
  const attrs:Record<string,string>={'data-orgmap-accessibility':'true','data-a11y-text-size':p.textSize};
  for(const [key,value] of Object.entries(p)) if(key!=='textSize') attrs[`data-a11y-${key.replace(/[A-Z]/g,c=>`-${c.toLowerCase()}`)}`]=String(value);
  attrs['data-a11y-motion']=String(p.motion||reducedMotion);
  const previous=new Map(Object.keys(attrs).map(key=>[key,root.getAttribute(key)]));
  for(const [key,value] of Object.entries(attrs)) root.setAttribute(key,value);
  return ()=> { for(const [key,value] of previous) value===null?root.removeAttribute(key):root.setAttribute(key,value); };
}
