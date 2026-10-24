import base64
import binascii
import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_MATCH_THRESHOLD = 80.0
CORS_HEADERS = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
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
    "PD": {
        2: {"fullName": "Aditya Pratama", "noRm": "RM-2026-001"},
        3: {"fullName": "Rizky Ramadhan", "noRm": "RM-2026-003"},
        4: {"fullName": "Hendra Gunawan", "noRm": "RM-2026-007"},
        5: {"fullName": "Siti Nurhaliza", "noRm": "RM-2026-010"},
    },
    "UM": {
        4: {"fullName": "Budi Santoso", "noRm": "RM-2026-004"},
        5: {"fullName": "Dewi Lestari", "noRm": "RM-2026-008"},
        6: {"fullName": "Fajar Nugroho", "noRm": "RM-2026-012"},
        7: {"fullName": "Rina Kartika", "noRm": "RM-2026-015"},
    },
    "JT": {
        1: {"fullName": "Dimas Saputra", "noRm": "RM-2026-005"},
        2: {"fullName": "Agus Salim", "noRm": "RM-2026-011"},
        3: {"fullName": "Ratna Sari", "noRm": "RM-2026-014"},
    },
    "PR": {
        2: {"fullName": "Nabila Putri Maharani", "noRm": "RM-2026-002"},
        3: {"fullName": "Eko Prasetyo", "noRm": "RM-2026-009"},
        4: {"fullName": "Maya Indriani", "noRm": "RM-2026-016"},
    },
}
_custom_medical_records: dict[str, list[dict[str, str]]] = {}
MINUTES_PER_PATIENT = 8


def _get_patient_for_queue(prefix: str, seq: int) -> dict[str, str]:
    poli_map = _queue_patients.get(prefix, {})
    if seq in poli_map:
        return poli_map[seq]
    return {
        "fullName": f"Pasien {prefix}-{seq:03d}",
        "noRm": f"RM-2026-{seq:03d}",
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
    elif normalized_action == "recall":
        _serving_status[prefix] = "DIPANGGIL"
    else:
        if serving_seq < issued_seq:
            serving_seq += 1
            _serving_counter[prefix] = serving_seq
        _serving_status[prefix] = "DIPANGGIL"

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


def _generate_queue_ticket(
    patient: dict[str, Any], requested_poli: str | None = None
) -> dict[str, Any]:
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
    no_rm = str(patient.get("noRm") or patient.get("personId") or f"RM-2026-{seq:03d}")
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
    return {
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
        "status": (
            "DIPANGGIL"
            if patients_ahead == 0
            else "MENUNGGU"
        ),
        "issuedAt": now_iso,
    }


def _extract_identity_metadata(face_match: dict[str, Any]) -> dict[str, Any]:
    face = face_match.get("Face", {})
    person_id = face.get("ExternalImageId") or face.get("FaceId")
    if not person_id:
        raise RuntimeError("Matched face has no identity")

    similarity = float(face_match.get("Similarity", 0))
    no_rm = face.get("NoRm") or face.get("Nim") or person_id
    poliklinik = face.get("Poliklinik") or "Poli Penyakit Dalam"
    poli_info = POLIKLINIK_CONFIG.get(poliklinik, {})

    base_history = list(face.get("MedicalHistory") or [])
    extra_history = _custom_medical_records.get(person_id, []) + _custom_medical_records.get(no_rm, [])
    # Deduplicate while preserving order
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
        "gender": face.get("Gender") or "-",
        "age": int(face.get("Age") or 30),
        "bloodType": face.get("BloodType") or "O+",
        "insurance": face.get("Insurance") or "BPJS Kesehatan",
        "allergies": face.get("Allergies") or "Tidak Ada Alergi",
        "chronicConditions": face.get("ChronicConditions") or "Tidak Ada",
        "poliklinik": poliklinik,
        "dokter": face.get("Dokter")
        or poli_info.get("dokter", "dr. Hendra Wijaya, Sp.PD"),
        "medicalHistory": merged_history,
        "similarity": similarity,
    }


def _record_attendance(
    face_match: dict[str, Any], requested_poli: str | None = None
) -> dict[str, Any]:
    identity = _extract_identity_metadata(face_match)
    person_id = identity["personId"]
    similarity = identity["similarity"]

    queue_ticket = _generate_queue_ticket(identity, requested_poli=requested_poli)
    timestamp = queue_ticket["issuedAt"]
    attendance_id = str(uuid.uuid4())

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
        "Similarity": Decimal(str(round(similarity, 4))),
    }
    _get_attendance_table().put_item(Item=item)
    return {
        "attendanceId": attendance_id,
        "timestamp": timestamp,
        "queueTicket": queue_ticket,
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

    raw_rm = str(
        payload.get("noRm") or payload.get("nim") or payload.get("personId") or ""
    ).strip()
    if not raw_rm:
        raw_rm = f"RM-2026-{uuid.uuid4().hex[:4].upper()}"
    person_id = "".join(
        ch if (ch.isalnum() or ch in "_.-:") else "-" for ch in raw_rm
    )

    image_bytes = _decode_image(payload)
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
    }
    queue_ticket = _generate_queue_ticket(patient_data, requested_poli=poliklinik)
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
    if method and method != "POST":
        return _json_response(
            400, {"success": False, "message": "Only POST is supported"}
        )

    try:
        payload = _parse_request_body(event)
        collection_id = os.environ.get("REKOGNITION_COLLECTION_ID")
        if not collection_id:
            raise RuntimeError("REKOGNITION_COLLECTION_ID is not configured")

        path = str(event.get("path") or "")
        action = str(payload.get("action") or "").lower()
        if path.endswith("/queues/advance") or action == "advance_queue":
            poli_name = str(payload.get("poliklinik") or "Poli Penyakit Dalam").strip()
            queue_action = str(payload.get("queueAction") or "call_next").strip()
            updated_queue = advance_poli_queue(poli_name, queue_action=queue_action)
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "QUEUE_ADVANCED",
                    "queue": updated_queue,
                    "queues": get_all_queues_status(),
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
                        f"Pasien {enrolled['fullName']} ({enrolled['noRm']}) berhasil didaftarkan. "
                        f"Tiket Antrean: {enrolled['queueTicket']['queueNumber']}"
                    ),
                    **enrolled,
                },
            )

        image_bytes = _decode_image(payload)
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
            return _json_response(
                200,
                {
                    "success": True,
                    "status": "IDENTIFIED",
                    "message": f"Pasien Lama Dikenali: {identity['fullName']} ({identity['noRm']})",
                    **identity,
                },
            )

        requested_poli = payload.get("poliklinik")
        attendance = _record_attendance(matches[0], requested_poli=requested_poli)
        ticket_no = attendance["queueTicket"]["queueNumber"]
        poli_name = attendance["queueTicket"]["poliklinik"]
        return _json_response(
            200,
            {
                "success": True,
                "status": "RECORDED",
                "message": (
                    f"Pasien lama {attendance['fullName']} ({attendance['noRm']}) terverifikasi. "
                    f"Tiket Antrean Otomatis {ticket_no} ({poli_name}) berhasil diterbitkan!"
                ),
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
