# GymBro - Agente Local para Catraca Toletus LiteNet2

## Sobre
Este agente roda no computador da recepcao da academia (rede local) e faz a ponte entre a catraca Toletus LiteNet2 e o servidor GymBro na nuvem.

## Requisitos
- Python 3.8+
- Biblioteca `requests`
- Acesso a rede local onde esta a catraca
- Acesso a internet para comunicar com o servidor GymBro

## Instalacao
```bash
pip install requests
```

## Configuracao (variaveis de ambiente)
```bash
export GYMBRO_API_URL="https://seu-servidor.com"
export CATRACA_IP="192.168.1.9"
export CATRACA_PORT="7878"
export LISTEN_PORT="7878"
```

## Execucao
```bash
python agente_toletus.py
```

## Fluxo de Operacao
1. O aluno apresenta o cartao RFID, biometria ou digita no teclado
2. A catraca envia o ID via TCP para o Agente Local
3. O Agente consulta a API do GymBro na nuvem
4. A nuvem valida a assinatura e responde
5. O Agente envia o comando hex de liberacao/bloqueio para a catraca

## Protocolo Toletus
- Porta TCP: 7878
- Pacotes de 20 bytes fixos
- Prefixo: 0x53 / Sufixo: 0xC3
- Notificacoes: RFID (0x0301), Biometria (0x0306), Teclado (0x0303)
- Comandos: Libera entrada (0x0001), Libera saida (0x0002), Notifica (0x0005)

## Arquitetura
```
[Catraca Toletus] <--TCP/LAN--> [Agente Local] <--HTTPS/Internet--> [GymBro Cloud]
  192.168.1.9:7878              PC Recepcao                    DigitalOcean VPS
```
