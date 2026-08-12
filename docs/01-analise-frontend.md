# Etapa 1 — Análise do Frontend (engenharia reversa)

Fonte: SPA Vite + React 18 + Zustand (`persist` em `localStorage`), 13 páginas, 5 componentes de domínio.
Estado global único em [src/store/useApp.ts](../src/store/useApp.ts), dados fictícios gerados em
[src/data/seed.ts](../src/data/seed.ts).

---

## 1. Níveis de usuário / papéis

Definidos em `PERFIS` ([src/lib/constants.ts:98](../src/lib/constants.ts#L98)). O front diferencia papéis
**exclusivamente por acesso a módulo** — não há granularidade de ação (ver/criar/editar/excluir) na UI.

| Perfil (front) | Nome demo | Cargo | Papel no backend |
|---|---|---|---|
| `wallace` | Wallace | Responsável | `owner` |
| `atendimento` | Camila | Atendimento | `attendant` |
| `producao` | Diego | Produção | `production` |
| `financeiro` | Sandra | Financeiro | `finance` |
| `consulta` | Visitante | Consulta | `viewer` |

Mecanismos de proteção encontrados:

- **Guard de rota**: `<Protegida modulo="...">` em [src/App.tsx:22](../src/App.tsx#L22) — sem sessão redireciona
  para `/`; sem o módulo no perfil redireciona para `/dashboard`.
- **Menu condicional**: `NAV.filter(i => perfil.modulos.includes(i.id))` em
  [src/components/Layout.tsx:65](../src/components/Layout.tsx#L65).
- **Menu "Criar" filtrado por módulo**: [src/components/Layout.tsx:558](../src/components/Layout.tsx#L558).
- **Busca global filtrada por módulo**: [src/components/Layout.tsx:742](../src/components/Layout.tsx#L742).
- **Link para ficha do cliente condicionado**: `podeVerCliente` em
  [src/pages/ComandaDetalhe.tsx:58](../src/pages/ComandaDetalhe.tsx#L58).

## 2. Multi-tenancy — **NÃO SE APLICA**

Sinalização exigida antes de modelar. Varredura completa do front **não encontrou nenhum indício** de
multi-tenancy:

- Nenhum seletor de empresa/organização/equipe.
- Nenhum fluxo de convite, membros, planos ou assinatura.
- `config.empresa` é **um registro único e fixo** ("Chaveiro Formiga"), editado em Configurações →
  Empresa ([src/pages/Configuracoes.tsx:84](../src/pages/Configuracoes.tsx#L84)).
- `PERFIS` é uma lista fechada de 5 pessoas da mesma loja.

**Decisão:** modelagem **single-tenant**. Nenhuma tabela recebe `org_id`.
`app_settings` é uma tabela singleton (uma linha, PK booleana com `CHECK`).

> **Caminho de migração**, se um dia virar SaaS multi-loja: (1) criar `organizations`;
> (2) `ALTER TABLE ... ADD COLUMN org_id uuid REFERENCES organizations` em todas as tabelas de negócio,
> com backfill para a org única; (3) trocar `app_settings` singleton por `organization_settings` com
> `org_id` UNIQUE; (4) adicionar `org_id` a `profiles` e trocar os predicados RLS por
> `org_id = public.current_org_id()`. Custo estimado: 1 migration por tabela + reescrita das policies.
> Enquanto o produto for uma loja só, `org_id` seria coluna morta em todas as tabelas.

## 3. Módulos, telas e entidades

| Módulo (chave DB) | Rota | Tela | Função | Entidades |
|---|---|---|---|---|
| `dashboard` | `/dashboard` | Dashboard | KPIs, alertas do dia, gráficos, últimas comandas | orders, customers, ledger_entries |
| `service_desk` | `/atendimento` | Atendimento | Balcão: KPIs do dia + fluxo de 8 etapas de novo atendimento | orders, customers, services, order_photos |
| `customers` | `/clientes`, `/clientes/:id` | Clientes / ClienteDetalhe | Base de clientes, histórico, resumo financeiro, registro de contato | customers, orders, order_payments, order_photos |
| `orders` | `/comandas`, `/comandas/:id` | Comandas / ComandaDetalhe | Ordem de serviço completa: status, fotos, execução, financeiro, histórico, impressão | orders, order_photos, order_payments, order_events |
| `services` | `/servicos` | Serviços | Catálogo: preço base, prazo, responsável padrão, arquivar/duplicar | services, service_categories, staff |
| `production` | `/producao` | Produção | Kanban arrastável de 8 colunas, drawer de detalhe rápido | orders, order_statuses, staff, order_photos |
| `labels` | `/etiquetas` | Etiquetas | Seleção em lote, 3 tamanhos, preview, impressão | orders, app_settings |
| `finance` | `/financeiro` | Financeiro | Lançamentos (entrada/saída), gráficos 12 meses, formas de pagamento, entregues sem pagar | ledger_entries, ledger_categories, orders |
| `reports` | `/relatorios` | Relatórios | Abas de relatórios agregados | views de relatório |
| `settings` | `/configuracoes` | Configurações | Empresa, catálogo, numeração/impressão, etiquetas, financeiro, demo | app_settings, integrations |

## 4. Pontos de consumo de dados (o que era mock e passa a ser API)

Toda leitura hoje vem de `useApp` (memória). Toda escrita é uma action do store. Mapa completo:

### Leituras

| Origem no front | Substituição |
|---|---|
| `s.clientes` | `customers` (CRUD direto) + `customer_summary_view` |
| `s.servicos` | `services` (CRUD direto) |
| `s.comandas` | `order_list_view` (listagem paginada) / `order_detail_view` (detalhe) |
| `s.lancamentos` | `ledger_entries` (listagem paginada) |
| `s.config` | `app_settings` (singleton) |
| `calcularKpis()` [metricas.ts:26](../src/lib/metricas.ts#L26) | RPC `dashboard_kpis()` |
| `serieAtendimentos()` [metricas.ts:85](../src/lib/metricas.ts#L85) | RPC `report_daily_intake(days)` |
| `porCategoria()` [metricas.ts:101](../src/lib/metricas.ts#L101) | RPC `report_by_category()` |
| `serieFaturamento()` [metricas.ts:120](../src/lib/metricas.ts#L120) | RPC `report_monthly_finance(months)` |
| `topServicos()` [metricas.ts:153](../src/lib/metricas.ts#L153) | RPC `report_top_services(limit)` |
| `tempoMedioExecucao()` [metricas.ts:167](../src/lib/metricas.ts#L167) | RPC `report_avg_lead_time()` |
| `porFormaPagamento()` [metricas.ts:178](../src/lib/metricas.ts#L178) | RPC `report_payment_methods()` |
| `porResponsavel()` [metricas.ts:188](../src/lib/metricas.ts#L188) | RPC `report_by_staff()` |
| `gerarAlertas()` [metricas.ts:221](../src/lib/metricas.ts#L221) | RPC `dashboard_alerts()` |
| `resumoCliente()` [useApp.ts:433](../src/store/useApp.ts#L433) | `customer_summary_view` |
| `PERFIS` / `RESPONSAVEIS` | `profiles` + `role_modules` + `staff` |
| `CATEGORIAS`, `STATUS`, `CLIENTE_STATUS`, `LANCAMENTO_STATUS`, `FORMAS`, `CAT_ENTRADA`, `CAT_SAIDA` | tabelas de domínio |

### Escritas

| Action do store | Endpoint |
|---|---|
| `entrar` / `sair` | `supabase.auth.signInWithPassword` / `signOut` |
| `criarCliente` | `POST customers` |
| `atualizarCliente` | `PATCH customers` |
| `criarServico` | `POST services` |
| `atualizarServico` | `PATCH services` |
| `duplicarServico` | RPC `duplicate_service(id)` |
| `arquivarServico` | `PATCH services {active}` |
| `criarComanda` | **RPC `create_order(payload)`** — numeração + lançamentos + eventos, atômico |
| `atualizarComanda` | RPC `update_order(id, patch, event_title)` |
| `alterarStatus` | **RPC `change_order_status(id, status)`** |
| `anexarFoto` | upload em Storage + `POST order_photos` |
| `removerFoto` | `DELETE order_photos` + remoção no Storage |
| `marcarFotoTipo` | `PATCH order_photos {kind}` |
| `registrarPagamento` | **RPC `register_order_payment(...)`** — pagamento + lançamento + baixa de pendência |
| `marcarImpressa` | RPC `mark_order_printed(id)` |
| `marcarEtiqueta` | RPC `mark_labels_printed(ids[])` |
| `criarLancamento` | `POST ledger_entries` |
| `atualizarLancamento` | `PATCH ledger_entries` |
| `removerLancamento` | `PATCH ledger_entries {deleted_at}` (soft delete) |
| `atualizarConfig` | `PATCH app_settings` |
| `restaurarDemo` | **removido** — substituído pelos seeds/script de reset |

## 5. Matriz de permissões (módulo × papel)

Derivada de `PERFIS.modulos`. `r` = visualizar, `w` = criar/editar/excluir.
Vive no banco na tabela `role_modules` e é a **única** fonte de verdade — RLS e front leem dela.

| Módulo | owner | attendant | production | finance | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `dashboard`    | r   | r   | r   | r   | r |
| `service_desk` | r w | r w | —   | —   | — |
| `customers`    | r w | r w | —   | r w | — |
| `orders`       | r w | r w | r w | r   | r |
| `services`     | r w | —   | r w | —   | — |
| `production`   | r w | r w | r w | —   | r |
| `labels`       | r w | r w | r w | —   | — |
| `finance`      | r w | —   | —   | r w | — |
| `reports`      | r   | —   | —   | r   | r |
| `settings`     | r w | —   | —   | —   | — |

Regras de escrita derivadas que não são "módulo × papel" puro:

- `order_payments`: escrita para quem tem `w` em `finance` **ou** `service_desk` (o balcão registra a
  entrada no ato) **ou** `owner`. `finance` tem `orders` só em `r`, mas precisa registrar pagamento.
- `order_events`: append-only para qualquer papel com `w` em `orders`/`production`/`finance`; nunca
  UPDATE/DELETE.
- `audit_logs`: `SELECT` apenas `owner`; `INSERT` via trigger `SECURITY DEFINER`; nunca UPDATE/DELETE.
- `integrations`: `r w` apenas `owner` (módulo `settings`).

## 6. Regras de negócio implícitas → constraint / check / trigger

| # | Regra | Onde está no front | Implementação no banco |
|---|---|---|---|
| 1 | Nome de cliente > 2 caracteres | `valido` [Clientes.tsx:347](../src/pages/Clientes.tsx#L347) | `CHECK (char_length(btrim(name)) > 2)` |
| 2 | Telefone só dígitos, ≥ 8 | `Clientes.tsx:347`, `NovoAtendimento.tsx:144` | `CHECK (phone ~ '^[0-9]{8,15}$')` + trigger de normalização |
| 3 | WhatsApp default = telefone | [useApp.ts:119](../src/store/useApp.ts#L119) | trigger `BEFORE INSERT` |
| 4 | Cidade default "Formiga" | [useApp.ts:121](../src/store/useApp.ts#L121) | `DEFAULT 'Formiga'` |
| 5 | Nome de serviço > 2 caracteres | `valido` [Servicos.tsx:335](../src/pages/Servicos.tsx#L335) | `CHECK` |
| 6 | Preço base ≥ 0 | `Servicos.tsx:411` | `CHECK (base_price >= 0)` |
| 7 | Prazo padrão ≥ 0 dias | `Servicos.tsx:424` | `CHECK (lead_time_days >= 0)` |
| 8 | Quantidade ≥ 1 | `NovoAtendimento.tsx:470` | `CHECK (quantity >= 1)` |
| 9 | Valor total > 0 para criar comanda | `podeAvancar` case 5 [NovoAtendimento.tsx:154](../src/components/NovoAtendimento.tsx#L154) | `CHECK (total_amount > 0)` |
| 10 | Entrada ≤ valor total | `podeAvancar` case 6 + `Math.min` [NovoAtendimento.tsx:678](../src/components/NovoAtendimento.tsx#L678) | `CHECK (down_payment <= total_amount)` |
| 11 | Entrada ≥ 0 | idem | `CHECK (down_payment >= 0)` |
| 12 | Forma de pagamento obrigatória se entrada > 0; nula se entrada = 0 | [NovoAtendimento.tsx:195](../src/components/NovoAtendimento.tsx#L195) | `CHECK ((down_payment > 0) = (down_payment_method_key IS NOT NULL))` |
| 13 | `total pago = entrada + Σ pagamentos` | `totalPago()` [utils.ts:87](../src/lib/utils.ts#L87) | coluna `amount_paid` mantida por trigger |
| 14 | `saldo = max(0, valor − pago)` | `saldo()` [utils.ts:91](../src/lib/utils.ts#L91) | coluna `balance` GENERATED STORED |
| 15 | Quitada quando saldo ≤ 0,009 | `estaQuitada()` [utils.ts:95](../src/lib/utils.ts#L95) | coluna `is_settled` GENERATED STORED |
| 16 | Pagamento nunca excede o saldo | `Math.min(valor, emAberto)` [RegistrarPagamento.tsx:78](../src/components/RegistrarPagamento.tsx#L78) | validação na RPC `register_order_payment` + `CHECK (amount > 0)` |
| 17 | Número da comanda sequencial, vem de `config.comandas.proximoNumero`, formato `PREFIXO-0000` | [useApp.ts:155](../src/store/useApp.ts#L155), `comandaCod()` [utils.ts:111](../src/lib/utils.ts#L111) | RPC com `SELECT ... FOR UPDATE` em `app_settings` + `UNIQUE (number)` |
| 18 | Prefixo ≤ 4 caracteres, maiúsculo | [Configuracoes.tsx:223](../src/pages/Configuracoes.tsx#L223) | `CHECK (order_prefix ~ '^[A-Z]{1,4}$')` |
| 19 | Próximo número ≥ 1 | `Configuracoes.tsx:239` | `CHECK (order_next_number >= 1)` |
| 20 | Etiquetas por folha entre 1 e 60 | `Configuracoes.tsx:325` | `CHECK (labels_per_sheet BETWEEN 1 AND 60)` |
| 21 | Atrasada = não finalizada **e** prazo < hoje | `estaAtrasada()` [utils.ts:82](../src/lib/utils.ts#L82) | coluna `is_overdue` em `order_list_view` |
| 22 | `entregueEm` gravado ao entrar em `entregue` | [useApp.ts:254](../src/store/useApp.ts#L254) | trigger `BEFORE UPDATE` |
| 23 | Comanda finalizada (`entregue`/`cancelada`) não muda mais de status | `finalizada` [ComandaDetalhe.tsx:103](../src/pages/ComandaDetalhe.tsx#L103) | trigger que rejeita transição a partir de status final |
| 24 | Só comandas não finalizadas são elegíveis a etiqueta | `elegiveis` [Etiquetas.tsx:27](../src/pages/Etiquetas.tsx#L27) | validação na RPC `mark_labels_printed` |
| 25 | Serviço arquivado não aparece no atendimento | `servicosCat` [NovoAtendimento.tsx:112](../src/components/NovoAtendimento.tsx#L112) | filtro `active = true` |
| 26 | Duplicar serviço → nome + " (cópia)" | [useApp.ts:146](../src/store/useApp.ts#L146) | RPC `duplicate_service` |
| 27 | Status do cliente derivado do histórico | `aplicarStatusClientes()` [seed.ts:546](../src/data/seed.ts#L546) | trigger `recalc_customer_status()` |
| 28 | Lançamento: descrição > 2 caracteres e valor > 0 | `valido` [Financeiro.tsx:672](../src/pages/Financeiro.tsx#L672) | `CHECK` |
| 29 | Categoria de lançamento coerente com o tipo (entrada/saída) | `cats` [Financeiro.tsx:671](../src/pages/Financeiro.tsx#L671) | FK + trigger que valida `ledger_categories.kind = kind` |
| 30 | Ao criar comanda: entrada > 0 gera lançamento `recebido`; saldo > 0 gera `pendente`/`parcial` | [useApp.ts:190-223](../src/store/useApp.ts#L190) | dentro da RPC `create_order` |
| 31 | Ao pagar: gera lançamento `recebido`; se quitou, baixa pendências da comanda; se não, ajusta a parcial para o saldo restante | [useApp.ts:328-348](../src/store/useApp.ts#L328) | dentro da RPC `register_order_payment` |
| 32 | Fotos classificadas em `antes` / `detalhe` / `depois` | `TIPOS` [Fotos.tsx:8](../src/components/Fotos.tsx#L8) | FK `photo_kinds` |
| 33 | Prazo previsto = hoje + `prazoDias` | [NovoAtendimento.tsx:138](../src/components/NovoAtendimento.tsx#L138) | calculado na RPC quando `due_date` não vem |

## 7. Fluxos de estado

### `orders.status_key` (10 estados, `order_statuses`)

Kanban ([constants.ts:43](../src/lib/constants.ts#L43)) — ordem das colunas:

```
recebida → analise → aprovacao → execucao → material → pronta → avisado → entregue
```

Fora do kanban: `pausada` (aberta, sem coluna), `cancelada` (final).

O front **permite transição livre** entre qualquer status via o modal "Alterar status"
([ComandaDetalhe.tsx:592](../src/pages/ComandaDetalhe.tsx#L592)), o drag-and-drop do kanban
([Producao.tsx:74](../src/pages/Producao.tsx#L74)) e a timeline de execução
([ComandaDetalhe.tsx:364](../src/pages/ComandaDetalhe.tsx#L364)). A **única** restrição real é:
status final (`entregue`, `cancelada`) trava a comanda.

| Transição | Quem executa | Dispara |
|---|---|---|
| *(criação)* → `recebida` | `service_desk` w | número sequencial, evento "Comanda criada", eventos de foto/entrada, 1–2 lançamentos |
| qualquer aberto → qualquer aberto | `orders` w ou `production` w | evento "Status alterado" + descrição do status |
| `pronta` → `avisado` | `orders` w / `production` w | evento; (integração WhatsApp — Etapa 2) |
| `pronta`/`avisado` → `entregue` | `orders` w / `production` w | `delivered_at = now()`, evento "Serviço entregue"; lançamento pendente vira `vencido` se sobrou saldo |
| qualquer → `cancelada` | `orders` w | evento; lançamentos automáticos da comanda vão para `cancelado` |
| `entregue`/`cancelada` → * | **ninguém** | trigger rejeita |

### `customers.status_key` (derivado, `customer_statuses`)

```
0 comandas               → inativo
saldo pendente > 0       → pendencia
≥ 3 comandas, sem saldo  → recorrente
1 comanda, sem saldo     → novo
2 comandas, sem saldo    → ativo
```

`bloqueado` é **manual** e nunca é sobrescrito pelo recálculo.

### `ledger_entries.status_key` (7 estados, `ledger_statuses`)

```
previsto → pendente → parcial → recebido        (entradas)
                   ↘  vencido ↗
         pago                                    (saídas)
         cancelado                               (qualquer, terminal)
```

Transições automáticas em `register_order_payment` (regra 31) e em `change_order_status`
(entrega com saldo → `vencido`; cancelamento → `cancelado`).

## 8. Integrações externas sugeridas pelo front

Nenhuma chamada HTTP real existe hoje. Todos os pontos abaixo são toasts "(simulado)" e formam a
lista que alimenta o módulo central de integrações:

| # | Integração | Tipo | Onde aparece no código |
|---|---|---|---|
| 1 | **WhatsApp** — avisar cliente que o serviço está pronto | `messaging` | [ComandaDetalhe.tsx:426](../src/pages/ComandaDetalhe.tsx#L426), [Producao.tsx:331](../src/pages/Producao.tsx#L331), [ClienteDetalhe.tsx:230](../src/pages/ClienteDetalhe.tsx#L230) |
| 2 | **WhatsApp** — compartilhar comprovante de pagamento | `messaging` | [RegistrarPagamento.tsx:110](../src/components/RegistrarPagamento.tsx#L110) |
| 3 | **WhatsApp / e-mail** — compartilhar a comanda com o cliente | `messaging` | [ImprimirComanda.tsx:60](../src/components/ImprimirComanda.tsx#L60) |
| 4 | **Geração de PDF** — comanda em PDF | `document` | [ImprimirComanda.tsx:73](../src/components/ImprimirComanda.tsx#L73) |
| 5 | **Exportação de dados** — clientes, lançamentos, relatórios (CSV/XLSX) | `export` | [Clientes.tsx:78](../src/pages/Clientes.tsx#L78), [Financeiro.tsx:157](../src/pages/Financeiro.tsx#L157), [Relatorios.tsx:100](../src/pages/Relatorios.tsx#L100) |
| 6 | **Compartilhamento de relatório por link** | `export` | [Relatorios.tsx:201](../src/pages/Relatorios.tsx#L201) |

**Não existem no front** e portanto **não serão criados**: gateway de pagamento, consulta de CEP,
mapas, e-mail transacional de autenticação além do padrão do Supabase Auth, nota fiscal.

A impressão de comanda/etiqueta é 100% local (`window.print` / CSS `no-print`) — **não** é integração.

---

## 9. Ambiguidades encontradas no front

Documentadas com a decisão tomada. Todas estão sinalizadas na resposta ao usuário para confirmação.

| # | Ambiguidade | Decisão adotada |
|---|---|---|
| A1 | `RESPONSAVEIS` = [Wallace, Diego, Marcelo, Rita, Sandra], mas `PERFIS` = [Wallace, Camila, Diego, Sandra, Visitante]. Marcelo e Rita executam serviços e **não** têm login; Camila abre comandas e **não** aparece como responsável de execução. | Tabela `staff` separada de `profiles`, com `can_execute boolean`. 6 registros: Wallace, Camila (`can_execute=false`), Diego, Marcelo, Rita, Sandra. `profiles.staff_id` liga login → pessoa. |
| A2 | O perfil `consulta` ("Visitante", somente consulta) tem o módulo `comandas`, o que faz `podeCriar` retornar `true` e o menu "Criar" exibir "Nova comanda" ([Layout.tsx:68](../src/components/Layout.tsx#L68)). | Tratado como **inconsistência do front**: `viewer` é read-only na RLS. O front passa a ler `can_write` de `role_modules`, o que remove a opção do menu. |
| A3 | O perfil `financeiro` tem o módulo `comandas` e portanto vê os botões "Alterar status" / "Marcar como pronto" / "Finalizar entrega" na ComandaDetalhe. | `finance` recebe `orders: r` + escrita em `order_payments`. Os botões de mudança de status passam a ser gated por `can('orders','w') \|\| can('production','w')`. |
| A4 | `criarComanda` grava o lançamento de saldo com `categoria: CAT_ENTRADA[0]` — sempre "Serviço de chaveiro", independente da categoria real ([useApp.ts:215](../src/store/useApp.ts#L215)) — enquanto o seed usa o mapa correto por categoria ([seed.ts:396](../src/data/seed.ts#L396)). | Adotada a versão **do seed** (mapa por categoria). O comportamento do store é tratado como bug. |
| A5 | Os autores de eventos são hardcoded: `'Wallace'` em `atualizarComanda`/`alterarStatus`/`anexarFoto`, `'Camila'` em `criarComanda`, `'Sandra'` em `registrarPagamento`. | Substituídos pelo usuário autenticado (`auth.uid()` → `profiles.full_name`). |
| A6 | `Foto.seed` é um gradiente determinístico; `Foto.dataUrl` é o arquivo local em base64. Nenhum upload real. | `order_photos.storage_path` (bucket privado `order-photos`, URL assinada) + `gradient_seed` mantido como fallback visual para o seed de demonstração, que não tem binários. |
| A7 | `config.financeiro.formas` existe no tipo mas nunca é editado na UI — Configurações → Financeiro só **exibe** as formas como "Ativa" ([Configuracoes.tsx:390](../src/pages/Configuracoes.tsx#L390)). | `payment_methods.active` no banco; a tela continua read-only (não inventar edição). |
| A8 | `modoApresentacao` é estado de apresentação comercial, persistido no `localStorage`. | Permanece **local** (`localStorage`), fora do banco — é preferência de UI, não dado de negócio. |
| A9 | `restaurarDemo()` recria os dados fictícios em runtime. | Removido do produto. Substituído por `seed_demo.sql` + `scripts/reset-to-prod.sh`. |
| A10 | `alertas` (sino do topo e cards do dashboard) são derivados em memória, sem tabela. | Permanecem derivados, agora via RPC `dashboard_alerts()`. Nenhuma tabela de notificação foi inventada. |
