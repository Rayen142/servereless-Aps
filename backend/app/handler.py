"""
AWS Lambda Serverless Handler untuk SIMRS Biometric Queue Testbed.

Alur Utama:
1. Face Image Input -> Face Detection & Vector Extraction -> Vector Matching (Cosine Similarity) -> Return Queue Number & Status.
2. Fallback Manual No. RM (`RM-2026-501B` atau input manual RM) -> Bypass komputasi biometrik -> Langsung terbitkan nomor antrean.
3. Logging ringkas terstruktur untuk observabilitas AWS CloudWatch (`Init Duration`, `Duration`, `Billed Duration`).
"""

import base64
import binascii
import hashlib
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger("simrs.handler")
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s",
    )
logger.setLevel(logging.INFO)

# Indikator Cold Start vs Warm Start untuk telemetri CloudWatch
_IS_COLD_START = True

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

# Daftar subjek referensi ringan untuk bypass manual No. RM (termasuk RM-2026-501B) di lingkungan Serverless murni
FALLBACK_RM_DIRECTORY: dict[str, dict[str, Any]] = {
    "RM-2026-501B": {
        "personId": "RM-2026-501B",
        "noRm": "RM-2026-501B",
        "nik": "3273012304070001",
        "fullName": "Candra Hidayattuloh",
        "gender": "Laki-laki",
        "age": 19,
        "poliklinik": "Poli Umum",
        "dokter": "dr. Sinta Maharani",
    },
    "RM-2026-0001": {
        "personId": "MHS-2026-001",
        "noRm": "RM-2026-0001",
        "nik": "3273011405950001",
        "fullName": "Aditya Pratama",
        "gender": "Laki-laki",
        "age": 31,
        "poliklinik": "Poli Penyakit Dalam",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
    },
    "MHS-2026-001": {
        "personId": "MHS-2026-001",
        "noRm": "RM-2026-0001",
        "nik": "3273011405950001",
        "fullName": "Aditya Pratama",
        "gender": "Laki-laki",
        "age": 31,
        "poliklinik": "Poli Penyakit Dalam",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
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
_patient_active_tickets: dict[str, dict[str, Any]] = {}
MINUTES_PER_PATIENT = 8

_QUEUE_LOCK = threading.RLock()

QUEUE_ACTION_ALIASES: dict[str, str] = {
    "next": "call_next",
    "call_next": "call_next",
    "advance": "call_next",
    "advance_queue": "call_next",
    "queue_action": "call_next",
    "finish": "complete",
    "complete": "complete",
    "done": "complete",
    "recall": "recall",
    "reset": "reset",
}


def normalize_queue_action(raw_action: Any) -> str:
    text = str(raw_action or "").strip().lower()
    if not text:
        return "call_next"
    normalized = QUEUE_ACTION_ALIASES.get(text)
    if normalized is None:
        raise ValueError(
            f"Aksi antrean '{raw_action}' tidak dikenal. "
            "Gunakan NEXT, FINISH, RECALL, atau RESET."
        )
    return normalized


def resolve_poli_name(
    poliklinik: Any = None, prefix: Any = None
) -> str | None:
    name = str(poliklinik or "").strip()
    if name:
        if name in POLIKLINIK_CONFIG:
            return name
        lowered = name.lower()
        for poli in POLIKLINIK_CONFIG:
            if poli.lower() == lowered:
                return poli
        return None
    code = str(prefix or "").strip().upper()
    if code:
        return next(
            (k for k, v in POLIKLINIK_CONFIG.items() if v["prefix"] == code),
            None,
        )
    return None


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
        logger.debug("Skip sinkronisasi state antrean ke DynamoDB: %s", err)


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
        logger.debug("Skip simpan state antrean ke SQLite: %s", err)
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
        logger.debug("Skip simpan cadangan antrean ke queue_state.json: %s", err)
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
        logger.debug("SQLite state tidak dimuat, mencoba JSON: %s", err)
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
        logger.debug("Gagal membaca file queue_state.json: %s", err)


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
    with _QUEUE_LOCK:
        return _get_poli_queue_snapshot_unlocked(poli_name)


def _get_poli_queue_snapshot_unlocked(poli_name: str) -> dict[str, Any]:
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
    with _QUEUE_LOCK:
        return [_get_poli_queue_snapshot_unlocked(poli) for poli in POLIKLINIK_CONFIG]


def _release_active_ticket(prefix: str, seq: int) -> None:
    queue_number = f"{prefix}-{seq:03d}"
    stale_keys = [
        k
        for k, t in _patient_active_tickets.items()
        if isinstance(t, dict) and str(t.get("queueNumber") or "") == queue_number
    ]
    for k in stale_keys:
        _patient_active_tickets.pop(k, None)
    finished_patient = _queue_patients.get(prefix, {}).get(seq)
    if finished_patient:
        rm_key = str(finished_patient.get("noRm") or "").strip().upper()
        if rm_key:
            _patient_active_tickets.pop(rm_key, None)


def _apply_queue_action(prefix: str, normalized_action: str) -> tuple[bool, str]:
    issued_seq = _queue_counter.get(prefix, 3)
    serving_seq = _serving_counter.get(prefix, 1)
    current_status = _serving_status.get(prefix, "DIPANGGIL")
    current_number = f"{prefix}-{serving_seq:03d}"

    if normalized_action == "complete":
        if current_status == "SELESAI":
            return False, f"Nomor {current_number} sudah berstatus selesai."
        _serving_status[prefix] = "SELESAI"
        _release_active_ticket(prefix, serving_seq)
        return True, f"Pelayanan nomor {current_number} selesai."

    if normalized_action == "recall":
        _serving_status[prefix] = "DIPANGGIL"
        return True, f"Nomor {current_number} dipanggil ulang."

    if normalized_action == "reset":
        defaults = DEFAULT_INITIAL_QUEUES.get(prefix, {"serving": 1, "issued": 3})
        _serving_counter[prefix] = defaults["serving"]
        _queue_counter[prefix] = defaults["issued"]
        _serving_status[prefix] = "DIPANGGIL"
        _queue_patients[prefix] = dict(DEFAULT_QUEUE_PATIENTS.get(prefix, {}))
        keys_to_remove = [
            k
            for k, t in _patient_active_tickets.items()
            if str(t.get("queueNumber") or "").startswith(f"{prefix}-")
        ]
        for k in keys_to_remove:
            _patient_active_tickets.pop(k, None)
        return True, "Antrean poli dikembalikan ke kondisi awal."

    if serving_seq >= issued_seq:
        return False, "Tidak ada pasien yang menunggu di antrean ini."
    _release_active_ticket(prefix, serving_seq)
    serving_seq += 1
    _serving_counter[prefix] = serving_seq
    _serving_status[prefix] = "DIPANGGIL"
    return True, f"Memanggil nomor {prefix}-{serving_seq:03d}."


def advance_poli_queue(
    poli_name: str, queue_action: str = "call_next"
) -> dict[str, Any]:
    resolved_poli = resolve_poli_name(poli_name)
    if resolved_poli is None:
        raise ValueError(f"Poliklinik '{poli_name}' tidak terdaftar.")
    normalized_action = normalize_queue_action(queue_action)
    prefix = POLIKLINIK_CONFIG[resolved_poli]["prefix"]

    with _QUEUE_LOCK:
        changed, _ = _apply_queue_action(prefix, normalized_action)
        if changed:
            _save_queue_state(prefix)
        return _get_poli_queue_snapshot_unlocked(resolved_poli)


def build_queue_state(
    poliklinik: Any = None, prefix: Any = None
) -> tuple[int, dict[str, Any]]:
    requested = str(poliklinik or prefix or "").strip()
    target_poli = resolve_poli_name(poliklinik, prefix) if requested else None
    if requested and target_poli is None:
        return 404, {
            "success": False,
            "message": f"Poliklinik '{requested}' tidak terdaftar.",
        }

    with _QUEUE_LOCK:
        all_queues = [
            _get_poli_queue_snapshot_unlocked(poli) for poli in POLIKLINIK_CONFIG
        ]
    selected = next(
        (q for q in all_queues if q["poliklinik"] == target_poli),
        all_queues[0] if all_queues else None,
    )
    return 200, {
        "success": True,
        "count": len(all_queues),
        "queue": selected,
        "queues": all_queues,
        "minutesPerPatient": MINUTES_PER_PATIENT,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def handle_queue_action(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    raw_action = payload.get("queueAction") or payload.get("action")
    try:
        normalized_action = normalize_queue_action(raw_action)
    except ValueError as error:
        return 400, {"success": False, "message": str(error)}

    raw_poli = payload.get("poliklinik") or payload.get("poli")
    raw_prefix = payload.get("prefix")
    if not str(raw_poli or raw_prefix or "").strip():
        return 400, {
            "success": False,
            "message": "Field 'poliklinik' wajib diisi untuk aksi antrean.",
        }
    poli_name = resolve_poli_name(raw_poli, raw_prefix)
    if poli_name is None:
        return 404, {
            "success": False,
            "message": f"Poliklinik '{raw_poli or raw_prefix}' tidak terdaftar.",
        }

    prefix = POLIKLINIK_CONFIG[poli_name]["prefix"]
    with _QUEUE_LOCK:
        changed, message = _apply_queue_action(prefix, normalized_action)
        if changed:
            _save_queue_state(prefix)
        updated_queue = _get_poli_queue_snapshot_unlocked(poli_name)
        all_queues = [
            _get_poli_queue_snapshot_unlocked(poli) for poli in POLIKLINIK_CONFIG
        ]

    return 200, {
        "success": True,
        "status": "QUEUE_ADVANCED" if changed else "QUEUE_UNCHANGED",
        "action": normalized_action,
        "changed": changed,
        "message": message,
        "queue": updated_queue,
        "queues": all_queues,
        "minutesPerPatient": MINUTES_PER_PATIENT,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


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
    with _QUEUE_LOCK:
        return _generate_queue_ticket_unlocked(
            patient, requested_poli=requested_poli, image_hash=image_hash
        )


def _generate_queue_ticket_unlocked(
    patient: dict[str, Any],
    requested_poli: str | None = None,
    image_hash: str | None = None,
) -> dict[str, Any]:
    person_id = str(patient.get("personId") or "").strip()
    no_rm = str(patient.get("noRm") or person_id or "").strip()

    existing_ticket = _find_existing_active_ticket(
        no_rm=no_rm, person_id=person_id, image_hash=image_hash
    )
    if existing_ticket is not None:
        return existing_ticket

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
        "gender": patient.get("gender") or "Laki-laki",
        "age": int(patient.get("age") or 30),
        "poliklinik": poli_name,
        "dokter": poli_info["dokter"],
        "room": poli_info["room"],
        "status": "DIPANGGIL" if patients_ahead == 0 else "MENUNGGU",
        "issuedAt": now_iso,
        "isExistingTicket": False,
    }

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
    matched_face_id = face.get("ExternalImageId") or face.get("FaceId")
    if not matched_face_id:
        raise RuntimeError("Matched face has no identity")
    base_face_id = str(matched_face_id).split("__pose")[0]
    person_id = str(face.get("CanonicalPersonId") or base_face_id)

    similarity = float(face_match.get("Similarity", 0))
    no_rm = face.get("NoRm") or face.get("Nim") or person_id
    poliklinik = face.get("Poliklinik") or "Poli Penyakit Dalam"
    poli_info = POLIKLINIK_CONFIG.get(poliklinik, {})

    return {
        "personId": person_id,
        "canonicalPersonId": person_id,
        "matchedFaceId": str(matched_face_id),
        "noRm": no_rm,
        "rmNumber": no_rm,
        "nim": no_rm,
        "nik": face.get("Nik") or "3273010000000001",
        "fullName": face.get("FullName") or person_id,
        "gender": face.get("Gender") or "Laki-laki",
        "age": int(face.get("Age") or 30),
        "poliklinik": poliklinik,
        "defaultPoli": poliklinik,
        "dokter": face.get("Dokter")
        or poli_info.get("dokter", "dr. Hendra Wijaya, Sp.PD"),
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

    if not already_queued:
        item = {
            "attendanceId": attendance_id,
            "Timestamp": timestamp,
            "ID": person_id,
            "NoRM": identity["noRm"],
            "FullName": identity["fullName"],
            "Gender": identity["gender"],
            "Poliklinik": queue_ticket["poliklinik"],
            "QueueNumber": queue_ticket["queueNumber"],
            "Status": "QUEUE_ISSUED",
            "VerificationMethod": verification_method,
            "Similarity": Decimal(str(round(similarity, 4))),
        }
        try:
            _get_attendance_table().put_item(Item=item)
        except Exception as err:
            logger.debug("Skip DynamoDB put_item pada mode bypass/lokal: %s", err)

    return {
        "attendanceId": attendance_id,
        "timestamp": timestamp,
        "queueTicket": queue_ticket,
        "alreadyQueued": already_queued,
        "verificationMethod": verification_method,
        **identity,
    }


def _handle_manual_rm_bypass(
    raw_query: str, requested_poli: str | None = None
) -> tuple[int, dict[str, Any]]:
    """
    Rute bypass langsung untuk input No. RM manual (khususnya RM-2026-501B).
    Mengembalikan nomor antrean valid seketika tanpa mengeksekusi komputasi biometrik.
    """
    query = raw_query.strip().upper()
    if not query:
        return 400, {
            "success": False,
            "message": "Nomor Rekam Medis (No. RM) wajib diisi.",
        }

    # Cek di SQLite lokal jika tersedia, atau gunakan FALLBACK_RM_DIRECTORY
    matched_profile: dict[str, Any] | None = None
    try:
        from app import database
        db_match = database.search_patient_query(query)
        if db_match:
            matched_profile = {
                "personId": db_match["person_id"],
                "noRm": db_match["no_rm"],
                "nik": db_match.get("nik", "3273010000000001"),
                "fullName": db_match["full_name"],
                "gender": db_match.get("gender_label", "Laki-laki"),
                "age": int(db_match.get("age", 30)),
                "poliklinik": db_match.get("poliklinik", "Poli Umum"),
                "dokter": db_match.get("dokter", "dr. Sinta Maharani"),
            }
    except Exception:
        matched_profile = None

    if matched_profile is None:
        matched_profile = FALLBACK_RM_DIRECTORY.get(query)

    # Khusus RM-2026-501B atau format RM-2026-* yang diinput saat demo/load test:
    if matched_profile is None and query.startswith(("RM-2026-", "MHS-2026-")):
        matched_profile = {
            "personId": query,
            "noRm": query,
            "nik": "3273012304070001",
            "fullName": "Candra Hidayattuloh"
            if query == "RM-2026-501B"
            else f"Pasien Terdaftar ({query})",
            "gender": "Laki-laki",
            "age": 22,
            "poliklinik": requested_poli or "Poli Umum",
            "dokter": "dr. Sinta Maharani",
        }

    if matched_profile is None:
        return 200, {
            "success": False,
            "status": "NOT_FOUND",
            "message": f"Nomor Rekam Medis '{raw_query}' tidak ditemukan pada basis data.",
        }

    synthetic_match = {
        "Similarity": 100.0,
        "Face": {
            "FaceId": f"bypass-{matched_profile['personId'].lower()}",
            "ExternalImageId": matched_profile["personId"],
            "CanonicalPersonId": matched_profile["personId"],
            "NoRm": matched_profile["noRm"],
            "Nim": matched_profile["noRm"],
            "Nik": matched_profile["nik"],
            "FullName": matched_profile["fullName"],
            "Gender": matched_profile["gender"],
            "Age": matched_profile["age"],
            "Poliklinik": matched_profile["poliklinik"],
            "Dokter": matched_profile["dokter"],
        },
    }
    attendance = _record_attendance(
        synthetic_match,
        requested_poli=requested_poli,
        verification_method="MANUAL_LOOKUP",
    )
    ticket_no = attendance["queueTicket"]["queueNumber"]
    poli_name = attendance["queueTicket"]["poliklinik"]
    already_queued = bool(attendance.get("alreadyQueued"))
    status_label = "ALREADY_QUEUED" if already_queued else "RECORDED"

    msg = (
        f"Bypass Manual No. RM ({attendance['noRm']}) berhasil. "
        f"Nomor Antrean {ticket_no} ({poli_name}) diterbitkan tanpa eksekusi biometrik."
    )
    return 200, {
        "success": True,
        "status": status_label,
        "message": msg,
        **attendance,
    }


def _enroll_face(payload: dict[str, Any], collection_id: str) -> dict[str, Any]:
    full_name = str(payload.get("fullName") or "").strip()
    if not full_name:
        raise ValueError("Nama lengkap pasien wajib diisi")

    gender = str(payload.get("gender") or "Laki-laki").strip()
    normalized_gender = (
        "Perempuan" if gender in ("P", "Perempuan") else "Laki-laki"
    )

    image_bytes = _decode_image(payload)
    image_hash = hashlib.sha256(image_bytes).hexdigest()

    existing_search = _get_rekognition_client().search_faces_by_image(
        CollectionId=collection_id,
        FaceMatchThreshold=_match_threshold(),
        Image={"Bytes": image_bytes},
        MaxFaces=1,
    )
    existing_matches = existing_search.get("FaceMatches", [])
    if existing_matches:
        matched_face = existing_matches[0].get("Face", {})
        existing_name = (
            matched_face.get("FullName")
            or matched_face.get("ExternalImageId")
            or "Pasien"
        )
        existing_rm = (
            matched_face.get("NoRm")
            or matched_face.get("ExternalImageId")
            or "-"
        )
        raise ValueError(
            f"Vektor biometrik wajah sudah terdaftar atas nama {existing_name} ({existing_rm}). "
            f"Silakan gunakan fitur Pindai Wajah."
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
        raise ValueError("Wajah tidak terdeteksi pada citra input")

    extra_images = payload.get("extraImages")
    poses_count = 1
    if isinstance(extra_images, list):
        for idx, extra_b64 in enumerate(extra_images[:2], start=2):
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
                    logger.warning("Skip pose tambahan ke-%d untuk %s: %s", idx, person_id, err)

    face_info = records[0].get("Face", {})
    poliklinik = str(payload.get("poliklinik") or "Poli Umum").strip()
    poli_info = POLIKLINIK_CONFIG.get(poliklinik, POLIKLINIK_CONFIG["Poli Umum"])

    patient_data = {
        "personId": person_id,
        "noRm": person_id,
        "nim": person_id,
        "nik": str(payload.get("nik") or "3273010000000000").strip(),
        "fullName": full_name,
        "gender": normalized_gender,
        "age": int(payload.get("age") or 30),
        "poliklinik": poliklinik,
        "dokter": poli_info["dokter"],
        "faceId": face_info.get("FaceId"),
        "confidence": float(face_info.get("Confidence", 100.0)),
        "similarity": float(face_info.get("Confidence", 100.0)),
        "enrolledPosesCount": poses_count,
    }
    queue_ticket = _generate_queue_ticket(
        patient_data, requested_poli=poliklinik, image_hash=image_hash
    )
    return {
        **patient_data,
        "queueTicket": queue_ticket,
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    global _IS_COLD_START
    is_cold = _IS_COLD_START
    _IS_COLD_START = False
    t_start = time.perf_counter()

    method = (
        event.get("httpMethod")
        or event.get("requestContext", {}).get("http", {}).get("method")
    )
    if method == "OPTIONS":
        return _json_response(200, {"success": True})

    path = str(event.get("path") or "").rstrip("/")

    if method == "GET":
        query_params = event.get("queryStringParameters") or {}
        if not isinstance(query_params, dict):
            query_params = {}
        status_code, body = build_queue_state(
            query_params.get("poliklinik") or query_params.get("poli"),
            query_params.get("prefix"),
        )
        return _json_response(status_code, body)

    if method and method != "POST":
        return _json_response(
            400, {"success": False, "message": "Only GET and POST are supported"}
        )

    try:
        payload = _parse_request_body(event)
        action = str(payload.get("action") or "").strip().lower()

        # 1. Aksi kontrol antrean (NEXT / FINISH / RECALL / RESET)
        if (
            path.endswith("/queue/action")
            or path.endswith("/queues/advance")
            or action in QUEUE_ACTION_ALIASES
            or "queueAction" in payload
        ):
            status_code, body = handle_queue_action(payload)
            return _json_response(status_code, body)

        if path.endswith("/queue") or path.endswith("/queues"):
            status_code, body = build_queue_state(
                payload.get("poliklinik"), payload.get("prefix")
            )
            return _json_response(status_code, body)

        # 2. Rute Bypass Manual No. RM (contoh: RM-2026-501B) — Tanpa Eksekusi Biometrik
        manual_query = str(
            payload.get("query")
            or payload.get("manualRm")
            or (
                payload.get("noRm")
                if not payload.get("image") and not payload.get("imageBase64")
                else ""
            )
            or ""
        ).strip()
        if (
            path.endswith("/lookup")
            or action in ("lookup_manual", "manual_rm", "bypass")
            or (manual_query and not payload.get("image") and not payload.get("imageBase64"))
        ):
            status_code, body = _handle_manual_rm_bypass(
                manual_query, requested_poli=payload.get("poliklinik")
            )
            duration_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            logger.info(
                "[CLOUDWATCH_METRIC] event=MANUAL_RM_BYPASS cold_start=%s query=%s status=%s duration_ms=%.2f",
                is_cold,
                manual_query,
                body.get("status"),
                duration_ms,
            )
            return _json_response(status_code, body)

        collection_id = os.environ.get("REKOGNITION_COLLECTION_ID")
        if not collection_id:
            raise RuntimeError("REKOGNITION_COLLECTION_ID is not configured")

        # 3. Pendaftaran Wajah Pasien Baru (Face Enrollment)
        if path.endswith("/enroll") or action == "enroll":
            enrolled = _enroll_face(payload, collection_id)
            duration_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            logger.info(
                "[CLOUDWATCH_METRIC] event=ENROLL cold_start=%s person_id=%s queue=%s duration_ms=%.2f",
                is_cold,
                enrolled["personId"],
                enrolled["queueTicket"]["queueNumber"],
                duration_ms,
            )
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "ENROLLED",
                    "message": (
                        f"Registrasi vektor biometrik berhasil ({enrolled['noRm']}). "
                        f"Nomor Antrean: {enrolled['queueTicket']['queueNumber']}"
                    ),
                    **enrolled,
                },
            )

        # 4. Verifikasi Wajah (Face Image Input -> Vector Extraction & Cosine Similarity Matching -> Queue Number)
        image_bytes = _decode_image(payload)
        image_hash = hashlib.sha256(image_bytes).hexdigest()
        threshold = _match_threshold()

        t_bio = time.perf_counter()
        result = _get_rekognition_client().search_faces_by_image(
            CollectionId=collection_id,
            FaceMatchThreshold=threshold,
            Image={"Bytes": image_bytes},
            MaxFaces=1,
        )
        bio_ms = round((time.perf_counter() - t_bio) * 1000.0, 2)

        matches = result.get("FaceMatches", [])
        if not matches:
            duration_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
            logger.info(
                "[CLOUDWATCH_METRIC] event=VERIFY_REJECT cold_start=%s biometric_ms=%.2f total_ms=%.2f",
                is_cold,
                bio_ms,
                duration_ms,
            )
            return _json_response(
                200,
                {
                    "success": False,
                    "status": "NOT_RECOGNIZED",
                    "message": "Identifikasi Gagal. Jarak Cosine Similarity berada di bawah threshold.",
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
                    "message": (
                        f"Identifikasi Berhasil ({identity['similarity']:.1f}%). "
                        f"Jarak Cosine Similarity memenuhi threshold."
                    ),
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
        similarity_val = float(attendance.get("similarity", 0.0))
        already_queued = bool(attendance.get("alreadyQueued"))
        status_code_label = "ALREADY_QUEUED" if already_queued else "RECORDED"

        msg = (
            f"Identifikasi Berhasil ({similarity_val:.1f}% >= threshold {threshold:.0f}%). "
            f"Jarak Cosine Similarity memenuhi threshold. Nomor Antrean: {ticket_no}."
        )

        duration_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
        logger.info(
            "[CLOUDWATCH_METRIC] event=VERIFY_MATCH cold_start=%s person_id=%s similarity=%.2f queue=%s biometric_ms=%.2f total_ms=%.2f",
            is_cold,
            attendance["personId"],
            similarity_val,
            ticket_no,
            bio_ms,
            duration_ms,
        )

        return _json_response(
            200,
            {
                "success": True,
                "status": status_code_label,
                "message": msg,
                "biometricLatencyMs": bio_ms,
                "totalLatencyMs": duration_ms,
                "coldStart": is_cold,
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
                    "message": "Tidak ditemukan wajah pada citra input.",
                },
            )
        logger.error("AWS ClientError: %s - %s", error_code, error_message)
        return _json_response(
            500,
            {
                "success": False,
                "message": "Layanan pencocokan vektor biometrik sedang mengalami gangguan.",
            },
        )
    except (BotoCoreError, RuntimeError) as error:
        logger.error("Runtime/BotoCoreError: %s", error)
        return _json_response(
            500,
            {
                "success": False,
                "message": "Layanan pencocokan vektor biometrik sedang mengalami gangguan.",
            },
        )
