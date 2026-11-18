export function credentialProof(password:string,totpCode:string,federated:boolean):{password?:string;totpCode?:string}{
 return {...(!federated?{password}:{}),...(totpCode?{totpCode}: {})};
}
