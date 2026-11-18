const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function admissionRoute(value:string):{organizationId:string;requestId?:string;linkToken?:string;path:string}|null {
 const url=new URL(value,'https://orgmap.invalid');
 if(url.origin!=='https://orgmap.invalid')return null;
 const match=/^\/join\/([^/]+)\/?$/.exec(url.pathname);
 if(!match||!uuid.test(match[1]))return null;
 const requestId=url.searchParams.get('requestId');
 const fragment=new URLSearchParams(url.hash.slice(1));
 const linkToken=fragment.get('linkToken')||undefined;
 return {organizationId:match[1],...(requestId&&uuid.test(requestId)?{requestId}:{}),...(linkToken?{linkToken}:{}),path:admissionPath(match[1],requestId&&uuid.test(requestId)?requestId:null)};
}
export function admissionPath(organizationId:string,requestId?:string|null):string {
 if(!uuid.test(organizationId))throw new Error('Invalid organization identifier');
 return '/join/'+organizationId+(requestId&&uuid.test(requestId)?'?requestId='+requestId:'');
}
/** Only for an explicit copy/open action; never store the resulting capability URL. */
export function admissionLinkPath(organizationId:string,linkToken:string):string {
 return admissionPath(organizationId)+'#linkToken='+encodeURIComponent(linkToken);
}
