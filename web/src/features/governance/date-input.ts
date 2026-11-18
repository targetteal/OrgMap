/** Civil input in the account time zone. Never interpret it in the browser's zone. */
export function mandateInput(instant:string|undefined,timeZone:string):string {
  if (!instant) return "";
  const date=new Date(instant);
  if (!Number.isFinite(date.getTime())) return "";
  const parts=new Intl.DateTimeFormat("en-CA-u-nu-latn",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const get=(key:string)=>parts.find(part=>part.type===key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function mandateInstant(value:string,timeZone:string,original?:string):string {
  if (original && mandateInput(original,timeZone)===value) return new Date(original).toISOString();
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("INVALID_MANDATE_TIME");
  const [,y,m,d,h,min]=match.map(Number), wall=Date.UTC(y,m-1,d,h,min);
  if (new Date(wall).toISOString().slice(0,16)!==value) throw new Error("INVALID_MANDATE_TIME");
  const candidates=new Set<number>();
  for (const hours of [-36,-24,-12,0,12,24,36]) {
    const probe=wall+hours*3600000;
    const local=mandateInput(new Date(probe).toISOString(),timeZone);
    const offset=Date.parse(local+":00Z")-probe;
    const candidate=wall-offset;
    if (mandateInput(new Date(candidate).toISOString(),timeZone)===value) candidates.add(candidate);
  }
  if (candidates.size!==1) throw new Error(candidates.size ? "AMBIGUOUS_MANDATE_TIME" : "NONEXISTENT_MANDATE_TIME");
  return new Date([...candidates][0]).toISOString();
}
