/** Domain-owned table projection. Platform owns escaping, OOXML/CSV encoding, blobs and download authorization. */
export type WorkWorkbook = {
  sheets: {
    name: string;
    columns: string[];
    rows: (string | number | boolean | null)[][];
  }[];
};
export function workExportWorkbook(
  kind: string,
  records: any[],
  format?: string,
): WorkWorkbook {
  if (kind === "STATISTICS")
    return {
      sheets: [
        {
          name: "Estatísticas",
          columns: [
            "Mês UTC",
            "Projetos atuais",
            "Tarefas observadas",
            "Concluídas",
            "Conclusão (%)",
            "A fazer",
            "Em andamento",
            "Bloqueadas",
            "Criadas",
            "Alteradas",
            "Círculos com atividade",
            "Círculos vinculados",
            "Participantes com atividade",
            "Participantes atuais",
            "Cobertura",
            "Primeira observação",
            "Criações desconhecidas",
            "Atividades sem autoria",
            "Capacidade dos participantes",
          ],
          rows: records.map((r) => [
            r.period.month,
            r.totalProjects,
            r.total,
            r.completed,
            r.completedPercent,
            r.byStatus.TODO,
            r.byStatus.IN_PROGRESS,
            r.byStatus.BLOCKED,
            r.created,
            r.changes,
            r.activeCircles,
            r.circlesWithProjects,
            r.activeParticipants,
            r.participants,
            r.coverage.state,
            r.coverage.firstObserved,
            r.coverage.unknownCreationDates,
            r.coverage.unknownActivityActors,
            r.participantCoverage ?? "CURRENT_AUTHORIZED_CAPACITY",
          ]),
        },
      ],
    };
  const taskRows: (string | number | boolean | null)[][] = [];
  for (const project of records) {
    const levels = new Map<string, number>();
    for (const t of project.tasks) {
      const level = t.parentSourceId
        ? (levels.get(t.parentSourceId) ?? 0) + 1
        : 0;
      levels.set(t.sourceId, level);
      taskRows.push([
        project.sourceId,
        project.title,
        t.sourceId,
        t.parentSourceId,
        level,
        t.title,
        t.description,
        t.status,
        t.sectionIndex === null
          ? null
          : (project.definition.sections[t.sectionIndex]?.name ?? null),
        t.startsAt,
        t.endsAt,
        t.assigneeMemberIds.join(", "),
        t.checklist.length,
        t.checklist.filter((x: any) => x.done).length,
        t.priority ?? "NONE",
        t.estimateMinutes ?? null,
        JSON.stringify(t.tags ?? []),
        JSON.stringify(
          t.principals ??
            (t.assigneeMemberIds ?? []).map((memberId: string) => ({
              kind: "MEMBER",
              memberId,
            })),
        ),
        t.customStatusId ?? null,
        JSON.stringify(t.customFields ?? {}),
      ]);
    }
  }
  if (format === "CSV") {
    const rows: (string | number | boolean | null)[][] = [];
    for (const p of records) {
      const project = [
        p.sourceId,
        p.title,
        p.description,
        p.visibility,
        p.circleId,
        p.definition.views.join(", "),
        p.startsAt ?? null,p.endsAt ?? null,JSON.stringify(p.tags ?? []),JSON.stringify(p.customFields ?? {}),JSON.stringify(p.contextLinks ?? []),JSON.stringify(p.taskStates ?? []),p.projectStateId ?? null,
      ];
      const own = taskRows.filter((row) => row[0] === p.sourceId);
      if (!own.length)
        rows.push(["PROJECT_ONLY", ...project, ...Array(18).fill(null)]);
      else
        for (const row of own) rows.push(["TASK", ...project, ...row.slice(2)]);
    }
    return {
      sheets: [
        {
          name: "Projetos e tarefas",
          columns: [
            "Tipo de registro",
            "Projeto ID",
            "Projeto",
            "Descrição do projeto",
            "Privacidade",
            "Círculo ID",
            "Vistas",
            "Início do projeto UTC", "Fim do projeto UTC", "Tags do projeto (JSON)", "Campos do projeto (JSON)", "Vínculos do projeto (JSON)", "Estados de tarefas (JSON)", "Estado do projeto ID",
            "Tarefa ID",
            "Tarefa principal ID",
            "Nível",
            "Tarefa",
            "Descrição da tarefa",
            "Estado",
            "Seção",
            "Início UTC",
            "Vencimento UTC",
            "Responsáveis (memberId)",
            "Checklist total",
            "Checklist concluído",
            "Prioridade",
            "Estimativa (minutos)",
            "Etiquetas (JSON)",
            "Responsáveis tipados (JSON)",
            "Estado personalizado ID", "Campos da tarefa (JSON)",
          ],
          rows,
        },
      ],
    };
  }
  return {
    sheets: [
      {
        name: "Tarefas",
        columns: [
          "Projeto ID",
          "Projeto",
          "Tarefa ID",
          "Tarefa principal ID",
          "Nível",
          "Tarefa",
          "Descrição",
          "Estado",
          "Seção",
          "Início UTC",
          "Vencimento UTC",
          "Responsáveis (memberId)",
          "Checklist total",
          "Checklist concluído",
          "Prioridade",
          "Estimativa (minutos)",
          "Etiquetas (JSON)",
          "Responsáveis tipados (JSON)",
          "Estado personalizado ID", "Campos da tarefa (JSON)",
        ],
        rows: taskRows,
      },
      {
        name: "Projetos",
        columns: [
          "Projeto ID",
          "Projeto",
          "Descrição",
          "Privacidade",
          "Círculo ID",
          "Vistas",
          "Tarefas ativas", "Início UTC", "Fim UTC", "Tags (JSON)", "Campos (JSON)", "Vínculos (JSON)", "Estados de tarefas (JSON)", "Estado do projeto ID",
        ],
        rows: records.map((p) => [
          p.sourceId,
          p.title,
          p.description,
          p.visibility,
          p.circleId,
          p.definition.views.join(", "),
          p.tasks.length, p.startsAt ?? null,p.endsAt ?? null,JSON.stringify(p.tags ?? []),JSON.stringify(p.customFields ?? {}),JSON.stringify(p.contextLinks ?? []),JSON.stringify(p.taskStates ?? []),p.projectStateId ?? null,
        ]),
      },
    ],
  };
}
