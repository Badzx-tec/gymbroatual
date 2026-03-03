# Gateway Toletus LiteNet2

Gateway local que conecta a catraca LiteNet2 (TCP 7878) ao SaaS (`/api/turnstiles/*`), com foco em robustez de conexao e decisao por direcao.

## Escopo funcional

- Parse de pacotes LiteNet2 (20 bytes, `0x53 ... 0xC3`).
- Eventos de credencial:
  - `0x0301` RFID
  - `0x0302` Barcode
  - `0x0303` Keypad
  - `0x0306` Biometria
- Eventos operacionais:
  - `0x0304` Passage (`entry`/`exit` + contador)
  - `0x0305` Timeout de liberacao
  - `0x0307` Biometria nao cadastrada
- Comandos de atuacao:
  - `0x0001` Liberar entrada
  - `0x0002` Liberar saida
  - `0x0006` Liberar bidirecional
  - `0x0005` Feedback deny (beep/led)

## Fluxo de decisao (direcao explicita)

1. Gateway recebe evento da catraca.
2. Se evento for credencial (`rfid`, `keypad`, `biometry`):
   - envia para `POST /api/turnstiles/decision`;
   - normaliza resposta para matriz:
     - `allow_entry`
     - `allow_exit`
     - `release_direction` (`entry`, `exit`, `both` ou sem release);
   - envia comando fisico correto na catraca.
3. Se evento for operacional (`passage`):
   - nao chama endpoint de decisao;
   - envia telemetria para `POST /api/turnstiles/events`.

Observacao importante:
- no LiteNet2, a notificacao de biometria (`0x0306`) nao traz lado;
- por isso o gateway usa `TOLETUS_BIOMETRY_DEFAULT_DIRECTION` (padrao `both`).

## Contrato de decisao suportado

O gateway aceita resposta legada e resposta por direcao:

- Legado:
  - `allow: true|false`
  - `direction: entry|exit|both` (opcional)
- Por direcao:
  - `allow_entry: true|false`
  - `allow_exit: true|false`
  - `deny_entry`, `deny_exit`, `allow_both`, `deny_both` (opcionais)
  - `allowed_directions` ou `allow_directions` (lista/string)
  - `command_direction` (forca o lado do comando fisico)

## Variaveis de ambiente (gateway)

- `SAAS_URL`: URL do backend SaaS.
- `DEVICE_ID` ou `GATEWAY_DEVICE_ID`: id do dispositivo.
- `DEVICE_TOKEN` ou `GATEWAY_DEVICE_TOKEN`: token do dispositivo.
- `TOLETUS_SIMULATOR`: `true|false`.
- `TOLETUS_HOST`: IP da catraca.
- `TOLETUS_PORT`: porta TCP (padrao `7878`).
- `TOLETUS_READ_TIMEOUT`: timeout de leitura (segundos).
- `TOLETUS_RECONNECT_DELAY`: atraso de reconexao (segundos).
- `TOLETUS_PROBE_ON_CONNECT`: envia probes ao conectar.
- `TOLETUS_PROBE_ON_TIMEOUT`: envia probe em timeout de leitura.
- `TOLETUS_DEFAULT_DIRECTION`: direcao padrao para credenciais sem lado (`entry|exit|both|unknown`).
- `TOLETUS_BIOMETRY_DEFAULT_DIRECTION`: direcao padrao especifica da biometria (`entry|exit|both|unknown`), padrao `both`.
- `TOLETUS_DENY_DURATION_MS`: duracao do feedback deny.
- `TOLETUS_DENY_BEEP`: padrao de beep no deny.
- `TOLETUS_DENY_LED`: cor/led no deny.
- `SAAS_REQUEST_TIMEOUT`: timeout HTTP para chamadas ao SaaS.

## Docker (local)

```bash
docker compose --profile gateway up -d --build gateway-toletus
docker compose --profile gateway logs -f --tail=200 gateway-toletus
```

## Docker (producao)

```bash
docker compose -f docker-compose.prod.yml --profile gateway up -d --build gateway-toletus
docker compose -f docker-compose.prod.yml logs -f --tail=200 gateway-toletus
```

## Testes operacionais

### 1) Conectividade e handshake

- Esperado em log:
  - `tcp_connecting`
  - `tcp_connected`
  - `tx_sent` com probes (`probe_query_fw`, `probe_query_init_states`)

### 2) Credential -> decisao -> atuacao

Teste RFID, keypad e biometria na catraca.

- Esperado em log:
  - `credential_rx`
  - `decision_rx`
  - `tx_sent` com `release` ou `deny_notify`

### 3) Passagem operacional

Ao ocorrer passagem fisica:

- Esperado em log:
  - `operational_rx` com `op_type=passage`
  - sem chamada de decisao para o evento de passagem

### 4) Matriz de acesso por direcao

Para validar os cenarios A/B/C/D, o SaaS deve responder campos por direcao.

- `allow entry + allow exit` -> release `both` (ou lado do evento).
- `deny entry + allow exit` -> evento entry nega; evento exit libera.
- `allow entry + deny exit` -> evento entry libera; evento exit nega.
- `deny both` -> sempre `deny_notify` (sem release).

## Troubleshooting rapido

- `DEVICE_TOKEN is required`:
  - defina `GATEWAY_DEVICE_TOKEN` no `.env`.
- `ValueError` em timeout/reconnect:
  - use defaults no compose e evite variavel vazia.
- `Name or service not known`:
  - ajuste `SAAS_URL` para URL valida/resolvida no host do gateway.
- Conexao cai com EOF (`IncompleteReadError`):
  - comportamento esperado em placas que fecham socket ocioso;
  - gateway reconecta automaticamente.
- Sem eventos de credencial:
  - confirme IP/porta (`TOLETUS_HOST`, `TOLETUS_PORT`);
  - confirme se outro host nao esta conectado na placa.
