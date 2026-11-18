# OrgMap — marca do produto

Identidade R2 de círculos abertos, aprovada para integração por Ravi em 03/11/2026. Três círculos de tamanhos diferentes, composição assimétrica, aberturas orientadas para a região de encontro. Palavra OrgMap em Manrope 610 convertida em curvas, com ajuste óptico em g/M.

## Fonte e reprodução

Os SVGs em `web/public/brand/` são os arquivos vetoriais de referência. São cópias da reconstrução manual R2 revisada nesta conversa, sem traçado automático do raster. Preservam as curvas em todos os tamanhos e não dependem de uma fonte instalada ou de uma URL externa.

- `orgmap-logo.svg`: assinatura horizontal em cores.
- `orgmap-logo-white.svg` e `orgmap-logo-black.svg`: assinatura em uma tinta.
- `orgmap-symbol.svg`, `orgmap-symbol-white.svg`, `orgmap-symbol-black.svg`: símbolo principal.
- `orgmap-symbol-small.svg` e variantes branca/preta: geometria compensada para 16–32 px; até 39 px em interfaces densas.
- `orgmap-icon.svg`: ícone com base teal e cantos arredondados.
- `orgmap-icon-maskable.svg`: fundo opaco completo e símbolo dentro do círculo seguro de 80% para recortes do sistema operacional.

Execute `npm run brand:generate` para reconstruir PNGs, favicon SVG adaptável a fundo claro/escuro, ICO 16/32/48, Apple touch 180, ícones 192/512, imagem social 1200×630 e `site.webmanifest`. Usa apenas os SVGs locais e a dependência `sharp` já existente.

## Uso no aplicativo

`web/src/OrgMapBrand.tsx` apresenta a marca com um único nome acessível. Prefira a assinatura sobre fundos claros e a versão branca sobre fundos escuros. Na navegação recolhida, aparece somente o símbolo com geometria para redução.

Login, cadastro, recuperação, ativação, criação de organização, entrada por convite, carregamento, navegação principal e navegação da conta usam a identidade do produto. O tema compartilhado da organização continua independente da marca fixa do OrgMap. Logotipos configurados em `WorkspaceBrand`, imagens de entrada e anexos de marca nos e-mails organizacionais continuam pertencendo à organização. E-mails do sistema que são texto simples não recebem imagens remotas.

As imagens de compartilhamento em `web/index.html` usam caminhos relativos à origem. Ao definir o domínio público, a camada de hospedagem deve expor esses caminhos na mesma origem e, se necessário para o crawler escolhido, resolver `og:image`/`twitter:image` para URLs absolutas. Não há domínio público inventado no projeto. O manifesto fornece nome/ícones/modo de abertura; não adiciona funcionamento offline ou sincronização em segundo plano.

## Regras

- Teal `#105D63`, jade `#508F7C`, nome `#172D2E`. A marca não herda as cores das paletas Maré/Cobalto/Argila/Grafite.
- Reservar ao menos uma espessura de arco como área livre ao redor do limite visível do símbolo.
- Não girar, deformar, fechar as aberturas ou alterar isoladamente as proporções dos círculos.
- Em uma tinta, pintar todos os arcos com a mesma cor. O jade não é necessário para separar as partes.
- Em tamanhos pequenos usar os SVGs `small`; não reduzir o símbolo principal indefinidamente.

O teste `web/tests/product-brand.test.tsx` verifica a integridade dos caminhos de metadados, dimensões, favicon, círculo seguro do ícone maskable e independência de fontes nos vetores. A inspeção visual continua necessária ao alterar geometria, espaçamento ou layout.
