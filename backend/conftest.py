"""Test bootstrap.

Sets minimum env vars before `app.*` is imported so Settings validation passes
under pytest. Values are session-scoped and never reused outside tests.
"""

import os

from cryptography.fernet import Fernet

os.environ.setdefault(
    "JWT_SECRET",
    "test_secret_at_least_32_chars_long_for_testing_only_xxxxxxxxxxxx",
)
os.environ.setdefault("FERNET_KEYS", Fernet.generate_key().decode())
