# Implementação: pagamento mensal, login aprimorado e catraca Toletus LiteNet2 (LAN)

## O que foi implementado

### 1) Pagamento mensal da academia com Mercado Pago
- Endpoint novo: `POST /api/payments/academy/subscription/checkout`
- Cria preferência de checkout no Mercado Pago para cobrança mensal da academia.
- Salva ciclo de cobrança em `academy_billing` com `external_reference` no formato:
  - `academy:<academy_id>:YYYY-MM`
- Retorna URL de checkout (`checkout_url`) para o frontend redirecionar o dono da academia.

### 2) Webhook do Mercado Pago estendido para academia
- O webhook existente (`POST /api/webhooks/mercadopago`) agora também trata pagamentos de `external_reference` iniciados por `academy:`.
- Ao aprovar pagamento, atualiza/insere `academy_billing` e calcula `paid_until` (+30 dias).

### 3) Login mais robusto
- Normalização de e-mail (trim + lower-case) no register/login.
- Regra mínima de senha no registro (8 caracteres).
- Proteção contra força bruta no login:
  - `failed_login_attempts`
  - bloqueio temporário (`lock_until`) após tentativas inválidas consecutivas.
- Criação de sessão persistida em `user_sessions` no register/login e cookie httpOnly para sessão.

### 4) Catraca Toletus LiteNet2 por TCP/IP (LAN)
- Endpoint novo: `POST /api/catraca/ilnet2/execute`
- Busca IP/porta da academia (`catraca_ip`, `catraca_port`) e envia comando TCP diretamente.
- Suporta:
  - `raw_hex` (payload binário explícito)
  - mapeamento por variáveis de ambiente (`ILNET2_CMD_*`)
  - fallback textual para ambiente de desenvolvimento.
- Persiste execução em `catraca_commands` com status e resposta do dispositivo.

## Variáveis de ambiente sugeridas

- `MERCADOPAGO_ACCESS_TOKEN`: token de API do Mercado Pago.
- `FRONTEND_URL`: URL pública do frontend para redirects pós-pagamento.
- `BACKEND_PUBLIC_URL`: URL pública do backend para `notification_url` do webhook.
- `CORS_ORIGINS`: lista separada por vírgula de origens permitidas (evitar `*` em produção).
- `LOGIN_MAX_ATTEMPTS` (padrão: 5)
- `LOGIN_LOCK_MINUTES` (padrão: 15)
- `ILNET2_CMD_RELEASE_ENTRY`, `ILNET2_CMD_RELEASE_EXIT`, `ILNET2_CMD_BLOCK`, `ILNET2_CMD_MESSAGE` (hex dos comandos do protocolo LiteNet2)

## Notas de integração LiteNet2
- O endpoint de execução LAN foi preparado para uso com payload binário (`raw_hex`) e por variáveis de ambiente.
- Para produção, use os comandos oficiais do protocolo da catraca LiteNet2 conforme os manuais da Toletus.
- Isso permite evoluir sem alterar código, apenas ajustando variáveis de ambiente.
