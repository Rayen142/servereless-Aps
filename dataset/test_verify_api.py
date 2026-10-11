"""Script evaluasi & pengujian dataset terhadap endpoint `/attendance/verify` atau `lambda_handler` lokal.

Mendukung dua mode:
1. Live API Gateway (`--api-url https://<api-id>.execute-api.<region>.amazonaws.com/v1/attendance/verify`)
   Mengirim payload `{"image": "data:image/jpeg;base64,..."}` persis seperti frontend React.
2. Simulasi Lokal `lambda_handler` (`--simulate-local`)
   Menguji alur `backend/app/handler.py` secara end-to-end menggunakan mock Rekognition & DynamoDB
   berdasarkan pencocokan fitur wajah pada koleksi `dataset/images/enrolled/`, serta menghasilkan
   tabel metrik evaluasi (TP, TN, FP, FN, Accuracy, Precision, Recall, F1-Score, dan Latency).
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

METADATA_PATH = BASE_DIR / "metadata.json"
TEST_CASES_PATH = BASE_DIR / "test_cases.json"
REPORT_CSV_PATH = BASE_DIR / "evaluation_report.csv"


def _encode_data_url(image_path: Path) -> str:
    b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _compute_face_similarity(img_a_bytes: bytes, img_b_bytes: bytes) -> float:
    """Menghitung skor kemiripan (0-100) berbasis template & histogram ROI wajah tengah."""
    arr_a = np.frombuffer(img_a_bytes, np.uint8)
    arr_b = np.frombuffer(img_b_bytes, np.uint8)
    img_a = cv2.imdecode(arr_a, cv2.IMREAD_GRAYSCALE)
    img_b = cv2.imdecode(arr_b, cv2.IMREAD_GRAYSCALE)
    if img_a is None or img_b is None:
        return 0.0

    # Ambil area wajah di tengah (240x240)
    h, w = img_a.shape[:2]
    cy, cx = h // 2, w // 2
    roi_a = cv2.resize(img_a[cy - 120 : cy + 120, cx - 120 : cx + 120], (128, 128))
    roi_b = cv2.resize(img_b[cy - 120 : cy + 120, cx - 120 : cx + 120], (128, 128))

    roi_a = cv2.equalizeHist(roi_a)
    roi_b = cv2.equalizeHist(roi_b)

    corr = float(cv2.matchTemplate(roi_a, roi_b, cv2.TM_CCOEFF_NORMED)[0][0])
    score = max(0.0, min(100.0, (corr + 0.15) * 95.0))
    return round(score, 2)


def _setup_local_lambda_simulator(enrolled_subjects: list[dict[str, Any]]):
    """Menyiapkan `backend.app.handler.lambda_handler` dengan mock Rekognition & DynamoDB."""
    # Jika boto3 belum terinstal di environment lokal, sediakan stub ringan agar handler.py dapat diimpor
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

    from app import handler

    os.environ["ATTENDANCE_TABLE_NAME"] = "AttendanceTable-LocalTest"
    os.environ["REKOGNITION_COLLECTION_ID"] = "attendance-faces"
    os.environ.setdefault("MATCH_THRESHOLD", "80")

    enrolled_bytes_map: dict[str, bytes] = {}
    for subj in enrolled_subjects:
        img_path = BASE_DIR / subj["enrolled_image"]
        enrolled_bytes_map[subj["person_id"]] = img_path.read_bytes()

    def mock_search_faces_by_image(
        CollectionId: str,
        FaceMatchThreshold: float,
        Image: dict[str, bytes],
        MaxFaces: int = 1,
    ) -> dict[str, Any]:
        query_bytes = Image["Bytes"]
        best_person_id = None
        best_score = 0.0
        for person_id, ref_bytes in enrolled_bytes_map.items():
            sim = _compute_face_similarity(query_bytes, ref_bytes)
            if sim > best_score:
                best_score = sim
                best_person_id = person_id

        if best_person_id and best_score >= FaceMatchThreshold:
            return {
                "FaceMatches": [
                    {
                        "Similarity": best_score,
                        "Face": {
                            "FaceId": f"face-{best_person_id.lower()}",
                            "ExternalImageId": best_person_id,
                        },
                    }
                ]
            }
        return {"FaceMatches": []}

    mock_rekognition = MagicMock()
    mock_rekognition.search_faces_by_image.side_effect = mock_search_faces_by_image

    mock_table = MagicMock()
    mock_dynamodb = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    handler._rekognition_client = mock_rekognition
    handler._dynamodb_resource = mock_dynamodb
    return handler.lambda_handler


def _call_live_api(api_url: str, data_url: str) -> dict[str, Any]:
    payload = json.dumps({"image": data_url}).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluasi akurasi dataset wajah terhadap API verifikasi absensi."
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("VITE_API_URL"),
        help="URL endpoint POST /attendance/verify di API Gateway",
    )
    parser.add_argument(
        "--simulate-local",
        action="store_true",
        help="Jalankan simulasi pengujian langsung terhadap fungsi lambda_handler lokal",
    )
    args = parser.parse_args()

    if not args.api_url and not args.simulate_local:
        print(
            "[INFO] --api-url tidak diberikan, menjalankan dalam mode --simulate-local.\n"
        )
        args.simulate_local = True

    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    with open(TEST_CASES_PATH, "r", encoding="utf-8") as f:
        test_data = json.load(f)

    local_handler = None
    if args.simulate_local:
        local_handler = _setup_local_lambda_simulator(metadata["subjects"])

    cases = test_data["cases"]
    results: list[dict[str, Any]] = []
    tp = tn = fp = fn = 0

    print(f"Menjalankan evaluasi untuk {len(cases)} skenario uji...")
    print("-" * 95)
    print(
        f"{'Case ID':<10} | {'Tipe':<8} | {'Target ID':<14} | {'Prediksi ID':<14} | {'Sim (%)':<8} | {'Waktu':<8} | {'Hasil'}"
    )
    print("-" * 95)

    for case in cases:
        img_path = BASE_DIR / case["image_path"]
        data_url = _encode_data_url(img_path)

        t0 = time.perf_counter()
        if args.simulate_local and local_handler is not None:
            event = {
                "httpMethod": "POST",
                "body": json.dumps({"image": data_url}),
                "isBase64Encoded": False,
            }
            raw_resp = local_handler(event, None)
            resp_body = json.loads(raw_resp["body"])
        else:
            resp_body = _call_live_api(args.api_url, data_url)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        recognized = bool(resp_body.get("success") is True)
        predicted_id = resp_body.get("personId")
        similarity = float(resp_body.get("similarity", 0.0))

        expected_rec = case["expected_recognized"]
        expected_id = case["expected_person_id"]

        if expected_rec:
            if recognized and predicted_id == expected_id:
                outcome = "TP (Benar)"
                tp += 1
            elif recognized and predicted_id != expected_id:
                outcome = "FP (Salah Orang)"
                fp += 1
            else:
                outcome = "FN (Gagal Kenal)"
                fn += 1
        else:
            if not recognized:
                outcome = "TN (Benar Ditolak)"
                tn += 1
            else:
                outcome = "FP (Impostor Lolos)"
                fp += 1

        print(
            f"{case['case_id']:<10} | {case['type']:<8} | {str(expected_id or '-'):<14} | "
            f"{str(predicted_id or '-'):<14} | {similarity:>7.2f}% | {elapsed_ms:>5.1f} ms | {outcome}"
        )

        results.append(
            {
                "case_id": case["case_id"],
                "type": case["type"],
                "full_name": case["full_name"],
                "expected_person_id": expected_id or "",
                "predicted_person_id": predicted_id or "",
                "recognized": recognized,
                "similarity": round(similarity, 2),
                "latency_ms": round(elapsed_ms, 2),
                "outcome": outcome.split()[0],
            }
        )

    total = len(cases)
    accuracy = ((tp + tn) / total) * 100 if total else 0.0
    precision = (tp / (tp + fp)) * 100 if (tp + fp) else 0.0
    recall = (tp / (tp + fn)) * 100 if (tp + fn) else 0.0

    print("-" * 95)
    print(f"Ringkasan Evaluasi ({total} Sampel):")
    print(f"  True Positive (TP)  : {tp}")
    print(f"  True Negative (TN)  : {tn}")
    print(f"  False Positive (FP) : {fp}")
    print(f"  False Negative (FN) : {fn}")
    print(f"  Accuracy            : {accuracy:.2f}%")
    print(f"  Precision           : {precision:.2f}%")
    print(f"  Recall              : {recall:.2f}%")

    with open(REPORT_CSV_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)
    print(f"\nLaporan lengkap disimpan ke: {REPORT_CSV_PATH}")


if __name__ == "__main__":
    main()
