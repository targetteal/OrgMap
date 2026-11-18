// Node tests do not render CSS; browser verification remains a separate required gate.
export async function load(url,context,next){
 if(url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};
 return next(url,context);
}
