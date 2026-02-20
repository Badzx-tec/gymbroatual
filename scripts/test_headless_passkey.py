#!/usr/bin/env python3
import os
import sys
import json
import uuid
import binascii
from datetime import datetime, timezone
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', 'backend', '.env'))
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'gymbro')

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

student_id = 'std_001'
student = db.students.find_one({'student_id': student_id})
if not student:
    print(f'Student {student_id} not found — criando documento de teste')
    doc = {
        'student_id': student_id,
        'nome': 'Aluno Teste',
        'email': 'teste+std001@gymbro.local',
        'cpf': '000.000.000-00',
        'telefone': '',
        'plano_id': '',
        'tag_rfid': '',
        'biometria_id': '',
        'status': 'ativo',
        'data_vencimento': '',
        'academy_id': 'acad_matriz',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }
    db.students.insert_one(doc)
    student = db.students.find_one({'student_id': student_id})

# create fake credential
cred_id = f'cred_{uuid.uuid4().hex[:12]}'
# public_key placeholder: random bytes base64
pub = binascii.b2a_base64(os.urandom(64)).decode().strip()
entry = {
    'id': cred_id,
    'public_key': pub,
    'created_at': datetime.now(timezone.utc).isoformat(),
    'sign_count': 0,
}

res = db.students.update_one({'student_id': student_id}, {'$push': {'webauthn_credentials': entry}})
if res.modified_count:
    print(f'Inserted credential {cred_id} for student {student_id}')
else:
    print('Failed to insert credential')

student = db.students.find_one({'student_id': student_id}, {'webauthn_credentials': 1, '_id': 0})
print('Current passkeys:')
print(json.dumps(student.get('webauthn_credentials', []), indent=2, ensure_ascii=False))
