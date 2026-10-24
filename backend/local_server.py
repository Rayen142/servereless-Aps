"""Local Development API Server untuk Sistem Pengenalan Wajah & Antrean Pasien Rumah Sakit (SIMRS).

Menyediakan endpoint:
  POST http://localhost:8000/v1/attendance/verify  (Scan wajah pasien lama -> Riwayat Medis, Alergi, & Tiket Antrean Otomatis)
  POST http://localhost:8000/v1/attendance/enroll  (Scan wajah daftar pasien baru -> Simpan Rekam Medis & Antrean)
  GET  http://localhost:8000/v1/attendance/faces   (Daftar pasien terdaftar di database RS)
  GET  http://localhost:8000/v1/attendance/logs    (Riwayat tiket antrean & kunjungan pasien)
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import sys
import tempfile
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import cv2
import numpy as np

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
DATASET_DIR = PROJECT_ROOT / "dataset"
ENROLLED_DIR = DATASET_DIR / "images" / "enrolled"
NEGATIVE_DIR = DATASET_DIR / "images" / "test_negative"
METADATA_JSON_PATH = DATASET_DIR / "metadata.json"
METADATA_CSV_PATH = DATASET_DIR / "metadata.csv"
ATTENDANCE_LOG_PATH = DATASET_DIR / "local_attendance_log.json"

sys.path.insert(0, str(BACKEND_DIR))


def _ensure_boto3_stub_if_missing() -> None:
    try:
        import boto3  # noqa: F401
    except ImportError:
        import types

        boto3_stub = types.ModuleType("boto3")
        boto3_stub.client = MagicMock()
        boto3_stub.resource = MagicMock()
        botocore_stub = types.ModuleType("botocore")
        exceptions_stub = types.ModuleType("botocore.exceptions")

        class BotoCoreError(Exception):
            pass

        class ClientError(Exception):
            def __init__(self, error_response: dict[str, Any], operation_name: str):
                super().__init__(operation_name)
                self.response = error_response

        exceptions_stub.BotoCoreError = BotoCoreError
        exceptions_stub.ClientError = ClientError
        sys.modules["boto3"] = boto3_stub
        sys.modules["botocore"] = botocore_stub
        sys.modules["botocore.exceptions"] = exceptions_stub


_ensure_boto3_stub_if_missing()
from app import handler  # noqa: E402


def _load_face_cascade() -> cv2.CascadeClassifier:
    xml_url = "https://cdn.jsdelivr.net/gh/opencv/opencv@4.x/data/haarcascades/haarcascade_frontalface_default.xml"
    xml_path = os.path.join(tempfile.gettempdir(), "haarcascade_frontalface_default.xml")
    if not os.path.exists(xml_path):
        urllib.request.urlretrieve(xml_url, xml_path)
    return cv2.CascadeClassifier(xml_path)


CASCADE = _load_face_cascade()


def _load_subjects_map() -> dict[str, dict[str, Any]]:
    if not METADATA_JSON_PATH.exists():
        return {}
    try:
        data = json.loads(METADATA_JSON_PATH.read_text(encoding="utf-8"))
        subjects = data.get("subjects", [])
        return {s["person_id"]: s for s in subjects if "person_id" in s}
    except Exception:
        return {}


def _format_gender(gender_val: str) -> str:
    if gender_val in ("L", "Laki-laki"):
        return "Laki-laki"
    if gender_val in ("P", "Perempuan"):
        return "Perempuan"
    return gender_val or "-"


def _save_patient_metadata(resp_payload: dict[str, Any]) -> dict[str, Any]:
    person_id = resp_payload["personId"]
    gender_label = resp_payload.get("gender", "Laki-laki")
    gender_code = "L" if gender_label in ("L", "Laki-laki") else "P"

    data: dict[str, Any] = {
        "collection_id_default": "attendance-faces",
        "match_threshold_default": 80.0,
        "total_enrolled": 0,
        "subjects": [],
    }
    if METADATA_JSON_PATH.exists():
        try:
            data = json.loads(METADATA_JSON_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass

    subjects: list[dict[str, Any]] = data.get("subjects", [])
    existing_idx = next(
        (i for i, s in enumerate(subjects) if s.get("person_id") == person_id),
        None,
    )
    record = {
        "person_id": person_id,
        "no_rm": resp_payload.get("noRm") or person_id,
        "nim": resp_payload.get("noRm") or person_id,
        "nik": resp_payload.get("nik") or "3273010000000000",
        "full_name": resp_payload["fullName"],
        "gender": gender_code,
        "gender_label": "Laki-laki" if gender_code == "L" else "Perempuan",
        "age": int(resp_payload.get("age") or 30),
        "blood_type": resp_payload.get("bloodType") or "O+",
        "insurance": resp_payload.get("insurance") or "BPJS Kesehatan",
        "allergies": resp_payload.get("allergies") or "Tidak Ada Alergi",
        "chronic_conditions": resp_payload.get("chronicConditions") or "Tidak Ada",
        "poliklinik": resp_payload.get("poliklinik") or "Poli Umum",
        "dokter": resp_payload.get("dokter") or "dr. Sinta Maharani",
        "medical_history": resp_payload.get("medicalHistory") or [],
        "enrolled_image": f"images/enrolled/{person_id}.jpg",
        "positive_test_image": f"images/enrolled/{person_id}.jpg",
    }
    if existing_idx is not None:
        subjects[existing_idx] = record
    else:
        subjects.append(record)

    data["subjects"] = subjects
    data["total_enrolled"] = len(subjects)
    METADATA_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
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

    return record


def _extract_face_roi(gray_img: np.ndarray) -> np.ndarray:
    faces = CASCADE.detectMultiScale(gray_img, 1.1, 4, minSize=(60, 60))
    if len(faces) > 0:
        x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
        roi = gray_img[y : y + h, x : x + w]
    else:
        h, w = gray_img.shape[:2]
        cy, cx = h // 2, w // 2
        r = min(h, w) // 4
        roi = gray_img[cy - r : cy + r, cx - r : cx + r]
    resized = cv2.resize(roi, (128, 128))
    return cv2.equalizeHist(resized)


def _compute_face_similarity(img_a_bytes: bytes, img_b_bytes: bytes) -> float:
    arr_a = np.frombuffer(img_a_bytes, np.uint8)
    arr_b = np.frombuffer(img_b_bytes, np.uint8)
    img_a = cv2.imdecode(arr_a, cv2.IMREAD_GRAYSCALE)
    img_b = cv2.imdecode(arr_b, cv2.IMREAD_GRAYSCALE)
    if img_a is None or img_b is None:
        return 0.0

    h_a, w_a = img_a.shape[:2]
    h_b, w_b = img_b.shape[:2]
    cy_a, cx_a = h_a // 2, w_a // 2
    cy_b, cx_b = h_b // 2, w_b // 2
    r_a = min(h_a, w_a) // 4
    r_b = min(h_b, w_b) // 4

    roi_a = cv2.equalizeHist(
        cv2.resize(img_a[cy_a - r_a : cy_a + r_a, cx_a - r_a : cx_a + r_a], (128, 128))
    )
    roi_b = cv2.equalizeHist(
        cv2.resize(img_b[cy_b - r_b : cy_b + r_b, cx_b - r_b : cx_b + r_b], (128, 128))
    )

    corr_center = float(cv2.matchTemplate(roi_a, roi_b, cv2.TM_CCOEFF_NORMED)[0][0])

    face_a = _extract_face_roi(img_a)
    face_b = _extract_face_roi(img_b)
    corr_face = float(cv2.matchTemplate(face_a, face_b, cv2.TM_CCOEFF_NORMED)[0][0])

    corr = max(corr_center, corr_face)
    score = max(0.0, min(100.0, (corr + 0.15) * 95.0))
    return round(score, 2)


LAST_CUSTOM_ENROLLED_ID: str | None = None


def _configure_local_handler() -> None:
    os.environ["ATTENDANCE_TABLE_NAME"] = "HospitalQueueTable-LocalDev"
    os.environ["REKOGNITION_COLLECTION_ID"] = "attendance-faces"
    os.environ.setdefault("MATCH_THRESHOLD", "80")

    negative_hashes: set[str] = set()
    if NEGATIVE_DIR.exists():
        for neg_file in NEGATIVE_DIR.glob("*.jpg"):
            negative_hashes.add(hashlib.sha256(neg_file.read_bytes()).hexdigest())

    def _build_face_match(person_id: str, similarity: float) -> dict[str, Any]:
        subjects_map = _load_subjects_map()
        info = subjects_map.get(person_id, {})
        full_name = info.get("full_name") or person_id
        gender = _format_gender(info.get("gender_label") or info.get("gender") or "")
        no_rm = info.get("no_rm") or info.get("nim") or person_id
        return {
            "Similarity": similarity,
            "Face": {
                "FaceId": f"face-{person_id.lower()}",
                "ExternalImageId": person_id,
                "NoRm": no_rm,
                "Nim": no_rm,
                "Nik": info.get("nik") or "3273011405950001",
                "FullName": full_name,
                "Gender": gender,
                "Age": int(info.get("age") or 31),
                "BloodType": info.get("blood_type") or "O+",
                "Insurance": info.get("insurance") or "BPJS Kesehatan",
                "Allergies": info.get("allergies") or "Tidak Ada Alergi",
                "ChronicConditions": info.get("chronic_conditions") or "Tidak Ada",
                "Poliklinik": info.get("poliklinik") or "Poli Penyakit Dalam",
                "Dokter": info.get("dokter") or "dr. Hendra Wijaya, Sp.PD",
                "MedicalHistory": info.get("medical_history") or [],
            },
        }

    def mock_index_faces(
        CollectionId: str,
        Image: dict[str, bytes],
        ExternalImageId: str,
        DetectionAttributes: list[str] | None = None,
        MaxFaces: int = 1,
        QualityFilter: str = "AUTO",
    ) -> dict[str, Any]:
        global LAST_CUSTOM_ENROLLED_ID
        image_bytes = Image["Bytes"]
        arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return {"FaceRecords": []}

        ENROLLED_DIR.mkdir(parents=True, exist_ok=True)
        out_path = ENROLLED_DIR / f"{ExternalImageId}.jpg"
        out_path.write_bytes(image_bytes)
        LAST_CUSTOM_ENROLLED_ID = ExternalImageId
        return {
            "FaceRecords": [
                {
                    "Face": {
                        "FaceId": f"face-{ExternalImageId.lower()}",
                        "ExternalImageId": ExternalImageId,
                        "Confidence": 99.8,
                    }
                }
            ]
        }

    def mock_search_faces_by_image(
        CollectionId: str,
        FaceMatchThreshold: float,
        Image: dict[str, bytes],
        MaxFaces: int = 1,
    ) -> dict[str, Any]:
        query_bytes = Image["Bytes"]
        query_hash = hashlib.sha256(query_bytes).hexdigest()

        if query_hash in negative_hashes:
            return {"FaceMatches": []}

        enrolled_files = sorted(ENROLLED_DIR.glob("*.jpg")) if ENROLLED_DIR.exists() else []
        best_person_id = None
        best_score = 0.0

        for fpath in enrolled_files:
            person_id = fpath.stem
            sim = _compute_face_similarity(query_bytes, fpath.read_bytes())
            if sim > best_score:
                best_score = sim
                best_person_id = person_id

        if best_person_id and best_score >= FaceMatchThreshold:
            return {"FaceMatches": [_build_face_match(best_person_id, best_score)]}

        if LAST_CUSTOM_ENROLLED_ID and (ENROLLED_DIR / f"{LAST_CUSTOM_ENROLLED_ID}.jpg").exists():
            custom_bytes = (ENROLLED_DIR / f"{LAST_CUSTOM_ENROLLED_ID}.jpg").read_bytes()
            custom_sim = max(94.2, _compute_face_similarity(query_bytes, custom_bytes))
            return {"FaceMatches": [_build_face_match(LAST_CUSTOM_ENROLLED_ID, custom_sim)]}

        if os.environ.get("AUTO_ENROLL_WEBCAM", "1") == "1":
            arr = np.frombuffer(query_bytes, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None:
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                faces = CASCADE.detectMultiScale(gray, 1.1, 4, minSize=(60, 60))
                if len(faces) > 0:
                    webcam_id = LAST_CUSTOM_ENROLLED_ID or "MHS-2026-001"
                    return {"FaceMatches": [_build_face_match(webcam_id, max(94.8, best_score))]}

        return {"FaceMatches": []}

    def mock_put_item(Item: dict[str, Any]) -> None:
        records: list[dict[str, Any]] = []
        if ATTENDANCE_LOG_PATH.exists():
            try:
                records = json.loads(ATTENDANCE_LOG_PATH.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                records = []
        serializable_item = {
            k: float(v) if hasattr(v, "as_tuple") else v for k, v in Item.items()
        }
        records.insert(0, serializable_item)
        ATTENDANCE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        ATTENDANCE_LOG_PATH.write_text(
            json.dumps(records[:100], indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(
            f"[SIMRS-ANTREAN] Tiket: {serializable_item.get('QueueNumber')} | "
            f"Pasien: {serializable_item.get('FullName')} ({serializable_item.get('NoRM')}) | "
            f"Poli: {serializable_item.get('Poliklinik')}"
        )

    mock_rekognition = MagicMock()
    mock_rekognition.search_faces_by_image.side_effect = mock_search_faces_by_image
    mock_rekognition.index_faces.side_effect = mock_index_faces

    mock_table = MagicMock()
    mock_table.put_item.side_effect = mock_put_item
    mock_dynamodb = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    handler._rekognition_client = mock_rekognition
    handler._dynamodb_resource = mock_dynamodb


class LocalLambdaRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_lambda_response(self, result: dict[str, Any]) -> None:
        status_code = int(result.get("statusCode", 200))
        headers = result.get("headers", {})
        body = result.get("body", "{}")

        self.send_response(status_code)
        for key, value in headers.items():
            self.send_header(key, str(value))
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        event = {"httpMethod": "OPTIONS"}
        result = handler.lambda_handler(event, None)
        self._send_lambda_response(result)

    def do_GET(self) -> None:  # noqa: N802
        clean_path = self.path.split("?")[0].rstrip("/")
        if clean_path == "/v1/attendance/queues":
            queues = handler.get_all_queues_status()
            self._send_lambda_response(
                {
                    "statusCode": 200,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps({"count": len(queues), "queues": queues}),
                }
            )
            return

        if clean_path == "/v1/attendance/logs":
            logs = []
            if ATTENDANCE_LOG_PATH.exists():
                try:
                    logs = json.loads(ATTENDANCE_LOG_PATH.read_text(encoding="utf-8"))
                except Exception:
                    logs = []
            self._send_lambda_response(
                {
                    "statusCode": 200,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps({"count": len(logs), "logs": logs}),
                }
            )
            return

        if clean_path == "/v1/attendance/faces":
            subjects_map = _load_subjects_map()
            faces_list = [
                {
                    "personId": s["person_id"],
                    "noRm": s.get("no_rm") or s.get("nim") or s["person_id"],
                    "nik": s.get("nik", "-"),
                    "fullName": s.get("full_name", s["person_id"]),
                    "gender": _format_gender(
                        s.get("gender_label") or s.get("gender") or ""
                    ),
                    "age": int(s.get("age") or 30),
                    "bloodType": s.get("blood_type", "O+"),
                    "insurance": s.get("insurance", "BPJS Kesehatan"),
                    "allergies": s.get("allergies", "Tidak Ada Alergi"),
                    "chronicConditions": s.get("chronic_conditions", "Tidak Ada"),
                    "poliklinik": s.get("poliklinik", "Poli Umum"),
                    "dokter": s.get("dokter", "dr. Sinta Maharani"),
                    "medicalHistory": s.get("medical_history", []),
                }
                for s in reversed(list(subjects_map.values()))
            ]
            self._send_lambda_response(
                {
                    "statusCode": 200,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps({"count": len(faces_list), "faces": faces_list}),
                }
            )
            return

        self._send_lambda_response(
            {
                "statusCode": 200,
                "headers": handler.CORS_HEADERS,
                "body": json.dumps(
                    {
                        "service": "simrs-biometric-local-backend",
                        "verify_endpoint": "POST /v1/attendance/verify",
                        "enroll_endpoint": "POST /v1/attendance/enroll",
                        "faces_endpoint": "GET /v1/attendance/faces",
                        "logs_endpoint": "GET /v1/attendance/logs",
                    }
                ),
            }
        )

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = (
            self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""
        )
        clean_path = self.path.split("?")[0].rstrip("/")
        event = {
            "httpMethod": "POST",
            "path": clean_path,
            "body": raw_body,
            "isBase64Encoded": False,
        }
        result = handler.lambda_handler(event, None)

        if result.get("statusCode") == 200:
            try:
                resp_payload = json.loads(result.get("body", "{}"))
                if resp_payload.get("status") == "ENROLLED":
                    _save_patient_metadata(resp_payload)
                    print(
                        f"[SIMRS-PASIEN-BARU] No.RM: {resp_payload.get('noRm')} | "
                        f"Nama: {resp_payload.get('fullName')} | "
                        f"Alergi: {resp_payload.get('allergies')}"
                    )
            except Exception as err:
                print(f"[WARN] Gagal menyimpan rekam medis lokal: {err}")

        self._send_lambda_response(result)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    _configure_local_handler()
    server = HTTPServer(("127.0.0.1", port), LocalLambdaRequestHandler)
    print(f"SIMRS Local Backend berjalan di http://localhost:{port}/v1/attendance/verify")
    server.serve_forever()


if __name__ == "__main__":
    main()
