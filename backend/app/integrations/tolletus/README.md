# Tolletus Integration Notes

This repository stores only biometric templates/identifiers returned by Tolletus.
No fingerprint image is stored.

## Implemented modes
- `mock` (default): no physical device required.
- `real` placeholder: `HttpTolletusClient` with extension points for API/SDK calls.

## Data stored
Collection: `biometrics`
- `student_id`
- `provider = "tolletus"`
- `template_encrypted` (Fernet)
- `device_id`
- `external_id`
- `enrolled_at`

## ENV required for production
- `FERNET_KEY`
- `APP_BASE_URL`
- Tolletus endpoint and key (to be mapped when official docs/API are available)

## Extension points
File: `backend/app/integrations/tolletus/client.py`
- Implement `HttpTolletusClient.enroll_start`
- Implement `HttpTolletusClient.enroll_confirm`
- Map provider response fields to `external_id` and template payload

## Rotation of encryption key
1. Generate new key (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)
2. Decrypt/re-encrypt existing templates with migration script
3. Update `FERNET_KEY` in environment
4. Restart backend
