# Correções da auditoria de QA — 31/07/2026

Execução do plano de correção sobre as 46 pendências apontadas pela auditoria funcional de
30/07/2026 (relatório `relatorio-status-chaveiro-formiga.pdf` / `BACKLOG-QA.md`, fora do repo).

**8 migrations novas** (20260730150000 → 20260730220000), verificadas com `db:nuke` + `db:up`:
27/27 aplicadas em banco limpo, sem intervenção.

---

## Duas correções ao relatório de QA

### 1. As integrações não eram "configuração, não código"

O relatório apontou como prioridade #1 que "ativar as 6 integrações destrava ~8 botões". Isso estava
incorreto:

- `chamarIntegracao()` existia e **nunca era chamado** por botão nenhum
- `supabase/functions/` estava **vazia**
- os botões só disparavam um toast simulado

Ativar no admin não faria nada funcionar. Depois de investigar, duas das seis nem eram integração:

| Antes | Agora |
|---|---|
| `data_export` — "Exportação de dados", Inativa | **Removida.** CSV é gerado no cliente ([src/lib/exportar.ts](../src/lib/exportar.ts)) |
| `order_pdf` — "Comanda em PDF", Inativa | **Removida.** PDF sai pela caixa de impressão, reusando o `@media print` que já existia |
| `whatsapp_notify` / `whatsapp_order` / `whatsapp_receipt` / `report_share` | Continuam — dependem mesmo de provedor e segredo |

`integrations` é para serviço **externo**. O que o navegador resolve sozinho não deve aparecer lá
como "Inativa" enquanto funciona.

### 2. Os botões de integração já davam feedback

O relatório diz que clicar não produzia nada. Na verdade todos já mostravam um toast explicativo. O
que faltava era `disabled` + tooltip — dizer **antes** do clique, não depois.

---

## Defeitos sistêmicos (resolvem vários itens de uma vez)

### `useAcao.erro` lido de closure obsoleto — 20 call sites

[src/lib/hooks.ts](../src/lib/hooks.ts). O idiom `if (r === null && acao.erro)` lia o valor do render
**anterior** — sempre `null` na primeira falha. No Financeiro isso produzia um toast **verde**
"Lançamento excluído" para uma exclusão recusada pela RLS.

Corrigido devolvendo `erro` como *getter* sobre um ref: os 20 call sites passaram a funcionar sem
nenhuma alteração neles.

### Soft delete era impossível via PostgREST

Num `UPDATE ... RETURNING`, o Postgres aplica as policies de **SELECT** também sobre a linha **nova**.
O PostgREST sempre embrulha o update num CTE com `RETURNING`. Logo, `deleted_at IS NULL` no `USING`
de uma policy de SELECT torna a coluna **imutável pela API**.

Erro real capturado no log do container:

```
ERROR: new row violates row-level security policy for table "ledger_entries"
STATEMENT: WITH pgrst_source AS (UPDATE "public"."ledger_entries" SET "deleted_at" = ... RETURNING 1)
```

Resolvido com RPCs `SECURITY DEFINER` ([20260730160000](../supabase/migrations/20260730160000_soft_delete_rpcs.sql)),
mantendo o predicado na policy como defesa em profundidade.

### `P0002` virava HTTP 500 sem corpo

Toda RPC que levantava "não encontrado" devolvia `500 · Something went wrong`. A mensagem em
português era descartada no caminho. Medido, com a mesma mensagem em cada código:

| SQLSTATE | HTTP | Corpo |
|---|---|---|
| `P0001` | 400 | ✅ JSON com a mensagem |
| `42501` | 403 | ✅ |
| `23514` | 400 | ✅ |
| `23505` | 409 | ✅ |
| `P0002` | 500 | ❌ página de erro do Kong |

Defeito **pré-existente** — `duplicate_service` e `create_order` já usavam `P0002` desde a primeira
versão. Corrigido em 9 funções ([20260730220000](../supabase/migrations/20260730220000_erro_nao_encontrado.sql)).

### `create_auth_user` deixava os tokens NULL

Rodar `npm run db:seed:demo` com a stack no ar quebrava **todos** os logins com 500:

```
error finding user: sql: Scan error on column index 3, name "confirmation_token":
converting NULL to string is unsupported
```

O GoTrue lê essas colunas como `string`, não `sql.NullString`. Ficava escondido porque no boot normal
o schema `auth` ainda não existe quando os seeds rodam, e quem cria os usuários é o
`bootstrap-users.sh` pela Admin API. Corrigido em
[20260730210000](../supabase/migrations/20260730210000_auth_user_tokens_vazios.sql), com reparo das
linhas já quebradas.

---

## Itens de alta prioridade

| # | Item | Causa raiz | Onde |
|---|---|---|---|
| 1 | Integrações | ver acima | — |
| 2 | Lentidão de 5-8 s | **N+1 de URLs assinadas**: até 109 POSTs de `createSignedUrl` no Kanban (~20 ms cada), refeitos a cada render, porque cada card era uma instância de `GradeFotos` | cache + coalescência em `fotos.ts`; efeito passou a depender do conteúdo, não da identidade do array |
| 3 | Filtro de período | O período **não saía da tela**: não estava no filtro nem nas deps, `FiltroComandas` não tinha faixa de datas, e nenhuma das 8 RPCs aceitava período | [20260730180000](../supabase/migrations/20260730180000_reports_period.sql) + Relatorios.tsx |
| 4 | Exclusão de lançamento | policy de SELECT (ver acima) + erro engolido | RPC + `useAcao` |
| 5 | KPI "Recorrentes" = 0 | O trigger avalia `pendencia` antes de `recorrente`: só seria recorrente quem tem 3+ comandas **e** zero dívida. Medido: 13 com 3+ comandas, **0** sem pendência | KPI e filtro passaram a usar `order_count >= 3` |
| 6 | Filtro "Arquivados" | O flag só sabia **incluir** — nunca havia `eq('active', false)` | `arquivo: 'ativos' \| 'arquivados' \| 'todos'` |
| 7 | Gestão de equipe | Era só leitura, e lia a tabela **errada** (`staff` em vez de `profiles`) | [20260730170000](../supabase/migrations/20260730170000_team_management.sql) |
| 8 | Consulta vê "Criar comanda" | Dashboard usava permissão de **leitura** para botão de **escrita** — única tela do app com esse erro | `podeCriar` + guarda nos deep-links + guarda no wizard |
| 9 | `<button>` aninhado | `GradeFotos` sempre passava `onClick`, mesmo com `editavel={false}` | prop `interativo` |

### Achados extras, não relatados pelo QA

- **Vazamento de KPI mais amplo que o descrito.** O QA viu `PENDENTE` e `TICKET MÉDIO` no Dashboard.
  Também vazavam no KPI "Valor pendente" de **Comandas** e nos três KPIs de **Relatórios**.
- **Auto-lockout do responsável.** Policies permissivas se combinam por OR, e `profiles_admin_all` é
  `FOR ALL USING is_owner()`. O responsável conseguia gravar `is_active = false` em si mesmo — e o
  único caminho para reconceder `settings:write` exige `is_owner()`. Um clique deixava o sistema sem
  administrador, recuperável só por `psql`. Fechado com uma policy `RESTRICTIVE`.
- **Valor abaixo do já pago era validado só no front.** Como `balance` é `greatest(0, total - paid)`,
  baixar o total zerava o saldo em silêncio. Agora a RPC recusa.
- **Comanda finalizada era editável pelo banco.** O front bloqueava, a RPC não.

---

## Decisões que valem registrar

**`count: 'exact'` foi mantido.** O plano previa trocar por `'planned'`. Medido com `EXPLAIN ANALYZE`:
**1 ms**. Trocar daria contagem aproximada em "121 comandas" e na paginação — errado nas duas pontas,
para economizar 1 ms. O embed `order_photos(*)` custa ~25 ms e foi removido só do Kanban, que renderiza
uma foto por card.

**O trigger de status do cliente não foi alterado.** Frequência e dívida são eixos ortogonais numa
coluna só, e pendência é o que a operação precisa ver primeiro no badge.

**`report_avg_lead_time` recorta por `delivered_at`, não `created_at`.** Com `created_at` haveria viés
de sobrevivência: comandas abertas no fim da janela ainda não foram entregues, o filtro pegaria só as
rápidas e o tempo médio cairia todo fim de mês.

**O período de `report_by_status` vai no `ON` do LEFT JOIN.** No `WHERE` o LEFT JOIN degeneraria em
INNER e as colunas do Kanban sem comanda no período sumiriam da tela em vez de aparecer com zero.

**`DROP + CREATE` em vez de `DEFAULT NULL`.** Acrescentar parâmetro com default **não** substitui a
função de zero argumentos — cria uma irmã, e a chamada sem argumento passa a ter dois candidatos:
`42725 ambiguous_function` na **chamada**, não no `CREATE`. A migration aplicaria limpa e a tela
quebraria em produção.

---

## O que foi verificado

Sobre a stack reconstruída do zero (`db:nuke` + `db:up` + `db:bootstrap`):

| Item | Resultado |
|---|---|
| Migrations em banco limpo | 27/27, sem erro |
| Login dos 5 perfis | ✅ |
| KPIs financeiros por papel | `sandra` vê 9488.80 · `diego`/`camila`/`consulta` recebem `null` |
| Soft delete de lançamento | grava `deleted_at`, some da view, idempotente, recusa automático com mensagem |
| Filtro de período | 123 → 106 (90d) → 91 (30d); `report_by_status` mantém as 10 linhas |
| KPI "Recorrentes" | 0 → 13 |
| Filtro "Arquivados" | 37 → 1 |
| Guardas de equipe | recusa auto-desativação, auto-rebaixamento, papel inexistente; `PATCH` cru → 403 |
| Aba Equipe | lista os 6 logins, incluindo `consulta` (antes invisível) |
| Guardas de edição de comanda | recusa valor < pago e comanda finalizada; troca de serviço leva a categoria junto |
| Mensagens de "não encontrado" | chegam ao cliente em português |
| Reset para produção | 0 registros, config intacta, primeira comanda **CF-0001** |
| App sobre banco zerado | cliente, serviço, comanda e lançamento criados |
| `typecheck` + `build` | ✅ sem mock no projeto |
| `.env` e `credenciais.md` | fora do git |

---

## Regressão encontrada e corrigida na validação de navegador

A correção de "preservar a rota de destino após o login" (Fase 7) introduziu um defeito **pior que o
bug original**: entrar pela tela de login deixava a aplicação **em branco**.

`Login.tsx` usava `state.from || '/'`. Sem rota salva, o fallback era `/` — que é a própria rota do
login. O ciclo era `/ → /dashboard → /`, terminando num `#root` vazio. O comentário no código já
dizia que vazio significava "sem destino"; o código escreveu `'/'`.

Corrigido: sem destino salvo o Login **não navega** — a rota `/` já redireciona pelo primeiro módulo
do perfil assim que a sessão entra no store.

**Por que só apareceu agora:** typecheck, build e todos os testes de API passavam. O defeito era de
roteamento no cliente, invisível fora do navegador.

### O primeiro script de validação deu 30/30 sobre uma tela em branco

Vale registrar porque é um modo de falha de teste, não de produto. O script checava
`waitForURL(/dashboard/)`, que **passou** — a aplicação chegava a `/dashboard` antes de rebotar. E
`page.on('console')` **não** captura exceção não tratada, só `page.on('pageerror')`.

Resultado: as verificações de menu rodavam sobre zero elementos e "Financeiro oculto no menu"
passava por vacuidade — não havia menu nenhum.

O script foi endurecido com três guardas: exigir que `#root` tenha conteúdo depois do login, exigir
a **contagem exata** de itens de menu por papel, e escutar `pageerror`. Só então as 36 verificações
passaram a significar alguma coisa.

---

## Validação no navegador (Playwright, headless)

Fechado o critério que estava aberto. 5 perfis × 36 verificações, todas passando:

| Perfil | Menu | KPIs financeiros | Escrita |
|---|---|---|---|
| `wallace` | 10 itens | visíveis | — |
| `camila` | 6 itens, sem Financeiro | **ocultos** | — |
| `diego` | 5 itens, sem Financeiro | **ocultos** | — |
| `sandra` | 5 itens | visíveis | — |
| `consulta` | 4 itens, sem Financeiro | **ocultos** | sem "+ Criar", sem "Criar comanda", `?novo=1` bloqueado |

Também verificado em todos: `/financeiro` por URL direta redireciona **com toast**, nenhum
`validateDOMNesting` no console, e console sem erro.

Preservação de rota: pedir `/relatorios` deslogado leva a `/relatorios` **depois** do login; entrar
pela raiz leva ao primeiro módulo do perfil.

### Continua precisando de teste manual

**Arrastar e soltar na Produção** — a biblioteca de DnD exige movimento incremental do ponteiro, que
o Playwright não reproduz de forma confiável. Há alternativa funcional pelo painel lateral
("MOVER PARA"), essa sim verificada.
