# Ajustes no fluxo do usuário

Levantado com o sistema no ar, lendo schema e telas. O critério não foi "o que
falta no código" e sim **o que a pessoa no balcão não consegue fazer** — ou faz
sem deixar rastro.

Os blocos estão em ordem de custo-benefício, não de tamanho.

**Blocos 1 a 5: entregues.** 1 e 2 na migration
`20260806200000_registro_entrega_e_foto_obrigatoria.sql` — saíram juntos porque
os dois alteram `change_order_status`. O bloco 3 na
`20260807100000_order_items.sql`, e o bloco 4 na
`20260807140000_aprovacao_orcamento.sql` e o bloco 5 na
`20260807170000_garantia_retrabalho.sql` (mais duas correções de regressão,
`20260807190000` e `20260807200000`). **Bloco 6 em aberto.**

## Regras que valem para todos os blocos

- Alteração de schema é **migration nova**. Nunca editar uma já aplicada.
- Depois de qualquer migration: `npm run db:types`.
- A regra mora no **banco** (RPC + RLS). O front repete a mesma regra para
  esconder botão — esconder é coerência, não segurança.
- Erro novo do Postgres precisa de tradução em `src/lib/supabase.ts`, senão
  chega na tela como texto técnico em inglês.
- Fechar cada bloco testando com os 5 logins de demonstração, não só o `owner`.

---

## Bloco 1 — Registrar a entrega

**Por quê:** `orders` guarda `delivered_at` e nada mais. Não há quem retirou,
nem documento, nem foto do estado em que o item saiu. "Finalizar entrega"
([ComandaDetalhe.tsx:800](../src/pages/ComandaDetalhe.tsx#L800)) é um `Confirm`
de uma pergunta. A linha "Assinatura do cliente" existe só na comanda impressa
de **entrada** ([ImprimirComanda.tsx:265](../src/components/ImprimirComanda.tsx#L265)),
e o papel assinado não volta para o sistema.

É a disputa mais cara da loja: "não fui eu que retirei" e "não estava assim
quando saiu daqui" não têm resposta hoje.

- [x] Migration `..._registro_entrega.sql`
  - `orders.delivered_to_name text` — quem retirou
  - `orders.delivered_to_document text` — opcional, para retirada por terceiro
  - `orders.delivered_by uuid REFERENCES profiles(id)` — quem no balcão entregou
        (`created_by` só cobre a abertura)
  - `orders.delivery_note text NOT NULL DEFAULT ''`
- [x] Não usar CHECK constraint para exigir o nome. As comandas já entregues
      ficariam inválidas e toda escrita futura na linha passaria a falhar. A
      exigência vai na RPC.
- [x] `CREATE OR REPLACE FUNCTION change_order_status` com assinatura nova:
      `(p_order_id uuid, p_status_key text, p_delivery jsonb DEFAULT NULL)`.
      O `DEFAULT NULL` mantém as chamadas atuais funcionando.
  - Quando `p_status_key = 'entregue'`: exigir `delivered_to_name`, gravar
    `delivered_at`, `delivered_by = auth.uid()` e chamar `log_order_event`
  - Dropar a assinatura antiga de 2 argumentos no fim da migration, senão o
    PostgREST fica com duas sobrecargas e escolhe a errada
- [x] `npm run db:types`
- [x] `alterarStatus` ([comandas.ts:256](../src/lib/api/comandas.ts#L256)) passa
      a aceitar o payload de entrega
- [x] Trocar o `Confirm` de entrega por um formulário: nome de quem retira,
      documento (opcional), observação. Manter o aviso de saldo em aberto que
      já existe hoje
- [x] Mostrar quem retirou e quando na aba "Visão geral" e no histórico
- [x] **Recibo de entrega** para impressão — hoje `ImprimirComanda` só gera a
      comanda de entrada. É o comprovante que o cliente leva

## Bloco 2 — Foto obrigatória onde importa

**Por quê:** `podeAvancar` ([NovoAtendimento.tsx:185](../src/components/NovoAtendimento.tsx#L185))
valida cliente, serviço, valor e entrada. A etapa 2 (Fotos) cai no
`default: return true`. Uma comanda nasce sem nenhuma foto e é entregue sem
nenhuma foto do "depois". A captura já funciona — câmera nativa, bucket privado,
URL assinada, três tipos (`antes`, `detalhe`, `depois`). Falta ser parte do
fluxo em vez de opcional.

- [x] Migration `..._exigir_fotos.sql` — duas colunas em `app_settings`
      (é linha única, então configuração nova é **coluna** nova, não par
      chave/valor):
  - `require_photo_on_intake boolean NOT NULL DEFAULT true`
  - `require_photo_on_delivery boolean NOT NULL DEFAULT true`
- [x] A loja decide, não o código: expor as duas em Configurações → Impressão
      ou uma aba nova de Operação
- [x] `create_order` recusa comanda sem foto quando `require_photo_on_intake`.
      Conferir a ordem dentro da transação: as fotos são vinculadas no mesmo
      `create_order`, então a checagem tem que vir depois do vínculo
- [x] `change_order_status` recusa `entregue` sem foto do tipo `depois` quando
      `require_photo_on_delivery`
- [x] ~~Traduzir os dois erros novos em `src/lib/supabase.ts`~~ — resolvido na
      origem. `mensagemErro` ([supabase.ts:115](../src/lib/supabase.ts#L115))
      só devolve a mensagem da RPC se ela tiver **acento** — é assim que
      distingue frase nossa de frase do Postgres. As duas mensagens nasceram
      sem nenhum e cairiam no genérico de 23514. Reescritas começando por
      "É obrigatório", elas passam sem precisar de entrada no mapa.
- [x] Front (coerência): etapa 2 deixa de cair no `default` do `podeAvancar`
- [x] Front: "Finalizar entrega" desabilitado com dica explicando o que falta —
      não deixar o usuário descobrir pelo erro

**Verificado** com o stack reconstruído do zero (`db:nuke` + `db:up`), pela API
real (Kong → PostgREST → RPC), não por psql: comanda sem foto recusada sem
queimar número da numeração; entrega recusada sem nome e recusada sem foto
`depois`; entrega completa gravando nome, documento, observação, `delivered_by`
e evento no histórico; e o perfil `viewer` barrado pela RPC.

> ⚠️ **Este bloco foi dado como pronto cedo demais.** O "Por quê" acima afirma
> que "a captura já funciona". Funcionava — mas ao lado dela havia um botão
> "Sem foto" que satisfazia a exigência sem nenhuma imagem, e o cadastro
> oferecia a marcação "Depois", que destravava a entrega no ato do
> recebimento. Nada disso aparece em teste de API: os testes anexavam a foto
> do jeito certo. Ver [O buraco que só apareceu clicando](#o-buraco-que-só-apareceu-clicando).

## Bloco 3 — Comanda com mais de um item

**Por quê:** `orders` tem `service_id`, `service_name` e `quantity` no singular,
não existe `order_items`, e `create_order(p_payload jsonb)` recebe um serviço
só. Cliente que chega com duas chaves e um sapato vira três comandas, três
números e o financeiro em três pedaços. Para uma loja que faz "chaveiro,
sapataria, costura e reparos", é o caso comum.

**Decisões tomadas** (as três, na opção de maior fidelidade):

- [x] Uma comanda com N itens, ou N comandas agrupadas por um atendimento?
      A etiqueta vai no item físico, então N itens = N etiquetas de qualquer
      forma. A diferença é se o cliente recebe um número ou três
- [x] O status é por item ou por comanda? Hoje o Kanban da Produção move a
      comanda inteira. Se dois itens da mesma comanda ficam prontos em dias
      diferentes, o status por comanda passa a mentir
- [x] Entrega parcial existe? Cliente retira a chave e deixa o sapato

Implementado na migration `20260807100000_order_items.sql`:

- [x] Migration `order_items` + backfill das comandas existentes
- [x] `create_order` recebe array de itens
- [x] `orders.total_amount` vira soma dos itens
- [x] Etiquetas: uma por item (`mark_labels_printed` já recebe array)
- [x] Kanban da Produção conforme a decisão de status
- [x] `report_by_category` e `report_top_services` passam a ler de `order_items`
- [x] Etapa "Serviço" do atendimento vira lista, não seleção única

### Como ficou

`order_items` é a fonte da verdade de serviço, preço, status e entrega. As
colunas equivalentes em `orders` **não foram removidas**: viraram espelhos
mantidos por trigger (`recalc_order_from_items`). Foi o que manteve
`order_list_view`, os oito `report_*`, `dashboard_kpis`, as policies de RLS e as
telas de Comandas, Clientes, Financeiro e Dashboard funcionando sem alteração.

A regra que passa a valer: **escrever direto em `orders.status_key`,
`total_amount` ou `quantity` é gravar num espelho** — o próximo toque em
qualquer item sobrescreve. Quem manda é o item.

Status agregado = o item **menos** adiantado. Com uma chave pronta e um sapato
em execução, a comanda está em execução; dizer "pronta" faria o balcão chamar o
cliente para levar metade.

Duas armadilhas que custaram um rebuild cada:

- `total_amount` do item **não** pode ser `GENERATED AS unit_price * quantity`.
  Comanda legada de R$ 100,00 com quantidade 3 daria 99,99, e como
  `orders.balance` e `is_settled` são GENERATED, um centavo transforma comanda
  quitada em devedora. O valor da linha é a fonte; preço unitário é derivado.
- O `db-init` aplica **migrations antes dos seeds**, então um `INSERT` de
  backfill na migration pega zero linhas num banco novo — e as 120 comandas do
  seed nasceriam sem item. Por isso o backfill é a função idempotente
  `backfill_order_items()`, chamada na migration **e** no fim dos dois seeds.

**Verificado** em base reconstruída do zero, pela API real: uma comanda com dois
itens somando total e quantidade; o status da comanda seguindo o item mais
lento; entrega recusada sem a foto "Depois" **daquele** item; foto de um item
não liberando outro; comanda seguindo aberta após a entrega parcial e fechando
só com a última peça; e os relatórios sem os nomes agregados ("X +1").

## Bloco 4 — Aprovação de orçamento com lastro

**Por quê:** o status `aprovacao` ("Aguardando aprovação") existe, mas nada
guarda quem aprovou, quando e por qual valor. Orçamento aprovado por telefone
sobra como texto solto no histórico. Se o cliente contesta o preço, o status diz
que foi aprovado e nada diz por quem.

- [x] ~~Migration em `orders`~~ → **em `order_items`**. Este item do checklist
      foi escrito antes do bloco 3, que moveu o status para o item:
      `aprovacao` é status de item, e o valor aprovado é o daquela peça — o
      cliente aprova o conserto do sapato e recusa a cópia da chave na mesma
      comanda. Colunas: `approved_at`, `approved_by_name` (o **cliente**),
      `approved_amount`, `approval_channel_key` e `approval_taken_by` (quem no
      balcão registrou)
- [x] `change_order_item_status` exige os dados ao **sair** de `aprovacao`.
      Sair para `cancelada` é o cliente dizendo NÃO e não exige nada — obrigar
      a preencher "quem aprovou" para registrar uma recusa seria pedir mentira
      ao operador. Item já aprovado também não repete o pedido a cada coluna do
      Kanban
- [x] Sinalizar quando `approved_amount` divergir do `total_amount` atual — é
      o caso em que o serviço cresceu depois do aceite. A conta vive na view
      `order_item_approval_view` para não obrigar cada tela a repeti-la

### Como ficou

O canal é tabela de domínio (`approval_channels`: presencial, telefone,
whatsapp, e-mail), não texto livre — senão a mesma base teria "whats", "zap" e
"telefone " e nenhum relatório agruparia.

**Verificado** pela API real, 12 asserts: recusa sem quem aprovou, sem canal e
com canal inexistente; aprovação gravando valor, canal e quem registrou, com
evento no histórico; cancelamento a partir de `aprovacao` passando livre; item
já aprovado andando no Kanban sem reabrir o formulário; e a view apontando a
divergência de R$ 80 depois de o serviço subir de 150 para 230.

## Bloco 5 — Garantia e retrabalho

**Por quê:** o conceito não existe em coluna, status ou vínculo. Cliente que
volta com o mesmo problema abre comanda nova, desligada da original. Não dá
para honrar garantia com rastro nem medir retrabalho — que é o indicador que
diz se a oficina está indo bem.

- [x] ~~`orders.parent_order_id`~~ → **`order_items.parent_item_id`**. Pelo
      mesmo motivo do bloco 4: a garantia é da PEÇA, e começa quando aquele
      item foi entregue. Numa comanda de três itens, dois podem estar na
      garantia e um não. `is_rework` é GENERATED de `parent_item_id IS NOT
      NULL` — a mesma informação em dois lugares divergiria
- [x] `orders.is_rework` existe como **espelho**, para tirar retrabalho
      gratuito do ticket médio. Comanda mista (item novo + retrabalho) NÃO
      conta como retrabalho: ela fatura
- [x] `services.warranty_days integer` no catálogo
- [x] Botão "Abrir retrabalho" na ComandaDetalhe: cria comanda vinculada, valor
      zerado por padrão
- [x] Prazo de garantia na comanda impressa e no recibo do bloco 1
- [x] Relatório de retrabalho por serviço e por responsável
- [x] Retrabalho de valor zero não contamina o financeiro: `dashboard_kpis`
      exclui `is_rework` do `average_ticket`, e retrabalho em garantia não gera
      lançamento nenhum. **As contagens continuam incluindo** — a peça está na
      bancada e ocupa a oficina
- [x] `orders_total_positive` (`> 0`) precisou virar `orders_total_min`
      (`>= 0`): sem isso comanda de retrabalho gratuito era impossível.
      `create_order` continua recusando total zero — só `create_rework` cria

### Como ficou

`create_order` **não foi reescrito**. O retrabalho tem RPC própria
(`create_rework`) e o instantâneo da garantia entra por trigger. Seria a
terceira reescrita completa daquela função em três migrations, e cada
transcrição de 200 linhas é uma chance nova de introduzir defeito onde não
havia.

**Verificado** pela API real, 13 asserts, incluindo: garantia copiada do
catálogo e imune a mudança posterior; retrabalho recusado para peça ainda na
loja e sem motivo; comanda gratuita vinculada, sem lançamento financeiro, com
rastro nos dois lados; e o relatório de taxa por serviço e por responsável.

### Dois defeitos que a regressão pegou

Reexecutar a suíte dos blocos 1 e 2 depois do 5 encontrou duas coisas que os
testes novos não pegavam — os dois vieram do bloco 3 e nenhum dos dois
aparecia em typecheck:

1. **A entrega estava travada pela tela.** A exigência de foto "Depois" desceu
   para o item, mas `enviarFoto` grava só `order_id` — a aba Fotos é da
   comanda. Numa comanda de um item, o operador anexava a foto, via na tela, e
   a entrega continuava recusando, sem saída pela interface. Corrigido em
   `20260807190000`: comanda de UM item aceita foto solta; com várias peças o
   vínculo continua obrigatório, e cada item ganhou sua própria grade de fotos.
2. **O recibo sairia com "Retirado por —".** O bloco 1 gravava a entrega em
   `orders`; o bloco 3 moveu para o item e deixou as quatro colunas órfãs. O
   comprovante que o cliente assina lê da comanda. Corrigido em
   `20260807200000`: a entrega da comanda passa a ser espelho da última peça
   que saiu.

---

## O buraco que só apareceu clicando

Nenhum dos dois defeitos acima é o pior que o bloco 2 tinha. O pior foi visto
por quem abriu a tela: **a foto obrigatória não exigia foto.**

A grade tinha dois botões dizendo respeito à mesma coisa e com o mesmo peso
visual — "Escolher", que anexa o arquivo, e **"Sem foto"**, que criava a linha
em `order_photos` só com o gradiente. A exigência do banco pergunta se existe
uma *linha*, não se existe uma *imagem*. Um clique no botão errado fechava a
regra sem cumprir o propósito dela, e era o clique mais fácil.

Havia um segundo caminho, pior, e igualmente visível na tela: o cadastro
oferecia as três marcações — Antes, Detalhe e **Depois**. Marcar "Depois" no
momento do recebimento satisfazia a exigência da *entrega* desde o minuto zero.
Dava para abrir e entregar uma comanda inteira sem nunca fotografar o serviço
pronto.

### Como ficou

- **"Sem foto" saiu; entrou "Câmera"** — abre a webcam num modal, com
  conferência antes de aceitar ("Usar esta foto" / "Repetir"). Reduz para
  1600px em JPEG, desliga a câmera durante a conferência, troca de câmera
  quando há mais de uma, e espelha a prévia só na frontal. Ver
  [CapturaCamera.tsx](../src/components/CapturaCamera.tsx).
- **"Depois" não aparece mais no cadastro** (`tiposPermitidos={['antes',
  'detalhe']}`). A foto da peça pronta é tirada na ficha, na hora da entrega.
- **A exigência da entrega passou a pedir imagem** — `storage_path IS NOT
  NULL`, migration `20260807220000`. Interface não é regra: enquanto o banco
  aceitasse, qualquer caminho novo reabriria o buraco. A mensagem separa "não
  tem foto" de "tem a marcação, mas sem imagem", que é o caso que mais confunde
  — o operador vê o quadrado colorido marcado "Depois" e não entende a recusa.

⚠️ **`getUserMedia` exige `localhost` ou `https`.** Aberto por IP da rede
(`http://192.168.x.x`) o navegador bloqueia a câmera e não explica; o modal
detecta e diz o que fazer. Na hora de publicar, isso é requisito de certificado.

### O que remover um botão quebrou

Tirar o "Sem foto" **impediu abrir qualquer comanda**, e teria quebrado calada.

O cadastro mandava para `create_order` só as fotos *sem* arquivo, e subia as
com arquivo depois — porque o caminho no bucket é `<order_id>/…` e o id só
existe depois da comanda. Enquanto havia o "Sem foto", sempre ia alguma no
payload e a exigência era satisfeita. Sem ele, o payload ia vazio e a RPC
recusava a comanda com "É obrigatório anexar ao menos uma foto" — depois de o
operador ter anexado três.

Invertido: **todas** as fotos vão no payload, e os arquivos sobem em seguida
preenchendo o `storage_path` de cada linha (`anexarArquivo`,
[fotos.ts](../src/lib/api/fotos.ts)). A correlação é pelo `seed`, agora
`<categoria>-<uuid>` — o antigo `Math.random()*999` colidia em ~0,3% dos casos
com três fotos, e a colisão mandaria o arquivo para a linha errada.

### A suíte saiu do temporário

As cinco suítes viraram `npm run test:api` ([scripts/testes/](../scripts/testes/)).
Antes viviam num diretório temporário — o que significa que a única rede de
proteção do projeto sumiria ao reiniciar a máquina.

A suíte nova (`camera`) é a primeira a exercitar **upload real no bucket com
token de atendente**: a policy do Storage nunca tinha sido testada.

## Bloco 6 — Item não retirado

**Por quê:** comanda `pronta` há oito meses continua `pronta` para sempre.
Nenhum prazo, alerta ou status. Tem consequência legal e ocupa prateleira.

- [x] Coluna em `app_settings` com o prazo de abandono em dias
- [x] `dashboard_alerts()` passa a emitir "pronto há mais de N dias"
- [x] Filtro correspondente em Comandas
- [x] Decidir se vira status novo (`abandonada`)

### Como ficou

**Não virou status, e essa foi a decisão do bloco.**

Abandono não é um estado de trabalho — é uma propriedade do **tempo**. A peça
continua pronta: o serviço está feito e ela está esperando. O que mudou foi
quantos dias faz.

Um status exigiria alguém mover a comanda na mão, e é exatamente isso que não
acontece numa loja cheia: o alerta que depende de alguém lembrar de marcar não
dispara nunca. Derivado do tempo, está sempre certo e custa zero de operação.
Também evita a pergunta chata — quando o cliente aparece no décimo mês, quem
devolve o status? Com derivação, o balcão simplesmente entrega.

Se um dia a loja precisar de um **ato** explícito (doar, vender, descartar), aí
sim é status novo, porque aí existe uma decisão humana com peso legal para
registrar. Isso é outra conversa, e ela não é de software.

O que entrou (migration `20260811100000`):

- `app_settings.abandoned_after_days`, padrão 90. **0 desliga** o alerta e some
  com o filtro da tela — um filtro que não pode filtrar nada é pior que nenhum.
- `order_items.ready_at`, gravado na primeira vez que a peça entra em
  `pronta`/`avisado`, e `orders.ready_at` como espelho derivado.
- `order_list_view.days_ready`.
- `dashboard_alerts()` ganha `abandoned`, com o prazo e a maior espera.
- Filtro "Não retiradas" em Comandas e a linha "Na prateleira desde" na ficha,
  em vermelho quando passou do prazo.

Três decisões que valem explicar:

**`ready_at` e não `updated_at`.** `updated_at` muda a cada toque — corrigir uma
observação, imprimir etiqueta, registrar pagamento. A peça rejuvenesceria toda
vez que alguém mexesse na comanda, e o abandono nunca completaria o prazo
justamente nas comandas mais mexidas, que são as problemáticas.

**Voltar para a bancada não reinicia a contagem** (`coalesce(ready_at, now())`).
A peça está na loja desde a primeira vez, e é isso que o cliente e a prateleira
sentem.

**O espelho usa `max()` das peças vivas**, não `min()`. A comanda só está na
prateleira quando a **última** peça ficou pronta. Com `min()`, uma comanda de
três peças em que uma ficou pronta em janeiro entraria no alerta enquanto as
outras duas ainda estivessem na bancada — e não há nada de abandonado nisso.

A view expõe `days_ready`, **não** `is_abandoned`: o prazo mora em
`app_settings`, e lê-lo dentro da view amarraria `order_list_view` a uma tabela
com RLS própria. Quem sabe o prazo compara — `dashboard_alerts()` no servidor, a
tela no cliente, que já carrega a configuração.

### A armadilha do backfill, de novo

A primeira versão preenchia `ready_at` com um `UPDATE` solto na migration. O
`db-init` aplica **migrations antes dos seeds**, então ele rodou com o banco
vazio: numa instalação do zero, as 120 comandas semeadas nasceriam sem
`ready_at`, nunca entrariam no alerta, e o bloco pareceria funcionar enquanto não
fazia nada.

É a mesma armadilha do `backfill_order_items` do bloco 3, e só apareceu porque a
verificação final reconstruiu o banco do zero em vez de aplicar a migration por
cima do banco existente. Mesmo remédio: `backfill_ready_at()`, idempotente,
chamada pela migration **e** pelo fim dos dois seeds.

---

## Dependência externa

Os blocos 1 e 6 melhoram muito com aviso automático ao cliente, e o status
`avisado` ("Cliente avisado") hoje só pode ser marcado na mão. As integrações
de WhatsApp estão cadastradas no banco e desabilitadas, `chamarIntegracao`
([integracoes.ts:121](../src/lib/api/integracoes.ts#L121)) não tem nenhum
caller, e não existe `supabase/functions/`, serviço de functions no
`docker-compose.yml` nem rota `/functions/v1` no Kong. É trabalho próprio, em
`docs/02-backend.md` §integrações.

## Ordem sugerida

1. **Blocos 1 e 2 juntos** — resolvem a mesma disputa e tocam as mesmas duas
   RPCs. Fazer separado significa mexer em `change_order_status` duas vezes.
2. **Bloco 3** — decisão de produto agora, implementação antes de entrar dado
   real. Depois disso o custo passa a incluir backfill.
3. **Blocos 4, 5 e 6** — independentes entre si, podem entrar conforme a
   operação pedir.
