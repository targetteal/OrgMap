export const notificationEvents = [
  {
    event: "InvitationAccepted",
    module: "members",
    label: "Convite aceito",
    description: "Quando uma pessoa aceita seu convite para a organização",
  },
  {
    event: "InvitationDeliveryFailed",
    module: "members",
    label: "Problema no envio de convite",
    description: "Quando um envio falha ou precisa de confirmação",
  },
  {
    event: "ProposalSubmitted",
    module: "structure",
    label: "Proposta aberta",
    description: "Quando uma proposta abre para participação",
  },
  {
    event: "ConsentWindowOpened",
    module: "structure",
    label: "Prazo de objeções iniciado",
    description: "Quando começa o prazo de uma proposta para consentimento assíncrono",
  },
  {
    event: "ProposalDecided",
    module: "structure",
    label: "Proposta decidida",
    description: "Quando uma proposta da qual você participou é decidida",
  },
  {
    event: "RoleAssigned",
    module: "structure",
    label: "Atribuição de papel",
    description: "Quando você é atribuído a um papel",
  },
  {
    event: "RoleScopeUpdated",
    module: "structure",
    label: "Atualização do escopo do papel",
    description: "Quando o escopo de um papel que você ocupa muda",
  },
  {
    event: "RoleUnassigned",
    module: "structure",
    label: "Desatribuição de papel",
    description: "Quando você é removido de um papel",
  },
  {
    event: "CircleAssigned",
    module: "circles",
    label: "Atribuição de círculo",
    description: "Quando você é atribuído a um círculo",
  },
  {
    event: "CircleUnassigned",
    module: "circles",
    label: "Desatribuição de círculo",
    description: "Quando você é removido de um círculo",
  },
  {
    event: "CommentAdded",
    module: "circles",
    label: "Novo comentário",
    description: "Comentários em recursos que você acompanha",
  },
  {
    event: "StructureCommentAdded",
    module: "structure",
    label: "Novo comentário",
    description: "Comentários em propostas e acordos que você acompanha",
  },
  {
    event: "GoalCommentAdded",
    module: "goals",
    label: "Novo comentário",
    description:
      "Comentários em objetivos e resultados-chave que você acompanha",
  },
  {
    event: "ProjectCommentAdded",
    module: "projects",
    label: "Novo comentário",
    description: "Comentários em projetos e tarefas que você acompanha",
  },
  {
    event: "MeetingCommentAdded",
    module: "meetings",
    label: "Novo comentário",
    description: "Comentários em reuniões e atas que você acompanha",
  },
  {
    event: "GoalAssigned",
    module: "goals",
    label: "Atribuição de objetivo",
    description: "Quando você recebe uma atribuição de objetivo",
  },
  {
    event: "KRAssigned",
    module: "goals",
    label: "Atribuição de resultado-chave",
    description: "Quando você recebe uma atribuição de resultado-chave",
  },
  {
    event: "GoalUpdated",
    module: "goals",
    label: "Atualização de objetivo",
    description: "Mudanças nos objetivos que você acompanha",
  },
  {
    event: "TaskAssigned",
    module: "projects",
    label: "Atribuição de tarefa",
    description: "Quando você recebe uma atribuição de tarefa",
  },
  {
    event: "ProjectUpdated",
    module: "projects",
    label: "Atualização de projeto",
    description: "Mudanças nos projetos que você acompanha",
  },
  {
    event: "MeetingScheduled",
    module: "meetings",
    label: "Reunião agendada",
    description: "Quando você é convidado para uma reunião",
  },
  {
    event: "ReportPublished",
    module: "meetings",
    label: "Ata publicada",
    description: "Quando uma ata de reunião fica disponível",
  },
] as const;
export const eventModule = (event: string) =>
  notificationEvents.find((x) => x.event === event)?.module;
export const commentEventFor = (type: string) =>
  (
    ({
      proposal: "StructureCommentAdded",
      tension: "StructureCommentAdded",
      agreement: "StructureCommentAdded",
      goal: "GoalCommentAdded",
      "key-result": "GoalCommentAdded",
      project: "ProjectCommentAdded",
      task: "ProjectCommentAdded",
      meeting: "MeetingCommentAdded",
      report: "MeetingCommentAdded",
    }) as Record<string, string>
  )[type] ?? "CommentAdded";
