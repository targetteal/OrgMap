import type { Pool } from 'pg';

/** Internal supervisor API; pool must use the restricted maintenance login.
 * Lease credentials come only from PostgreSQL, never HTTP/tenant input. */
export type DeletionJobLease = Readonly<{
 organizationId:string; jobId:string; fence:string; token:string; leaseUntil:string; phase:string;
}>;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function target(org:string,job:string,fence:string) {
 if(!uuid.test(org)||!uuid.test(job)||!/^[1-9][0-9]{0,18}$/.test(fence)) throw Error('DELETION_JOB_INPUT_INVALID');
}
function ttl(seconds:number) {if(!Number.isInteger(seconds)||seconds<5||seconds>300)throw Error('DELETION_LEASE_TTL_INVALID');}
export async function claimDeletionJob(pool:Pool,input:{organizationId:string;jobId:string;fence:string;ttlSeconds:number}):Promise<DeletionJobLease> {
 target(input.organizationId,input.jobId,input.fence);ttl(input.ttlSeconds);
 const result=(await pool.query('SELECT public.orgmap_deletion_job_claim($1,$2,$3,$4) AS result',[input.organizationId,input.jobId,input.fence,input.ttlSeconds])).rows[0]?.result;
 if(!result||!uuid.test(result.leaseToken)||typeof result.leaseUntil!=='string'||!Number.isFinite(Date.parse(result.leaseUntil))||result.fence!==input.fence||typeof result.phase!=='string')throw Error('DELETION_JOB_CLAIM_RESULT_INVALID');
 return Object.freeze({organizationId:input.organizationId,jobId:input.jobId,fence:input.fence,token:result.leaseToken,leaseUntil:result.leaseUntil,phase:result.phase});
}
export async function heartbeatDeletionJob(pool:Pool,lease:DeletionJobLease,ttlSeconds:number):Promise<string> {
 target(lease.organizationId,lease.jobId,lease.fence);if(!uuid.test(lease.token))throw Error('DELETION_JOB_INPUT_INVALID');ttl(ttlSeconds);
 const value=(await pool.query('SELECT public.orgmap_deletion_job_heartbeat($1,$2,$3,$4,$5) AS expiry',[lease.organizationId,lease.jobId,lease.fence,lease.token,ttlSeconds])).rows[0]?.expiry;
 if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw Error('DELETION_JOB_HEARTBEAT_RESULT_INVALID');return value.toISOString();
}
export async function yieldDeletionJob(pool:Pool,lease:DeletionJobLease,errorCode:string|null=null):Promise<void> {
 target(lease.organizationId,lease.jobId,lease.fence);if(!uuid.test(lease.token)||errorCode!==null&&!/^[A-Z][A-Z0-9_]{0,79}$/.test(errorCode))throw Error('DELETION_JOB_INPUT_INVALID');
 await pool.query('SELECT public.orgmap_deletion_job_yield($1,$2,$3,$4,$5)',[lease.organizationId,lease.jobId,lease.fence,lease.token,errorCode]);
}
