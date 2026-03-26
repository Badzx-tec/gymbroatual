#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.biometric_credentials import (
    normalize_biometric_credential,
)  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sincroniza students.biometria_id a partir de biometrics.external_id"
    )
    parser.add_argument("--mongo-uri", required=True, help="Mongo connection string")
    parser.add_argument("--db-name", required=True, help="Database name")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica as atualizacoes. Sem essa flag o script roda em dry-run.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    client = MongoClient(args.mongo_uri)
    db = client[args.db_name]
    now = datetime.now(timezone.utc)

    summary = {
        "mode": "apply" if args.apply else "dry-run",
        "matched": 0,
        "updated": 0,
        "would_update": 0,
        "skipped": 0,
        "missing_student": 0,
        "missing_external_id": 0,
    }

    cursor = db.biometrics.find(
        {"subject_type": "student"},
        {
            "_id": 1,
            "owner_id": 1,
            "subject_id": 1,
            "student_id": 1,
            "external_id": 1,
        },
    )

    for biometric in cursor:
        external_id = normalize_biometric_credential(biometric.get("external_id"))
        if not external_id:
            summary["missing_external_id"] += 1
            continue

        owner_id = biometric.get("owner_id")
        student_id = biometric.get("subject_id") or biometric.get("student_id")
        if not owner_id or not student_id:
            summary["missing_student"] += 1
            continue

        student = db.students.find_one(
            {"owner_id": owner_id, "student_id": student_id},
            {"_id": 1, "biometria_id": 1},
        )
        if (
            not student
            and biometric.get("student_id")
            and biometric.get("student_id") != student_id
        ):
            student = db.students.find_one(
                {"owner_id": owner_id, "student_id": biometric.get("student_id")},
                {"_id": 1, "biometria_id": 1},
            )

        if not student:
            summary["missing_student"] += 1
            continue

        summary["matched"] += 1

        current_biometria_id = normalize_biometric_credential(
            student.get("biometria_id")
        )
        needs_student_update = current_biometria_id != external_id
        needs_biometric_update = biometric.get("external_id") != external_id

        if not needs_student_update and not needs_biometric_update:
            summary["skipped"] += 1
            continue

        summary["would_update"] += 1
        if not args.apply:
            continue

        db.students.update_one(
            {"_id": student["_id"]},
            {
                "$set": {
                    "biometria_id": external_id,
                    "updated_at": now,
                }
            },
        )
        if needs_biometric_update:
            db.biometrics.update_one(
                {"_id": biometric["_id"]},
                {
                    "$set": {
                        "external_id": external_id,
                        "updated_at": now,
                    }
                },
            )
        summary["updated"] += 1

    print(json.dumps(summary, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
