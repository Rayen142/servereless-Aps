"""Script evaluasi & pengujian dataset terhadap endpoint `/attendance/verify` atau `lambda_handler` lokal.

Mendukung dua mode:
1. Live API Gateway (`--api-url https://<api-id>.execute-api.<region>.amazonaws.com/v1/attendance/verify`)
   Mengirim payload `{"image": "data:image/jpeg;base64,..."}` persis seperti frontend React.
2. Simulasi Lokal `lambda_handler` (`--simulate-local`)
   Menguji alur `backend/app/handler.py` secara end-to-end menggunakan mock Rekognition & DynamoDB
   berdasarkan pencocokan fitur wajah pada koleksi `dataset/images/enrolled/`, serta menghasilkan
   tabel metrik evaluasi (TP, TN, FP, FN, Accuracy, Precision, Recall, F1-Score, dan Latency).

Artefak Bab 4 yang dihasilkan (dibaca juga oleh `EvaluationDashboardPage.tsx`):
- `evaluation_report.csv`           : hasil per-sampel uji (format tabel utama).
- `evaluation_summary.csv`          : ringkasan metrik format panjang (section,metric,value,unit,notes).
- `evaluation_threshold_sweep.csv`  : sensitivitas ambang 75%-99% (FAR vs FRR).
- `evaluation_summary.json`         : seluruh data di atas dalam satu berkas untuk dasbor evaluasi.

Definisi metrik (selaras dengan dasbor):
- FAR (False Acceptance Rate) = FP / (FP + TN) x 100%
- FRR (False Rejection Rate)  = FN / (FN + TP) x 100%
- Accuracy                    = (TP + TN) / N x 100%
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
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
SUMMARY_CSV_PATH = BASE_DIR / "evaluation_summary.csv"
SWEEP_CSV_PATH = BASE_DIR / "evaluation_threshold_sweep.csv"
SUMMARY_JSON_PATH = BASE_DIR / "evaluation_summary.json"

SWEEP_MIN_THRESHOLD = 75
SWEEP_MAX_THRESHOLD = 99

# Urutan kolom WAJIB sama dengan `REPORT_CSV_COLUMNS` di src/lib/evaluationMetrics.ts
REPORT_CSV_COLUMNS = [
    "case_id",
    "type",
    "full_name",
    "expected_person_id",
    "predicted_person_id",
    "recognized",
    "similarity",
    "latency_ms",
    "outcome",
    "best_match_id",
    "best_score",
    "payload_kb",
    "network_ms",
    "cloud_ms",
    "rekognition_ms",
    "start_type",
]
SWEEP_CSV_COLUMNS = [
    "threshold",
    "tp",
    "tn",
    "fp",
    "fn",
    "far_pct",
    "frr_pct",
    "accuracy_pct",
]
SUMMARY_CSV_COLUMNS = ["section", "metric", "value", "unit", "notes"]


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


class LocalSimulator:
    """Membungkus `lambda_handler` lokal + mock Rekognition yang merekam skor mentah.

    Skor mentah (best match tanpa memandang ambang) diperlukan untuk analisis
    sensitivitas threshold; Rekognition asli hanya mengembalikan kandidat di atas
    `FaceMatchThreshold`, sehingga skor impostor tidak terlihat dari respons API.
    """

    def __init__(self, enrolled_subjects: list[dict[str, Any]]):
        self.last_search: dict[str, Any] = {}
        self.cold_init_ms = 0.0

        t_init = time.perf_counter()
        self.lambda_handler = self._setup(enrolled_subjects)
        # Waktu import modul handler + inisialisasi klien ~ fase INIT cold start Lambda.
        self.cold_init_ms = (time.perf_counter() - t_init) * 1000.0

    def _setup(self, enrolled_subjects: list[dict[str, Any]]):
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

        simulator = self

        def mock_search_faces_by_image(
            CollectionId: str,
            FaceMatchThreshold: float,
            Image: dict[str, bytes],
            MaxFaces: int = 1,
        ) -> dict[str, Any]:
            t0 = time.perf_counter()
            query_bytes = Image["Bytes"]
            best_person_id = None
            best_score = 0.0
            for person_id, ref_bytes in enrolled_bytes_map.items():
                sim = _compute_face_similarity(query_bytes, ref_bytes)
                if sim > best_score:
                    best_score = sim
                    best_person_id = person_id

            simulator.last_search = {
                "best_match_id": best_person_id,
                "best_score": best_score,
                "rekognition_ms": (time.perf_counter() - t0) * 1000.0,
            }

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
        self.threshold = float(handler._match_threshold())
        return handler.lambda_handler

    def invoke(self, data_url: str) -> dict[str, Any]:
        self.last_search = {}
        event = {
            "httpMethod": "POST",
            "body": json.dumps({"image": data_url}),
            "isBase64Encoded": False,
        }
        raw_resp = self.lambda_handler(event, None)
        return json.loads(raw_resp["body"])


def _call_live_api(api_url: str, data_url: str) -> dict[str, Any]:
    payload = json.dumps({"image": data_url}).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        # Respons 4xx (mis. wajah tidak dikenali) tetap berisi body JSON yang valid.
        try:
            return json.loads(err.read().decode("utf-8"))
        except Exception:
            return {"success": False, "error": f"HTTP {err.code}"}


def _classify(
    expected_rec: bool,
    expected_id: str | None,
    recognized: bool,
    predicted_id: str | None,
) -> str:
    if expected_rec:
        if recognized and predicted_id == expected_id:
            return "TP"
        if recognized and predicted_id != expected_id:
            return "FP"  # salah orang (misidentification) = false accept
        return "FN"
    return "FP" if recognized else "TN"


def _rates(tp: int, tn: int, fp: int, fn: int) -> dict[str, float]:
    total = tp + tn + fp + fn
    return {
        "accuracy": round(((tp + tn) / total) * 100, 2) if total else 0.0,
        "precision": round((tp / (tp + fp)) * 100, 2) if (tp + fp) else 0.0,
        "recall": round((tp / (tp + fn)) * 100, 2) if (tp + fn) else 0.0,
        "far": round((fp / (fp + tn)) * 100, 2) if (fp + tn) else 0.0,
        "frr": round((fn / (fn + tp)) * 100, 2) if (fn + tp) else 0.0,
    }


def _f1(precision: float, recall: float) -> float:
    return (
        round((2 * precision * recall) / (precision + recall), 2)
        if (precision + recall)
        else 0.0
    )


def _threshold_sweep(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Klasifikasi ulang setiap sampel dengan skor mentah pada ambang 75%-99%."""
    sweep: list[dict[str, Any]] = []
    for thr in range(SWEEP_MIN_THRESHOLD, SWEEP_MAX_THRESHOLD + 1):
        tp = tn = fp = fn = 0
        for r in results:
            accepted = r["best_score"] >= thr and bool(r["best_match_id"])
            outcome = _classify(
                r["type"] == "POSITIVE",
                r["expected_person_id"] or None,
                accepted,
                r["best_match_id"] if accepted else None,
            )
            if outcome == "TP":
                tp += 1
            elif outcome == "TN":
                tn += 1
            elif outcome == "FP":
                fp += 1
            else:
                fn += 1
        rates = _rates(tp, tn, fp, fn)
        sweep.append(
            {
                "threshold": thr,
                "tp": tp,
                "tn": tn,
                "fp": fp,
                "fn": fn,
                "far_pct": rates["far"],
                "frr_pct": rates["frr"],
                "accuracy_pct": rates["accuracy"],
            }
        )
    return sweep


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * (pct / 100.0)
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo), 2)


def _mean(values: list[float]) -> float | None:
    return round(statistics.fmean(values), 2) if values else None


def _fmt_csv(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "True" if value else "False"
    return value


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
    parser.add_argument(
        "--lambda-threshold",
        type=float,
        default=80.0,
        help="Nilai MATCH_THRESHOLD Lambda yang ter-deploy (mode live) untuk catatan validitas sweep",
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

    simulator: LocalSimulator | None = None
    threshold = args.lambda_threshold
    mode = "simulate-local" if args.simulate_local else "live-api"
    start_detection = "local_import_timing"
    if args.simulate_local:
        simulator = LocalSimulator(metadata["subjects"])
        threshold = simulator.threshold

    cases = test_data["cases"]
    results: list[dict[str, Any]] = []
    tp = tn = fp = fn = 0
    handler_reports_timing = False
    handler_reports_cold = False

    print(f"Menjalankan evaluasi ({mode}) untuk {len(cases)} skenario uji...")
    print("-" * 118)
    print(
        f"{'Case ID':<10} | {'Tipe':<8} | {'Target ID':<14} | {'Prediksi ID':<14} | "
        f"{'Sim (%)':<8} | {'Best (%)':<8} | {'Waktu':<9} | {'Start':<5} | {'Hasil'}"
    )
    print("-" * 118)

    for idx, case in enumerate(cases):
        img_path = BASE_DIR / case["image_path"]
        data_url = _encode_data_url(img_path)
        payload_kb = round(len(json.dumps({"image": data_url}).encode("utf-8")) / 1024.0, 2)

        network_ms: float | None = None
        rekognition_ms: float | None = None
        best_match_id: str | None = None
        best_score = 0.0

        t0 = time.perf_counter()
        if simulator is not None:
            resp_body = simulator.invoke(data_url)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            cloud_ms: float | None = elapsed_ms
            rekognition_ms = simulator.last_search.get("rekognition_ms")
            best_match_id = simulator.last_search.get("best_match_id")
            best_score = float(simulator.last_search.get("best_score", 0.0))
            start_type = "COLD" if idx == 0 else "WARM"
            if idx == 0:
                # Cold start = fase INIT (import + klien) + eksekusi pertama
                cloud_ms = elapsed_ms + simulator.cold_init_ms
                elapsed_ms = cloud_ms
        else:
            resp_body = _call_live_api(args.api_url, data_url)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            # Field opsional `serverTiming` & `coldStart` dari handler (jika diinstrumentasi)
            server_timing = resp_body.get("serverTiming") or {}
            if isinstance(server_timing, dict) and server_timing.get("totalMs") is not None:
                handler_reports_timing = True
                cloud_ms = float(server_timing["totalMs"])
                network_ms = max(0.0, elapsed_ms - cloud_ms)
                if server_timing.get("rekognitionMs") is not None:
                    rekognition_ms = float(server_timing["rekognitionMs"])
            else:
                cloud_ms = None
            if "coldStart" in resp_body:
                handler_reports_cold = True
                start_type = "COLD" if resp_body.get("coldStart") else "WARM"
            else:
                start_type = "COLD" if idx == 0 else "WARM"

        recognized = bool(resp_body.get("success") is True)
        predicted_id = resp_body.get("personId")
        similarity = float(resp_body.get("similarity", 0.0) or 0.0)
        if simulator is None and recognized:
            # Mode live: hanya kandidat di atas ambang Lambda yang terlihat
            best_match_id = predicted_id
            best_score = similarity

        expected_rec = case["expected_recognized"]
        expected_id = case["expected_person_id"]
        outcome = _classify(expected_rec, expected_id, recognized, predicted_id)
        if outcome == "TP":
            tp += 1
        elif outcome == "TN":
            tn += 1
        elif outcome == "FP":
            fp += 1
        else:
            fn += 1

        print(
            f"{case['case_id']:<10} | {case['type']:<8} | {str(expected_id or '-'):<14} | "
            f"{str(predicted_id or '-'):<14} | {similarity:>7.2f}% | {best_score:>7.2f}% | "
            f"{elapsed_ms:>6.1f} ms | {start_type:<5} | {outcome}"
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
                "outcome": outcome,
                "best_match_id": best_match_id or "",
                "best_score": round(best_score, 2),
                "payload_kb": payload_kb,
                "network_ms": round(network_ms, 2) if network_ms is not None else None,
                "cloud_ms": round(cloud_ms, 2) if cloud_ms is not None else None,
                "rekognition_ms": round(rekognition_ms, 2) if rekognition_ms is not None else None,
                "start_type": start_type,
            }
        )

    if simulator is None:
        start_detection = "handler_flag" if handler_reports_cold else "first_request_heuristic"

    total = len(results)
    rates = _rates(tp, tn, fp, fn)
    f1_score = _f1(rates["precision"], rates["recall"])
    sweep = _threshold_sweep(results)
    eer_row = min(sweep, key=lambda r: (abs(r["far_pct"] - r["frr_pct"]), r["threshold"]))

    latencies = [r["latency_ms"] for r in results]
    cloud_vals = [r["cloud_ms"] for r in results if r["cloud_ms"] is not None]
    warm_cloud = [
        r["cloud_ms"] for r in results if r["cloud_ms"] is not None and r["start_type"] == "WARM"
    ]
    cold_cloud = [
        r["cloud_ms"] for r in results if r["cloud_ms"] is not None and r["start_type"] == "COLD"
    ]
    warm_total = [r["latency_ms"] for r in results if r["start_type"] == "WARM"]
    cold_total = [r["latency_ms"] for r in results if r["start_type"] == "COLD"]
    net_vals = [r["network_ms"] for r in results if r["network_ms"] is not None]
    rek_vals = [r["rekognition_ms"] for r in results if r["rekognition_ms"] is not None]
    payload_vals = [r["payload_kb"] for r in results]
    positives = sum(1 for r in results if r["type"] == "POSITIVE")
    negatives = total - positives

    notes: list[str] = []
    if mode == "simulate-local":
        notes.append(
            "Mode simulasi lokal: Rekognition & DynamoDB di-mock; latensi cloud bukan latensi AWS sebenarnya."
        )
        notes.append("Network & payload transit tidak diukur pada mode lokal (tidak ada jaringan).")
    else:
        if not handler_reports_timing:
            notes.append(
                "Handler tidak mengirim field serverTiming; pemisahan network vs cloud tidak dapat diukur."
            )
        if not handler_reports_cold:
            notes.append(
                "Cold start ditentukan heuristik permintaan pertama (handler tidak mengirim field coldStart)."
            )
        if args.lambda_threshold > SWEEP_MIN_THRESHOLD:
            notes.append(
                f"Skor di bawah ambang Lambda ({args.lambda_threshold:.0f}%) tidak dikembalikan Rekognition; "
                f"sweep < {args.lambda_threshold:.0f}% bersifat batas bawah."
            )
    if negatives < 20:
        notes.append(
            f"Hanya {negatives} sampel negatif: resolusi FAR = {100 / negatives if negatives else 0:.1f}% per sampel."
        )

    latency_summary = {
        "totalAvgMs": _mean(latencies),
        "totalP50Ms": _percentile(latencies, 50),
        "totalP95Ms": _percentile(latencies, 95),
        "networkAvgMs": _mean(net_vals),
        "networkMeasured": bool(net_vals),
        "cloudAvgMs": _mean(cloud_vals),
        "rekognitionAvgMs": _mean(rek_vals),
        "coldStartMs": _mean(cold_cloud) if cold_cloud else _mean(cold_total),
        "warmAvgMs": _mean(warm_cloud) if warm_cloud else _mean(warm_total),
        "coldInitMs": round(simulator.cold_init_ms, 2) if simulator else None,
        "coldSamples": len(cold_total),
        "warmSamples": len(warm_total),
        "startDetection": start_detection,
    }

    summary = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "apiUrl": args.api_url if mode == "live-api" else None,
        "threshold": threshold,
        "dataset": {
            "totalCases": total,
            "positiveCases": positives,
            "negativeCases": negatives,
            "enrolledSubjects": len(metadata.get("subjects", [])),
        },
        "confusionMatrix": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
        "metrics": {
            "accuracy": rates["accuracy"],
            "precision": rates["precision"],
            "recall": rates["recall"],
            "f1Score": f1_score,
            "far": rates["far"],
            "frr": rates["frr"],
        },
        "eer": {
            "threshold": eer_row["threshold"],
            "far": eer_row["far_pct"],
            "frr": eer_row["frr_pct"],
        },
        "latency": latency_summary,
        "payload": {"avgKb": _mean(payload_vals)},
        "thresholdSweep": sweep,
        "notes": notes,
        "cases": results,
    }

    # ----------------------------- Ringkasan konsol -----------------------------
    print("-" * 118)
    print(f"Ringkasan Evaluasi ({total} Sampel, threshold {threshold:.0f}%):")
    print(f"  True Positive (TP)  : {tp}")
    print(f"  True Negative (TN)  : {tn}")
    print(f"  False Positive (FP) : {fp}")
    print(f"  False Negative (FN) : {fn}")
    print(f"  Accuracy            : {rates['accuracy']:.2f}%")
    print(f"  Precision           : {rates['precision']:.2f}%")
    print(f"  Recall              : {rates['recall']:.2f}%")
    print(f"  F1-Score            : {f1_score:.2f}%")
    print(f"  FAR                 : {rates['far']:.2f}%")
    print(f"  FRR                 : {rates['frr']:.2f}%")
    print(
        f"  EER (perkiraan)     : ~{eer_row['far_pct']:.2f}% / {eer_row['frr_pct']:.2f}% "
        f"@ threshold {eer_row['threshold']}%"
    )
    print("\nBreakdown Latensi:")
    for key, label in (
        ("totalAvgMs", "Total rata-rata"),
        ("totalP95Ms", "Total P95"),
        ("networkAvgMs", "Network & payload"),
        ("cloudAvgMs", "Cloud matching"),
        ("rekognitionAvgMs", "SearchFacesByImage"),
        ("coldStartMs", "Cold start"),
        ("warmAvgMs", "Warm start (rata2)"),
    ):
        val = latency_summary[key]
        print(f"  {label:<20}: {f'{val:.2f} ms' if val is not None else 'tidak diukur'}")

    print("\nSensitivitas Threshold (FAR vs FRR):")
    print(f"  {'Thr':>4} | {'TP':>3} {'TN':>3} {'FP':>3} {'FN':>3} | {'FAR':>7} | {'FRR':>7} | {'Acc':>7}")
    for row in sweep:
        print(
            f"  {row['threshold']:>3}% | {row['tp']:>3} {row['tn']:>3} {row['fp']:>3} {row['fn']:>3} | "
            f"{row['far_pct']:>6.2f}% | {row['frr_pct']:>6.2f}% | {row['accuracy_pct']:>6.2f}%"
        )
    for note in notes:
        print(f"[CATATAN] {note}")

    # ------------------------------- Tulis artefak ------------------------------
    # utf-8-sig agar nama berkarakter non-ASCII tampil benar di Microsoft Excel
    with open(REPORT_CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(REPORT_CSV_COLUMNS)
        for r in results:
            writer.writerow([_fmt_csv(r[col]) for col in REPORT_CSV_COLUMNS])

    with open(SWEEP_CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(SWEEP_CSV_COLUMNS)
        for row in sweep:
            writer.writerow([row[col] for col in SWEEP_CSV_COLUMNS])

    summary_rows: list[list[Any]] = [
        ["dataset", "mode", mode, "", ""],
        ["dataset", "total_cases", total, "sampel", ""],
        ["dataset", "positive_cases", positives, "sampel", "test_positive/"],
        ["dataset", "negative_cases", negatives, "sampel", "test_negative/"],
        ["dataset", "threshold", threshold, "%", "MATCH_THRESHOLD"],
        ["confusion_matrix", "TP", tp, "sampel", ""],
        ["confusion_matrix", "TN", tn, "sampel", ""],
        ["confusion_matrix", "FP", fp, "sampel", ""],
        ["confusion_matrix", "FN", fn, "sampel", ""],
        ["metrics", "accuracy", rates["accuracy"], "%", "(TP+TN)/N"],
        ["metrics", "precision", rates["precision"], "%", "TP/(TP+FP)"],
        ["metrics", "recall", rates["recall"], "%", "TP/(TP+FN)"],
        ["metrics", "f1_score", f1_score, "%", "2PR/(P+R)"],
        ["metrics", "far", rates["far"], "%", "FP/(FP+TN)"],
        ["metrics", "frr", rates["frr"], "%", "FN/(FN+TP)"],
        ["metrics", "eer_threshold", eer_row["threshold"], "%", "|FAR-FRR| minimum"],
    ]
    for key, val in latency_summary.items():
        if key in ("startDetection", "networkMeasured"):
            summary_rows.append(["latency", key, _fmt_csv(val), "", ""])
        elif key.endswith("Samples"):
            summary_rows.append(["latency", key, val, "sampel", ""])
        else:
            summary_rows.append(["latency", key, _fmt_csv(val), "ms", ""])
    summary_rows.append(["payload", "avg_payload", _fmt_csv(_mean(payload_vals)), "KB", "JSON base64"])
    for note in notes:
        summary_rows.append(["notes", "catatan", "", "", note])

    with open(SUMMARY_CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(SUMMARY_CSV_COLUMNS)
        writer.writerows(summary_rows)

    with open(SUMMARY_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print(f"\nLaporan per-sampel   : {REPORT_CSV_PATH}")
    print(f"Ringkasan metrik     : {SUMMARY_CSV_PATH}")
    print(f"Sweep threshold      : {SWEEP_CSV_PATH}")
    print(f"Data dasbor (JSON)   : {SUMMARY_JSON_PATH}")


if __name__ == "__main__":
    main()
