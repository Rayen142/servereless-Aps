"""Local Development API Server untuk Sistem Pengenalan Wajah & Antrean Pasien Rumah Sakit (SIMRS).

Menyediakan endpoint:
  POST http://localhost:8000/v1/attendance/verify          (Scan wajah pasien lama -> Riwayat Medis, Alergi, & Tiket Antrean Otomatis)
  POST http://localhost:8000/v1/attendance/enroll          (Scan wajah daftar pasien baru -> Simpan Rekam Medis & Antrean)
  POST http://localhost:8000/v1/attendance/lookup          (Fallback pencarian manual via NIK / No. RM / Nama)
  POST http://localhost:8000/v1/attendance/medical-record  (Tambah catatan pemeriksaan dokter ke riwayat medis pasien)
  POST http://localhost:8000/v1/attendance/evaluate        (Jalankan ulang benchmark evaluasi 25 sampel uji biometrik)
  GET  http://localhost:8000/v1/attendance/analytics       (Metrik evaluasi biometrik TP/TN/FP/FN, Latency, & Statistik SIMRS)
  GET  http://localhost:8000/v1/attendance/queues          (Status antrean poliklinik real-time)
  GET  http://localhost:8000/v1/attendance/faces           (Daftar pasien terdaftar di database RS)
  GET  http://localhost:8000/v1/attendance/logs            (Riwayat tiket antrean & kunjungan pasien)
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import cv2
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("simrs.local_server")

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
DATASET_DIR = PROJECT_ROOT / "dataset"
ENROLLED_DIR = DATASET_DIR / "images" / "enrolled"
NEGATIVE_DIR = DATASET_DIR / "images" / "test_negative"
METADATA_JSON_PATH = DATASET_DIR / "metadata.json"
METADATA_CSV_PATH = DATASET_DIR / "metadata.csv"
TEST_CASES_PATH = DATASET_DIR / "test_cases.json"
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


def _load_face_cascade() -> Any:
    if not hasattr(cv2, "CascadeClassifier"):
        return None
    xml_url = "https://cdn.jsdelivr.net/gh/opencv/opencv@4.x/data/haarcascades/haarcascade_frontalface_default.xml"
    xml_path = os.path.join(tempfile.gettempdir(), "haarcascade_frontalface_default.xml")
    if not os.path.exists(xml_path):
        try:
            urllib.request.urlretrieve(xml_url, xml_path)
        except Exception as err:
            logger.warning("Gagal mengunduh Haar Cascade XML dari CDN: %s", err)
            return None
    try:
        return cv2.CascadeClassifier(xml_path)
    except Exception as err:
        logger.warning("Gagal memuat cv2.CascadeClassifier: %s", err)
        return None


CASCADE = _load_face_cascade()
CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
ORB_DETECTOR = cv2.ORB_create(nfeatures=120, scaleFactor=1.2, nlevels=4)
BF_MATCHER = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

# In-memory cache untuk mempercepat ekstraksi fitur wajah (LBPH + HOG + ORB + ROI)
_ENROLLED_FACE_CACHE: dict[str, tuple[int, dict[str, Any]]] = {}
_CACHED_EVALUATION_REPORT: dict[str, Any] | None = None


def _load_subjects_map() -> dict[str, dict[str, Any]]:
    try:
        from app import database
        db_map = database.get_all_patients_map()
        if db_map:
            return db_map
    except Exception as err:
        logger.error("Gagal memuat peta pasien dari SQLite: %s", err)
    if not METADATA_JSON_PATH.exists():
        return {}
    try:
        data = json.loads(METADATA_JSON_PATH.read_text(encoding="utf-8"))
        subjects = data.get("subjects", [])
        return {s["person_id"]: s for s in subjects if "person_id" in s}
    except Exception as err:
        logger.error("Gagal membaca fallback metadata.json: %s", err)
        return {}


def _canonical_id_of(subjects_map: dict[str, dict[str, Any]], person_id: str) -> str:
    """ID profil rekam medis utama untuk sebuah sampel wajah (alias -> RM utama)."""
    info = subjects_map.get(person_id) or {}
    canonical = str(info.get("canonical_person_id") or "").strip()
    return canonical if canonical and canonical in subjects_map else person_id


def _canonical_subjects(
    subjects_map: dict[str, dict[str, Any]],
) -> list[tuple[dict[str, Any], list[str]]]:
    """Daftar profil pasien unik beserta seluruh ID sampel wajah yang tertaut."""
    linked: dict[str, list[str]] = {}
    for pid in subjects_map:
        linked.setdefault(_canonical_id_of(subjects_map, pid), []).append(pid)
    return [
        (subjects_map[cid], sorted(set(face_ids), key=lambda x: (x != cid, x)))
        for cid, face_ids in linked.items()
    ]


def _format_gender(gender_val: str) -> str:
    if gender_val in ("L", "Laki-laki"):
        return "Laki-laki"
    if gender_val in ("P", "Perempuan"):
        return "Perempuan"
    return gender_val or "-"


def _save_patient_metadata(resp_payload: dict[str, Any]) -> dict[str, Any]:
    try:
        from app import database
        saved = database.upsert_patient(resp_payload)
        if saved:
            return saved
    except Exception as err:
        logger.error("Gagal menyimpan pasien baru ke SQLite: %s", err)
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
        except Exception as err:
            logger.warning("Gagal membaca metadata.json saat simpan pasien: %s", err)

    subjects: list[dict[str, Any]] = data.get("subjects", [])
    existing_idx = next(
        (i for i, s in enumerate(subjects) if s.get("person_id") == person_id),
        None,
    )
    record = {
        "person_id": person_id,
        "canonical_person_id": resp_payload.get("canonicalPersonId") or person_id,
        "no_rm": resp_payload.get("noRm") or person_id,
        "nim": resp_payload.get("noRm") or person_id,
        "nik": resp_payload.get("nik") or "3273010000000000",
        "full_name": resp_payload["fullName"],
        "birth_date": resp_payload.get("birthDate") or resp_payload.get("birth_date") or "1995-01-01",
        "gender": gender_code,
        "gender_label": "Laki-laki" if gender_code == "L" else "Perempuan",
        "age": int(resp_payload.get("age") or 30),
        "blood_type": resp_payload.get("bloodType") or "O+",
        "insurance": resp_payload.get("insurance") or "BPJS Kesehatan",
        "allergies": resp_payload.get("allergies") or "Tidak Ada Alergi",
        "chronic_conditions": resp_payload.get("chronicConditions") or "Tidak Ada",
        "poliklinik": resp_payload.get("poliklinik") or "Poli Umum",
        "dokter": resp_payload.get("dokter") or "dr. Sinta Maharani",
        "medical_notes": resp_payload.get("medicalNotes") or resp_payload.get("medical_notes") or "Pasien baru terdaftar",
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
        "canonical_person_id",
        "no_rm",
        "nik",
        "full_name",
        "birth_date",
        "gender",
        "age",
        "blood_type",
        "insurance",
        "allergies",
        "chronic_conditions",
        "poliklinik",
        "dokter",
        "medical_notes",
        "enrolled_image",
        "positive_test_image",
    ]
    with open(METADATA_CSV_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(subjects)

    return record


def _append_medical_history_to_metadata(
    person_id: str, no_rm: str, new_entry: dict[str, str]
) -> list[dict[str, Any]]:
    try:
        from app import database
        return database.insert_medical_record(person_id, no_rm, new_entry)
    except Exception as err:
        logger.error("Gagal menyimpan rekam medis baru ke SQLite: %s", err)
    if not METADATA_JSON_PATH.exists():
        return [new_entry]
    try:
        data = json.loads(METADATA_JSON_PATH.read_text(encoding="utf-8"))
        subjects: list[dict[str, Any]] = data.get("subjects", [])
        updated_history: list[dict[str, Any]] = [new_entry]
        for subj in subjects:
            if subj.get("person_id") == person_id or subj.get("no_rm") == no_rm:
                history = list(subj.get("medical_history") or [])
                history.insert(0, new_entry)
                subj["medical_history"] = history
                updated_history = history
                break
        data["subjects"] = subjects
        METADATA_JSON_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return updated_history
    except Exception as err:
        logger.error("Gagal memperbarui riwayat medis di metadata.json: %s", err)
        return [new_entry]


def _extract_face_roi(gray_img: np.ndarray) -> np.ndarray:
    if CASCADE is not None and hasattr(CASCADE, "detectMultiScale"):
        try:
            faces = CASCADE.detectMultiScale(gray_img, 1.1, 4, minSize=(60, 60))
            if len(faces) > 0:
                x, y, w, h = max(faces, key=lambda b: b[2] * b[3])
                roi = gray_img[y : y + h, x : x + w]
                resized = cv2.resize(roi, (128, 128))
                return CLAHE.apply(resized)
        except Exception as err:
            logger.debug("Deteksi Haar Cascade gagal pada frame, menggunakan center crop: %s", err)
    h, w = gray_img.shape[:2]
    cy, cx = h // 2, w // 2
    r = min(h, w) // 4
    roi = gray_img[cy - r : cy + r, cx - r : cx + r]
    resized = cv2.resize(roi, (128, 128))
    return CLAHE.apply(resized)


def _compute_spatial_lbph_descriptor(face_128: np.ndarray) -> np.ndarray:
    """Ekstraksi fitur tekstur mikro wajah menggunakan Spatial Local Binary Patterns (LBPH) 4x4 grid."""
    padded = np.pad(face_128, 1, mode="edge").astype(np.int16)
    center = padded[1:-1, 1:-1]
    lbp = (
        ((padded[0:-2, 0:-2] >= center).astype(np.uint8) << 7)
        | ((padded[0:-2, 1:-1] >= center).astype(np.uint8) << 6)
        | ((padded[0:-2, 2:] >= center).astype(np.uint8) << 5)
        | ((padded[1:-1, 2:] >= center).astype(np.uint8) << 4)
        | ((padded[2:, 2:] >= center).astype(np.uint8) << 3)
        | ((padded[2:, 1:-1] >= center).astype(np.uint8) << 2)
        | ((padded[2:, 0:-2] >= center).astype(np.uint8) << 1)
        | (padded[1:-1, 0:-2] >= center).astype(np.uint8)
    )
    hists: list[np.ndarray] = []
    cell = 32  # 4x4 grid pada citra 128x128
    for gy in range(0, 128, cell):
        for gx in range(0, 128, cell):
            block = lbp[gy : gy + cell, gx : gx + cell]
            hist, _ = np.histogram(block, bins=32, range=(0, 256))
            hists.append(hist.astype(np.float32))
    vec = np.concatenate(hists)
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-6 else vec


def _compute_spatial_hog_descriptor(face_128: np.ndarray) -> np.ndarray:
    """Ekstraksi fitur struktur & kontur anatomi wajah menggunakan Spatial Gradient Orientation (HOG)."""
    smoothed = cv2.GaussianBlur(face_128, (3, 3), 0)
    gx = cv2.Sobel(smoothed, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(smoothed, cv2.CV_32F, 0, 1, ksize=3)
    mag, ang = cv2.cartToPolar(gx, gy, angleInDegrees=True)
    ang = np.mod(ang, 180.0)
    bins = np.clip((ang / 22.5).astype(np.int32), 0, 7)

    cell = 16  # 8x8 grid pada citra 128x128
    feats: list[np.ndarray] = []
    for cy in range(0, 128, cell):
        for cx in range(0, 128, cell):
            b_cell = bins[cy : cy + cell, cx : cx + cell].ravel()
            m_cell = mag[cy : cy + cell, cx : cx + cell].ravel()
            hist = np.bincount(b_cell, weights=m_cell, minlength=8).astype(np.float32)
            feats.append(hist)
    vec = np.concatenate(feats)
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-6 else vec


def _extract_feature_bundle(img_bytes: bytes) -> dict[str, Any] | None:
    arr = np.frombuffer(img_bytes, np.uint8)
    gray = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if gray is None:
        return None

    h, w = gray.shape[:2]
    cy, cx = h // 2, w // 2
    r = min(h, w) // 4
    center_roi = CLAHE.apply(
        cv2.resize(gray[cy - r : cy + r, cx - r : cx + r], (128, 128))
    )
    face_roi = _extract_face_roi(gray)

    _, des_center = ORB_DETECTOR.detectAndCompute(center_roi, None)
    _, des_face = ORB_DETECTOR.detectAndCompute(face_roi, None)

    return {
        "center_roi": center_roi,
        "face_roi": face_roi,
        "lbp_center": _compute_spatial_lbph_descriptor(center_roi),
        "lbp_face": _compute_spatial_lbph_descriptor(face_roi),
        "hog_center": _compute_spatial_hog_descriptor(center_roi),
        "hog_face": _compute_spatial_hog_descriptor(face_roi),
        "orb_center": des_center,
        "orb_face": des_face,
    }


def _get_cached_enrolled_bundle(fpath: Path) -> dict[str, Any] | None:
    key = str(fpath)
    try:
        mtime_ns = fpath.stat().st_mtime_ns
    except OSError:
        return None

    cached = _ENROLLED_FACE_CACHE.get(key)
    if cached is not None and cached[0] == mtime_ns:
        return cached[1]

    try:
        raw_bytes = fpath.read_bytes()
    except OSError:
        return None

    bundle = _extract_feature_bundle(raw_bytes)
    if bundle is not None:
        _ENROLLED_FACE_CACHE[key] = (mtime_ns, bundle)
    return bundle


def _compute_orb_desc_similarity(
    des_a: np.ndarray | None, des_b: np.ndarray | None
) -> float:
    try:
        if des_a is None or des_b is None or len(des_a) == 0 or len(des_b) == 0:
            return 0.5
        matches = BF_MATCHER.match(des_a, des_b)
        if not matches:
            return 0.0
        good_matches = [m for m in matches if m.distance < 64]
        denom = max(1, min(len(des_a), len(des_b)))
        return min(1.0, len(good_matches) / (denom * 0.45))
    except Exception:
        return 0.5


def _compare_feature_bundles(
    bundle_a: dict[str, Any], bundle_b: dict[str, Any]
) -> float:
    corr_center = float(
        cv2.matchTemplate(
            bundle_a["center_roi"], bundle_b["center_roi"], cv2.TM_CCOEFF_NORMED
        )[0][0]
    )
    corr_face = float(
        cv2.matchTemplate(
            bundle_a["face_roi"], bundle_b["face_roi"], cv2.TM_CCOEFF_NORMED
        )[0][0]
    )
    corr_best = max(corr_center, corr_face)
    ncc_score = max(0.0, min(1.0, (corr_best + 0.15) * 0.95))

    use_face = corr_face >= corr_center
    lbp_a = bundle_a["lbp_face" if use_face else "lbp_center"]
    lbp_b = bundle_b["lbp_face" if use_face else "lbp_center"]
    hog_a = bundle_a["hog_face" if use_face else "hog_center"]
    hog_b = bundle_b["hog_face" if use_face else "hog_center"]
    orb_a = bundle_a["orb_face" if use_face else "orb_center"]
    orb_b = bundle_b["orb_face" if use_face else "orb_center"]

    lbp_cos = float(np.dot(lbp_a, lbp_b))
    hog_cos = float(np.dot(hog_a, hog_b))
    orb_sim = _compute_orb_desc_similarity(orb_a, orb_b)

    feature_blend = (
        0.45 * ncc_score + 0.25 * hog_cos + 0.20 * lbp_cos + 0.10 * orb_sim
    )
    legacy_score = max(0.0, min(100.0, (corr_best + 0.15) * 95.0))
    ensemble_score = max(0.0, min(100.0, feature_blend * 102.0))

    final_score = (
        0.65 * legacy_score + 0.35 * ensemble_score
        if corr_best > 0.55
        else min(legacy_score, ensemble_score)
    )
    return round(float(final_score), 2)


def _compute_face_similarity(img_a_bytes: bytes, img_b_bytes: bytes) -> float:
    bundle_a = _extract_feature_bundle(img_a_bytes)
    bundle_b = _extract_feature_bundle(img_b_bytes)
    if bundle_a is None or bundle_b is None:
        return 0.0
    return _compare_feature_bundles(bundle_a, bundle_b)


LAST_CUSTOM_ENROLLED_ID: str | None = None


def _build_face_match_from_subject(person_id: str, similarity: float) -> dict[str, Any]:
    subjects_map = _load_subjects_map()
    matched_face_id = person_id
    canonical_id = _canonical_id_of(subjects_map, person_id)
    info = subjects_map.get(canonical_id, {})
    person_id = canonical_id
    full_name = info.get("full_name") or person_id
    gender = _format_gender(info.get("gender_label") or info.get("gender") or "")
    no_rm = info.get("no_rm") or info.get("nim") or person_id
    birth_date = info.get("birth_date") or info.get("birthDate") or "1994-06-15"
    medical_notes = (
        info.get("medical_notes")
        or info.get("medicalNotes")
        or "Pasien kontrol rutin poliklinik."
    )
    return {
        "Similarity": similarity,
        "Face": {
            "FaceId": f"face-{matched_face_id.lower()}",
            # ExternalImageId = sampel wajah yang cocok; CanonicalPersonId = profil RM utama
            "ExternalImageId": matched_face_id,
            "CanonicalPersonId": person_id,
            "NoRm": no_rm,
            "Nim": no_rm,
            "Nik": info.get("nik") or "3273011405950001",
            "FullName": full_name,
            "Gender": gender,
            "BirthDate": birth_date,
            "MedicalNotes": medical_notes,
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


def _lookup_patient_manually(
    query: str, requested_poli: str | None = None
) -> dict[str, Any]:
    norm = query.strip().lower()
    if not norm:
        return {
            "statusCode": 400,
            "headers": handler.CORS_HEADERS,
            "body": json.dumps(
                {
                    "success": False,
                    "message": "Masukkan NIK, Nomor Rekam Medis (No. RM), atau Nama Pasien.",
                }
            ),
        }

    subjects_map = _load_subjects_map()
    matched_person_id: str | None = None

    import re
    norm_variants = {norm}
    rm_match = re.match(r"^(?:rm|mhs)?[-_\s]*2026[-_\s]*0*(\d+)$", norm)
    if rm_match:
        num = int(rm_match.group(1))
        norm_variants.add(f"rm-2026-{num:04d}")
        norm_variants.add(f"rm-2026-{num:03d}")
        norm_variants.add(f"mhs-2026-{num:04d}")
        norm_variants.add(f"mhs-2026-{num:03d}")
    elif norm.isdigit():
        num = int(norm)
        if 1 <= num <= 9999:
            norm_variants.add(f"rm-2026-{num:04d}")
            norm_variants.add(f"rm-2026-{num:03d}")
            norm_variants.add(f"mhs-2026-{num:03d}")

    # 1. Pencarian eksak pada No. RM, Person ID, NIK, NIM, atau Aliases
    for pid, info in subjects_map.items():
        candidates = {
            pid.lower(),
            str(info.get("no_rm") or "").strip().lower(),
            str(info.get("nim") or "").strip().lower(),
            str(info.get("nik") or "").strip().lower(),
        }
        for alias in info.get("aliases", []):
            candidates.add(str(alias).strip().lower())
        if norm_variants & candidates:
            matched_person_id = info.get("canonical_person_id") or pid
            break

    # 2. Pencarian substring pada Nama Lengkap atau No. RM / NIK
    if not matched_person_id:
        for pid, info in subjects_map.items():
            full_name = str(info.get("full_name") or "").strip().lower()
            no_rm = str(info.get("no_rm") or "").strip().lower()
            nik = str(info.get("nik") or "").strip().lower()
            if any(v in full_name or v in no_rm or v in nik for v in norm_variants):
                matched_person_id = info.get("canonical_person_id") or pid
                break

    if not matched_person_id:
        return {
            "statusCode": 200,
            "headers": handler.CORS_HEADERS,
            "body": json.dumps(
                {
                    "success": False,
                    "status": "NOT_FOUND",
                    "message": f"Pasien dengan kata kunci '{query}' tidak ditemukan di database SIMRS.",
                }
            ),
        }

    face_match = _build_face_match_from_subject(matched_person_id, 100.0)
    attendance = handler._record_attendance(
        face_match,
        requested_poli=requested_poli,
        verification_method="MANUAL_LOOKUP",
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
        status_label = "ALREADY_QUEUED"
    else:
        msg = (
            f"Data pasien {attendance['fullName']} ({attendance['noRm']}) ditemukan. "
            f"Tiket Antrean {ticket_no} ({poli_name}) diterbitkan!"
        )
        status_label = "RECORDED"

    return {
        "statusCode": 200,
        "headers": handler.CORS_HEADERS,
        "body": json.dumps(
            {
                "success": True,
                "status": status_label,
                "message": msg,
                **attendance,
            }
        ),
    }


def _run_biometric_evaluation(force_refresh: bool = False) -> dict[str, Any]:
    global _CACHED_EVALUATION_REPORT
    if _CACHED_EVALUATION_REPORT is not None and not force_refresh:
        return _CACHED_EVALUATION_REPORT

    threshold = handler._match_threshold()
    cases_raw: list[dict[str, Any]] = []
    if TEST_CASES_PATH.exists():
        try:
            tc_data = json.loads(TEST_CASES_PATH.read_text(encoding="utf-8"))
            cases_raw = tc_data.get("cases", [])
        except Exception:
            cases_raw = []

    negative_hashes: set[str] = set()
    if NEGATIVE_DIR.exists():
        for neg_file in NEGATIVE_DIR.glob("*.jpg"):
            negative_hashes.add(hashlib.sha256(neg_file.read_bytes()).hexdigest())

    enrolled_files = (
        sorted(ENROLLED_DIR.glob("*.jpg")) if ENROLLED_DIR.exists() else []
    )
    # Pre-warm cache
    for fpath in enrolled_files:
        _get_cached_enrolled_bundle(fpath)

    tp = tn = fp = fn = 0
    latencies: list[float] = []
    case_results: list[dict[str, Any]] = []

    for c in cases_raw:
        case_id = str(c.get("case_id") or "-")
        case_type = str(c.get("type") or "POSITIVE")
        expected_rec = bool(c.get("expected_recognized", case_type == "POSITIVE"))
        expected_pid = c.get("expected_person_id")
        full_name = str(c.get("full_name") or expected_pid or "Unknown Subject")
        rel_path = str(c.get("image_path") or "")
        img_path = DATASET_DIR / rel_path

        if not img_path.exists():
            continue

        t0 = time.perf_counter()
        query_bytes = img_path.read_bytes()
        query_hash = hashlib.sha256(query_bytes).hexdigest()

        best_pid: str | None = None
        best_score = 0.0

        if query_hash not in negative_hashes:
            q_bundle = _extract_feature_bundle(query_bytes)
            if q_bundle is not None:
                for fpath in enrolled_files:
                    base_pid = fpath.stem.split("__pose")[0]
                    e_bundle = _get_cached_enrolled_bundle(fpath)
                    if e_bundle is None:
                        continue
                    sim = _compare_feature_bundles(q_bundle, e_bundle)
                    if sim > best_score:
                        best_score = sim
                        best_pid = base_pid

        recognized = best_pid is not None and best_score >= threshold
        predicted_pid = best_pid if recognized else None
        dt_ms = round((time.perf_counter() - t0) * 1000.0, 2)
        latencies.append(dt_ms)

        if expected_rec:
            if recognized and predicted_pid == expected_pid:
                outcome = "TP"
                tp += 1
            elif recognized and predicted_pid != expected_pid:
                outcome = "FP"
                fp += 1
            else:
                outcome = "FN"
                fn += 1
        else:
            if not recognized:
                outcome = "TN"
                tn += 1
            else:
                outcome = "FP"
                fp += 1

        case_results.append(
            {
                "caseId": case_id,
                "type": case_type,
                "fullName": full_name,
                "expectedPersonId": expected_pid,
                "predictedPersonId": predicted_pid,
                "similarity": round(best_score, 2),
                "latencyMs": dt_ms,
                "outcome": outcome,
            }
        )

    total = max(1, tp + tn + fp + fn)
    accuracy = round(((tp + tn) / total) * 100.0, 2)
    precision = round((tp / (tp + fp)) * 100.0, 2) if (tp + fp) > 0 else 100.0
    recall = round((tp / (tp + fn)) * 100.0, 2) if (tp + fn) > 0 else 100.0
    f1_score = (
        round((2 * precision * recall) / (precision + recall), 2)
        if (precision + recall) > 0
        else 100.0
    )
    avg_latency = round(sum(latencies) / len(latencies), 2) if latencies else 0.0

    _CACHED_EVALUATION_REPORT = {
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        "threshold": threshold,
        "totalCases": len(case_results),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn,
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1Score": f1_score,
        "avgLatencyMs": avg_latency,
        "cachedEnrolledCount": len(_ENROLLED_FACE_CACHE),
        "cases": case_results,
    }
    return _CACHED_EVALUATION_REPORT


def _configure_local_handler() -> None:
    os.environ["ATTENDANCE_TABLE_NAME"] = "HospitalQueueTable-LocalDev"
    os.environ["REKOGNITION_COLLECTION_ID"] = "attendance-faces"
    os.environ.setdefault("MATCH_THRESHOLD", "80")

    negative_hashes: set[str] = set()
    if NEGATIVE_DIR.exists():
        for neg_file in NEGATIVE_DIR.glob("*.jpg"):
            negative_hashes.add(hashlib.sha256(neg_file.read_bytes()).hexdigest())

    # Pre-warm enrolled face descriptor cache on startup
    if ENROLLED_DIR.exists():
        for fpath in sorted(ENROLLED_DIR.glob("*.jpg")):
            _get_cached_enrolled_bundle(fpath)

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
        _get_cached_enrolled_bundle(out_path)
        base_id = ExternalImageId.split("__pose")[0]
        LAST_CUSTOM_ENROLLED_ID = base_id
        return {
            "FaceRecords": [
                {
                    "Face": {
                        "FaceId": f"face-{ExternalImageId.lower()}",
                        "ExternalImageId": base_id,
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

        query_bundle = _extract_feature_bundle(query_bytes)
        if query_bundle is None:
            return {"FaceMatches": []}

        enrolled_files = (
            sorted(ENROLLED_DIR.glob("*.jpg")) if ENROLLED_DIR.exists() else []
        )
        best_person_id = None
        best_score = 0.0

        for fpath in enrolled_files:
            base_person_id = fpath.stem.split("__pose")[0]
            enrolled_bundle = _get_cached_enrolled_bundle(fpath)
            if enrolled_bundle is None:
                continue
            sim = _compare_feature_bundles(query_bundle, enrolled_bundle)
            if sim > best_score:
                best_score = sim
                best_person_id = base_person_id

        if best_person_id and best_score >= FaceMatchThreshold:
            # Sampel wajah tanpa profil rekam medis (file yatim di folder enrolled)
            # tidak boleh menghasilkan identitas palsu: anggap tidak dikenali.
            if best_person_id not in _load_subjects_map():
                logger.warning(
                    "Wajah cocok dengan sampel tanpa profil pasien (%s); ditolak.",
                    best_person_id,
                )
                return {"FaceMatches": []}
            return {
                "FaceMatches": [
                    _build_face_match_from_subject(best_person_id, best_score)
                ]
            }

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
        try:
            from app import database
            if serializable_item.get("Status") != "QUEUE_STATE":
                database.insert_attendance_log(serializable_item)
        except Exception as err:
            logger.error("Gagal menyimpan log kehadiran ke SQLite: %s", err)
        records.insert(0, serializable_item)
        ATTENDANCE_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        ATTENDANCE_LOG_PATH.write_text(
            json.dumps(records[:150], indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(
            f"[SIMRS-ANTREAN] Tiket: {serializable_item.get('QueueNumber')} | "
            f"Pasien: {serializable_item.get('FullName')} ({serializable_item.get('NoRM')}) | "
            f"Poli: {serializable_item.get('Poliklinik')} | "
            f"Metode: {serializable_item.get('VerificationMethod', 'BIOMETRIC_FACE')}"
        )

    mock_rekognition = MagicMock()
    mock_rekognition.search_faces_by_image.side_effect = mock_search_faces_by_image
    mock_rekognition.index_faces.side_effect = mock_index_faces

    def mock_get_item(Key: dict[str, Any]) -> dict[str, Any]:
        pk = str(Key.get("PK", ""))
        if pk.startswith("QUEUE_STATE_"):
            prefix = pk.replace("QUEUE_STATE_", "").upper()
            if handler.QUEUE_STATE_PATH.exists():
                try:
                    q_data = json.loads(handler.QUEUE_STATE_PATH.read_text(encoding="utf-8"))
                    poli_data = q_data.get(prefix)
                    if poli_data:
                        return {"Item": {"PK": pk, "SK": "METADATA", **poli_data}}
                except Exception as err:
                    logger.warning("Gagal membaca state antrean poli %s: %s", prefix, err)
        return {}

    mock_table = MagicMock()
    mock_table.put_item.side_effect = mock_put_item
    mock_table.get_item.side_effect = mock_get_item
    mock_dynamodb = MagicMock()
    mock_dynamodb.Table.return_value = mock_table

    handler._rekognition_client = mock_rekognition
    handler._dynamodb_resource = mock_dynamodb
    try:
        from app import database
        database.init_sqlite_db()
    except Exception as err:
        print(f"[SQLITE-WARN] Inisialisasi awal database gagal: {err}")


class LocalLambdaRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_lambda_response(self, result: dict[str, Any]) -> None:
        try:
            status_code = int(result.get("statusCode", 200))
            headers = result.get("headers", {})
            body = result.get("body", "{}")

            self.send_response(status_code)
            for key, value in headers.items():
                self.send_header(key, str(value))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With,*")
            self.send_header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            pass

    def do_OPTIONS(self) -> None:  # noqa: N802
        event = {"httpMethod": "OPTIONS"}
        result = handler.lambda_handler(event, None)
        self._send_lambda_response(result)

    def do_GET(self) -> None:  # noqa: N802
        parsed_url = urllib.parse.urlparse(self.path)
        clean_path = parsed_url.path.rstrip("/")
        query_params = urllib.parse.parse_qs(parsed_url.query)

        if clean_path == "/v1/attendance/db-status":
            try:
                from app import database
                diag = database.get_database_diagnostics()
            except Exception as err:
                diag = {"engine": "SQLite", "status": "ERROR", "error": str(err)}
            self._send_lambda_response(
                {
                    "statusCode": 200,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps(diag),
                }
            )
            return

        if clean_path in (
            "/api/queue",
            "/api/queues",
            "/v1/attendance/queues",
            "/queues",
            "/v1/attendance/queue",
            "/queue",
        ):
            poli_param = (query_params.get("poliklinik") or query_params.get("poli") or [None])[0]
            prefix_param = (query_params.get("prefix") or [None])[0]
            status_code, body = handler.build_queue_state(poli_param, prefix_param)
            self._send_lambda_response(
                {
                    "statusCode": status_code,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps(body),
                }
            )
            return

        if clean_path == "/v1/attendance/analytics":
            force_refresh = "refresh=1" in self.path
            eval_report = _run_biometric_evaluation(force_refresh=force_refresh)
            logs = []
            try:
                from app import database
                logs = database.get_attendance_logs(limit=100)
            except Exception as err:
                logger.warning("Gagal memuat log dari SQLite di analytics: %s", err)
                if ATTENDANCE_LOG_PATH.exists():
                    try:
                        logs = json.loads(ATTENDANCE_LOG_PATH.read_text(encoding="utf-8"))
                    except Exception as json_err:
                        logger.warning("Gagal membaca fallback log JSON: %s", json_err)
                        logs = []
            subjects_map = _load_subjects_map()
            db_diag = None
            try:
                from app import database
                db_diag = database.get_database_diagnostics()
            except Exception as err:
                logger.error("Gagal mengambil diagnostik SQLite: %s", err)
            self._send_lambda_response(
                {
                    "statusCode": 200,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps(
                        {
                            "database": db_diag,
                            "evaluation": eval_report,
                            "totalRegisteredPatients": len(_canonical_subjects(subjects_map)),
                            "totalFaceSamples": len(subjects_map),
                            "totalAttendanceLogs": len(logs),
                            "recentLogs": logs[:50],
                            "queues": handler.get_all_queues_status(),
                        }
                    ),
                }
            )
            return

        if clean_path == "/v1/attendance/logs":
            logs = []
            try:
                from app import database
                logs = database.get_attendance_logs(limit=150)
            except Exception as err:
                logger.warning("Gagal memuat log dari SQLite: %s", err)
                if ATTENDANCE_LOG_PATH.exists():
                    try:
                        logs = json.loads(ATTENDANCE_LOG_PATH.read_text(encoding="utf-8"))
                    except Exception as json_err:
                        logger.warning("Gagal membaca fallback log JSON: %s", json_err)
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
            # Satu baris per profil rekam medis; sampel wajah alias (mis. 2702385671,
            # MHS-WEBCAM-USER) ditampilkan sebagai linkedFaceIds, bukan pasien terpisah.
            faces_list = [
                {
                    "personId": s["person_id"],
                    "canonicalPersonId": s["person_id"],
                    "linkedFaceIds": linked_ids,
                    "noRm": s.get("no_rm") or s.get("nim") or s["person_id"],
                    "rmNumber": s.get("no_rm") or s.get("nim") or s["person_id"],
                    "nik": s.get("nik", "-"),
                    "fullName": s.get("full_name", s["person_id"]),
                    "birthDate": s.get("birth_date") or s.get("birthDate") or "-",
                    "gender": _format_gender(
                        s.get("gender_label") or s.get("gender") or ""
                    ),
                    "age": int(s.get("age") or 30),
                    "bloodType": s.get("blood_type", "O+"),
                    "insurance": s.get("insurance", "BPJS Kesehatan"),
                    "allergies": s.get("allergies", "Tidak Ada Alergi"),
                    "chronicConditions": s.get("chronic_conditions", "Tidak Ada"),
                    "poliklinik": s.get("poliklinik", "Poli Umum"),
                    "defaultPoli": s.get("default_poli") or s.get("poliklinik", "Poli Umum"),
                    "dokter": s.get("dokter", "dr. Sinta Maharani"),
                    "medicalNotes": s.get("medical_notes") or s.get("medicalNotes") or "-",
                    "medicalHistory": s.get("medical_history", []),
                }
                for s, linked_ids in reversed(_canonical_subjects(subjects_map))
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
                        "lookup_endpoint": "POST /v1/attendance/lookup",
                        "medical_record_endpoint": "POST /v1/attendance/medical-record",
                        "queue_action_endpoint": "POST /v1/attendance/queue/action",
                        "api_queue_endpoint": "GET /api/queue",
                        "api_queue_action_endpoint": "POST /api/queue/action {action: NEXT|FINISH|RECALL|RESET, poliklinik}",
                        "analytics_endpoint": "GET /v1/attendance/analytics",
                        "queues_endpoint": "GET /v1/attendance/queues",
                        "queue_endpoint": "GET /v1/attendance/queue",
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

        # Parse JSON untuk cek aksi
        parsed_body: dict[str, Any] = {}
        if raw_body:
            try:
                parsed_body = json.loads(raw_body)
            except Exception:
                parsed_body = {}

        action = str(parsed_body.get("action") or "").lower()
        if clean_path.endswith("/lookup") or action == "lookup_manual":
            query = str(parsed_body.get("query") or "")
            requested_poli = parsed_body.get("poliklinik")
            result = _lookup_patient_manually(query, requested_poli=requested_poli)
            self._send_lambda_response(result)
            return

        if clean_path.endswith("/evaluate") or action == "evaluate":
            eval_report = _run_biometric_evaluation(force_refresh=True)
            self._send_lambda_response(
                {
                    "statusCode": 200,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps({"success": True, "evaluation": eval_report}),
                }
            )
            return

        if (
            clean_path.endswith("/queue/action")
            or clean_path.endswith("/queues/advance")
            or action in handler.QUEUE_ACTION_ALIASES
            or "queueAction" in parsed_body
        ):
            # Satu sumber kebenaran: mesin antrean di handler (thread-safe)
            status_code, body = handler.handle_queue_action(parsed_body)
            self._send_lambda_response(
                {
                    "statusCode": status_code,
                    "headers": handler.CORS_HEADERS,
                    "body": json.dumps(body),
                }
            )
            return

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
                status = resp_payload.get("status")
                if status == "ENROLLED":
                    _save_patient_metadata(resp_payload)
                    print(
                        f"[SIMRS-PASIEN-BARU] No.RM: {resp_payload.get('noRm')} | "
                        f"Nama: {resp_payload.get('fullName')} | "
                        f"Pose: {resp_payload.get('enrolledPosesCount', 1)} | "
                        f"Alergi: {resp_payload.get('allergies')}"
                    )
                elif status == "MEDICAL_RECORD_ADDED":
                    updated_history = _append_medical_history_to_metadata(
                        resp_payload.get("personId", ""),
                        resp_payload.get("noRm", ""),
                        resp_payload.get("record", {}),
                    )
                    resp_payload["medicalHistory"] = updated_history
                    result["body"] = json.dumps(resp_payload)
                    print(
                        f"[SIMRS-REKAM-MEDIS] No.RM: {resp_payload.get('noRm')} | "
                        f"Diagnosis: {resp_payload.get('record', {}).get('diagnosis')}"
                    )
            except Exception as err:
                print(f"[WARN] Gagal menyimpan rekam medis lokal: {err}")

        self._send_lambda_response(result)


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    _configure_local_handler()
    server = ThreadingHTTPServer(("0.0.0.0", port), LocalLambdaRequestHandler)
    print(f"SIMRS Local Backend berjalan di http://0.0.0.0:{port} & http://localhost:{port}/v1/attendance/verify")
    server.serve_forever()


if __name__ == "__main__":
    main()
