import base64
import binascii
import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger("simrs.handler")

MAX_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_MATCH_THRESHOLD = 80.0
CORS_HEADERS = {
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Requested-With,*",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
}

POLIKLINIK_CONFIG: dict[str, dict[str, str]] = {
    "Poli Penyakit Dalam": {
        "prefix": "PD",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
        "room": "Lantai 2 • Ruang 201",
    },
    "Poli Umum": {
        "prefix": "UM",
        "dokter": "dr. Sinta Maharani",
        "room": "Lantai 1 • Ruang 102",
    },
    "Poli Jantung": {
        "prefix": "JT",
        "dokter": "dr. Bambang Hartono, Sp.JP",
        "room": "Lantai 2 • Ruang 205",
    },
    "Poli Paru & Pernapasan": {
        "prefix": "PR",
        "dokter": "dr. Faisal Rahman, Sp.P",
        "room": "Lantai 2 • Ruang 208",
    },
    "Poli Saraf (Neurologi)": {
        "prefix": "SR",
        "dokter": "dr. Arifin Putra, Sp.N",
        "room": "Lantai 3 • Ruang 301",
    },
    "Poli Mata": {
        "prefix": "MT",
        "dokter": "dr. Ratna Kusuma, Sp.M",
        "room": "Lantai 3 • Ruang 304",
    },
    "Poli Gigi & Mulut": {
        "prefix": "GG",
        "dokter": "drg. Nadia Larasati",
        "room": "Lantai 1 • Ruang 108",
    },
    "Poli THT": {
        "prefix": "TH",
        "dokter": "dr. Lukman Hakim, Sp.THT-KL",
        "room": "Lantai 3 • Ruang 306",
    },
    "Poli Kulit & Kelamin": {
        "prefix": "KK",
        "dokter": "dr. Clara Wijaya, Sp.KK",
        "room": "Lantai 2 • Ruang 210",
    },
    "Poli Ortopedi": {
        "prefix": "OR",
        "dokter": "dr. Kevin Santoso, Sp.OT",
        "room": "Lantai 1 • Ruang 112",
    },
}

_rekognition_client = None
_dynamodb_resource = None

QUEUE_STATE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "dataset" / "queue_state.json"
)

DEFAULT_INITIAL_QUEUES: dict[str, dict[str, int]] = {
    "PD": {"serving": 2, "issued": 5},
    "UM": {"serving": 4, "issued": 7},
    "JT": {"serving": 1, "issued": 3},
    "PR": {"serving": 2, "issued": 4},
    "SR": {"serving": 1, "issued": 3},
    "MT": {"serving": 3, "issued": 5},
    "GG": {"serving": 2, "issued": 4},
    "TH": {"serving": 1, "issued": 3},
    "KK": {"serving": 2, "issued": 4},
    "OR": {"serving": 1, "issued": 2},
}

# Pasien awal di ruang tunggu menggunakan nomor RM seri 0800 agar tidak bentrok
# dengan 20 subjek uji dataset (RM-2026-0001 s/d RM-2026-0020).
DEFAULT_QUEUE_PATIENTS: dict[str, dict[int, dict[str, str]]] = {
    "PD": {
        2: {"fullName": "Surya Darmawan", "noRm": "RM-2026-0801"},
        3: {"fullName": "Lestari Wulandari", "noRm": "RM-2026-0802"},
        4: {"fullName": "Bagus Setiawan", "noRm": "RM-2026-0803"},
        5: {"fullName": "Kartika Sari", "noRm": "RM-2026-0804"},
    },
    "UM": {
        4: {"fullName": "Wahyu Hidayat", "noRm": "RM-2026-0805"},
        5: {"fullName": "Ratih Permata", "noRm": "RM-2026-0806"},
        6: {"fullName": "Kurniawan Putra", "noRm": "RM-2026-0807"},
        7: {"fullName": "Yuni Astuti", "noRm": "RM-2026-0808"},
    },
    "JT": {
        1: {"fullName": "Hermawan Susanto", "noRm": "RM-2026-0809"},
        2: {"fullName": "Sri Wahyuni", "noRm": "RM-2026-0810"},
        3: {"fullName": "Taufik Hidayat", "noRm": "RM-2026-0811"},
    },
    "PR": {
        2: {"fullName": "Rudi Hartono", "noRm": "RM-2026-0812"},
        3: {"fullName": "Indah Permatasari", "noRm": "RM-2026-0813"},
        4: {"fullName": "Anton Wijaya", "noRm": "RM-2026-0814"},
    },
}

_queue_counter: dict[str, int] = {
    prefix: vals["issued"] for prefix, vals in DEFAULT_INITIAL_QUEUES.items()
}
_serving_counter: dict[str, int] = {
    prefix: vals["serving"] for prefix, vals in DEFAULT_INITIAL_QUEUES.items()
}
_serving_status: dict[str, str] = {
    prefix: "DIPANGGIL" for prefix in DEFAULT_INITIAL_QUEUES
}
_queue_patients: dict[str, dict[int, dict[str, str]]] = {
    p: dict(mapping) for p, mapping in DEFAULT_QUEUE_PATIENTS.items()
}
# Menyimpan 1 tiket antrean aktif per pasien (key: noRm / personId / imageHash)
# untuk mencegah dobel order jika orang/foto yang sama discan berulang kali.
_patient_active_tickets: dict[str, dict[str, Any]] = {}
_custom_medical_records: dict[str, list[dict[str, str]]] = {}
MINUTES_PER_PATIENT = 8


def _save_queue_state_to_dynamodb(prefix: str | None = None) -> None:
    try:
        table = _get_attendance_table()
        prefixes = [prefix] if prefix else list(DEFAULT_INITIAL_QUEUES.keys())
        for p in prefixes:
            poli_name = next(
                (k for k, v in POLIKLINIK_CONFIG.items() if v["prefix"] == p),
                f"Poli {p}",
            )
            issued = _queue_counter.get(p, 1)
            serving = _serving_counter.get(p, 1)
            status = _serving_status.get(p, "DIPANGGIL")
            now_iso = datetime.now(timezone.utc).isoformat()
            item = {
                "attendanceId": f"QUEUE_STATE_{p}",
                "Timestamp": now_iso,
                "Prefix": p,
                "Poliklinik": poli_name,
                "LatestSequence": issued,
                "LatestQueueNumber": f"{p}-{issued:03d}",
                "CurrentServingSequence": serving,
                "CurrentServingNumber": f"{p}-{serving:03d}",
                "ServingStatus": status,
                "TotalWaiting": max(0, issued - serving),
                "Status": "QUEUE_STATE",
            }
            table.put_item(Item=item)
    except Exception as err:
        logger.warning("Gagal menyinkronkan state antrean ke DynamoDB: %s", err)


def _save_queue_state(prefix: str | None = None) -> None:
    try:
        from app import database
        database.save_queue_state_to_sqlite(
            _queue_counter,
            _serving_counter,
            _serving_status,
            _queue_patients,
            _patient_active_tickets,
            POLIKLINIK_CONFIG,
        )
    except Exception as err:
        logger.error("Gagal menyimpan state antrean ke SQLite: %s", err)
    try:
        QUEUE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        serializable_patients = {
            prefix_key: {str(k): v for k, v in pmap.items()}
            for prefix_key, pmap in _queue_patients.items()
        }
        state = {
            "queue_counter": _queue_counter,
            "serving_counter": _serving_counter,
            "serving_status": _serving_status,
            "queue_patients": serializable_patients,
            "patient_active_tickets": _patient_active_tickets,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        QUEUE_STATE_PATH.write_text(
            json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception as err:
        logger.warning("Gagal menyimpan cadangan antrean ke queue_state.json: %s", err)
    _save_queue_state_to_dynamodb(prefix)


def _load_queue_state() -> None:
    try:
        from app import database
        db_state = database.load_queue_state_from_sqlite()
        if db_state:
            if db_state.get("queue_counter"):
                _queue_counter.update(db_state["queue_counter"])
            if db_state.get("serving_counter"):
                _serving_counter.update(db_state["serving_counter"])
            if db_state.get("serving_status"):
                _serving_status.update(db_state["serving_status"])
            if db_state.get("queue_patients"):
                _queue_patients.update(db_state["queue_patients"])
            if db_state.get("patient_active_tickets"):
                _patient_active_tickets.update(db_state["patient_active_tickets"])
            return
    except Exception as err:
        logger.warning("Gagal memuat state antrean dari SQLite, beralih ke JSON: %s", err)
    if not QUEUE_STATE_PATH.exists():
        return
    try:
        raw = json.loads(QUEUE_STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(raw.get("queue_counter"), dict):
            for k, v in raw["queue_counter"].items():
                _queue_counter[str(k)] = int(v)
        if isinstance(raw.get("serving_counter"), dict):
            for k, v in raw["serving_counter"].items():
                _serving_counter[str(k)] = int(v)
        if isinstance(raw.get("serving_status"), dict):
            for k, v in raw["serving_status"].items():
                _serving_status[str(k)] = str(v)
        if isinstance(raw.get("queue_patients"), dict):
            for prefix, pmap in raw["queue_patients"].items():
                if isinstance(pmap, dict):
                    _queue_patients[str(prefix)] = {
                        int(seq): val
                        for seq, val in pmap.items()
                        if str(seq).isdigit() and isinstance(val, dict)
                    }
        if isinstance(raw.get("patient_active_tickets"), dict):
            for k, v in raw["patient_active_tickets"].items():
                if isinstance(v, dict):
                    _patient_active_tickets[str(k)] = v
    except Exception as err:
        logger.warning("Gagal membaca file queue_state.json: %s", err)


_load_queue_state()


def _get_patient_for_queue(prefix: str, seq: int) -> dict[str, str]:
    poli_map = _queue_patients.get(prefix, {})
    if seq in poli_map:
        return poli_map[seq]
    return {
        "fullName": f"Pasien {prefix}-{seq:03d}",
        "noRm": f"RM-2026-{seq:04d}",
    }


def get_poli_queue_snapshot(poli_name: str) -> dict[str, Any]:
    poli_info = POLIKLINIK_CONFIG.get(
        poli_name,
        {
            "prefix": "PL",
            "dokter": "dr. Sinta Maharani",
            "room": "Lantai 1 • Ruang 101",
        },
    )
    prefix = poli_info["prefix"]
    issued_seq = _queue_counter.get(prefix, 3)
    serving_seq = _serving_counter.get(prefix, 1)
    if serving_seq > issued_seq:
        serving_seq = issued_seq
        _serving_counter[prefix] = serving_seq

    total_waiting = max(0, issued_seq - serving_seq)
    serving_status = _serving_status.get(prefix, "DIPANGGIL")
    current_patient = _get_patient_for_queue(prefix, serving_seq)
    next_seq = serving_seq + 1 if serving_seq < issued_seq else None
    next_patient = _get_patient_for_queue(prefix, next_seq) if next_seq else None

    return {
        "poliklinik": poli_name,
        "prefix": prefix,
        "dokter": poli_info["dokter"],
        "room": poli_info["room"],
        "currentServingSequence": serving_seq,
        "currentServingNumber": f"{prefix}-{serving_seq:03d}",
        "servingStatus": serving_status,
        "currentPatientName": current_patient["fullName"],
        "currentPatientNoRm": current_patient["noRm"],
        "nextQueueNumber": f"{prefix}-{next_seq:03d}" if next_seq else None,
        "nextPatientName": next_patient["fullName"] if next_patient else None,
        "latestQueueSequence": issued_seq,
        "latestQueueNumber": f"{prefix}-{issued_seq:03d}",
        "totalWaiting": total_waiting,
        "estimatedWaitMinutes": total_waiting * MINUTES_PER_PATIENT,
    }


def get_all_queues_status() -> list[dict[str, Any]]:
    return [get_poli_queue_snapshot(poli) for poli in POLIKLINIK_CONFIG]


def advance_poli_queue(
    poli_name: str, queue_action: str = "call_next"
) -> dict[str, Any]:
    poli_info = POLIKLINIK_CONFIG.get(
        poli_name, POLIKLINIK_CONFIG["Poli Penyakit Dalam"]
    )
    prefix = poli_info["prefix"]
    issued_seq = _queue_counter.get(prefix, 3)
    serving_seq = _serving_counter.get(prefix, 1)

    normalized_action = queue_action.strip().lower()
    if normalized_action == "complete":
        _serving_status[prefix] = "SELESAI"
        # Jika pasien yang sedang dilayani sudah selesai, hapus kunci antrean aktifnya
        finished_patient = _queue_patients.get(prefix, {}).get(serving_seq)
        if finished_patient:
            rm_key = str(finished_patient.get("noRm") or "").strip().upper()
            if rm_key:
                _patient_active_tickets.pop(rm_key, None)
    elif normalized_action == "recall":
        _serving_status[prefix] = "DIPANGGIL"
    elif normalized_action == "reset":
        defaults = DEFAULT_INITIAL_QUEUES.get(prefix, {"serving": 1, "issued": 3})
        _serving_counter[prefix] = defaults["serving"]
        _queue_counter[prefix] = defaults["issued"]
        _serving_status[prefix] = "DIPANGGIL"
        _queue_patients[prefix] = dict(DEFAULT_QUEUE_PATIENTS.get(prefix, {}))
        # Hapus seluruh tiket aktif yang terdaftar di poli ini
        keys_to_remove = [
            k
            for k, t in _patient_active_tickets.items()
            if str(t.get("queueNumber") or "").startswith(f"{prefix}-")
        ]
        for k in keys_to_remove:
            _patient_active_tickets.pop(k, None)
    else:
        if serving_seq < issued_seq:
            # Pasien sebelumnya otomatis selesai ketika dokter memanggil pasien berikutnya
            prev_patient = _queue_patients.get(prefix, {}).get(serving_seq)
            if prev_patient:
                rm_key = str(prev_patient.get("noRm") or "").strip().upper()
                if rm_key:
                    _patient_active_tickets.pop(rm_key, None)
            serving_seq += 1
            _serving_counter[prefix] = serving_seq
        _serving_status[prefix] = "DIPANGGIL"

    _save_queue_state(prefix)
    return get_poli_queue_snapshot(poli_name)


def _json_response(
    status_code: int, payload: dict[str, Any]
) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(payload),
    }


def _get_rekognition_client():
    global _rekognition_client
    if _rekognition_client is None:
        _rekognition_client = boto3.client("rekognition")
    return _rekognition_client


def _get_attendance_table():
    global _dynamodb_resource
    if _dynamodb_resource is None:
        _dynamodb_resource = boto3.resource("dynamodb")

    table_name = os.environ.get("ATTENDANCE_TABLE_NAME")
    if not table_name:
        raise RuntimeError("ATTENDANCE_TABLE_NAME is not configured")
    return _dynamodb_resource.Table(table_name)


def _parse_request_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if body is None:
        raise ValueError("Request body is required")

    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as error:
            raise ValueError("Request body is not valid JSON") from error

    if isinstance(body, dict):
        payload = body
    elif isinstance(body, str):
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as error:
            raise ValueError("Request body is not valid JSON") from error
    else:
        raise ValueError("Request body must be a JSON object")

    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    return payload


def _decode_image(payload: dict[str, Any]) -> bytes:
    encoded_image = payload.get("image") or payload.get("imageBase64")
    if not isinstance(encoded_image, str) or not encoded_image.strip():
        raise ValueError("The image base64 string is required")

    if encoded_image.startswith("data:"):
        try:
            encoded_image = encoded_image.split(",", 1)[1]
        except IndexError as error:
            raise ValueError("The image data URL is invalid") from error

    try:
        image_bytes = base64.b64decode(encoded_image, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("The image is not valid base64") from error

    if not image_bytes:
        raise ValueError("The image cannot be empty")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("The image must be 5 MB or smaller")
    return image_bytes


def _match_threshold() -> float:
    configured_threshold = os.environ.get(
        "MATCH_THRESHOLD", str(DEFAULT_MATCH_THRESHOLD)
    )
    try:
        threshold = float(configured_threshold)
    except ValueError as error:
        raise RuntimeError("MATCH_THRESHOLD is not a valid number") from error

    if not 0 <= threshold <= 100:
        raise RuntimeError("MATCH_THRESHOLD must be between 0 and 100")
    return threshold


def _refresh_existing_ticket(existing: dict[str, Any]) -> dict[str, Any]:
    """Perbarui informasi antrean dinamis pada tiket aktif milik pasien tanpa menerbitkan nomor baru."""
    poli_name = str(existing.get("poliklinik") or "Poli Umum")
    poli_info = POLIKLINIK_CONFIG.get(
        poli_name,
        {
            "prefix": "PL",
            "dokter": existing.get("dokter") or "dr. Sinta Maharani",
            "room": existing.get("room") or "Lantai 1 • Ruang 101",
        },
    )
    prefix = poli_info["prefix"]
    seq = int(existing.get("queueSequence") or 1)
    serving_seq = _serving_counter.get(prefix, 1)
    issued_seq = _queue_counter.get(prefix, seq)
    patients_ahead = max(0, seq - serving_seq)
    estimated_wait_minutes = patients_ahead * MINUTES_PER_PATIENT

    return {
        **existing,
        "currentServingNumber": f"{prefix}-{serving_seq:03d}",
        "currentServingSequence": serving_seq,
        "latestQueueNumber": f"{prefix}-{issued_seq:03d}",
        "patientsAhead": patients_ahead,
        "estimatedWaitMinutes": estimated_wait_minutes,
        "status": "DIPANGGIL" if patients_ahead == 0 else "MENUNGGU",
        "isExistingTicket": True,
    }


def _find_existing_active_ticket(
    no_rm: str, person_id: str, image_hash: str | None = None
) -> dict[str, Any] | None:
    """Cek apakah pasien (berdasarkan No. RM, Person ID, atau hash foto) sudah memiliki order antrean aktif."""
    lookup_keys = [
        k.strip().upper()
        for k in (no_rm, person_id, f"IMG:{image_hash}" if image_hash else "")
        if k and k.strip()
    ]
    for key in lookup_keys:
        ticket = _patient_active_tickets.get(key)
        if not isinstance(ticket, dict):
            continue
        poli_name = str(ticket.get("poliklinik") or "Poli Umum")
        poli_info = POLIKLINIK_CONFIG.get(poli_name, {"prefix": "PL"})
        prefix = poli_info["prefix"]
        seq = int(ticket.get("queueSequence") or 0)
        serving_seq = _serving_counter.get(prefix, 1)
        serving_stat = _serving_status.get(prefix, "DIPANGGIL")

        # Tiket masih aktif selama nomor antreannya belum terlewati dan belum berstatus SELESAI
        is_still_active = seq > serving_seq or (
            seq == serving_seq and serving_stat != "SELESAI"
        )
        if is_still_active:
            return _refresh_existing_ticket(ticket)

    return None


def _generate_queue_ticket(
    patient: dict[str, Any],
    requested_poli: str | None = None,
    image_hash: str | None = None,
) -> dict[str, Any]:
    person_id = str(patient.get("personId") or "").strip()
    no_rm = str(patient.get("noRm") or person_id or "").strip()

    # 1. Cegah dobel order: satu orang hanya boleh memiliki satu antrean aktif
    existing_ticket = _find_existing_active_ticket(
        no_rm=no_rm, person_id=person_id, image_hash=image_hash
    )
    if existing_ticket is not None:
        return existing_ticket

    # 2. Jika belum punya antrean aktif, terbitkan 1 tiket baru
    poli_name = requested_poli or patient.get("poliklinik") or "Poli Umum"
    poli_info = POLIKLINIK_CONFIG.get(
        poli_name,
        {
            "prefix": "PL",
            "dokter": patient.get("dokter") or "dr. Sinta Maharani",
            "room": "Lantai 1 • Ruang 101",
        },
    )
    prefix = poli_info["prefix"]
    _queue_counter[prefix] = _queue_counter.get(prefix, 3) + 1
    seq = _queue_counter[prefix]
    serving_seq = _serving_counter.get(prefix, 1)
    if serving_seq > seq:
        serving_seq = seq
        _serving_counter[prefix] = serving_seq

    full_name = str(patient.get("fullName") or f"Pasien {prefix}-{seq:03d}")
    if not no_rm:
        no_rm = f"RM-2026-{seq:04d}"

    _queue_patients.setdefault(prefix, {})[seq] = {
        "fullName": full_name,
        "noRm": no_rm,
    }

    queue_number = f"{prefix}-{seq:03d}"
    current_serving_number = f"{prefix}-{serving_seq:03d}"
    patients_ahead = max(0, seq - serving_seq)
    estimated_wait_minutes = patients_ahead * MINUTES_PER_PATIENT

    allergies = str(patient.get("allergies") or "Tidak Ada Alergi")
    has_allergy = (
        allergies.strip().lower() not in ("", "-", "tidak ada", "tidak ada alergi")
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    ticket = {
        "ticketId": f"TKT-{uuid.uuid4().hex[:8].upper()}",
        "queueNumber": queue_number,
        "queueSequence": seq,
        "currentServingNumber": current_serving_number,
        "currentServingSequence": serving_seq,
        "latestQueueNumber": queue_number,
        "patientsAhead": patients_ahead,
        "estimatedWaitMinutes": estimated_wait_minutes,
        "noRm": no_rm,
        "fullName": full_name,
        "gender": patient.get("gender"),
        "insurance": patient.get("insurance") or "BPJS Kesehatan",
        "poliklinik": poli_name,
        "dokter": poli_info["dokter"],
        "room": poli_info["room"],
        "allergies": allergies,
        "hasAllergyAlert": has_allergy,
        "status": "DIPANGGIL" if patients_ahead == 0 else "MENUNGGU",
        "issuedAt": now_iso,
        "isExistingTicket": False,
    }

    # Simpan tiket ke indeks aktif agar scan berikutnya dari orang/foto yang sama tidak dobel order
    if no_rm:
        _patient_active_tickets[no_rm.upper()] = ticket
    if person_id:
        _patient_active_tickets[person_id.upper()] = ticket
    if image_hash:
        _patient_active_tickets[f"IMG:{image_hash.upper()}"] = ticket

    _save_queue_state(prefix)
    return ticket


def _extract_identity_metadata(face_match: dict[str, Any]) -> dict[str, Any]:
    face = face_match.get("Face", {})
    person_id = face.get("ExternalImageId") or face.get("FaceId")
    if not person_id:
        raise RuntimeError("Matched face has no identity")

    similarity = float(face_match.get("Similarity", 0))
    no_rm = face.get("NoRm") or face.get("Nim") or person_id
    poliklinik = face.get("Poliklinik") or "Poli Penyakit Dalam"
    poli_info = POLIKLINIK_CONFIG.get(poliklinik, {})

    birth_date = (
        face.get("BirthDate")
        or face.get("birthDate")
        or face.get("TanggalLahir")
        or face.get("tanggal_lahir")
        or "1995-01-01"
    )
    medical_notes = (
        face.get("MedicalNotes")
        or face.get("medicalNotes")
        or face.get("medical_notes")
        or ""
    )

    base_history = list(face.get("MedicalHistory") or [])
    extra_history = _custom_medical_records.get(
        person_id, []
    ) + _custom_medical_records.get(no_rm, [])
    seen_keys: set[str] = set()
    merged_history: list[dict[str, Any]] = []
    for item in extra_history + base_history:
        key = f"{item.get('date')}|{item.get('diagnosis')}|{item.get('treatment')}"
        if key not in seen_keys:
            seen_keys.add(key)
            merged_history.append(item)

    return {
        "personId": person_id,
        "noRm": no_rm,
        "nim": no_rm,
        "nik": face.get("Nik") or "3273010000000001",
        "fullName": face.get("FullName") or person_id,
        "birthDate": birth_date,
        "gender": face.get("Gender") or "-",
        "age": int(face.get("Age") or 30),
        "bloodType": face.get("BloodType") or "O+",
        "insurance": face.get("Insurance") or "BPJS Kesehatan",
        "allergies": face.get("Allergies") or "Tidak Ada Alergi",
        "chronicConditions": face.get("ChronicConditions") or "Tidak Ada",
        "poliklinik": poliklinik,
        "dokter": face.get("Dokter")
        or poli_info.get("dokter", "dr. Hendra Wijaya, Sp.PD"),
        "medicalNotes": medical_notes,
        "medicalHistory": merged_history,
        "similarity": similarity,
    }


def _record_attendance(
    face_match: dict[str, Any],
    requested_poli: str | None = None,
    verification_method: str = "BIOMETRIC_FACE",
    image_hash: str | None = None,
) -> dict[str, Any]:
    identity = _extract_identity_metadata(face_match)
    person_id = identity["personId"]
    similarity = identity["similarity"]

    queue_ticket = _generate_queue_ticket(
        identity, requested_poli=requested_poli, image_hash=image_hash
    )
    already_queued = bool(queue_ticket.get("isExistingTicket"))
    timestamp = queue_ticket["issuedAt"]
    attendance_id = str(uuid.uuid4())

    # Hanya catat ke log kehadiran/antrean apabila ini adalah order baru (bukan scan berulang)
    if not already_queued:
        item = {
            "attendanceId": attendance_id,
            "Timestamp": timestamp,
            "ID": person_id,
            "NoRM": identity["noRm"],
            "FullName": identity["fullName"],
            "Gender": identity["gender"],
            "Allergies": identity["allergies"],
            "Poliklinik": queue_ticket["poliklinik"],
            "QueueNumber": queue_ticket["queueNumber"],
            "Status": "QUEUE_ISSUED",
            "VerificationMethod": verification_method,
            "Similarity": Decimal(str(round(similarity, 4))),
        }
        _get_attendance_table().put_item(Item=item)

    return {
        "attendanceId": attendance_id,
        "timestamp": timestamp,
        "queueTicket": queue_ticket,
        "alreadyQueued": already_queued,
        "verificationMethod": verification_method,
        **identity,
    }


def _add_medical_record(payload: dict[str, Any]) -> dict[str, Any]:
    person_id = str(payload.get("personId") or payload.get("noRm") or "").strip()
    no_rm = str(payload.get("noRm") or person_id).strip()
    if not person_id:
        raise ValueError("Identitas pasien (personId / No. RM) wajib diisi")

    diagnosis = str(payload.get("diagnosis") or "").strip()
    treatment = str(payload.get("treatment") or "").strip()
    if not diagnosis:
        raise ValueError("Diagnosis pemeriksaan dokter wajib diisi")
    if not treatment:
        raise ValueError("Tindakan / resep obat wajib diisi")

    poliklinik = str(payload.get("poliklinik") or "Poli Umum").strip()
    poli_info = POLIKLINIK_CONFIG.get(poliklinik, POLIKLINIK_CONFIG["Poli Umum"])
    doctor = str(payload.get("doctor") or poli_info["dokter"]).strip()
    date_str = str(
        payload.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ).strip()

    record = {
        "date": date_str,
        "poliklinik": poliklinik,
        "doctor": doctor,
        "diagnosis": diagnosis,
        "treatment": treatment,
    }
    _custom_medical_records.setdefault(person_id, []).insert(0, record)
    if no_rm and no_rm != person_id:
        _custom_medical_records.setdefault(no_rm, []).insert(0, record)

    return {
        "personId": person_id,
        "noRm": no_rm,
        "record": record,
    }


def _enroll_face(payload: dict[str, Any], collection_id: str) -> dict[str, Any]:
    full_name = str(payload.get("fullName") or "").strip()
    if not full_name:
        raise ValueError("Nama lengkap pasien wajib diisi")

    gender = str(payload.get("gender") or "").strip()
    if gender not in ("L", "P", "Laki-laki", "Perempuan"):
        raise ValueError("Gender pasien wajib dipilih (Laki-laki atau Perempuan)")
    normalized_gender = (
        "Laki-laki" if gender in ("L", "Laki-laki") else "Perempuan"
    )

    image_bytes = _decode_image(payload)
    image_hash = hashlib.sha256(image_bytes).hexdigest()

    # Cek apakah wajah pada foto ini sudah terdaftar sebelumnya untuk mencegah dobel akun / dobel order
    existing_search = _get_rekognition_client().search_faces_by_image(
        CollectionId=collection_id,
        FaceMatchThreshold=_match_threshold(),
        Image={"Bytes": image_bytes},
        MaxFaces=1,
    )
    existing_matches = existing_search.get("FaceMatches", [])
    if existing_matches:
        matched_face = existing_matches[0].get("Face", {})
        existing_name = matched_face.get("FullName") or matched_face.get("ExternalImageId") or "Pasien"
        existing_rm = matched_face.get("NoRm") or matched_face.get("ExternalImageId") or "-"
        raise ValueError(
            f"Wajah pada foto ini sudah terdaftar atas nama {existing_name} ({existing_rm}). "
            f"Satu orang hanya boleh memiliki satu akun & satu nomor antrean (silakan gunakan menu Pasien Lama)."
        )

    raw_rm = str(
        payload.get("noRm") or payload.get("nim") or payload.get("personId") or ""
    ).strip()
    if not raw_rm:
        raw_rm = f"RM-2026-{uuid.uuid4().hex[:4].upper()}"
    person_id = "".join(
        ch if (ch.isalnum() or ch in "_.-:") else "-" for ch in raw_rm
    )

    response = _get_rekognition_client().index_faces(
        CollectionId=collection_id,
        Image={"Bytes": image_bytes},
        ExternalImageId=person_id,
        DetectionAttributes=["DEFAULT"],
        MaxFaces=1,
        QualityFilter="AUTO",
    )
    records = response.get("FaceRecords", [])
    if not records:
        raise ValueError("Wajah pasien tidak terdeteksi pada foto yang dikirim")

    # Jika ada extraImages (multi-angle enrollment), indeks juga sebagai sampel pose tambahan
    extra_images = payload.get("extraImages")
    poses_count = 1
    if isinstance(extra_images, list):
        for idx, extra_b64 in enumerate(extra_images[:3], start=2):
            if isinstance(extra_b64, str) and extra_b64.strip():
                try:
                    extra_bytes = _decode_image({"image": extra_b64})
                    _get_rekognition_client().index_faces(
                        CollectionId=collection_id,
                        Image={"Bytes": extra_bytes},
                        ExternalImageId=f"{person_id}__pose{idx}",
                        DetectionAttributes=["DEFAULT"],
                        MaxFaces=1,
                        QualityFilter="AUTO",
                    )
                    poses_count += 1
                except Exception as err:
                    logger.warning("Gagal mengindeks pose wajah tambahan ke-%d untuk %s: %s", idx, person_id, err)

    face_info = records[0].get("Face", {})
    poliklinik = str(payload.get("poliklinik") or "Poli Umum").strip()
    poli_info = POLIKLINIK_CONFIG.get(poliklinik, POLIKLINIK_CONFIG["Poli Umum"])
    allergies = str(payload.get("allergies") or "Tidak Ada Alergi").strip()
    chronic = str(payload.get("chronicConditions") or "Tidak Ada").strip()
    complaint = str(
        payload.get("medicalHistoryNotes") or "Pemeriksaan awal pasien baru"
    ).strip()

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    initial_history = [
        {
            "date": today_str,
            "poliklinik": poliklinik,
            "doctor": poli_info["dokter"],
            "diagnosis": complaint,
            "treatment": "Pendaftaran Pasien Baru & Pemeriksaan Tanda Vital",
        }
    ]

    patient_data = {
        "personId": person_id,
        "noRm": person_id,
        "nim": person_id,
        "nik": str(payload.get("nik") or "3273010000000000").strip(),
        "fullName": full_name,
        "gender": normalized_gender,
        "age": int(payload.get("age") or 30),
        "bloodType": str(payload.get("bloodType") or "O+").strip(),
        "insurance": str(payload.get("insurance") or "BPJS Kesehatan").strip(),
        "allergies": allergies,
        "chronicConditions": chronic,
        "poliklinik": poliklinik,
        "dokter": poli_info["dokter"],
        "medicalHistory": initial_history,
        "faceId": face_info.get("FaceId"),
        "confidence": float(face_info.get("Confidence", 100.0)),
        "birthDate": str(payload.get("birthDate") or "1995-01-01").strip(),
        "medicalNotes": complaint,
        "enrolledPosesCount": poses_count,
        "consentAccepted": bool(payload.get("consentAccepted", True)),
        "consentTimestamp": str(payload.get("consentTimestamp") or datetime.now(timezone.utc).isoformat()),
    }
    queue_ticket = _generate_queue_ticket(
        patient_data, requested_poli=poliklinik, image_hash=image_hash
    )
    return {
        **patient_data,
        "queueTicket": queue_ticket,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method")
    )
    if method == "OPTIONS":
        return _json_response(200, {"success": True})

    path = str(event.get("path") or "").rstrip("/")

    # Handle GET /queue and GET /queues
    if method == "GET":
        query_params = event.get("queryStringParameters") or {}
        if not isinstance(query_params, dict):
            query_params = {}
        poli_name = query_params.get("poliklinik") or query_params.get("poli")
        prefix = query_params.get("prefix")
        if not poli_name and prefix:
            poli_name = next(
                (k for k, v in POLIKLINIK_CONFIG.items() if v["prefix"].upper() == prefix.upper()),
                None,
            )
        snapshot = get_poli_queue_snapshot(poli_name) if poli_name else get_all_queues_status()[0]
        return _json_response(
            200,
            {
                "success": True,
                "count": len(POLIKLINIK_CONFIG),
                "queue": snapshot,
                "queues": get_all_queues_status(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            },
        )

    if method and method != "POST":
        return _json_response(
            400, {"success": False, "message": "Only GET and POST are supported"}
        )

    try:
        payload = _parse_request_body(event)
        collection_id = os.environ.get("REKOGNITION_COLLECTION_ID")
        if not collection_id:
            raise RuntimeError("REKOGNITION_COLLECTION_ID is not configured")

        action = str(payload.get("action") or "").lower()
        queue_action = str(payload.get("queueAction") or action or "call_next").strip().lower()

        # Handle POST /queue/action, /queues/advance, and queue actions
        if (
            path.endswith("/queue/action")
            or path.endswith("/queues/advance")
            or action in ("advance_queue", "queue_action", "call_next", "complete", "recall", "reset")
            or "queueAction" in payload
        ):
            poli_name = str(payload.get("poliklinik") or "Poli Penyakit Dalam").strip()
            updated_queue = advance_poli_queue(poli_name, queue_action=queue_action)
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "QUEUE_ADVANCED",
                    "action": queue_action,
                    "queue": updated_queue,
                    "queues": get_all_queues_status(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
            )

        # Handle POST to /queue or /queues without action (returns status)
        if path.endswith("/queue") or path.endswith("/queues"):
            return _json_response(
                200,
                {
                    "success": True,
                    "count": len(POLIKLINIK_CONFIG),
                    "queues": get_all_queues_status(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
            )

        if path.endswith("/medical-record") or action == "add_medical_record":
            added = _add_medical_record(payload)
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "MEDICAL_RECORD_ADDED",
                    "message": "Catatan pemeriksaan dokter berhasil ditambahkan ke rekam medis pasien.",
                    **added,
                },
            )

        if path.endswith("/enroll") or action == "enroll":
            enrolled = _enroll_face(payload, collection_id)
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "ENROLLED",
                    "message": (
                        f"Pasien {enrolled['fullName']} ({enrolled['noRm']}) berhasil didaftarkan "
                        f"({enrolled.get('enrolledPosesCount', 1)} sampel pose). "
                        f"Tiket Antrean: {enrolled['queueTicket']['queueNumber']}"
                    ),
                    **enrolled,
                },
            )

        image_bytes = _decode_image(payload)
        image_hash = hashlib.sha256(image_bytes).hexdigest()
        result = _get_rekognition_client().search_faces_by_image(
            CollectionId=collection_id,
            FaceMatchThreshold=_match_threshold(),
            Image={"Bytes": image_bytes},
            MaxFaces=1,
        )
        matches = result.get("FaceMatches", [])
        if not matches:
            return _json_response(
                200,
                {
                    "success": False,
                    "status": "NOT_RECOGNIZED",
                    "message": "Wajah pasien belum terdaftar di database Rekam Medis RS. Silakan daftar di menu Pasien Baru.",
                },
            )

        if payload.get("identifyOnly") is True:
            identity = _extract_identity_metadata(matches[0])
            existing_ticket = _find_existing_active_ticket(
                no_rm=identity["noRm"],
                person_id=identity["personId"],
                image_hash=image_hash,
            )
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "IDENTIFIED",
                    "message": f"Pasien Lama Dikenali: {identity['fullName']} ({identity['noRm']})",
                    "alreadyQueued": existing_ticket is not None,
                    **(
                        {"queueTicket": existing_ticket}
                        if existing_ticket is not None
                        else {}
                    ),
                    **identity,
                },
            )

        requested_poli = payload.get("poliklinik")
        attendance = _record_attendance(
            matches[0],
            requested_poli=requested_poli,
            image_hash=image_hash,
        )
        ticket_no = attendance["queueTicket"]["queueNumber"]
        poli_name = attendance["queueTicket"]["poliklinik"]
        already_queued = bool(attendance.get("alreadyQueued"))

        if already_queued:
            msg = (
                f"Pasien {attendance['fullName']} ({attendance['noRm']}) sudah memiliki "
                f"nomor antrean aktif {ticket_no} di {poli_name}. "
                f"Satu pasien hanya dapat memiliki 1 antrean aktif (tidak boleh dobel order)."
            )
            status_code_label = "ALREADY_QUEUED"
        else:
            msg = (
                f"Pasien lama {attendance['fullName']} ({attendance['noRm']}) terverifikasi. "
                f"Tiket Antrean Otomatis {ticket_no} ({poli_name}) berhasil diterbitkan!"
            )
            status_code_label = "RECORDED"

        return _json_response(
            200,
            {
                "success": True,
                "status": status_code_label,
                "message": msg,
                **attendance,
            },
        )
    except ValueError as error:
        return _json_response(400, {"success": False, "message": str(error)})
    except ClientError as error:
        error_code = error.response.get("Error", {}).get("Code", "")
        error_message = error.response.get("Error", {}).get("Message", "")
        if (
            error_code == "InvalidParameterException"
            and "face" in error_message.lower()
        ):
            return _json_response(
                200,
                {
                    "success": False,
                    "status": "NOT_RECOGNIZED",
                    "message": "Tidak ada wajah pasien yang dapat dikenali.",
                },
            )
        service_error = {
            "success": False,
            "message": "Layanan verifikasi biometrik RS sedang bermasalah.",
        }
        return _json_response(
            500,
            service_error,
        )
    except (BotoCoreError, RuntimeError):
        service_error = {
            "success": False,
            "message": "Layanan verifikasi biometrik RS sedang bermasalah.",
        }
        return _json_response(
            500,
            service_error,
        )
