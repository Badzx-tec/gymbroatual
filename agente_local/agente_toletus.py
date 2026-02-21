#!/usr/bin/env python3
"""
GymBro - Agente Local para Catraca Toletus LiteNet2
-----------------------------------------------------
Este script roda na rede local da academia (no computador da recepcao)
e faz a ponte entre a catraca Toletus e o servidor GymBro na nuvem.

Fluxo:
1. Escuta conexao TCP na porta 7878 (mesmo protocolo da catraca)
2. Recebe notificacao de ID (RFID, biometria ou teclado)
3. Envia o ID para a API do GymBro na nuvem
4. Recebe resposta de autorizacao
5. Envia comando hex para a catraca liberar/bloquear

Configuracao:
  GYMBRO_API_URL  - URL da API do GymBro na nuvem
  CATRACA_IP      - IP da catraca Toletus na rede local (default: 192.168.1.9)
  CATRACA_PORT    - Porta da catraca (default: 7878)
"""

import socket
import struct
import time
import json
import os
import sys
import logging
from datetime import datetime

try:
    import requests
except ImportError:
    print("Instalando requests...")
    os.system(f"{sys.executable} -m pip install requests")
    import requests

# ============== CONFIGURACAO ==============

GYMBRO_API_URL = os.environ.get("GYMBRO_API_URL", "https://gym-management-23.preview.emergentagent.com")
CATRACA_IP = os.environ.get("CATRACA_IP", "192.168.1.9")
CATRACA_PORT = int(os.environ.get("CATRACA_PORT", "7878"))
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "7878"))

# Protocolo Toletus LiteNet2
PACKET_SIZE = 20
PREFIX = 0x53  # 83
SUFFIX = 0xC3  # 195

# Comandos de Notificacao (catraca -> servidor)
CMD_RFID = 0x0301
CMD_BARCODE = 0x0302
CMD_KEYBOARD = 0x0303
CMD_PASSAGE = 0x0304
CMD_TIMEOUT = 0x0305
CMD_BIOMETRY = 0x0306
CMD_BIO_NOT_FOUND = 0x0307

# Comandos de Funcao (servidor -> catraca)
CMD_RELEASE_ENTRY = 0x0001
CMD_RELEASE_EXIT = 0x0002
CMD_TEMP_MESSAGE = 0x0004
CMD_NOTIFY_USER = 0x0005
CMD_RELEASE_BIDIRECTIONAL = 0x0006

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger("GymBroAgent")

# ============== FUNCOES DO PROTOCOLO TOLETUS ==============

def build_packet(command_id, data=None):
    """Constroi um pacote de 20 bytes no formato Toletus LiteNet2"""
    packet = bytearray(PACKET_SIZE)
    packet[0] = PREFIX
    # Command ID em little-endian (2 bytes)
    packet[1] = command_id & 0xFF
    packet[2] = (command_id >> 8) & 0xFF
    # Data (ate 16 bytes)
    if data:
        for i, byte in enumerate(data[:16]):
            packet[3 + i] = byte
    packet[19] = SUFFIX
    return bytes(packet)


def parse_packet(raw):
    """Faz parse de um pacote de 20 bytes recebido da catraca"""
    if len(raw) < PACKET_SIZE:
        return None
    if raw[0] != PREFIX or raw[19] != SUFFIX:
        return None
    command_id = raw[1] | (raw[2] << 8)
    data = raw[3:19]
    return {"command": command_id, "data": data}


def build_release_entry_packet(message=""):
    """Comando 0x0001 - Libera entrada com mensagem opcional"""
    msg_bytes = message.encode('ascii')[:16].ljust(16, b'\x00')
    return build_packet(CMD_RELEASE_ENTRY, msg_bytes)


def build_release_exit_packet(message=""):
    """Comando 0x0002 - Libera saida"""
    msg_bytes = message.encode('ascii')[:16].ljust(16, b'\x00')
    return build_packet(CMD_RELEASE_EXIT, msg_bytes)


def build_notify_user_packet(duration_ms=2000, beep=1, color=1, show_text=0):
    """Comando 0x0005 - Notifica usuario (beep + LED)"""
    data = bytearray(16)
    # Duration em little-endian (2 bytes)
    data[0] = duration_ms & 0xFF
    data[1] = (duration_ms >> 8) & 0xFF
    data[2] = beep  # 1 = beep normal, 2 = erro
    data[3] = color  # 1=vermelho, 2=verde dir, 5=verde ambos
    data[4] = show_text
    return build_packet(CMD_NOTIFY_USER, data)


def build_temp_message_packet(message):
    """Comando 0x0004 - Mensagem temporaria no display"""
    msg_bytes = message.encode('ascii')[:16].ljust(16, b'\x00')
    return build_packet(CMD_TEMP_MESSAGE, msg_bytes)


def extract_rfid_id(data):
    """Extrai o ID de uma notificacao RFID (texto ASCII de 16 chars)"""
    return data.decode('ascii', errors='ignore').strip('\x00').strip()


def extract_biometry_id(data):
    """Extrai o ID de uma notificacao de biometria (numero de 16 bits)"""
    return str(data[0] | (data[1] << 8))


# ============== COMUNICACAO COM A CATRACA ==============

def send_to_catraca(packet):
    """Envia um pacote para a catraca via TCP"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(5)
            sock.connect((CATRACA_IP, CATRACA_PORT))
            sock.sendall(packet)
            logger.info(f"Pacote enviado para catraca {CATRACA_IP}:{CATRACA_PORT}")
            try:
                response = sock.recv(PACKET_SIZE)
                if response:
                    parsed = parse_packet(response)
                    if parsed:
                        logger.info(f"Resposta da catraca: cmd=0x{parsed['command']:04x}")
                    return response
            except socket.timeout:
                pass
    except Exception as e:
        logger.error(f"Erro ao enviar para catraca: {e}")
    return None


# ============== COMUNICACAO COM A API ==============

def validate_access(tag_id, tipo="rfid"):
    """Envia o ID para a API do GymBro para validacao"""
    try:
        url = f"{GYMBRO_API_URL}/api/access/validate"
        payload = {"tag_id": tag_id, "tipo": tipo}
        logger.info(f"Validando acesso: {payload}")
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            result = response.json()
            logger.info(f"Resposta da API: {result}")
            return result
        else:
            logger.error(f"Erro API: HTTP {response.status_code}")
    except Exception as e:
        logger.error(f"Erro de conexao com API: {e}")
    return {"autorizado": False, "motivo": "Erro de conexao", "aluno": None}


# ============== PROCESSAMENTO DE NOTIFICACOES ==============

def process_notification(parsed):
    """Processa uma notificacao recebida da catraca"""
    cmd = parsed["command"]
    data = parsed["data"]

    if cmd == CMD_RFID:
        tag_id = extract_rfid_id(data)
        logger.info(f"RFID detectado: {tag_id}")
        handle_access(tag_id, "rfid")

    elif cmd == CMD_BARCODE:
        tag_id = extract_rfid_id(data)
        logger.info(f"Codigo de barras: {tag_id}")
        handle_access(tag_id, "barcode")

    elif cmd == CMD_KEYBOARD:
        tag_id = extract_rfid_id(data)
        logger.info(f"Teclado: {tag_id}")
        handle_access(tag_id, "teclado")

    elif cmd == CMD_BIOMETRY:
        bio_id = extract_biometry_id(data)
        logger.info(f"Biometria reconhecida: ID {bio_id}")
        handle_access(bio_id, "biometria")

    elif cmd == CMD_BIO_NOT_FOUND:
        logger.warning("Biometria nao cadastrada")
        # Notifica erro na catraca
        send_to_catraca(build_temp_message_packet("NAO CADASTRADO"))
        send_to_catraca(build_notify_user_packet(
            duration_ms=2000, beep=2, color=1, show_text=1  # vermelho + beep erro
        ))

    elif cmd == CMD_PASSAGE:
        direction = data[0]
        count = data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)
        dir_str = "ENTRADA" if direction == 1 else "SAIDA"
        logger.info(f"Passagem registrada: {dir_str} (total: {count})")

    elif cmd == CMD_TIMEOUT:
        logger.info("Timeout de liberacao - catraca bloqueada novamente")

    else:
        logger.debug(f"Comando desconhecido: 0x{cmd:04x}")


def handle_access(tag_id, tipo):
    """Valida acesso e envia comando para a catraca"""
    result = validate_access(tag_id, tipo)

    if result.get("autorizado"):
        nome = result.get("aluno", "")[:16]
        logger.info(f"ACESSO LIBERADO: {nome}")
        # Envia mensagem temporaria com nome do aluno
        send_to_catraca(build_temp_message_packet(nome.upper()))
        # Libera entrada com nome
        send_to_catraca(build_release_entry_packet(nome.upper()))
        # Notifica com LED verde e beep
        send_to_catraca(build_notify_user_packet(
            duration_ms=2000, beep=1, color=5, show_text=1  # verde ambos lados
        ))
    else:
        motivo = result.get("motivo", "NEGADO")[:16]
        logger.warning(f"ACESSO NEGADO: {motivo}")
        # Mensagem de erro
        send_to_catraca(build_temp_message_packet(motivo.upper()))
        # Notifica com LED vermelho e beep de erro
        send_to_catraca(build_notify_user_packet(
            duration_ms=3000, beep=2, color=1, show_text=1  # vermelho
        ))


# ============== SERVIDOR TCP ==============

def start_server():
    """Inicia o servidor TCP que escuta a catraca"""
    logger.info("=" * 60)
    logger.info("   GymBro - Agente Local v1.0")
    logger.info("=" * 60)
    logger.info(f"API: {GYMBRO_API_URL}")
    logger.info(f"Catraca: {CATRACA_IP}:{CATRACA_PORT}")
    logger.info(f"Escutando na porta: {LISTEN_PORT}")
    logger.info("=" * 60)

    # Testa conexao com a API
    try:
        r = requests.get(f"{GYMBRO_API_URL}/api/health", timeout=5)
        if r.status_code == 200:
            logger.info("Conexao com API GymBro: OK")
        else:
            logger.warning(f"API retornou status {r.status_code}")
    except Exception as e:
        logger.warning(f"Nao foi possivel conectar a API: {e}")

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('0.0.0.0', LISTEN_PORT))
    server.listen(5)
    logger.info(f"Servidor TCP iniciado na porta {LISTEN_PORT}")
    logger.info("Aguardando conexoes da catraca...")

    while True:
        try:
            conn, addr = server.accept()
            logger.info(f"Conexao recebida de {addr}")
            conn.settimeout(30)

            buffer = b""
            while True:
                try:
                    data = conn.recv(PACKET_SIZE)
                    if not data:
                        break
                    buffer += data

                    while len(buffer) >= PACKET_SIZE:
                        raw_packet = buffer[:PACKET_SIZE]
                        buffer = buffer[PACKET_SIZE:]

                        parsed = parse_packet(raw_packet)
                        if parsed:
                            logger.info(f"Pacote recebido: cmd=0x{parsed['command']:04x}")
                            process_notification(parsed)
                        else:
                            logger.warning("Pacote invalido recebido")
                except socket.timeout:
                    break
                except Exception as e:
                    logger.error(f"Erro lendo dados: {e}")
                    break

            conn.close()
            logger.info(f"Conexao com {addr} encerrada")
        except KeyboardInterrupt:
            logger.info("Encerrando agente...")
            break
        except Exception as e:
            logger.error(f"Erro no servidor: {e}")
            time.sleep(1)

    server.close()
    logger.info("Agente encerrado")


if __name__ == "__main__":
    start_server()
