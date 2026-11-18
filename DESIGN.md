---
version: alpha
name: OrgMap Maré
description: Teal claro, preciso e acolhedor.
colors:
  primary: "#0B7077"
  surface: "#FFFFFF"
  ink: "#183237"
  muted: "#50666A"
  line: "#D5E1E2"
  subtle: "#E5F1F1"
  selected: "#B54D35"
  selectedBg: "#FCE9DF"
  stroke: "#6A969B"
  on-primary: "#FFFFFF"
  primary-hover: "#085A60"
  neutral: "#F3F8F8"
  success: "#286649"
  warning: "#87560D"
  error: "#B33434"
  info: "#315D85"
  map-level-1: "#DFEEEE"
  map-level-2: "#C8E0E1"
  map-level-3: "#B0D2D4"
  map-level-4: "#96C3C6"
  map-level-5: "#7EB4B8"
typography:
  display:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: 650
    lineHeight: 1.1
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: 650
    lineHeight: 1.2
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: 650
    lineHeight: 1.25
  headline-sm:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
  body-lg:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Manrope
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label-lg:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.2
  label-md:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
  caption:
    fontFamily: Manrope
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
rounded:
  control: 10px
  surface: 14px
  avatar: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  section: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    height: "40px"
    typography: "{typography.label-lg}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-disabled:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.muted}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
  drawer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  metadata:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
  map-selected:
    backgroundColor: "{colors.selectedBg}"
    textColor: "{colors.ink}"
  navigation:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
  map-node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  separator:
    backgroundColor: "{colors.line}"
    height: "1px"
  map-selected-outline:
    backgroundColor: "{colors.selected}"
  map-node-outline:
    backgroundColor: "{colors.stroke}"
  status-success:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.success}"
  status-warning:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warning}"
  status-info:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.info}"
  map-layer-1:
    backgroundColor: "{colors.map-level-1}"
    textColor: "{colors.ink}"
  map-layer-2:
    backgroundColor: "{colors.map-level-2}"
    textColor: "{colors.ink}"
  map-layer-3:
    backgroundColor: "{colors.map-level-3}"
    textColor: "{colors.ink}"
  map-layer-4:
    backgroundColor: "{colors.map-level-4}"
    textColor: "{colors.ink}"
  map-layer-5:
    backgroundColor: "{colors.map-level-5}"
    textColor: "{colors.ink}"
---
# OrgMap — Maré

## Overview

Um ambiente sereno para enxergar relações complexas. O teal traz presença sem dominar a estrutura; brancos frios e curvas moderadas deixam o mapa respirar.

Cartografia contemporânea: camadas tonais, legenda econômica e caminhos que mantêm o contexto.

Sistema padrão aprovado por Ravi em 2/11/2026. Todas as próximas telas do OrgMap herdam esta base. Maré é o padrão inicial de cores; o owner da organização pode escolher outra paleta sem alterar tipografia, geometria, densidade ou comportamento.

## Colors

Ação: #0B7077, texto da ação: #FFFFFF. Base: #F3F8F8; superfície: #FFFFFF; tinta: #183237; secundário: #50666A.
Seleção de entidade: #B54D35 sobre #FCE9DF. Estado de sucesso, aviso e erro têm cores próprias e sempre rótulo/ícone; nunca depender só da cor.

Contrastes calculados em sRGB: ação 5.84:1; corpo 13.55:1; secundário 6.09:1.

Textos, ícones e foco usam `--mare-primary-ink`. No Grafite, esse token é oliva escuro `#536318`, com contraste de 6.63:1 sobre branco, enquanto o preenchimento primário permanece verde-claro. Estados usam os tokens `--mare-error` (`#B33434`), `--mare-warning` (`#87560D`), `--mare-success` (`#286649`) e `--mare-info` (`#315D85`). Seus fundos suaves são, respectivamente, `#FCECEB`, `#FFF1D4` e `#E8F2EB`. Componentes devem referenciar esses tokens para distinguir estados e acompanhar a paleta da organização.

## Typography

Manrope em toda a interface; fallback sans-serif. Nenhuma fonte serifada. Fonte local; numerais tabulares em medidas. Título de página 28–32px; drawer 30–32px; propósito 18–20px; corpo 14px. Não aplicar a escala display de 48px em telas operacionais.
Código, identificadores e dados técnicos delimitados podem usar a família monospace do sistema; isso não se aplica à navegação, rótulos ou títulos.
Rótulos do mapa usam ajuste geométrico de 7,5–16px na tela, mantendo nome completo, margem curva e aumento progressivo com zoom. O piso pequeno só se aplica ao mapa, não ao corpo da UI.

## Layout

Controles de 40px; linhas de 64px; seções separadas por 32px.
Sidebar 256px expandida e 72px recolhida. Drawer 50% da viewport desktop, com mapa centralizado no espaço restante; abaixo de 850px vira painel de tela. Modo expandido do drawer ocupa o workspace. Escala-base de 4px.
Agrupar primeiro conteúdo relacionado; separar seções. Listas hierárquicas: papéis próprios antes de subcírculos. Busca e filtros persistem ao alternar Círculos/Rede/Lista.

## Elevation & Depth

Planos brancos sobre base fria; sombra só para menu, tooltip e modal.
Sombra de sobreposição: 0 12px 36px rgb(20 30 35 / 0.12). Conteúdo estrutural usa separador de 1px. Não adicionar sombra em cada linha.

## Shapes

Curvas moderadas. Cantos de 10px nos controles e 14px em superfícies flutuantes.
Ícones Lucide e SVG de círculos/subcírculos com traço de 1,65px, cantos e terminais consistentes. O mapa usa círculos reais, não tiles arredondados.

## Components

### Marca do produto

Identidade OrgMap R2, integrada por decisão de Ravi em 3/11/2026: três círculos abertos de tamanhos diferentes, em composição assimétrica, com assinatura Manrope 610 convertida em curvas. Usar o componente `OrgMapBrand` e os SVGs de `web/public/brand/`; arquivos e regras em `docs/design/brand.md`. Teal da marca `#105D63`, acento jade `#508F7C`, nome `#172D2E`. A marca é fixa e não muda com a paleta da organização. Reduções de 16–32 px usam a geometria `small`; fundos escuros usam branco integral. A marca configurável da organização permanece distinta em `WorkspaceBrand`.

Tema da organização: Maré, Cobalto, Argila e Grafite são opções de paleta. Somente o owner pode gravar a configuração, com autorização no servidor e persistência por organizationId; todos os membros veem a paleta salva. A prévia ao selecionar é delimitada pela organização e conta ativas. Cancelar/Escape restaura a paleta salva; salvar confirma a alteração compartilhada. O protótipo continua sendo a referência visual, sem substituir os contratos reais.

- Teal sinaliza ação e contexto ativo; coral sinaliza a entidade selecionada no mapa.
- Círculos usam cinco tons dessaturados. Profundidade não significa desempenho ou status.
- Manrope 650 nos títulos; 400 no corpo. Evitar títulos excessivamente pesados.
- Botões: primário sólido, secundário de borda, terciário sem caixa; pressed mais escuro, disabled sem interação, loading com rótulo preservado. Alvos móveis de pelo menos 44px.
- Campos: label persistente, borda neutra, foco de 2px com offset; erro com texto, borda e ícone. Nunca usar placeholder como único label.
- Navegação: estado ativo e hover distintos. Governança é seção própria. Não reintroduzir Círculos e Papéis na sidebar.
- Mapa: cinco níveis tonais; papel branco, seleção com traço de 2,5px e preenchimento próprio. Cor não expressa tamanho ou importância.
- Drawer: Visão geral contém propósito, responsabilidades, artefatos e membros/Quem energiza; Papéis apenas em círculos; Restrições antes de Projetos.
- Busca de papéis no drawer preserva o caminho dos resultados nos subcírculos. Papéis próprios vêm antes dos subcírculos; abrir e fechar um detalhe preserva a origem de mapa ou lista e restaura o foco.
- Navegação móvel aberta delimita o foco e torna o conteúdo de fundo inerte; fechada, sai da ordem de foco. Escape e o controle de fechar retornam ao gatilho.
- Tooltips: nome, propósito e responsabilidades; espera de 220ms no hover, foco imediato só no teclado; nunca interceptar o primeiro clique nem cobrir os controles de zoom.
- Modal: restrição em lista abre texto em dialog com Escape, foco inicial e retorno ao gatilho. Dropdown não usa modal.
- Motion: entrada de círculo 720ms, recuo 520ms, zoom incremental 240ms; trajetória espacial interrompível. Rótulos reaparecem em 180ms. prefers-reduced-motion torna a câmera instantânea.

### Conteúdo e estado dos componentes reais

Projetos e tarefas usam dados da organização ativa, versões do servidor e estados vazios reais. Catálogo, drawer, vistas pessoais e rascunhos mantêm a identidade do trabalho: um rascunho de A não pode aparecer ou ser salvo em B, e atualizar os dados não deve substituir a vista ativa. Checklists de projeto e grupos de checklist de tarefa são distintos das tarefas/subtarefas e do checklist legado; não concluem o trabalho nem entram automaticamente no progresso.

Vínculos com círculos, papéis, participantes e pessoas que acompanham descrevem o contexto; o controle de acesso permanece explícito. A intenção de recorrência/lembrete deve aparecer como referência de planejamento, sem prometer scheduler, tarefa futura ou notificação. Referência de horário local não equivale a um instante com fuso.

Duplicação e modelos explicam o conteúdo transportado antes da confirmação. Modelos organizacionais não transportam pessoas atribuídas, grants, conversa, anexos ou histórico da origem; conclusão é reiniciada. O editor de definições essenciais O2 distingue valores herdados do pacote e overrides parciais da organização para propósito, responsabilidades e artefatos. Essas definições orientam novas criações e não reescrevem papéis existentes; modelos reutilizáveis independentes continuam separados das funções essenciais O2.

O registro histórico de implementação e verificação do candidato Maré está em `docs/archive/reviews/mare-20261103/ENTREGA.md`. Esta diretriz visual não declara aprovação do bundle ativo.

## Do's and Don'ts

- Teal sinaliza ação e contexto ativo; coral sinaliza a entidade selecionada no mapa.
- Círculos usam cinco tons dessaturados. Profundidade não significa desempenho ou status.
- Manrope 650 nos títulos; 400 no corpo. Evitar títulos excessivamente pesados.
- Preservar o contrato: primeiro clique no círculo aproxima, segundo abre drawer; papel abre em um clique; ancestral permite recuar.
- Artefatos são domínios de controle exclusivo. Não tratá-los como anexos ou documentos.
- Nunca usar fontes serifadas, gradientes decorativos, ícones inconsistentes ou cor como único sinal.
- Não migrar dados fictícios para o produto. Não alterar a arquitetura de navegação para demonstrar a paleta.

Risco desta direção: Se o teal ocupar fundos demais, a interface volta a parecer monocromática. A base permanece quase branca.

Referência de formato: https://github.com/google-labs-code/design.md/blob/main/docs/spec.md
