import {test} from "node:test";
import assert from "node:assert/strict";
import {Governance} from "../../server/modules/governance/service.js";

test("proposal source authorship applies even to an owner", async () => {
  const gov = new Governance({mode:"write",member:{id:"owner",org_role:"OWNER",member_type:"MEMBER"},org:{id:"org"}} as any, {} as any);
  gov.entity = async () => ({}) as any;
  gov.row = async () => ({author_id:"other",state:"OPEN",circle_id:"circle"}) as any;
  await assert.rejects(gov.proposal({circleId:"circle",tensionId:"known-id"}), /ACTION_DENIED/);
});
