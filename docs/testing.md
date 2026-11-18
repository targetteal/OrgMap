# Testes e validação

## Comandos de entrada

```sh
npm run typecheck
npm run build
npm run test:web
```

O build verifica TypeScript do servidor e da interface e produz `web/dist/`. O comando de interface descobre testes `.test.ts` e `.test.tsx` em `web/tests` e em `web/src`, incluindo os testes próximos dos componentes; em um segundo processo, executa os testes de DOM `.test.tsx` de `tests/editor/` com o `tsconfig` da interface.

Para rodar apenas um teste de interface a partir da raiz:

```sh
TSX_TSCONFIG_PATH=web/tsconfig.json node --import tsx --test web/tests/header-menus.test.tsx
```

## Testes de servidor

`npm test` usa `scripts/test-server.ts`, cria bancos temporários e distribui as suítes entre fixtures próprias. Por padrão, espera PostgreSQL no endereço de **testes** do `compose.yaml` (55432), diferente do desenvolvimento persistente (55433).

```sh
npm run db:up
npm test
```

Nunca aponte essas variáveis para dados de uma instalação em uso. Os runners criam e removem bancos temporários; alguns testes têm requisitos operacionais adicionais. Para ensaios específicos, use o runner do módulo ou os comandos `test:*` declarados em `package.json`.

| Local | Escopo |
| --- | --- |
| `tests/server/` | Domínios, HTTP, persistência, isolamento e jornadas. |
| `tests/editor/` | Conteúdo rico e colaboração. |
| `tests/localization/` | Localização e acessibilidade. |
| `tests/quality/` | Verificações independentes de fundação, segurança e readiness. |
| `web/tests/` e `web/src/**/*.test.*` | Modelos, componentes, rotas e interação da UI. |

## Escolher verificações

Para alteração visual, confira a interface renderizada nos tamanhos pertinentes. Para contratos, migrações ou autorização, rode as fixtures de servidor relacionadas. Não substitua a inspeção visual por um teste de presença de classes CSS.

Guarde logs e capturas locais em `.orgmap/qa/`.
