"""
Modul Database Relasional SQLite untuk SIMRS Biometric Queue Testbed.
Menyimpan profil identitas biometrik pasien, status antrean poliklinik,
dan log pengujian verifikasi wajah secara persisten di `dataset/simrs_biometric.db`.
Seluruh skema rekam medis klinis, gejala, alergi, dan resep obat telah dihapus.
"""

from __future__ import annotations

import csv
import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("simrs.database")

APP_DIR = Path(__file__).resolve().parent
BACKEND_DIR = APP_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATASET_DIR = PROJECT_ROOT / "dataset"

SQLITE_DB_PATH = DATASET_DIR / "simrs_biometric.db"
METADATA_JSON_PATH = DATASET_DIR / "metadata.json"
METADATA_CSV_PATH = DATASET_DIR / "metadata.csv"
ATTENDANCE_LOG_PATH = DATASET_DIR / "local_attendance_log.json"
QUEUE_STATE_PATH = DATASET_DIR / "queue_state.json"

_DB_LOCK = threading.RLock()
_INITIALIZED = False

DEFAULT_POLI_SEED: list[tuple[str, str, int, int]] = [
    ("PD", "Poli Penyakit Dalam", 2, 5),
    ("UM", "Poli Umum", 4, 7),
    ("JT", "Poli Jantung", 1, 3),
    ("PR", "Poli Paru & Pernapasan", 2, 4),
    ("SR", "Poli Saraf (Neurologi)", 1, 2),
    ("MT", "Poli Mata", 3, 5),
    ("GG", "Poli Gigi & Mulut", 2, 4),
    ("TH", "Poli THT", 1, 3),
    ("KK", "Poli Kulit & Kelamin", 2, 4),
    ("OR", "Poli Ortopedi", 1, 2),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(str(SQLITE_DB_PATH), timeout=15.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn
    except sqlite3.DatabaseError as err:
        logger.warning("File SQLite rusak (%s), membangun ulang skema bersih...", err)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        for suffix in ("", "-wal", "-shm"):
            p = Path(f"{SQLITE_DB_PATH}{suffix}")
            if p.exists():
                p.unlink(missing_ok=True)
        conn = sqlite3.connect(str(SQLITE_DB_PATH), timeout=15.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn


def _migrate_clean_testbed_schema(conn: sqlite3.Connection) -> None:
    """
    Menghapus tabel `medical_records` serta kolom-kolom medis (allergies,
    chronic_conditions, medical_notes, blood_type, consent_*) dari database
    lama apabila masih ada.
    """
    conn.execute("DROP TABLE IF EXISTS medical_records;")

    patient_cols = {
        str(r["name"])
        for r in conn.execute("PRAGMA table_info(patients)").fetchall()
    }
    legacy_medical_cols = {
        "allergies",
        "chronic_conditions",
        "medical_notes",
        "blood_type",
        "consent_accepted",
        "consent_timestamp",
    }
    if patient_cols and (patient_cols & legacy_medical_cols):
        logger.info("Membersihkan kolom medis lama dari tabel `patients`...")
        conn.executescript(
            """
            PRAGMA foreign_keys = OFF;
            CREATE TABLE IF NOT EXISTS patients_clean (
                person_id TEXT PRIMARY KEY,
                canonical_person_id TEXT NOT NULL DEFAULT '',
                no_rm TEXT NOT NULL,
                nim TEXT,
                nik TEXT,
                full_name TEXT NOT NULL,
                gender TEXT NOT NULL DEFAULT 'L',
                gender_label TEXT NOT NULL DEFAULT 'Laki-laki',
                age INTEGER NOT NULL DEFAULT 30,
                poliklinik TEXT NOT NULL DEFAULT 'Poli Umum',
                dokter TEXT NOT NULL DEFAULT 'dr. Sinta Maharani',
                enrolled_image TEXT,
                positive_test_image TEXT,
                enrolled_poses_count INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO patients_clean (
                person_id, canonical_person_id, no_rm, nim, nik, full_name,
                gender, gender_label, age, poliklinik, dokter, enrolled_image,
                positive_test_image, enrolled_poses_count, created_at, updated_at
            )
            SELECT
                person_id,
                COALESCE(NULLIF(canonical_person_id, ''), person_id),
                no_rm,
                COALESCE(nim, no_rm),
                COALESCE(nik, '3273010000000000'),
                full_name,
                gender,
                gender_label,
                age,
                poliklinik,
                dokter,
                enrolled_image,
                positive_test_image,
                COALESCE(enrolled_poses_count, 1),
                created_at,
                updated_at
            FROM patients;
            DROP TABLE patients;
            ALTER TABLE patients_clean RENAME TO patients;
            PRAGMA foreign_keys = ON;
            """
        )

    log_cols = {
        str(r["name"])
        for r in conn.execute("PRAGMA table_info(attendance_logs)").fetchall()
    }
    if "allergies" in log_cols:
        logger.info("Membersihkan kolom `allergies` dari tabel `attendance_logs`...")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS attendance_logs_clean (
                attendance_id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                person_id TEXT NOT NULL,
                no_rm TEXT NOT NULL,
                full_name TEXT NOT NULL,
                gender TEXT,
                poliklinik TEXT NOT NULL,
                queue_number TEXT NOT NULL,
                status TEXT NOT NULL,
                verification_method TEXT NOT NULL DEFAULT 'BIOMETRIC_FACE',
                similarity REAL NOT NULL DEFAULT 0.0
            );
            INSERT OR IGNORE INTO attendance_logs_clean (
                attendance_id, timestamp, person_id, no_rm, full_name,
                gender, poliklinik, queue_number, status, verification_method, similarity
            )
            SELECT
                attendance_id, timestamp, person_id, no_rm, full_name,
                gender, poliklinik, queue_number, status, verification_method, similarity
            FROM attendance_logs;
            DROP TABLE attendance_logs;
            ALTER TABLE attendance_logs_clean RENAME TO attendance_logs;
            """
        )


def init_sqlite_db() -> None:
    """Inisialisasi skema tabel SQLite untuk Biometric Queue Testbed."""
    global _INITIALIZED
    with _DB_LOCK:
        if _INITIALIZED and SQLITE_DB_PATH.exists():
            return

        with get_connection() as conn:
            _migrate_clean_testbed_schema(conn)
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS patients (
                    person_id TEXT PRIMARY KEY,
                    canonical_person_id TEXT NOT NULL DEFAULT '',
                    no_rm TEXT NOT NULL,
                    nim TEXT,
                    nik TEXT,
                    full_name TEXT NOT NULL,
                    gender TEXT NOT NULL DEFAULT 'L',
                    gender_label TEXT NOT NULL DEFAULT 'Laki-laki',
                    age INTEGER NOT NULL DEFAULT 30,
                    poliklinik TEXT NOT NULL DEFAULT 'Poli Umum',
                    dokter TEXT NOT NULL DEFAULT 'dr. Sinta Maharani',
                    enrolled_image TEXT,
                    positive_test_image TEXT,
                    enrolled_poses_count INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_patients_no_rm ON patients(no_rm);
                CREATE INDEX IF NOT EXISTS idx_patients_nik ON patients(nik);
                CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients(full_name);

                CREATE TABLE IF NOT EXISTS attendance_logs (
                    attendance_id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    person_id TEXT NOT NULL,
                    no_rm TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    gender TEXT,
                    poliklinik TEXT NOT NULL,
                    queue_number TEXT NOT NULL,
                    status TEXT NOT NULL,
                    verification_method TEXT NOT NULL DEFAULT 'BIOMETRIC_FACE',
                    similarity REAL NOT NULL DEFAULT 0.0
                );

                CREATE INDEX IF NOT EXISTS idx_attendance_logs_timestamp ON attendance_logs(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_attendance_logs_no_rm ON attendance_logs(no_rm);

                CREATE TABLE IF NOT EXISTS poli_queues (
                    prefix TEXT PRIMARY KEY,
                    poliklinik TEXT NOT NULL,
                    serving_sequence INTEGER NOT NULL,
                    issued_sequence INTEGER NOT NULL,
                    serving_status TEXT NOT NULL DEFAULT 'DIPANGGIL',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS queue_slots (
                    prefix TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    no_rm TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    ticket_json TEXT,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (prefix, sequence)
                );

                CREATE INDEX IF NOT EXISTS idx_queue_slots_no_rm ON queue_slots(no_rm);
                """
            )
            conn.commit()

        _seed_from_json_files_if_needed()
        _INITIALIZED = True


def _seed_from_json_files_if_needed() -> None:
    """Seeding subjek uji biometrik dari metadata.json dan antrean awal poliklinik."""
    now = _now_iso()
    with _DB_LOCK, get_connection() as conn:
        if METADATA_JSON_PATH.exists():
            try:
                raw_meta = json.loads(METADATA_JSON_PATH.read_text(encoding="utf-8"))
                subjects = raw_meta.get("subjects", [])
                for s in subjects:
                    pid = str(s.get("person_id") or "").strip()
                    if not pid:
                        continue
                    canonical_pid = str(s.get("canonical_person_id") or pid).strip()
                    no_rm = str(s.get("no_rm") or s.get("nim") or pid).strip()
                    gender_raw = str(s.get("gender") or "L").strip()
                    gender_code = "L" if gender_raw in ("L", "Laki-laki") else "P"
                    gender_label = "Laki-laki" if gender_code == "L" else "Perempuan"

                    exists = conn.execute(
                        "SELECT 1 FROM patients WHERE person_id = ?",
                        (pid,),
                    ).fetchone()

                    if not exists:
                        conn.execute(
                            """
                            INSERT INTO patients (
                                person_id, canonical_person_id, no_rm, nim, nik, full_name,
                                gender, gender_label, age, poliklinik, dokter,
                                enrolled_image, positive_test_image, enrolled_poses_count,
                                created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                pid,
                                canonical_pid,
                                no_rm,
                                no_rm,
                                str(s.get("nik") or "3273010000000000"),
                                str(s.get("full_name") or pid),
                                gender_code,
                                gender_label,
                                int(s.get("age") or 30),
                                str(s.get("poliklinik") or "Poli Umum"),
                                str(s.get("dokter") or "dr. Sinta Maharani"),
                                str(
                                    s.get("enrolled_image")
                                    or f"images/enrolled/{pid}.jpg"
                                ),
                                str(
                                    s.get("positive_test_image")
                                    or f"images/enrolled/{pid}.jpg"
                                ),
                                int(s.get("enrolled_poses_count") or 1),
                                now,
                                now,
                            ),
                        )
                    else:
                        conn.execute(
                            """
                            UPDATE patients
                            SET canonical_person_id = ?,
                                no_rm = ?,
                                nim = ?
                            WHERE person_id = ?
                            """,
                            (canonical_pid, no_rm, no_rm, pid),
                        )
            except Exception as err:
                logger.error("Gagal melakukan seeding awal dari metadata.json: %s", err)

        # Pastikan subjek fallback RM-2026-501B selalu terdaftar
        fallback_exists = conn.execute(
            "SELECT 1 FROM patients WHERE upper(no_rm) = 'RM-2026-501B' OR upper(person_id) = 'RM-2026-501B'"
        ).fetchone()
        if not fallback_exists:
            conn.execute(
                """
                INSERT OR IGNORE INTO patients (
                    person_id, canonical_person_id, no_rm, nim, nik, full_name,
                    gender, gender_label, age, poliklinik, dokter,
                    enrolled_image, positive_test_image, enrolled_poses_count,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "RM-2026-501B",
                    "RM-2026-501B",
                    "RM-2026-501B",
                    "RM-2026-501B",
                    "3273012304070001",
                    "Candra Hidayattuloh",
                    "L",
                    "Laki-laki",
                    19,
                    "Poli Umum",
                    "dr. Sinta Maharani",
                    "images/enrolled/RM-2026-501B.jpg",
                    "images/enrolled/RM-2026-501B.jpg",
                    1,
                    now,
                    now,
                ),
            )

        log_count = conn.execute("SELECT COUNT(*) FROM attendance_logs").fetchone()[0]
        if log_count == 0 and ATTENDANCE_LOG_PATH.exists():
            try:
                logs = json.loads(ATTENDANCE_LOG_PATH.read_text(encoding="utf-8"))
                for item in logs:
                    if not isinstance(item, dict):
                        continue
                    att_id = str(item.get("attendanceId") or "")
                    if not att_id:
                        continue
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO attendance_logs (
                            attendance_id, timestamp, person_id, no_rm, full_name,
                            gender, poliklinik, queue_number, status,
                            verification_method, similarity
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            att_id,
                            str(item.get("Timestamp") or now),
                            str(item.get("ID") or item.get("NoRM") or "-"),
                            str(item.get("NoRM") or item.get("ID") or "-"),
                            str(item.get("FullName") or "-"),
                            str(item.get("Gender") or "-"),
                            str(item.get("Poliklinik") or "Poli Umum"),
                            str(item.get("QueueNumber") or "-"),
                            str(item.get("Status") or "QUEUE_ISSUED"),
                            str(item.get("VerificationMethod") or "BIOMETRIC_FACE"),
                            float(item.get("Similarity") or 0.0),
                        ),
                    )
            except Exception as err:
                logger.error("Gagal melakukan seeding awal attendance_logs: %s", err)

        q_count = conn.execute("SELECT COUNT(*) FROM poli_queues").fetchone()[0]
        if q_count == 0:
            for prefix, poli_name, serving_seq, issued_seq in DEFAULT_POLI_SEED:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO poli_queues (
                        prefix, poliklinik, serving_sequence, issued_sequence, serving_status, updated_at
                    ) VALUES (?, ?, ?, ?, 'DIPANGGIL', ?)
                    """,
                    (prefix, poli_name, serving_seq, issued_seq, now),
                )

        conn.commit()


def _row_to_patient_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    canonical_pid = (
        row["canonical_person_id"]
        if "canonical_person_id" in keys and row["canonical_person_id"]
        else row["person_id"]
    )
    return {
        "person_id": row["person_id"],
        "canonical_person_id": canonical_pid,
        "no_rm": row["no_rm"],
        "rm_number": row["no_rm"],
        "rmNumber": row["no_rm"],
        "nim": row["nim"] or row["no_rm"],
        "nik": row["nik"] or "-",
        "full_name": row["full_name"],
        "fullName": row["full_name"],
        "gender": row["gender"],
        "gender_label": row["gender_label"],
        "age": int(row["age"]),
        "poliklinik": row["poliklinik"],
        "default_poli": row["poliklinik"],
        "defaultPoli": row["poliklinik"],
        "dokter": row["dokter"],
        "enrolled_image": row["enrolled_image"]
        or f"images/enrolled/{row['person_id']}.jpg",
        "positive_test_image": row["positive_test_image"]
        or f"images/enrolled/{row['person_id']}.jpg",
        "enrolled_poses_count": int(row["enrolled_poses_count"] or 1),
    }


def get_all_patients_map() -> dict[str, dict[str, Any]]:
    """Mengambil seluruh subjek/pasien terdaftar dari SQLite."""
    init_sqlite_db()
    with _DB_LOCK, get_connection() as conn:
        patient_rows = conn.execute(
            "SELECT * FROM patients ORDER BY rowid ASC"
        ).fetchall()

        result: dict[str, dict[str, Any]] = {}
        for p in patient_rows:
            pid = p["person_id"]
            result[pid] = _row_to_patient_dict(p)

        linked_by_canonical: dict[str, list[str]] = {}
        for pid, info in result.items():
            linked_by_canonical.setdefault(info["canonical_person_id"], []).append(pid)
        for pid, info in result.items():
            if info["canonical_person_id"] == pid:
                face_ids = linked_by_canonical.get(pid, [pid])
                info["linked_face_ids"] = sorted(
                    set(face_ids), key=lambda x: (x != pid, x)
                )
        return result


def get_patient_by_id_or_rm(identifier: str) -> dict[str, Any] | None:
    init_sqlite_db()
    norm = identifier.strip()
    if not norm:
        return None
    with _DB_LOCK, get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM patients WHERE lower(person_id) = lower(?) OR lower(no_rm) = lower(?) ORDER BY rowid ASC LIMIT 1",
            (norm, norm),
        ).fetchone()
        if not row:
            return None
        return _row_to_patient_dict(row)


def search_patient_query(query: str) -> dict[str, Any] | None:
    """Mencari pasien di SQLite berdasarkan No. RM, NIK, Person ID, atau Nama Lengkap."""
    init_sqlite_db()
    norm = query.strip()
    if not norm:
        return None
    with _DB_LOCK, get_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM patients
            WHERE lower(person_id) = lower(?)
               OR lower(no_rm) = lower(?)
               OR lower(nik) = lower(?)
            ORDER BY rowid ASC
            LIMIT 1
            """,
            (norm, norm, norm),
        ).fetchone()

        if not row:
            like_pat = f"%{norm}%"
            row = conn.execute(
                """
                SELECT * FROM patients
                WHERE lower(full_name) LIKE lower(?)
                   OR lower(no_rm) LIKE lower(?)
                   OR lower(nik) LIKE lower(?)
                ORDER BY rowid ASC
                LIMIT 1
                """,
                (like_pat, like_pat, like_pat),
            ).fetchone()

        if not row:
            return None
        return _row_to_patient_dict(row)


def upsert_patient(resp_payload: dict[str, Any]) -> dict[str, Any]:
    """Menyimpan atau memperbarui pasien baru ke SQLite."""
    init_sqlite_db()
    now = _now_iso()
    person_id = str(resp_payload["personId"]).strip()
    canonical_pid = str(resp_payload.get("canonicalPersonId") or person_id).strip()
    no_rm = str(resp_payload.get("noRm") or person_id).strip()
    gender_label = str(resp_payload.get("gender") or "Laki-laki").strip()
    gender_code = "L" if gender_label in ("L", "Laki-laki") else "P"
    gender_full = "Laki-laki" if gender_code == "L" else "Perempuan"

    with _DB_LOCK, get_connection() as conn:
        conn.execute(
            """
            INSERT INTO patients (
                person_id, canonical_person_id, no_rm, nim, nik, full_name,
                gender, gender_label, age, poliklinik, dokter,
                enrolled_image, positive_test_image, enrolled_poses_count,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(person_id) DO UPDATE SET
                canonical_person_id = excluded.canonical_person_id,
                no_rm = excluded.no_rm,
                nik = excluded.nik,
                full_name = excluded.full_name,
                gender = excluded.gender,
                gender_label = excluded.gender_label,
                age = excluded.age,
                poliklinik = excluded.poliklinik,
                dokter = excluded.dokter,
                enrolled_poses_count = excluded.enrolled_poses_count,
                updated_at = excluded.updated_at
            """,
            (
                person_id,
                canonical_pid,
                no_rm,
                no_rm,
                str(resp_payload.get("nik") or "3273010000000000"),
                str(resp_payload["fullName"]),
                gender_code,
                gender_full,
                int(resp_payload.get("age") or 30),
                str(resp_payload.get("poliklinik") or "Poli Umum"),
                str(resp_payload.get("dokter") or "dr. Sinta Maharani"),
                f"images/enrolled/{person_id}.jpg",
                f"images/enrolled/{person_id}.jpg",
                int(resp_payload.get("enrolledPosesCount") or 1),
                now,
                now,
            ),
        )
        conn.commit()

    _sync_sqlite_to_metadata_files()
    return get_patient_by_id_or_rm(person_id) or {}


def insert_attendance_log(item: dict[str, Any]) -> None:
    """Menyimpan log verifikasi & antrean ke tabel `attendance_logs` SQLite."""
    init_sqlite_db()
    now = _now_iso()
    att_id = str(item.get("attendanceId") or f"ATT-{now}")
    similarity = float(item.get("Similarity") or 0.0)
    with _DB_LOCK, get_connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO attendance_logs (
                attendance_id, timestamp, person_id, no_rm, full_name,
                gender, poliklinik, queue_number, status,
                verification_method, similarity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                att_id,
                str(item.get("Timestamp") or now),
                str(item.get("ID") or item.get("NoRM") or "-"),
                str(item.get("NoRM") or item.get("ID") or "-"),
                str(item.get("FullName") or "-"),
                str(item.get("Gender") or "-"),
                str(item.get("Poliklinik") or "Poli Umum"),
                str(item.get("QueueNumber") or "-"),
                str(item.get("Status") or "QUEUE_ISSUED"),
                str(item.get("VerificationMethod") or "BIOMETRIC_FACE"),
                similarity,
            ),
        )
        conn.commit()

    logs = get_attendance_logs(limit=150)
    try:
        ATTENDANCE_LOG_PATH.write_text(
            json.dumps(logs, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except OSError as err:
        logger.warning("Gagal menyinkronkan log ke local_attendance_log.json: %s", err)


def get_attendance_logs(limit: int = 150) -> list[dict[str, Any]]:
    init_sqlite_db()
    with _DB_LOCK, get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM attendance_logs ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            {
                "attendanceId": r["attendance_id"],
                "Timestamp": r["timestamp"],
                "ID": r["person_id"],
                "NoRM": r["no_rm"],
                "FullName": r["full_name"],
                "Gender": r["gender"],
                "Poliklinik": r["poliklinik"],
                "QueueNumber": r["queue_number"],
                "Status": r["status"],
                "VerificationMethod": r["verification_method"],
                "Similarity": round(float(r["similarity"]), 2),
            }
            for r in rows
        ]


def save_queue_state_to_sqlite(
    queue_counter: dict[str, int],
    serving_counter: dict[str, int],
    serving_status: dict[str, str],
    queue_patients: dict[str, dict[int, dict[str, str]]],
    patient_active_tickets: dict[str, dict[str, Any]],
    poliklinik_config: dict[str, dict[str, str]],
) -> None:
    """Menyimpan state antrean poliklinik dan slot tiket aktif ke SQLite."""
    init_sqlite_db()
    now = _now_iso()
    prefix_to_poli = {
        cfg["prefix"]: poli_name for poli_name, cfg in poliklinik_config.items()
    }
    with _DB_LOCK, get_connection() as conn:
        for prefix, issued_seq in queue_counter.items():
            serving_seq = serving_counter.get(prefix, 1)
            status = serving_status.get(prefix, "DIPANGGIL")
            poli_name = prefix_to_poli.get(prefix, prefix)
            conn.execute(
                """
                INSERT INTO poli_queues (
                    prefix, poliklinik, serving_sequence, issued_sequence, serving_status, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(prefix) DO UPDATE SET
                    poliklinik = excluded.poliklinik,
                    serving_sequence = excluded.serving_sequence,
                    issued_sequence = excluded.issued_sequence,
                    serving_status = excluded.serving_status,
                    updated_at = excluded.updated_at
                """,
                (prefix, poli_name, int(serving_seq), int(issued_seq), status, now),
            )

        conn.execute("UPDATE queue_slots SET is_active = 0")
        for prefix, seq_map in queue_patients.items():
            for seq, pinfo in seq_map.items():
                no_rm = str(pinfo.get("noRm") or "-")
                full_name = str(pinfo.get("fullName") or f"Pasien {prefix}-{seq:03d}")
                active_ticket = patient_active_tickets.get(no_rm.upper())
                ticket_json = (
                    json.dumps(active_ticket, ensure_ascii=False)
                    if active_ticket
                    else None
                )
                is_active = 1 if active_ticket else 0
                conn.execute(
                    """
                    INSERT INTO queue_slots (
                        prefix, sequence, no_rm, full_name, ticket_json, is_active, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(prefix, sequence) DO UPDATE SET
                        no_rm = excluded.no_rm,
                        full_name = excluded.full_name,
                        ticket_json = excluded.ticket_json,
                        is_active = excluded.is_active,
                        updated_at = excluded.updated_at
                    """,
                    (prefix, int(seq), no_rm, full_name, ticket_json, is_active, now),
                )
        conn.commit()


def load_queue_state_from_sqlite() -> dict[str, Any] | None:
    """Memuat state antrean poliklinik dan tiket aktif dari SQLite."""
    init_sqlite_db()
    with _DB_LOCK, get_connection() as conn:
        q_rows = conn.execute("SELECT * FROM poli_queues").fetchall()
        if not q_rows:
            return None

        queue_counter: dict[str, int] = {}
        serving_counter: dict[str, int] = {}
        serving_status: dict[str, str] = {}
        for r in q_rows:
            pfx = r["prefix"]
            queue_counter[pfx] = int(r["issued_sequence"])
            serving_counter[pfx] = int(r["serving_sequence"])
            serving_status[pfx] = str(r["serving_status"])

        slot_rows = conn.execute("SELECT * FROM queue_slots").fetchall()
        queue_patients: dict[str, dict[int, dict[str, str]]] = {}
        patient_active_tickets: dict[str, dict[str, Any]] = {}
        for s in slot_rows:
            pfx = s["prefix"]
            seq = int(s["sequence"])
            no_rm = str(s["no_rm"])
            full_name = str(s["full_name"])
            queue_patients.setdefault(pfx, {})[seq] = {
                "fullName": full_name,
                "noRm": no_rm,
            }
            if s["is_active"] and s["ticket_json"]:
                try:
                    t_obj = json.loads(s["ticket_json"])
                    if isinstance(t_obj, dict):
                        patient_active_tickets[no_rm.upper()] = t_obj
                except json.JSONDecodeError as err:
                    logger.warning(
                        "Format JSON tiket antrean tidak valid pada slot %s-%s: %s",
                        pfx,
                        seq,
                        err,
                    )

        return {
            "queue_counter": queue_counter,
            "serving_counter": serving_counter,
            "serving_status": serving_status,
            "queue_patients": queue_patients,
            "patient_active_tickets": patient_active_tickets,
        }


def get_database_diagnostics() -> dict[str, Any]:
    """Mengembalikan informasi diagnostik & statistik tabel SQLite."""
    init_sqlite_db()
    with _DB_LOCK, get_connection() as conn:
        patients_count = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
        logs_count = conn.execute(
            "SELECT COUNT(*) FROM attendance_logs"
        ).fetchone()[0]
        queues_count = conn.execute("SELECT COUNT(*) FROM poli_queues").fetchone()[0]
        active_slots_count = conn.execute(
            "SELECT COUNT(*) FROM queue_slots WHERE is_active = 1"
        ).fetchone()[0]
        journal_mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]

    size_bytes = SQLITE_DB_PATH.stat().st_size if SQLITE_DB_PATH.exists() else 0
    return {
        "engine": f"SQLite {sqlite3.sqlite_version}",
        "dbPath": "dataset/simrs_biometric.db",
        "sizeKB": round(size_bytes / 1024.0, 2),
        "sizeKb": round(size_bytes / 1024.0, 2),
        "journalMode": str(journal_mode).upper(),
        "status": "CONNECTED",
        "tables": {
            "patients": int(patients_count),
            "attendance_logs": int(logs_count),
            "poli_queues": int(queues_count),
            "active_queue_slots": int(active_slots_count),
        },
    }


def _sync_sqlite_to_metadata_files() -> None:
    """Menjaga file metadata.json dan metadata.csv tetap sinkron dengan isi SQLite."""
    try:
        subjects_map = get_all_patients_map()
        subjects = list(subjects_map.values())
        data = {
            "collection_id_default": "attendance-faces",
            "match_threshold_default": 80.0,
            "total_enrolled": len(subjects),
            "subjects": subjects,
        }
        METADATA_JSON_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        fieldnames = [
            "person_id",
            "canonical_person_id",
            "no_rm",
            "nik",
            "full_name",
            "gender",
            "age",
            "poliklinik",
            "dokter",
            "enrolled_image",
            "positive_test_image",
        ]
        with open(METADATA_CSV_PATH, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(subjects)
    except Exception as err:
        logger.error("Gagal menyinkronkan SQLite ke file metadata.json/csv: %s", err)
