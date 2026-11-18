import type { Ctx } from "../../src/runtime.js";
import { uuid, fail } from "../../src/core.js";
import type { ResourceRef, ResourceRegistry } from "./ports.js";
import { eventModule } from "./catalog.js";
import type {NotificationIntent} from '../../../packages/contracts/notifications.js';
import {normalizeNotificationContext} from './notification-presentation.js';
import {Failure} from '../../src/core.js';
export async function effectivePreference(
  ctx: Ctx,
  memberId: string,
  event: string,
  channel: string,
  registry: ResourceRegistry,
) {
  if (channel === "EMAIL" && !(await registry.notificationEmailEnabled(ctx)))
    return { enabled: false, origin: "ORGANIZATION_EMAIL_DISABLED" };
  const module = eventModule(event);
  if (module) {
    const master = (
      await ctx.c.query(
        "SELECT enabled FROM platform_preferences WHERE organization_id=$1 AND member_id=$2 AND event=$3 AND channel=$4",
        [ctx.org.id, memberId, module + ".Master", channel],
      )
    ).rows[0];
    if (master?.enabled === false)
      return { enabled: false, origin: "USER_MASTER_DISABLED" };
    const orgMaster = (
      await ctx.c.query(
        "SELECT module_enabled,master_enabled FROM platform_policy WHERE organization_id=$1 AND event=$2 AND channel=$3",
        [ctx.org.id, module + ".Master", channel],
      )
    ).rows[0];
    if (orgMaster?.module_enabled === false)
      return { enabled: false, origin: "MODULE_DISABLED" };
    if (orgMaster?.master_enabled === false)
      return { enabled: false, origin: "MASTER_DISABLED" };
  }
  const policy = (
    await ctx.c.query(
      "SELECT * FROM platform_policy WHERE organization_id=$1 AND event=$2 AND channel=$3",
      [ctx.org.id, event, channel],
    )
  ).rows[0];
  const user = (
    await ctx.c.query(
      "SELECT enabled FROM platform_preferences WHERE organization_id=$1 AND member_id=$2 AND event=$3 AND channel=$4",
      [ctx.org.id, memberId, event, channel],
    )
  ).rows[0];
  if (policy?.module_enabled === false)
    return { enabled: false, origin: "MODULE_DISABLED" };
  if (policy?.master_enabled === false)
    return { enabled: false, origin: "MASTER_DISABLED" };
  if (policy?.locked)
    return { enabled: policy.default_enabled, origin: "LOCK" };
  if (user) return { enabled: user.enabled, origin: "USER" };
  return { enabled: policy?.default_enabled ?? true, origin: "DEFAULT" };
}
/** Called in the producer's transaction. Recipients must be validated by its own domain service. */
export async function enqueueNotification(
  ctx: Ctx,
  registry: ResourceRegistry,
  input: Omit<NotificationIntent,'event'> & {event:string},
) {
  if (!registry.get(input.ref.type)) fail(404, "RESOURCE_NOT_FOUND");
  const recipients=new Map<string,{memberId:string;nominal:boolean;followRefs:ResourceRef[]}>();
  for(const recipient of input.recipients){const prior=recipients.get(recipient.memberId);recipients.set(recipient.memberId,{...recipient,nominal:recipient.nominal||prior?.nominal===true,followRefs:prior?.followRefs??[input.ref]});}
  const followedRefs=[...(input.followers?[input.ref]:[]),...(input.followersOf??[])];
  for(const followedRef of followedRefs){
    if(!registry.get(followedRef.type))fail(404,'RESOURCE_NOT_FOUND');
    for(const follower of (await ctx.c.query('SELECT member_id FROM platform_follows WHERE organization_id=$1 AND resource_type=$2 AND resource_id=$3 AND enabled',[ctx.org.id,followedRef.type,followedRef.id])).rows){
      const prior=recipients.get(follower.member_id);
      recipients.set(follower.member_id,{memberId:follower.member_id,nominal:prior?.nominal??false,followRefs:[...(prior?.followRefs??[]),followedRef]});
    }
  }
  const context=normalizeNotificationContext(input.context);
  const actorName=Array.from(String(input.actorName??ctx.account?.display_name??ctx.account?.displayName??'').replace(/[\x00-\x1f\x7f]/g,' ').trim()).slice(0,200).join('')||null;
  for (const recipient of recipients.values()) {
    if (recipient.memberId === ctx.member.id && !input.includeActor) continue;
    const deliveryContext={...context,...(!recipient.nominal?{followRefs:recipient.followRefs}:{} )};
    if (!recipient.nominal && !await notificationStillFollowed(ctx,{recipient_id:recipient.memberId,resource_type:input.ref.type,resource_id:input.ref.id,context:deliveryContext}))continue;
    for (const channel of ["IN_APP", "EMAIL"]) {
      const pref = await effectivePreference(
        ctx,
        recipient.memberId,
        input.event,
        channel,
        registry,
      );
      if (!pref.enabled) continue;
      await ctx.c.query(
        `INSERT INTO platform_deliveries(organization_id,id,event_id,recipient_id,channel,resource_type,resource_id,event,nominal,context,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(organization_id,event_id,recipient_id,channel) DO NOTHING`,
        [
          ctx.org.id,
          uuid(),
          input.eventId,
          recipient.memberId,
          channel,
          input.ref.type,
          input.ref.id,
          input.event,
          recipient.nominal,
          JSON.stringify(deliveryContext),
          actorName,
        ],
      );
    }
  }
}

/** Follow origins are persisted per recipient and rechecked under current tenant ACL. */
export async function notificationStillFollowed(ctx:Ctx,d:any,registry?:ResourceRegistry):Promise<boolean> {
  if(d.nominal===true)return true;
  const refs=Array.isArray(d.context?.followRefs)?d.context.followRefs:[{type:d.resource_type,id:d.resource_id}];
  for(const ref of refs){
    if(!ref||typeof ref.type!=='string'||typeof ref.id!=='string')continue;
    if(registry){
      try {if(!await registry.allowed(ctx,ref,'follow'))continue;}
      catch(error){if(error instanceof Failure&&[403,404].includes(error.status))continue;throw error;}
    }
    if((await ctx.c.query('SELECT 1 FROM platform_follows WHERE organization_id=$1 AND member_id=$2 AND resource_type=$3 AND resource_id=$4 AND enabled',[ctx.org.id,d.recipient_id,ref.type,ref.id])).rowCount)return true;
  }
  return false;
}
