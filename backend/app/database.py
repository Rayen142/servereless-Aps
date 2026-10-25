"""Modul Database SQLite untuk SIMRS Biometrik (Penyimpanan Sementara Lokal).

Menyediakan penyimpanan relasional terstruktur pada `dataset/simrs_biometric.db` dengan tabel:
  1. `patients`         : Data induk pasien & profil biometrik wajah
  2. `medical_records`  : Riwayat kunjungan & pemeriksaan dokter (RME)
  3. `attendance_logs`  : Log verifikasi biometrik & penerbitan tiket antrean
  4. `poli_queues`      : Counter & status antrean per poliklinik
  5. `queue_slots`      : Slot antrean pasien aktif (proteksi anti-dobel order)
"""

from __future__ import annotations

import csv
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATASET_DIR = Path(__file__).resolve().parent.parent.parent / "dataset"
SQLITE_DB_PATH = DATASET_DIR / "simrs_biometric.db"
METADATA_JSON_PATH = DATASET_DIR / "metadata.json"
METADATA_CSV_PATH = DATASET_DIR / "metadata.csv"
ATTENDANCE_LOG_PATH = DATASET_DIR / "local_attendance_log.json"
QUEUE_STATE_PATH = DATASET_DIR / "queue_state.json"

_DB_LOCK = threading.RLock()
_INITIALIZED = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(SQLITE_DB_PATH), timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_sqlite_db() -> None:
    """Membuat skema tabel SQLite dan melakukan migrasi data awal dari JSON jika tabel masih kosong."""
    global _INITIALIZED
    with _DB_LOCK:
        if _INITIALIZED and SQLITE_DB_PATH.exists():
            return

        with get_connection() as conn:
            # Pastikan kolom birth_date dan medical_notes ada jika tabel dibuat sebelumnya
            try:
                conn.execute("ALTER TABLE patients ADD COLUMN birth_date TEXT DEFAULT '1995-01-01'")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE patients ADD COLUMN medical_notes TEXT DEFAULT ''")
            except Exception:
                pass

            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS patients (
                    person_id TEXT PRIMARY KEY,
                    no_rm TEXT UNIQUE NOT NULL,
                    nim TEXT,
                    nik TEXT,
                    full_name TEXT NOT NULL,
                    birth_date TEXT NOT NULL DEFAULT '1995-01-01',
                    gender TEXT NOT NULL DEFAULT 'L',
                    gender_label TEXT NOT NULL DEFAULT 'Laki-laki',
                    age INTEGER NOT NULL DEFAULT 30,
                    blood_type TEXT NOT NULL DEFAULT 'O+',
                    insurance TEXT NOT NULL DEFAULT 'BPJS Kesehatan',
                    allergies TEXT NOT NULL DEFAULT 'Tidak Ada Alergi',
                    chronic_conditions TEXT NOT NULL DEFAULT 'Tidak Ada',
                    poliklinik TEXT NOT NULL DEFAULT 'Poli Umum',
                    dokter TEXT NOT NULL DEFAULT 'dr. Sinta Maharani',
                    medical_notes TEXT NOT NULL DEFAULT '',
                    enrolled_image TEXT,
                    positive_test_image TEXT,
                    enrolled_poses_count INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_patients_no_rm ON patients(no_rm);
                CREATE INDEX IF NOT EXISTS idx_patients_nik ON patients(nik);
                CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients(full_name);

                CREATE TABLE IF NOT EXISTS medical_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    person_id TEXT NOT NULL,
                    no_rm TEXT NOT NULL,
                    visit_date TEXT NOT NULL,
                    poliklinik TEXT NOT NULL,
                    doctor TEXT NOT NULL,
                    diagnosis TEXT NOT NULL,
                    treatment TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (person_id) REFERENCES patients(person_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_medical_records_person_id ON medical_records(person_id);
                CREATE INDEX IF NOT EXISTS idx_medical_records_no_rm ON medical_records(no_rm);

                CREATE TABLE IF NOT EXISTS attendance_logs (
                    attendance_id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    person_id TEXT NOT NULL,
                    no_rm TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    gender TEXT,
                    allergies TEXT,
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

                CREATE INDEX IF NOT EXISTS idx_queue_slots_active_rm ON queue_slots(no_rm, is_active);
                """
            )
            conn.commit()

        _seed_from_json_files_if_needed()
        _INITIALIZED = True


def _seed_from_json_files_if_needed() -> None:
    """Mengimpor data awal dari metadata.json dan local_attendance_log.json ke SQLite."""
    now = _now_iso()
    with _DB_LOCK, get_connection() as conn:
        # 1. Seed patients & medical_records dari metadata.json
        if METADATA_JSON_PATH.exists():
            try:
                raw_meta = json.loads(METADATA_JSON_PATH.read_text(encoding="utf-8"))
                subjects = raw_meta.get("subjects", [])
                for s in subjects:
                    pid = str(s.get("person_id") or "").strip()
                    if not pid:
                        continue
                    no_rm = str(s.get("no_rm") or s.get("nim") or pid).strip()
                    gender_raw = str(s.get("gender") or "L").strip()
                    gender_code = "L" if gender_raw in ("L", "Laki-laki") else "P"
                    gender_label = (
                        "Laki-laki" if gender_code == "L" else "Perempuan"
                    )

                    exists = conn.execute(
                        "SELECT 1 FROM patients WHERE person_id = ? OR no_rm = ?",
                        (pid, no_rm),
                    ).fetchone()

                    if not exists:
                        conn.execute(
                            """
                            INSERT INTO patients (
                                person_id, no_rm, nim, nik, full_name, gender, gender_label,
                                age, blood_type, insurance, allergies, chronic_conditions,
                                poliklinik, dokter, enrolled_image, positive_test_image,
                                enrolled_poses_count, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                pid,
                                no_rm,
                                no_rm,
                                str(s.get("nik") or "3273010000000000"),
                                str(s.get("full_name") or pid),
                                gender_code,
                                gender_label,
                                int(s.get("age") or 30),
                                str(s.get("blood_type") or "O+"),
                                str(s.get("insurance") or "BPJS Kesehatan"),
                                str(s.get("allergies") or "Tidak Ada Alergi"),
                                str(s.get("chronic_conditions") or "Tidak Ada"),
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

                        # Seed medical history untuk pasien ini
                        history = s.get("medical_history") or []
                        for h in reversed(history):
                            if isinstance(h, dict):
                                conn.execute(
                                    """
                                    INSERT INTO medical_records (
                                        person_id, no_rm, visit_date, poliklinik,
                                        doctor, diagnosis, treatment, created_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                    """,
                                    (
                                        pid,
                                        no_rm,
                                        str(h.get("date") or "2026-10-24"),
                                        str(h.get("poliklinik") or "Poli Umum"),
                                        str(h.get("doctor") or "dr. Sinta Maharani"),
                                        str(h.get("diagnosis") or "-"),
                                        str(h.get("treatment") or "-"),
                                        now,
                                    ),
                                )
            except Exception as err:
                print(f"[SQLITE-WARN] Gagal migrasi awal metadata.json: {err}")

        # 2. Seed attendance_logs dari local_attendance_log.json jika tabel masih kosong
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
                            gender, allergies, poliklinik, queue_number, status,
                            verification_method, similarity
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            att_id,
                            str(item.get("Timestamp") or now),
                            str(item.get("ID") or item.get("NoRM") or "-"),
                            str(item.get("NoRM") or item.get("ID") or "-"),
                            str(item.get("FullName") or "-"),
                            str(item.get("Gender") or "-"),
                            str(item.get("Allergies") or "Tidak Ada Alergi"),
                            str(item.get("Poliklinik") or "Poli Umum"),
                            str(item.get("QueueNumber") or "-"),
                            str(item.get("Status") or "QUEUE_ISSUED"),
                            str(item.get("VerificationMethod") or "BIOMETRIC_FACE"),
                            float(item.get("Similarity") or 0.0),
                        ),
                    )
            except Exception as err:
                print(f"[SQLITE-WARN] Gagal migrasi awal attendance_logs: {err}")

        conn.commit()


def _row_to_patient_dict(
    row: sqlite3.Row, medical_history: list[dict[str, str]]
) -> dict[str, Any]:
    keys = row.keys()
    birth_date = row["birth_date"] if "birth_date" in keys else "1995-01-01"
    med_notes = row["medical_notes"] if "medical_notes" in keys else ""
    return {
        "person_id": row["person_id"],
        "no_rm": row["no_rm"],
        "nim": row["nim"] or row["no_rm"],
        "nik": row["nik"] or "-",
        "full_name": row["full_name"],
        "birth_date": birth_date or "1995-01-01",
        "birthDate": birth_date or "1995-01-01",
        "gender": row["gender"],
        "gender_label": row["gender_label"],
        "age": int(row["age"]),
        "blood_type": row["blood_type"],
        "insurance": row["insurance"],
        "allergies": row["allergies"],
        "chronic_conditions": row["chronic_conditions"],
        "poliklinik": row["poliklinik"],
        "dokter": row["dokter"],
        "medical_notes": med_notes,
        "medicalNotes": med_notes,
        "medical_history": medical_history,
        "enrolled_image": row["enrolled_image"]
        or f"images/enrolled/{row['person_id']}.jpg",
        "positive_test_image": row["positive_test_image"]
        or f"images/enrolled/{row['person_id']}.jpg",
        "enrolled_poses_count": int(row["enrolled_poses_count"] or 1),
    }


def get_all_patients_map() -> dict[str, dict[str, Any]]:
    """Mengambil seluruh pasien beserta riwayat rekam medisnya dari SQLite."""
    init_sqlite_db()
    with _DB_LOCK, get_connection() as conn:
        patient_rows = conn.execute(
            "SELECT * FROM patients ORDER BY rowid ASC"
        ).fetchall()
        record_rows = conn.execute(
            "SELECT * FROM medical_records ORDER BY id DESC"
        ).fetchall()

        history_by_pid: dict[str, list[dict[str, str]]] = {}
        for r in record_rows:
            pid = r["person_id"]
            history_by_pid.setdefault(pid, []).append(
                {
                    "date": r["visit_date"],
                    "poliklinik": r["poliklinik"],
                    "doctor": r["doctor"],
                    "diagnosis": r["diagnosis"],
                    "treatment": r["treatment"],
                }
            )

        result: dict[str, dict[str, Any]] = {}
        for p in patient_rows:
            pid = p["person_id"]
            result[pid] = _row_to_patient_dict(p, history_by_pid.get(pid, []))
        return result


def get_patient_by_id_or_rm(identifier: str) -> dict[str, Any] | None:
    init_sqlite_db()
    norm = identifier.strip()
    if not norm:
        return None
    with _DB_LOCK, get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM patients WHERE lower(person_id) = lower(?) OR lower(no_rm) = lower(?)",
            (norm, norm),
        ).fetchone()
        if not row:
            return None
        records = conn.execute(
            "SELECT * FROM medical_records WHERE person_id = ? ORDER BY id DESC",
            (row["person_id"],),
        ).fetchall()
        history = [
            {
                "date": r["visit_date"],
                "poliklinik": r["poliklinik"],
                "doctor": r["doctor"],
                "diagnosis": r["diagnosis"],
                "treatment": r["treatment"],
            }
            for r in records
        ]
        return _row_to_patient_dict(row, history)


def search_patient_query(query: str) -> dict[str, Any] | None:
    """Mencari pasien di SQLite berdasarkan No. RM, NIK, Person ID, atau Nama Lengkap."""
    init_sqlite_db()
    norm = query.strip()
    if not norm:
        return None
    with _DB_LOCK, get_connection() as conn:
        # 1. Exact match pada person_id, no_rm, atau nik
        row = conn.execute(
            """
            SELECT * FROM patients
            WHERE lower(person_id) = lower(?)
               OR lower(no_rm) = lower(?)
               OR lower(nik) = lower(?)
            LIMIT 1
            """,
            (norm, norm, norm),
        ).fetchone()

        # 2. Substring match dengan LIKE
        if not row:
            like_pat = f"%{norm}%"
            row = conn.execute(
                """
                SELECT * FROM patients
                WHERE lower(full_name) LIKE lower(?)
                   OR lower(no_rm) LIKE lower(?)
                   OR lower(nik) LIKE lower(?)
                LIMIT 1
                """,
                (like_pat, like_pat, like_pat),
            ).fetchone()

        if not row:
            return None

        records = conn.execute(
            "SELECT * FROM medical_records WHERE person_id = ? ORDER BY id DESC",
            (row["person_id"],),
        ).fetchall()
        history = [
            {
                "date": r["visit_date"],
                "poliklinik": r["poliklinik"],
                "doctor": r["doctor"],
                "diagnosis": r["diagnosis"],
                "treatment": r["treatment"],
            }
            for r in records
        ]
        return _row_to_patient_dict(row, history)


def upsert_patient(resp_payload: dict[str, Any]) -> dict[str, Any]:
    """Menyimpan atau memperbarui pasien baru ke SQLite dan menyinkronkan ke file metadata."""
    init_sqlite_db()
    now = _now_iso()
    person_id = str(resp_payload["personId"]).strip()
    no_rm = str(resp_payload.get("noRm") or person_id).strip()
    gender_label = str(resp_payload.get("gender") or "Laki-laki").strip()
    gender_code = "L" if gender_label in ("L", "Laki-laki") else "P"
    gender_full = "Laki-laki" if gender_code == "L" else "Perempuan"

    with _DB_LOCK, get_connection() as conn:
        conn.execute(
            """
            INSERT INTO patients (
                person_id, no_rm, nim, nik, full_name, gender, gender_label,
                age, blood_type, insurance, allergies, chronic_conditions,
                poliklinik, dokter, enrolled_image, positive_test_image,
                enrolled_poses_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(person_id) DO UPDATE SET
                no_rm = excluded.no_rm,
                nik = excluded.nik,
                full_name = excluded.full_name,
                gender = excluded.gender,
                gender_label = excluded.gender_label,
                age = excluded.age,
                blood_type = excluded.blood_type,
                insurance = excluded.insurance,
                allergies = excluded.allergies,
                chronic_conditions = excluded.chronic_conditions,
                poliklinik = excluded.poliklinik,
                dokter = excluded.dokter,
                enrolled_poses_count = excluded.enrolled_poses_count,
                updated_at = excluded.updated_at
            """,
            (
                person_id,
                no_rm,
                no_rm,
                str(resp_payload.get("nik") or "3273010000000000"),
                str(resp_payload["fullName"]),
                gender_code,
                gender_full,
                int(resp_payload.get("age") or 30),
                str(resp_payload.get("bloodType") or "O+"),
                str(resp_payload.get("insurance") or "BPJS Kesehatan"),
                str(resp_payload.get("allergies") or "Tidak Ada Alergi"),
                str(resp_payload.get("chronicConditions") or "Tidak Ada"),
                str(resp_payload.get("poliklinik") or "Poli Umum"),
                str(resp_payload.get("dokter") or "dr. Sinta Maharani"),
                f"images/enrolled/{person_id}.jpg",
                f"images/enrolled/{person_id}.jpg",
                int(resp_payload.get("enrolledPosesCount") or 1),
                now,
                now,
            ),
        )

        # Simpan riwayat medis awal jika belum ada untuk pasien ini
        existing_rec = conn.execute(
            "SELECT COUNT(*) FROM medical_records WHERE person_id = ?",
            (person_id,),
        ).fetchone()[0]
        if existing_rec == 0:
            for item in reversed(resp_payload.get("medicalHistory") or []):
                if isinstance(item, dict):
                    conn.execute(
                        """
                        INSERT INTO medical_records (
                            person_id, no_rm, visit_date, poliklinik,
                            doctor, diagnosis, treatment, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            person_id,
                            no_rm,
                            str(item.get("date") or now[:10]),
                            str(item.get("poliklinik") or "Poli Umum"),
                            str(item.get("doctor") or "dr. Sinta Maharani"),
                            str(item.get("diagnosis") or "Pemeriksaan Awal"),
                            str(item.get("treatment") or "-"),
                            now,
                        ),
                    )
        conn.commit()

    _sync_sqlite_to_metadata_files()
    return get_patient_by_id_or_rm(person_id) or {}


def insert_medical_record(
    person_id: str, no_rm: str, new_entry: dict[str, str]
) -> list[dict[str, str]]:
    """Menambahkan catatan pemeriksaan dokter baru ke tabel `medical_records` SQLite."""
    init_sqlite_db()
    now = _now_iso()
    with _DB_LOCK, get_connection() as conn:
        patient_row = conn.execute(
            "SELECT person_id, no_rm FROM patients WHERE lower(person_id) = lower(?) OR lower(no_rm) = lower(?)",
            (person_id, no_rm),
        ).fetchone()

        target_pid = patient_row["person_id"] if patient_row else person_id
        target_rm = patient_row["no_rm"] if patient_row else no_rm

        if patient_row:
            conn.execute(
                """
                INSERT INTO medical_records (
                    person_id, no_rm, visit_date, poliklinik,
                    doctor, diagnosis, treatment, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    target_pid,
                    target_rm,
                    str(new_entry.get("date") or now[:10]),
                    str(new_entry.get("poliklinik") or "Poli Umum"),
                    str(new_entry.get("doctor") or "dr. Sinta Maharani"),
                    str(new_entry.get("diagnosis") or "-"),
                    str(new_entry.get("treatment") or "-"),
                    now,
                ),
            )
            conn.execute(
                "UPDATE patients SET updated_at = ? WHERE person_id = ?",
                (now, target_pid),
            )
            conn.commit()

        rows = conn.execute(
            "SELECT * FROM medical_records WHERE person_id = ? ORDER BY id DESC",
            (target_pid,),
        ).fetchall()
        history = [
            {
                "date": r["visit_date"],
                "poliklinik": r["poliklinik"],
                "doctor": r["doctor"],
                "diagnosis": r["diagnosis"],
                "treatment": r["treatment"],
            }
            for r in rows
        ]

    _sync_sqlite_to_metadata_files()
    return history if history else [new_entry]


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
                gender, allergies, poliklinik, queue_number, status,
                verification_method, similarity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                att_id,
                str(item.get("Timestamp") or now),
                str(item.get("ID") or item.get("NoRM") or "-"),
                str(item.get("NoRM") or item.get("ID") or "-"),
                str(item.get("FullName") or "-"),
                str(item.get("Gender") or "-"),
                str(item.get("Allergies") or "Tidak Ada Alergi"),
                str(item.get("Poliklinik") or "Poli Umum"),
                str(item.get("QueueNumber") or "-"),
                str(item.get("Status") or "QUEUE_ISSUED"),
                str(item.get("VerificationMethod") or "BIOMETRIC_FACE"),
                similarity,
            ),
        )
        conn.commit()

    # Sinkronkan juga ke local_attendance_log.json untuk kompatibilitas
    logs = get_attendance_logs(limit=150)
    try:
        ATTENDANCE_LOG_PATH.write_text(
            json.dumps(logs, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass


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
                "Allergies": r["allergies"],
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
                (prefix, poli_name, serving_seq, issued_seq, status, now),
            )

        # Perbarui slot pasien
        conn.execute("UPDATE queue_slots SET is_active = 0")
        for prefix, pmap in queue_patients.items():
            serving_seq = serving_counter.get(prefix, 1)
            status = serving_status.get(prefix, "DIPANGGIL")
            for seq, pinfo in pmap.items():
                no_rm = str(pinfo.get("noRm") or f"RM-2026-{seq:03d}")
                full_name = str(pinfo.get("fullName") or f"Pasien {prefix}-{seq:03d}")
                is_active = 1 if (seq > serving_seq or (seq == serving_seq and status != "SELESAI")) else 0
                ticket_obj = patient_active_tickets.get(no_rm.upper())
                ticket_json = json.dumps(ticket_obj, ensure_ascii=False) if ticket_obj else None
                conn.execute(
                    """
                    INSERT INTO queue_slots (
                        prefix, sequence, no_rm, full_name, ticket_json, is_active, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(prefix, sequence) DO UPDATE SET
                        no_rm = excluded.no_rm,
                        full_name = excluded.full_name,
                        ticket_json = COALESCE(excluded.ticket_json, queue_slots.ticket_json),
                        is_active = excluded.is_active,
                        updated_at = excluded.updated_at
                    """,
                    (prefix, int(seq), no_rm, full_name, ticket_json, is_active, now),
                )
        conn.commit()


def load_queue_state_from_sqlite() -> dict[str, Any] | None:
    """Memuat state antrean poliklinik dari SQLite jika sudah tersedia."""
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
                except Exception:
                    pass

        return {
            "queue_counter": queue_counter,
            "serving_counter": serving_counter,
            "serving_status": serving_status,
            "queue_patients": queue_patients,
            "patient_active_tickets": patient_active_tickets,
        }


def get_database_diagnostics() -> dict[str, Any]:
    """Mengembalikan informasi diagnostik & statistik tabel SQLite untuk ditampilkan di Dashboard."""
    init_sqlite_db()
    with _DB_LOCK, get_connection() as conn:
        patients_count = conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0]
        records_count = conn.execute(
            "SELECT COUNT(*) FROM medical_records"
        ).fetchone()[0]
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
            "medical_records": int(records_count),
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
            "no_rm",
            "nik",
            "full_name",
            "gender",
            "age",
            "blood_type",
            "insurance",
            "allergies",
            "chronic_conditions",
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
        print(f"[SQLITE-WARN] Gagal menyinkronkan file metadata: {err}")
