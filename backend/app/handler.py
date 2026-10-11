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
_queue_counter: dict[str, int] = {}


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
    _queue_counter[prefix] = _queue_counter.get(prefix, 0) + 1
    seq = _queue_counter[prefix]
    queue_number = f"{prefix}-{seq:03d}"

    allergies = str(patient.get("allergies") or "Tidak Ada Alergi")
    has_allergy = (
        allergies.strip().lower() not in ("", "-", "tidak ada", "tidak ada alergi")
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "ticketId": f"TKT-{uuid.uuid4().hex[:8].upper()}",
        "queueNumber": queue_number,
        "noRm": patient.get("noRm") or patient.get("personId"),
        "fullName": patient.get("fullName"),
        "gender": patient.get("gender"),
        "insurance": patient.get("insurance") or "BPJS Kesehatan",
        "poliklinik": poli_name,
        "dokter": poli_info["dokter"],
        "room": poli_info["room"],
        "allergies": allergies,
        "hasAllergyAlert": has_allergy,
        "status": "MENUNGGU PANGGILAN POLI",
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
        "medicalHistory": face.get("MedicalHistory") or [],
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
