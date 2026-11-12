# Financeiro, etapa 1: base, receitas das OS e parcelas

Data: 2026-11-12 · Branch: `desenvolvimento` (nada vai para a `main` sem aprovação do dono)

## Objetivo

Área financeira da oficina **exclusiva do MasterAdm**: acompanhar quanto cada OS vale, quanto já foi pago e quanto falta,
incluindo parcelas futuras com gráficos por mês. Registro 100% manual (sem gateway: a oficina usa maquininha própria).

## Etapas do projeto financeiro

1. **Esta etapa:** base, receitas das OS, pagamentos, parcelas e gráficos.
2. Despesas, perdas de ferramenta e pagamento de salários dos mecânicos.
3. Lucro por OS (custo de peças/terceiros).
4. Resumo e relatórios mensais.

## Decisões do dono

- Pagamento: tudo na entrega, entrada + restante, parcelado/fiado. (Seguradora fora desta etapa.)
- Formas: Pix, dinheiro, cartão de débito, cartão de crédito.
- Taxa da maquininha é registrada (valor líquido = cobrado − taxa). Opcional.
- Crédito parcelado: a oficina recebe **tudo de uma vez**. Parcelas do cartão são só informativas.
- Recebimentos futuros vêm do **parcelado/fiado** (cliente paga a oficina em vários meses).
- Valor da OS = soma dos itens aprovados − desconto da **última versão de orçamento aprovada**. O master pode marcar
  manualmente quais versões aprovadas contam (padrão: só a última).
- Visual segue o padrão das telas existentes. Botão "Instalar aplicativo" para toda a equipe.

## Dados (migração `20261112000008_finance.sql`)

Nenhuma tabela existente é alterada.

| Objeto | Função |
|---|---|
| `finance_payments` | Pagamento recebido: OS, data, forma, valor, taxa (só cartão), parcelas do cartão (só crédito, informativo), observação, parcela de origem opcional |
| `finance_installments` | Parcela prevista: OS, número, vencimento, valor, `payment_id` (preenchido ao dar baixa) |
| `finance_os_settings` | Versões de orçamento que contam numa OS (`counted_quote_ids`; nulo = última aprovada) |
| `finance_os_overview()` | Por OS: valor devido, pago, a receber, parcelas atrasadas e situação. Confere `is_master()` por dentro |
| `finance_monthly()` | Recebido e a receber por mês (para os gráficos). Confere `is_master()` |

Regras no banco: valor > 0; taxa entre 0 e o valor, e só em cartão; parcelas do cartão só em crédito; parcela com baixa
referencia um pagamento; RLS de todas as tabelas só para `is_master()`; auditoria com `tg_audit`/`tg_stamp`; execução
das funções só para `authenticated`, nunca para `anon`.

Situação da parcela: prevista, recebida (tem `payment_id`) ou atrasada (vencida e sem baixa), calculada na consulta.

## Telas (somente master; `RequireMaster` + RLS)

- `/sistema/financeiro`: totais, gráficos (a receber por mês e recebido por mês), lista de OS com filtros.
- `/sistema/financeiro/os/:id`: valor devido, versões que contam, pagamentos, plano de parcelas, registrar pagamento,
  gerar plano de parcelas (entrada + N parcelas mensais iguais, ajustáveis), dar baixa em parcela.
- Menu "Financeiro" visível só ao master. Botão "Ver financeiro" na tela da OS só para o master.
- Gráficos em SVG próprio, sem nova dependência.

## Instalar o app

O PWA já existe (manifesto, ícones, service worker). Falta o botão "Instalar aplicativo" no menu, usando
`beforeinstallprompt` (Chrome/Edge/Android) e instruções do Safari para iPhone; some quando já instalado.

## Segurança e testes

- Testes SQL em `tests/security_tests.sql`: mecânico e anônimo não leem nem escrevem nada financeiro nem executam as
  funções; master consegue; restrições de valor/taxa; baixa de parcela.
- Testes de regras puras no front (divisão do saldo em parcelas) quando houver runner; type-check e build.
- A migração **não** é aplicada no Supabase de produção. Será aplicada primeiro num banco de testes separado.
