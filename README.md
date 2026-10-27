# Innovi Autos: sistema da oficina

**Status:** todo o desenvolvimento está concluído. Banco instalado e testado no Supabase (São Paulo). Restam só as ações da seção "Falta fazer".

## Projeto Supabase

| Item | Valor |
|---|---|
| Projeto | Innovi_AutoCenter_SP (`rwgqhwbjnsihdouekrio`), região **sa-east-1 (São Paulo)** |
| URL | https://rwgqhwbjnsihdouekrio.supabase.co |
| Migrações aplicadas | 01 a 07 (`supabase/migrations`) |
| Tarefa agendada | `innovi-retencao-pedidos`, diária às 03:30 (pg_cron) |
| Projeto antigo (Oregon) | **Pausado** (vazio). Exclua pelo painel se não for usar |
| Edge Functions | `admin-users`, `change-password` (JWT obrigatório) |
| Bucket | `vehicle-photos` (privado, 10 MB, JPG/PNG/WEBP) |
| `web/.env.local` | Já preenchido com URL + chave pública |

## Falta fazer (só você pode)

| # | Onde | O que |
|---|---|---|
| 1 | Supabase → Authentication → Sign In / Providers | Desligar **Allow new users to sign up** (o conector não alcança essa configuração) |
| 2 | Terminal | `cd web` · `npm install` · `npm run dev` → http://localhost:5173/sistema |
| 3 | App | Entrar com **MasterAdm / Master@165** e criar a sua senha definitiva |
| 4 | App | Fazer o teste de aceite (seção "Teste de aceite") |
| 5 | Hospedagem | Publicar (seção "Publicar"). O plano gratuito (Hobby) da Vercel é só para uso não comercial |
| 6 | Windows | Agendar o backup (seção "Backups") |
| 7 | App, como MasterAdm | Revisar em "Fotos exigidas" quais fotos são obrigatórias |

O **MasterAdm já foi criado** (somente o hash da senha fica gravado). `npm run provision:master` não é mais necessário; `npm run recover:master` continua valendo para recuperação.

---|---|---|
| 1 | Supabase → Authentication → Sign In / Providers | Desligar **Allow new users to sign up** |
| 2 | Project Settings → API Keys | Copiar a chave **secret (service_role)**. Não compartilhe com ninguém, nem com IA |
| 3 | Terminal (PowerShell), pasta do projeto | `npm install` · `$env:SUPABASE_URL="https://rwgqhwbjnsihdouekrio.supabase.co"` · `$env:SUPABASE_SERVICE_ROLE_KEY="cole-aqui"` · `npm run provision:master` → digite `Master@165` |
| 4 | Mesmo terminal | `Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY` |
| 5 | Terminal | `cd web` · `npm install` · `npm run dev` → http://localhost:5173 (site) e /sistema (equipe) |
| 6 | Vercel | Publicar (seção "Publicar"). O plano gratuito (Hobby) da Vercel é só para uso não comercial; para a oficina, use o plano Pro ou outro serviço de hospedagem estática |
| 7 | Windows | Agendar o backup (seção "Backups") |
| 8 | App, como MasterAdm | Revisar em "Fotos exigidas" quais fotos são obrigatórias para a sua rotina |
| 9 | App | Fazer o teste de aceite (seção "Teste de aceite") |

---

## O que o sistema faz

| Área | Rota | Destaques |
|---|---|---|
| Site público | `/`, `/servicos`, `/contato` | Indicador "aberto agora", serviços, WhatsApp, pedido de orçamento/agendamento (não confirma horário) |
| Login e senha | `/sistema/login` | Contas individuais; troca obrigatória da senha temporária |
| Painel | `/sistema` | Busca por placa, pátio com indicadores reais, últimas movimentações |
| Check-in | `/sistema/checkin/novo?veiculo=…` | 5 etapas: identificação, inspeção (11 itens), painel/relatos x constatações, fotos, ciência do cliente |
| Ordem de serviço | `/sistema/os/:id` | Resumo, diagnóstico (defeitos por categoria), orçamento (versões, aprovação item a item), execução, saída, fotos, histórico de status |
| Lista de OS | `/sistema/ordens` | Busca por número, placa ou cliente; filtro de status; ordenação |
| Histórico do veículo | `/sistema/veiculos/:id` | Todos os atendimentos, filtros por período e tipo, comparação de fotos entre atendimentos |
| Documentos (PDF) | `/sistema/os/:id/documento/{checkin,inspecao,orcamento,os,checkout}` e `/sistema/veiculos/:id/documento` | Layout A4 com identidade da oficina, escolha de fotos, "Salvar como PDF" |
| Pedidos do site | `/sistema/solicitacoes` | Situação, anotação interna, resposta por WhatsApp |
| Clientes | `/sistema/clientes` | Busca por nome, telefone ou placa; CPF só se necessário; anonimização LGPD (master) |
| Usuários e auditoria | `/sistema/usuarios`, `/sistema/auditoria` | Exclusivos do MasterAdm |
| Fotos exigidas | `/sistema/fotos` | MasterAdm define categorias de foto por etapa, quais são obrigatórias e a ordem |

## Fotos: como o sistema garante que estão salvas

| Etapa | O que acontece |
|---|---|
| Captura | Câmera do celular ou galeria; reduz para até 1920px em JPEG (≈300–700 KB) mantendo detalhes; descrição opcional em cada foto |
| Fila no aparelho | A foto vai para uma fila local (IndexedDB) **antes** do envio, então sobrevive a queda de conexão ou fechamento da página |
| Envio | Barra de progresso; ao voltar a internet, reenvia sozinho |
| Confirmação | Só sai da fila quando o Storage confirmou o arquivo **e** o banco registrou os dados. O banco recusa registro de foto que não existe no Storage |
| Na tela | "Na nuvem" (verde) x "Na fila" / "Não enviada" (com "Tentar de novo"). Nunca diz que salvou sem ter salvo |
| Conclusão | Check-in e check-out não concluem com fotos pendentes; fotos obrigatórias são exigidas pelo banco |
| Acesso | Bucket privado; links temporários de 1 hora; ninguém fora da equipe vê |

## Regras garantidas pelo banco (não pela tela)

| Regra | Como |
|---|---|
| Só 1 MasterAdm; não pode ser excluído, desativado nem rebaixado | Índice único + trigger |
| Só o MasterAdm cria e gerencia usuários | Sem privilégio em `profiles`; só a função `admin-users` escreve |
| Senha temporária bloqueia o sistema até ser trocada | `is_staff()` exige senha trocada |
| Número da OS, status inicial e autoria impostos pelo servidor | Triggers |
| OS duplicada por clique repetido | `client_request_id` único |
| Check-in só conclui com inspeção + fotos obrigatórias na nuvem | Trigger confere o Storage |
| Execução só com orçamento aprovado e autorização registrada | Constraint + trigger |
| Orçamento decidido não muda (nova versão) | Trigger |
| Entrega só com check-out confirmado; km final ≥ km inicial | Triggers |
| Check-out só por quem tem autorização | RLS |
| OS encerrada só é corrigida pelo MasterAdm, sempre auditada | Triggers + auditoria imutável |
| Site público só **insere** pedidos; limite de 3 por telefone/hora e 30 no total a cada 10 min | Grants + RLS + trigger |
| Visitantes não executam nenhuma função interna | Migrações 05 e 06 |

## Publicar (Vercel)

| # | Ação |
|---|---|
| 1 | Importar o repositório; **Root Directory = `web`** |
| 2 | Variáveis: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_LOGIN_EMAIL_DOMAIN` (valores do `web/.env.local`) |
| 3 | Deploy. `vercel.json` traz rotas do SPA e cabeçalhos de segurança (CSP, HSTS, anti-iframe, câmera só no próprio site) |
| 4 | Supabase → Authentication → URL Configuration: Site URL = domínio final |

## Domínio e HTTPS

| # | Ação |
|---|---|
| 1 | Vercel → Project → Settings → Domains → adicionar `innoviautos.com.br` e `www.innoviautos.com.br` |
| 2 | No Registro.br (ou onde o domínio estiver): registro `A` de `@` para o IP indicado pela Vercel e `CNAME` de `www` para `cname.vercel-dns.com` |
| 3 | O certificado HTTPS é emitido e renovado automaticamente pela Vercel |
| 4 | (Opcional) Supabase → Edge Functions → Secrets: `APP_ALLOWED_ORIGINS=https://innoviautos.com.br,https://www.innoviautos.com.br` |

## Backups

| Item | Como | Frequência |
|---|---|---|
| Banco | Plano Pro: backup diário automático. Plano gratuito: **não tem**. Use `scripts/backup.ps1` (dump de estrutura e dados) | Diária |
| Fotos | **Não** entram no backup do banco. `npm run backup:fotos` baixa só as novas para `backups/fotos` e grava um manifesto | Diária |
| Agendamento | `scripts/backup.ps1` no Agendador de Tarefas do Windows (instruções no próprio arquivo) | 19h, dias úteis |
| Retenção | Dumps do banco: 30 dias. Fotos: todas (o script nunca apaga) | — |
| Teste do script | Validado contra Storage simulado: 1.109 arquivos com paginação, modo incremental, arquivo corrompido refeito, falha registrada no manifesto e recuperada na execução seguinte, chave errada com mensagem clara (`scripts/teste-backup`) | — |
| Restauração do banco | `psql "$SUPABASE_DB_URL" -f backups/banco/AAAA-MM-DD-estrutura.sql` e depois `...-dados.sql`, num projeto novo | — |
| Restauração das fotos | Reenviar a pasta `backups/fotos/os` para o bucket `vehicle-photos` mantendo os caminhos | — |
| Monitorar | Supabase → Reports: tamanho do banco e do Storage. Plano gratuito: 500 MB de banco e 1 GB de arquivos | Mensal |

## LGPD

| Tema | Tratamento |
|---|---|
| Dados mínimos | CPF opcional e escondido; e-mail opcional |
| Site público | Consentimento obrigatório; dados usados só para responder |
| Pedido de exclusão | Cliente → "Anonimizar este cliente" (só MasterAdm): remove nome, telefone, e-mail, CPF e observações das OS e da auditoria; mantém o histórico técnico do veículo |
| Pedido de acesso | Histórico em PDF do veículo + dados do cliente |
| Acesso interno | Contas individuais, RLS, auditoria de alterações |
| Testes | Nunca usar dados reais de clientes em desenvolvimento |
| Retenção automática | Pedidos do site respondidos ou arquivados há mais de 12 meses são excluídos todo dia às 03:30, com registro na auditoria |
| OS e fotos | Mantidas (garantia e obrigação fiscal). Exclusão só por anonimização do cliente |

## Teste de integração no servidor real (27/10/2026)

Executado de dentro do próprio banco (extensão `pg_net`, depois removida), passando pelos mesmos endereços que o app usa: login, API de dados e Edge Functions. 45 verificações, todas com o resultado esperado:

| Grupo | Verificado |
|---|---|
| Login | Senha inicial entra; senha errada, senha antiga após troca e conta desativada são recusadas |
| Senha temporária | Sem acesso a dados nem à Gestão de Usuários até trocar |
| Troca de senha | Recusa senha atual errada e senha fraca; **a sessão atual continua válida** e as outras são encerradas |
| Gestão de usuários | Cria mecânico; recusa login duplicado (mesmo com maiúsculas), segundo master, promoção a master, desativar ou redefinir o master |
| Mecânico | Não acessa a Gestão de Usuários, não cria perfis, não muda fotos exigidas; cadastra cliente normalmente |
| Desativação | Login bloqueado; sessão aberta perde acesso às funções e aos dados |
| Redefinir senha / encerrar sessões | Senha temporária nova funciona, a anterior não; sessões encerradas param de funcionar |
| Site público | Envia pedido; não lê clientes nem pedidos |
| Auditoria | Registrou todas as ações, inclusive as negadas |

Bug encontrado e corrigido nesse teste: a troca de senha derrubava a própria sessão do usuário (o MasterAdm cairia logo após criar a senha). A função `change-password` agora troca a senha pela via do próprio usuário. Usuário e dados de teste foram removidos; a auditoria mantém o registro do teste, com uma nota explicativa.

## Testes

| Teste | Onde | Resultado |
|---|---|---|
| 94 testes de permissão e regras | `tests/security_tests.sql` (banco local) e bateria equivalente no Supabase real após cada migração | Todos passaram |
| Fluxo completo da equipe e do site, desktop e celular | `web/tests/e2e_fases3e4_mock.py` (API simulada) | Passou: site, pedido, limite, check-in com 5 fotos e descrição, diagnóstico, orçamento, aprovação, execução, saída, comparação de fotos, documento, fotos exigidas |
| Horário e feriados do site | `web/tests/horario.test.ts` | 9 cenários corretos (incluindo Finados caindo na segunda) |
| Alertas de desempenho do Supabase | Migração 07 | Políticas otimizadas; índices criados nas chaves usadas em consultas |
| Login, senha, usuários, clientes | `web/tests/e2e_mock.py` | Passou |
| Edge Functions | `deno check` + `deno lint` | Sem erros |

Rodar os testes de banco: `npx supabase start` → `npx supabase db reset` → `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/security_tests.sql`. **Nunca em produção.**

## Teste de aceite (depois dos passos 1 a 5)

| # | Faça | Esperado |
|---|---|---|
| 1 | Entrar como `MasterAdm` / senha inicial | Vai direto para "Crie sua senha" |
| 2 | Usuários → Novo usuário | Senha temporária aparece uma vez |
| 3 | Entrar com o mecânico em outro navegador | Troca de senha obrigatória; depois, sem "Usuários" e "Auditoria" |
| 4 | Como mecânico, abrir `/sistema/usuarios` | Volta ao painel |
| 5 | Buscar uma placa nova → cadastrar cliente e veículo → Iniciar check-in | OS criada com número OS-AAAA-NNNNNN |
| 6 | Tirar as fotos pelo celular e concluir | Fotos "Na nuvem"; abrir a OS no computador mostra as mesmas fotos |
| 7 | Diagnóstico → Orçamento → Aprovação → Execução → Saída | OS "Entregue"; documento da OS gera PDF |
| 8 | Enviar um pedido pelo site em aba anônima | Aparece em "Pedidos"; a aba anônima não acessa nada interno |
| 9 | Auditoria | Mostra logins, criação de usuário e alterações |

Se algum passo falhar, anote a mensagem exibida: os erros do sistema dizem o que aconteceu.

## Recuperação do MasterAdm

`npm run recover:master` (exige a chave secret). Redefine a senha, encerra sessões e exige nova troca.

## Limitações conhecidas

| Ponto | Situação |
|---|---|
| PDF | Gerado pela impressão do navegador ("Salvar como PDF"), que funciona em computador, Android e iPhone. Não há botão de download direto |
| Offline | Fotos ficam na fila e sobem ao voltar a internet; textos ficam como rascunho no aparelho. Gravar etapas do check-in exige conexão |
| Indicador "aberto agora" | Reconhece feriados nacionais, de SP e de Guarulhos. Pontos facultativos (ex.: Carnaval) entram em `FECHAMENTOS_EXTRAS` em `web/src/lib/oficina.ts` |
| Senha errada no login | Fica nos logs do Supabase Auth, não na auditoria do sistema |
| Edge Functions | Publicadas e verificadas no código, mas só são exercitadas de verdade no seu primeiro login (teste de aceite) |
| Avisos do Supabase sobre funções chamáveis por usuários logados | Intencionais: cada função verifica quem chama |
