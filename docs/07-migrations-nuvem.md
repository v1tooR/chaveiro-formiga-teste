# Migrations pendentes no Supabase hospedado

Guia de subida das migrations que **ainda não** foram aplicadas num projeto
hospedado. Complementa [05-supabase-cloud.md](05-supabase-cloud.md), que trata
da primeira publicação; aqui o caso é o outro — o projeto já roda na nuvem e
precisa receber alteração de schema.

O que muda entre local e nuvem: no local o `db-init` roda os arquivos em ordem
alfabética a cada `db:nuke`, sem histórico. Na nuvem quem manda é o
`supabase db push`, que registra o aplicado em
`supabase_migrations.schema_migrations` e nunca reaplica. Por isso a lista do
que falta **se descobre consultando**, não se assume.

---

## 1. Descobrir o que falta

```bash
# .env apontando para a nuvem — ver 05-supabase-cloud.md
psql "$SUPABASE_DB_URL_CLOUD" -c \
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
```

Compare com `ls supabase/migrations/`. Hoje o repositório tem **35 migrations**;
as oito últimas são as que este documento cobre:

| Migration | O que faz |
|---|---|
| `20260806200000_registro_entrega_e_foto_obrigatoria.sql` | Registro da entrega em `orders` + exigência de foto (blocos 1 e 2 de [06](06-fluxo-do-usuario.md)) |
| `20260807100000_order_items.sql` | `order_items`, status e entrega por item (bloco 3) |
| `20260807140000_aprovacao_orcamento.sql` | Lastro da aprovação de orçamento por item (bloco 4) |
| `20260807170000_garantia_retrabalho.sql` | Garantia por peça e retrabalho vinculado (bloco 5) |
| `20260807190000_foto_entrega_comanda_de_um_item.sql` | Correção: comanda de um item aceita a foto solta da comanda |
| `20260807200000_espelho_entrega_na_comanda.sql` | Correção: a entrega volta a aparecer em `orders` (recibo) |
| `20260807220000_foto_de_entrega_precisa_de_arquivo.sql` | A foto que libera a entrega passa a exigir imagem, não só a marcação |
| `20260811100000_item_nao_retirado.sql` | Prazo de prateleira, alerta e filtro de peça não retirada (bloco 6) |

São **dependentes em cadeia** — cada uma reescreve funções que a anterior
criou. Aplicar fora de ordem não é possível pelo `db push`, mas aplicar **só
algumas** à mão quebra: se for subir manualmente, subam todas.

A 190000 e a 200000 são correções de defeitos que a 100000 introduziu e que só
apareceram ao reexecutar a suíte de regressão. **Não são opcionais**: sem a
190000 a entrega fica travada pela tela numa comanda de um item; sem a 200000 o
recibo de entrega sai com "Retirado por —".

A 220000 fecha um buraco de um clique — ver [3.9](#39-a-partir-da-220000-a-foto-da-entrega-precisa-de-imagem).

Se `schema_migrations` não existir, o projeto nunca recebeu um `db push` — vá
para [05-supabase-cloud.md](05-supabase-cloud.md) antes.

## 2. Aplicar

```bash
npm run cloud:migrations     # = cloud-deploy.sh --so-migrations
```

Aplica só as pendentes, na ordem, e registra o histórico. **Não** roda seed nem
mexe em login — é o comando certo para um projeto que já está em operação.

`npm run cloud:deploy` (sem a flag) roda migrations **e** `seed_prod.sql`. O
seed é idempotente e não cria cliente nem comanda, mas em projeto que já opera
não há motivo para tocá-lo.

---

## 3. O que exige atenção

### 3.1 A exigência de foto entra LIGADA

`20260806200000` cria duas colunas em `app_settings` com `DEFAULT true`:

- `require_photo_on_intake` — sem foto, `create_order` recusa abrir a comanda
- `require_photo_on_delivery` — sem foto do tipo `depois`, a entrega é recusada

**Efeito imediato na loja em operação:** toda comanda em `pronta` criada antes
da subida vai pedir a foto do "Depois" na hora de entregar. É o comportamento
desejado, mas é uma mudança de rotina que o balcão precisa saber **antes**, não
descobrir com o cliente na frente.

Para subir sem ligar a regra no mesmo dia:

```sql
UPDATE public.app_settings
SET require_photo_on_intake = false, require_photo_on_delivery = false;
```

Depois é só ligar em **Configurações → Operação**, sem nova migration.

### 3.2 `change_order_status` troca de assinatura

A migration cria a versão de 3 argumentos e **dropa a de 2** na mesma
transação. Isso é intencional: com as duas vivas o PostgREST fica com
sobrecarga ambígua e a exigência de quem retirou vira contornável.

O front antigo (bundle em cache num navegador aberto) continua chamando com 2
argumentos — e continua funcionando, porque o terceiro tem `DEFAULT NULL`. O
que muda para ele é só a entrega, que passa a devolver *"Informe quem está
retirando o item"*. Degradação aceitável; some no primeiro reload.

### 3.3 O backfill de `order_items` roda sozinho — na nuvem

`20260807100000` termina com `SELECT public.backfill_order_items();`, que cria
o item de posição 1 para toda comanda que não tem nenhum.

**Na nuvem isso basta**, porque o banco já tem as comandas quando a migration
roda. No local não bastava: o `db-init` aplica migrations **antes** dos seeds,
então o backfill pegava zero linhas — por isso a função também é chamada no fim
de `seed_prod.sql` e `seed_demo.sql`. A função é idempotente; rodar de novo não
duplica nada.

Confira depois de aplicar:

```sql
SELECT count(*) FILTER (WHERE i.id IS NULL) AS comandas_sem_item
FROM public.orders o
LEFT JOIN public.order_items i ON i.order_id = o.id;
-- esperado: 0
```

Se der diferente de zero:

```sql
SELECT public.backfill_order_items();
```

### 3.4 `orders` vira espelho — pare de escrever nele

Depois desta migration, `orders.status_key`, `total_amount`, `quantity`,
`service_name`, `service_id` e `assigned_staff_id` são **derivados** de
`order_items` por trigger (`recalc_order_from_items`).

Qualquer rotina externa, script de importação ou automação que faça
`UPDATE public.orders SET status_key = ...` passa a gravar num espelho: o
próximo toque em qualquer item da comanda sobrescreve. O caminho passa a ser
`change_order_item_status(item, status, entrega)` ou
`change_order_status(comanda, status, entrega)`, que faz fan-out nos itens
abertos.

### 3.5 Realtime

A migration executa:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
```

Sem isso o Kanban da Produção não se move sozinho — quem muda de status agora é
o item. Se a migration for reaplicada à mão a linha falha com *"relation is
already member of publication"*; pelo `db push` isso não acontece, porque a
migration não reroda.

Confira:

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'order_items';
```

### 3.6 A partir da 140000, sair de "Aguardando aprovação" pede lastro

`change_order_item_status` passa a exigir **quem aprovou** e **por onde** ao
mover um item para fora de `aprovacao`. Comanda que já estava nesse status antes
da subida vai pedir os dados na primeira vez que for movida.

Cancelar a partir de `aprovacao` continua livre — é o cliente recusando, e
obrigar a preencher "quem aprovou" para registrar uma recusa seria pedir mentira
ao operador. Item já aprovado também não pede de novo.

Se a loja não trabalha com orçamento prévio, o status `aprovacao` simplesmente
não é usado e nada muda na rotina.

`change_order_item_status` e `change_order_status` ganham um quarto argumento e
**as versões de 3 argumentos são dropadas**, pelo mesmo motivo do item 3.2. O
front antigo em cache continua movendo item (o quarto tem `DEFAULT NULL`); o que
ele não consegue é liberar um item que esteja em `aprovacao`.

### 3.7 A partir da 170000, comanda de valor zero é legal

`orders_total_positive` (`total_amount > 0`) vira `orders_total_min` (`>= 0`).
Sem isso o retrabalho em garantia é impossível. `create_order` continua
recusando total zero — só `create_rework` cria comanda gratuita.

`dashboard_kpis` passa a excluir retrabalho do `average_ticket`. As **contagens**
continuam incluindo: a peça está na bancada. Se alguém compara o ticket médio de
antes e depois, a diferença é esperada e é a correta.

`services.warranty_days` entra com `DEFAULT 0` — nenhum serviço ganha garantia
sozinho. Preencher no catálogo é decisão da loja, em Serviços.

### 3.8 Relatórios mudam de número

`report_top_services` e `report_by_category` passam a ler de `order_items`.

Isso **corrige** um número, não quebra: antes, comanda com dois itens contava o
nome agregado ("Cópia de chave +1") como se fosse um serviço próprio no ranking,
e a categoria da comanda era a do primeiro item. Se alguém compara relatório de
antes e depois, a diferença é esperada.

### 3.9 A partir da 220000, a foto da entrega precisa de imagem

**Esta é a que mais mexe na rotina do balcão. Avise antes de aplicar.**

Até aqui a exigência perguntava se existia uma **linha** marcada como "Depois" em
`order_photos`. Não perguntava se existia imagem. E `order_photos` aceita linha
sem arquivo de propósito — a constraint `order_photos_has_source` pede
`storage_path` **ou** `gradient_seed`, porque o seed de demonstração popula 120
comandas sem nenhum binário.

Na tela isso era um buraco de um clique: o botão "Sem foto" criava exatamente
essa linha e a entrega passava. Ele ficava encostado no botão que anexa de
verdade, com o mesmo peso visual, e dava menos trabalho — no balcão cheio, é o
que todo mundo apertaria.

Agora a entrega exige `storage_path IS NOT NULL`.

**O que muda na prática:** comandas em `pronta` cujo "Depois" é só marcação
passam a pedir uma foto de verdade antes de sair. Em base de demonstração é o
comportamento desejado. Em **base real vinda de antes deste sistema**, pode
haver comandas prontas nessa situação — conte quantas antes de aplicar:

```sql
SELECT count(DISTINCT i."order_id")
FROM public.order_items i
WHERE i."status_key" IN ('pronta', 'avisado')
  AND NOT EXISTS (
    SELECT 1 FROM public.order_photos p
    WHERE p."kind" = 'depois' AND p."storage_path" IS NOT NULL
      AND (p."order_item_id" = i."id" OR p."order_id" = i."order_id")
  );
```

Se o número for grande e a loja não puder refotografar, a saída é desligar
`app_settings.require_photo_on_delivery` até esvaziar a fila — a exigência é
configuração, não código.

Nada que já foi entregue é invalidado: a regra só roda na transição para
`entregue`.

O **recebimento continua aceitando linha sem arquivo**, e isso é deliberado.
`create_order` valida dentro da transação que cria a comanda, e nesse instante o
arquivo ainda não pode existir: o caminho no bucket é `<order_id>/…` e o id nasce
ali. O cadastro manda as linhas, a comanda nasce, os arquivos sobem em seguida.
Exigir arquivo nesse ponto tornaria impossível abrir qualquer comanda.

### 3.10 A partir da 100000 (11/08), o alerta de peça não retirada

`app_settings.abandoned_after_days` entra com **90**. Comanda pronta há mais de
90 dias e ainda na loja passa a aparecer no painel e no filtro "Não retiradas".

Numa base que já opera há um tempo, esse alerta pode acender com dezenas de
comandas de uma vez — não é defeito, é a fila que ninguém estava vendo. Conte
antes para não ser surpresa:

```sql
SELECT count(*) FROM public.orders o
JOIN public.order_statuses s ON s."key" = o."status_key"
WHERE o."deleted_at" IS NULL AND NOT s."is_final"
  AND o."status_key" IN ('pronta', 'avisado')
  AND o."updated_at" < now() - interval '90 days';
```

Para subir sem barulho, aplique com `abandoned_after_days = 0` (desliga tudo) e
ligue depois, em Configurações → Operação, quando a loja quiser encarar a fila.

O backfill usa `updated_at` como aproximação de quando a peça ficou pronta. Para
o que já está no banco não há dado melhor, e errar por horas não muda decisão
num prazo de dezenas de dias. Daí para a frente `ready_at` é gravado no momento
certo.

---

## 4. Ordem de subida

1. **Migrations primeiro**, front depois. O `create_order` novo aceita as duas
   formas de payload (`items: [...]` e o `service_id` solto da versão antiga),
   justamente para o front velho não quebrar na janela entre um e outro.
2. `npm run db:types` e **republicar o front** (Vercel ou onde estiver).
3. Só então avisar o balcão das mudanças de rotina dos itens 3.1, 3.6, 3.7, 3.10 e
   **3.9** — esta última é a que mais muda o dia a dia.

## 5. Conferência depois de aplicar

```sql
-- espelho bate com a soma dos itens
SELECT count(*) AS divergentes FROM public.orders o
WHERE o.total_amount IS DISTINCT FROM
      (SELECT sum(i.total_amount) FROM public.order_items i WHERE i.order_id = o.id);

-- nenhuma comanda quitada virou devedora
SELECT count(*) AS saldo_estranho FROM public.orders
WHERE amount_paid > 0 AND balance < 0;

-- pendências do financeiro batendo com o saldo
SELECT count(*) AS fora_do_saldo
FROM public.ledger_entries le
JOIN public.orders o ON o.id = le.order_id
WHERE le.auto_generated AND le.auto_role = 'receivable' AND le.deleted_at IS NULL
  AND le.status_key IN ('previsto','pendente','parcial')
  AND le.amount IS DISTINCT FROM o.balance;

-- as RPCs novas existem e as antigas sumiram (as duas têm que devolver 1)
SELECT p.proname, count(*) FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('change_order_status', 'change_order_item_status')
GROUP BY p.proname;

-- os canais de aprovação foram semeados (tem que devolver 4)
SELECT count(*) FROM public.approval_channels;
```

Os três primeiros devem devolver **0**; as sobrecargas, **1** cada; os canais, **4**.

## 6. Backup antes, sempre

Estas três migrations alteram `orders` e `order_items` e criam tabela com backfill. Não há
comando de desfazer.

O projeto **não tem rotina de backup** — é o item ainda em aberto na análise. No
plano free do Supabase não existe PITR. Antes de aplicar em produção:

```bash
pg_dump "$SUPABASE_DB_URL_CLOUD" --schema=public --no-owner \
  -f backup-pre-order-items-$(date +%Y%m%d).sql
```

Sem `psql`/`pg_dump` na máquina, use o do container:
`docker exec -i chaveiro-db pg_dump "$SUPABASE_DB_URL_CLOUD" ...` — `pg_dump` é
só um cliente, o alvo vem da URL.

---

## Regra permanente

Toda alteração de schema é **migration nova**; nunca edite uma já aplicada. Na
nuvem isso deixa de ser convenção e vira mecânica: o `db push` guarda o `version`
da migration, e editar o arquivo depois de aplicado significa que o banco e o
repositório passam a discordar em silêncio.

Depois de qualquer migration: `npm run db:types`.
