import type {FeatureContext} from './feature-contract';
import {MemberIndicators} from './features/structure-advanced';
import {Button} from './ui';
import {useLocalization} from './localization';
import {memberProfileLabels} from './member-profile-route';
export function MemberProfileIndicators({context,memberId,kind}:{context:FeatureContext;memberId:string;kind:'METRIC'|'CHECKLIST'}){
 const {locale}=useLocalization();
 if(context.bootstrap.membership.memberType==='GUEST')return null;
 return <section className="profile-indicators">
  {context.bootstrap.membership.id===memberId&&<Button onClick={()=>context.navigate('/my-indicator-permissions')}>{memberProfileLabels(locale).permissions}</Button>}
  <MemberIndicators context={context} memberId={memberId} kind={kind}/>
 </section>;
}
