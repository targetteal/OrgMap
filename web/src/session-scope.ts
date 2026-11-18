import type {Bootstrap,Session} from './api';
export function sessionOwnsBootstrap(session:Session,bootstrap:Bootstrap|null):bootstrap is Bootstrap {
 return !!bootstrap && session.organizations.some(org=>org.id===bootstrap.organization.id && org.memberId===bootstrap.membership.id);
}
