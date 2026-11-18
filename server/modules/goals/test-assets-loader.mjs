// DOM tests only: Node does not render styles or SVG assets.
export async function load(url, context, next) {
 if (/\.(css|svg)$/.test(url)) return {format:'module',source:'export default '+JSON.stringify(url)+';',shortCircuit:true};
 return next(url,context);
}
