const string = { type: "string" },
  number = { type: "integer" },
  nullableString = { type: ["string", "null"] };
export const policySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "method",
    "quorumPercent",
    "responseRequirement",
    "reviewDurationHours",
    "allowRevote",
    "allowAbstain",
    "workflowSteps",
  ],
  properties: {
    draftAccess: {type:"string",enum:["AUTHOR_ONLY","AUTHOR_AND_LEAD_LINKS","CIRCLE_MEMBERS"]},
    decisionProcess: {type:"string",enum:["STANDARD","HOLACRACY_O2"]},
    method: {
      type: "string",
      enum: ["MANUAL_FACILITATED", "CONSENT_ROUND", "CONSENT_WINDOW"],
    },
    quorumPercent: { type: "integer", minimum: 1, maximum: 100 },
    responseRequirement: { type: "string", enum: ["ALL", "QUORUM"] },
    reviewDurationHours: { type: "number", exclusiveMinimum: 0, maximum: 8760 },
    allowRevote: { type: "boolean" },
    allowAbstain: { type: "boolean" },
    workflowSteps: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 50 },
    },
  },
};
export const changeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "entityId"],
  properties: {
    kind: {
      type: "string",
      enum: ["CREATE", "UPDATE", "MOVE", "ARCHIVE", "RESTORE", "FIELD"],
    },
    entityId: { type: "string", format: "uuid" },
    baseVersion: { type: "integer", minimum: 0 },
    fieldId: { type: "string", format: "uuid" },
    value: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        {
          type: "array",
          maxItems: 100,
          items: { type: "string", maxLength: 1000 },
        },
      ],
    },
    entityKind: { type: "string", enum: ["CIRCLE", "ROLE"] },
    parentCircleId: { type: "string", format: "uuid" },
    name: { type: "string", minLength: 1, maxLength: 200 },
    purpose: { type: "string", maxLength: 10000 },
    purposeRich: { anyOf: [{type:'object',additionalProperties:true},{type:'null'}] },
    responsibilities: {type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["id","text"],properties:{id:{type:"string",format:"uuid"},text:{type:"string",minLength:1,maxLength:10000},richText:{type:"object",additionalProperties:true}}}},
    artifacts: {type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["id","text"],properties:{id:{type:"string",format:"uuid"},text:{type:"string",minLength:1,maxLength:10000},richText:{type:"object",additionalProperties:true}}}},
  },
};
export const documentPartSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentId: { type: "string", format: "uuid" },
    documentVersion: { type: "integer", minimum: 1 },
    documentAction: { type: "string", enum: ["ARCHIVE"] },
    documentBaseVersion: { type: "integer", minimum: 1 },
    newDocument: {
      type: "object",
      additionalProperties: false,
      required: ["title", "richContent"],
      properties: { title: { type: "string", minLength: 1, maxLength: 200 }, richContent: { type: "object", additionalProperties: true } },
    },
    documentRevision: {
      type: "object",
      additionalProperties: false,
      required: ["documentId", "version", "richContent"],
      properties: {
        documentId: { type: "string", format: "uuid" },
        version: { type: "integer", minimum: 1 },
        richContent: { type: "object", additionalProperties: true },
      },
    },
  },
};
export const payloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    changes: { type: "array", minItems: 1, maxItems: 100, items: changeSchema },
    documents: { type: "array", minItems: 1, maxItems: 20, items: documentPartSchema },
    documentId: { type: "string", format: "uuid" },
    documentVersion: { type: "integer", minimum: 1 },
    documentAction: {type:"string",enum:["ARCHIVE"]},
    documentBaseVersion: {type:"integer",minimum:1},
    roleId: { type: "string", format: "uuid" },
    winnerId: { type: ["string", "null"], format: "uuid" },
    mandateEnd: { type: "string", format: "date-time" },
  },
};
const rowProperties: Record<string, unknown> = {
  descriptionRich: {type:["object","null"],additionalProperties:true},
  richContent: {type:["object","null"],additionalProperties:true},
  canEdit: {type:"boolean"},
  canAmend: {type:"boolean"},
  editableDocumentVersion: {type:"integer",minimum:1},
  proposalRevision: {type:"integer",minimum:1},
  documentAction: {type:"string",enum:["ARCHIVE"]},
  leadLinkAccessAvailable: {type:"boolean"},
  policySource: {type:"string",enum:["LOCAL","ORGANIZATION","DOMAIN"]},
  allowOverride: {type:"boolean"},
  localVersion: {type:"integer",minimum:1},
  consentMeetingId: {type:'string',format:'uuid'},
  consentMeetingVersion: {type:'integer',minimum:1},
  meetingConsentRequired: {type:'boolean'},
  meetingConsentPending: {type:'boolean'},
  actorId:nullableString,action:string,reason:string,source:string,
  canProcess: { type: "boolean" },
  canProcessAgenda:{type:"boolean"},
  canVote: { type: "boolean" },
  scheduledMeeting: {type:'object',additionalProperties:false,required:['proposalId','meetingId','agendaId','circleId','title','startAt','state','version'],properties:{proposalId:{type:'string'},meetingId:{type:'string'},agendaId:{type:'string'},circleId:{type:'string'},title:{type:'string'},startAt:{type:'string'},state:{type:'string'},version:{type:'integer'}}},
  changeKinds: {type:"array",items:{type:"string",enum:["ROLE","CIRCLE","DOCUMENT"]}},
  evolutionCount: { type: "integer" },
  responseCount: { type: "integer" },
  electorateCount: { type: "integer" },
  ownVote: nullableString,
  name: string,
  typeId: nullableString,
  active: { type: "boolean" },
  targetKind: string,
  targetId: nullableString,
  ...Object.fromEntries(
    [
      "id",
      "organizationId",
      "title",
      "description",
      "state",
      "kind",
      "applyState",
      "choice",
      "rationale",
      "step",
      "at",
      "content",
      "createdAt",
      "createdBy",
      "workflow",
      "visibility",
    ].map((k) => [k, string]),
  ),
  ...Object.fromEntries(
    [
      "version",
      "revision",
      "number",
      "draftVersion",
      "baseStructureRevision",
    ].map((k) => [k, number]),
  ),
  ...Object.fromEntries(
    [
      "circleId",
      "ownerId",
      "authorId",
      "tensionId",
      "meetingId",
      "branchId",
      "proposalId",
      "roundId",
      "memberId",
      "candidateId",
      "documentId",
      "commitId",
      "firstSubmittedAt",
      "deadline",
      "decisionReason",
      "resolution",
      "verdict",
      "conflictCode",
    ].map((k) => [k, nullableString]),
  ),
  publishedVersion: { type: ["integer", "null"] },
  archived: { type: "boolean" },
  policy: policySchema,
  configuration: policySchema,
  electorate: { type: "array", items: string },
  payload: payloadSchema,
  changes: { type: "array", items: changeSchema },
};
export const rowSchema = {
  type: "object",
  additionalProperties: false,
  properties: rowProperties,
};
const dataSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...rowProperties,
    meetingDocument: rowSchema,
    meetingDocuments: {type:"array",items:rowSchema},
    origin: { anyOf: [{type:'null'}, rowSchema] },
    originTension: rowSchema,
    ...Object.fromEntries(
      ["proposal", "document", "round"].map((k) => [k, rowSchema]),
    ),
    ...Object.fromEntries(
      [
        "items",
        "revisions",
        "rounds",
        "ballots",
        "objections",
        "nominations",
        "commits",
        "versions",
      'history',
      ].map((k) => [k, { type: "array", items: rowSchema }]),
    ),
    versions: {type:'array',items:{type:'object',additionalProperties:false,properties:{...rowProperties,origin:{type:'object',additionalProperties:false,required:['kind'],properties:{kind:{type:'string',enum:['direct','governed','unavailable']},proposal:{type:'object',additionalProperties:false,required:['kind','id','title'],properties:{kind:{type:'string',enum:['PROPOSAL']},id:string,title:string}},proposalRevision:{type:'integer',minimum:1},meeting:{type:'object',additionalProperties:false,required:['kind','id','title'],properties:{kind:{type:'string',enum:['MEETING']},id:string,title:string}}}}}}},
    entityReferences: {type:"array",items:{type:"object",additionalProperties:false,required:["entityId","name","kind","archived"],properties:{entityId:string,name:string,kind:{type:"string",enum:["CIRCLE","ROLE"]},archived:{type:"boolean"}}}},
    page: {
      type: "object",
      additionalProperties: false,
      properties: {
        nextCursor: { type: ["string", "null"] },
        hasMore: { type: "boolean" },
      },
    },
  },
};
export const successSchema = {
  type: "object",
  required: ["data", "meta", "capabilities"],
  additionalProperties: false,
  properties: {
    data: dataSchema,
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: string,
        organizationId: nullableString,
        resourceVersion: { type: ["integer", "null"] },
        authorizationRevision: { type: ["integer", "null"] },
        asOf: string,
      },
    },
    capabilities: { type: "object", additionalProperties: { type: "boolean" } },
  },
};
export const responseSchema = {
  200: successSchema,
  201: successSchema,
  409: {
    type: "object",
    additionalProperties: false,
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: string,
          message: string,
          fieldErrors: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          retryable: { type: "boolean" },
          conflictDetails: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                properties: { applyState: string, conflictCode: string },
              },
            ],
          },
        },
      },
      meta: {
        type: "object",
        additionalProperties: false,
        properties: { requestId: string },
      },
    },
  },
};

/** Closed projection for contribution destinations; never serialize meeting content. */
export const agendaMeetingsResponseSchema = {
  ...responseSchema,
  200: {
    ...successSchema,
    properties: {
      ...successSchema.properties,
      data: {
        type: "object", additionalProperties: false, required: ["items", "page"],
        properties: {
          items: {type: "array", items: {
            type: "object", additionalProperties: false,
            required: ["id", "circleId", "title", "state", "startAt", "version", "method"],
            properties: {id: string, circleId: string, title: string, state: string, startAt: string, version: {type: "integer"}, method: string},
          }},
          page: {type: "object", additionalProperties: false, required: ["hasMore", "nextCursor"], properties: {hasMore: {type: "boolean"}, nextCursor: {type: ["string", "null"]}}},
        },
      },
    },
  },
};
