"""Generator & pengaya metadata dataset wajah Pasien Rumah Sakit (SIMRS Face Recognition).

Menghasilkan/memperbarui:
- dataset/images/enrolled/       : 20 foto wajah pasien terdaftar (640x480 JPEG)
- dataset/images/test_positive/  : 20 foto variasi kamera/pencahayaan pasien terdaftar
- dataset/images/test_negative/  : 5 foto wajah pengunjung belum terdaftar (uji True Negative)
- dataset/metadata.json          : Data Rekam Medis lengkap 20 pasien (No. RM, NIK, Alergi, Riwayat Berobat)
- dataset/metadata.csv           : Tabel ringkasan data pasien format CSV untuk lampiran skripsi
- dataset/test_cases.json        : Skenario pengujian 25 sampel uji
"""

from __future__ import annotations

import csv
import json
import os
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
ENROLLED_DIR = BASE_DIR / "images" / "enrolled"
POSITIVE_DIR = BASE_DIR / "images" / "test_positive"
NEGATIVE_DIR = BASE_DIR / "images" / "test_negative"

TARGET_WIDTH = 640
TARGET_HEIGHT = 480

ENROLLED_PATIENTS: list[dict[str, Any]] = [
    {
        "person_id": "MHS-2026-001",
        "no_rm": "RM-2026-001",
        "nik": "3273011405950001",
        "full_name": "Aditya Pratama",
        "gender": "L",
        "age": 31,
        "blood_type": "O+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Penisilin (Antibiotik), Udang",
        "chronic_conditions": "Hipertensi Ringan",
        "poliklinik": "Poli Penyakit Dalam",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
        "pravatar_id": 3,
        "medical_history": [
            {
                "date": "2026-09-18",
                "poliklinik": "Poli Penyakit Dalam",
                "doctor": "dr. Hendra Wijaya, Sp.PD",
                "diagnosis": "Hipertensi Esensial (I10)",
                "treatment": "Amlodipine 5mg 1x1, Edukasi diet rendah garam",
            },
            {
                "date": "2026-07-04",
                "poliklinik": "Poli Umum",
                "doctor": "dr. Sinta Maharani",
                "diagnosis": "Gastritis Akut (K29.1)",
                "treatment": "Omeprazole 20mg 2x1, Antasida Doen",
            },
        ],
    },
    {
        "person_id": "MHS-2026-002",
        "no_rm": "RM-2026-002",
        "nik": "3273025808990002",
        "full_name": "Nabila Putri Maharani",
        "gender": "P",
        "age": 27,
        "blood_type": "A+",
        "insurance": "Asuransi Swasta",
        "allergies": "Ibuprofen (NSAID), Debu",
        "chronic_conditions": "Asma Bronkial",
        "poliklinik": "Poli Paru & Pernapasan",
        "dokter": "dr. Faisal Rahman, Sp.P",
        "pravatar_id": 5,
        "medical_history": [
            {
                "date": "2026-09-25",
                "poliklinik": "Poli Paru & Pernapasan",
                "doctor": "dr. Faisal Rahman, Sp.P",
                "diagnosis": "Asma Bronkial Terkontrol (J45.9)",
                "treatment": "Inhaler Salbutamol, Cetirizine 10mg",
            },
            {
                "date": "2026-06-12",
                "poliklinik": "Poli Umum",
                "doctor": "dr. Sinta Maharani",
                "diagnosis": "ISPA Ringan (J06.9)",
                "treatment": "Paracetamol 500mg, Vitamin C",
            },
        ],
    },
    {
        "person_id": "MHS-2026-003",
        "no_rm": "RM-2026-003",
        "nik": "3273032101880003",
        "full_name": "Rizky Ramadhan",
        "gender": "L",
        "age": 38,
        "blood_type": "B+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "Diabetes Melitus Tipe 2",
        "poliklinik": "Poli Penyakit Dalam",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
        "pravatar_id": 6,
        "medical_history": [
            {
                "date": "2026-09-10",
                "poliklinik": "Poli Penyakit Dalam",
                "doctor": "dr. Hendra Wijaya, Sp.PD",
                "diagnosis": "Diabetes Melitus Tipe 2 (E11)",
                "treatment": "Metformin 500mg 2x1, Cek HbA1c rutin",
            }
        ],
    },
    {
        "person_id": "MHS-2026-004",
        "no_rm": "RM-2026-004",
        "nik": "3273046204960004",
        "full_name": "Aulia Rahmawati",
        "gender": "P",
        "age": 30,
        "blood_type": "O+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Amoxicillin",
        "chronic_conditions": "Tidak Ada",
        "poliklinik": "Poli Mata",
        "dokter": "dr. Ratna Kusuma, Sp.M",
        "pravatar_id": 9,
        "medical_history": [
            {
                "date": "2026-08-29",
                "poliklinik": "Poli Mata",
                "doctor": "dr. Ratna Kusuma, Sp.M",
                "diagnosis": "Miopia & Astigmatisme (H52.1)",
                "treatment": "Resep kacamata koreksi & tetes mata Sodium Hyaluronate",
            }
        ],
    },
    {
        "person_id": "MHS-2026-005",
        "no_rm": "RM-2026-005",
        "nik": "3273051907920005",
        "full_name": "Fajar Nugroho",
        "gender": "L",
        "age": 34,
        "blood_type": "AB+",
        "insurance": "Umum",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "Dislipidemia",
        "poliklinik": "Poli Jantung",
        "dokter": "dr. Bambang Hartono, Sp.JP",
        "pravatar_id": 12,
        "medical_history": [
            {
                "date": "2026-09-02",
                "poliklinik": "Poli Jantung",
                "doctor": "dr. Bambang Hartono, Sp.JP",
                "diagnosis": "Hiperkolesterolemia (E78.0)",
                "treatment": "Simvastatin 20mg 1x1 malam, EKG Normal",
            }
        ],
    },
    {
        "person_id": "MHS-2026-006",
        "no_rm": "RM-2026-006",
        "nik": "3273064511980006",
        "full_name": "Siti Nurhaliza",
        "gender": "P",
        "age": 28,
        "blood_type": "A+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Antibiotik Sulfa",
        "chronic_conditions": "Tidak Ada",
        "poliklinik": "Poli Gigi & Mulut",
        "dokter": "drg. Nadia Larasati",
        "pravatar_id": 16,
        "medical_history": [
            {
                "date": "2026-09-14",
                "poliklinik": "Poli Gigi & Mulut",
                "doctor": "drg. Nadia Larasati",
                "diagnosis": "Pulpitis Irreversible Molar 1 (K04.0)",
                "treatment": "Perawatan saluran akar tahap 1, Asam Mefenamat 500mg",
            }
        ],
    },
    {
        "person_id": "MHS-2026-007",
        "no_rm": "RM-2026-007",
        "nik": "3273071103910007",
        "full_name": "Dimas Wahyu Saputra",
        "gender": "L",
        "age": 35,
        "blood_type": "O+",
        "insurance": "Asuransi Swasta",
        "allergies": "Kacang Tanah",
        "chronic_conditions": "Vertigo Perifer",
        "poliklinik": "Poli Saraf (Neurologi)",
        "dokter": "dr. Arifin Putra, Sp.N",
        "pravatar_id": 15,
        "medical_history": [
            {
                "date": "2026-09-21",
                "poliklinik": "Poli Saraf (Neurologi)",
                "doctor": "dr. Arifin Putra, Sp.N",
                "diagnosis": "Benign Paroxysmal Positional Vertigo (H81.1)",
                "treatment": "Betahistine Mesylate 6mg 3x1, Flunarizine 5mg",
            }
        ],
    },
    {
        "person_id": "MHS-2026-008",
        "no_rm": "RM-2026-008",
        "nik": "3273085409970008",
        "full_name": "Intan Permatasari",
        "gender": "P",
        "age": 29,
        "blood_type": "B+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "Dermatitis Atopik",
        "poliklinik": "Poli Kulit & Kelamin",
        "dokter": "dr. Clara Wijaya, Sp.KK",
        "pravatar_id": 19,
        "medical_history": [
            {
                "date": "2026-08-30",
                "poliklinik": "Poli Kulit & Kelamin",
                "doctor": "dr. Clara Wijaya, Sp.KK",
                "diagnosis": "Dermatitis Atopik (L20)",
                "treatment": "Krim Hydrocortisone 1%, Loratadine 10mg",
            }
        ],
    },
    {
        "person_id": "MHS-2026-009",
        "no_rm": "RM-2026-009",
        "nik": "3273092812850009",
        "full_name": "Bagas Kurniawan",
        "gender": "L",
        "age": 40,
        "blood_type": "A+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Aspirin",
        "chronic_conditions": "Asam Urat (Gout)",
        "poliklinik": "Poli Penyakit Dalam",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
        "pravatar_id": 17,
        "medical_history": [
            {
                "date": "2026-09-19",
                "poliklinik": "Poli Penyakit Dalam",
                "doctor": "dr. Hendra Wijaya, Sp.PD",
                "diagnosis": "Gout Arthritis (M10.9)",
                "treatment": "Allopurinol 100mg 1x1, Kolkisin 0.5mg",
            }
        ],
    },
    {
        "person_id": "MHS-2026-010",
        "no_rm": "RM-2026-010",
        "nik": "3273106002940010",
        "full_name": "Dewi Anggraini",
        "gender": "P",
        "age": 32,
        "blood_type": "O+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Seafood (Kepiting)",
        "chronic_conditions": "Tidak Ada",
        "poliklinik": "Poli THT",
        "dokter": "dr. Lukman Hakim, Sp.THT-KL",
        "pravatar_id": 21,
        "medical_history": [
            {
                "date": "2026-09-05",
                "poliklinik": "Poli THT",
                "doctor": "dr. Lukman Hakim, Sp.THT-KL",
                "diagnosis": "Rhinitis Alergi (J30.4)",
                "treatment": "Fluticasone Nasal Spray, Cetirizine 10mg",
            }
        ],
    },
    {
        "person_id": "MHS-2026-011",
        "no_rm": "RM-2026-011",
        "nik": "3273111506900011",
        "full_name": "Ilham Maulana",
        "gender": "L",
        "age": 36,
        "blood_type": "B+",
        "insurance": "Umum",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "Nyeri Punggung Bawah",
        "poliklinik": "Poli Ortopedi",
        "dokter": "dr. Kevin Santoso, Sp.OT",
        "pravatar_id": 33,
        "medical_history": [
            {
                "date": "2026-09-11",
                "poliklinik": "Poli Ortopedi",
                "doctor": "dr. Kevin Santoso, Sp.OT",
                "diagnosis": "Low Back Pain / Muscle Spasm (M54.5)",
                "treatment": "Eperisone HCl 50mg 2x1, Rujukan Fisioterapi",
            }
        ],
    },
    {
        "person_id": "MHS-2026-012",
        "no_rm": "RM-2026-012",
        "nik": "3273124903980012",
        "full_name": "Putri Ayu Lestari",
        "gender": "P",
        "age": 28,
        "blood_type": "AB+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Paracetamol Dosis Tinggi",
        "chronic_conditions": "Migrain Kronis",
        "poliklinik": "Poli Saraf (Neurologi)",
        "dokter": "dr. Arifin Putra, Sp.N",
        "pravatar_id": 23,
        "medical_history": [
            {
                "date": "2026-09-22",
                "poliklinik": "Poli Saraf (Neurologi)",
                "doctor": "dr. Arifin Putra, Sp.N",
                "diagnosis": "Migraine without Aura (G43.0)",
                "treatment": "Sumatriptan 50mg prn, Vitamin B Kompleks",
            }
        ],
    },
    {
        "person_id": "MHS-2026-013",
        "no_rm": "RM-2026-013",
        "nik": "3273130810870013",
        "full_name": "Reza Pahlevi",
        "gender": "L",
        "age": 39,
        "blood_type": "O+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "GERD",
        "poliklinik": "Poli Penyakit Dalam",
        "dokter": "dr. Hendra Wijaya, Sp.PD",
        "pravatar_id": 52,
        "medical_history": [
            {
                "date": "2026-09-15",
                "poliklinik": "Poli Penyakit Dalam",
                "doctor": "dr. Hendra Wijaya, Sp.PD",
                "diagnosis": "Gastroesophageal Reflux Disease (K21.9)",
                "treatment": "Lansoprazole 30mg 1x1, Sucralfate Sirup 3x1",
            }
        ],
    },
    {
        "person_id": "MHS-2026-014",
        "no_rm": "RM-2026-014",
        "nik": "3273145207990014",
        "full_name": "Anisa Fitriani",
        "gender": "P",
        "age": 27,
        "blood_type": "A+",
        "insurance": "Asuransi Swasta",
        "allergies": "Lateks",
        "chronic_conditions": "Anemia Defisiensi Besi",
        "poliklinik": "Poli Umum",
        "dokter": "dr. Sinta Maharani",
        "pravatar_id": 27,
        "medical_history": [
            {
                "date": "2026-09-08",
                "poliklinik": "Poli Umum",
                "doctor": "dr. Sinta Maharani",
                "diagnosis": "Anemia Defisiensi Besi (D50.9)",
                "treatment": "Ferrous Sulfate 300mg 1x1, Asam Folat",
            }
        ],
    },
    {
        "person_id": "MHS-2026-015",
        "no_rm": "RM-2026-015",
        "nik": "3273152304830015",
        "full_name": "Hendra Gunawan",
        "gender": "L",
        "age": 43,
        "blood_type": "B+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Ciprofloxacin",
        "chronic_conditions": "Hipertensi & Kolesterol",
        "poliklinik": "Poli Jantung",
        "dokter": "dr. Bambang Hartono, Sp.JP",
        "pravatar_id": 53,
        "medical_history": [
            {
                "date": "2026-09-27",
                "poliklinik": "Poli Jantung",
                "doctor": "dr. Bambang Hartono, Sp.JP",
                "diagnosis": "Hypertensive Heart Disease (I11.9)",
                "treatment": "Candersartan 8mg 1x1, Atorvastatin 20mg 1x1",
            }
        ],
    },
    {
        "person_id": "MHS-2026-016",
        "no_rm": "RM-2026-016",
        "nik": "3273166701960016",
        "full_name": "Citra Kirana Dewi",
        "gender": "P",
        "age": 30,
        "blood_type": "O+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "Tidak Ada",
        "poliklinik": "Poli Gigi & Mulut",
        "dokter": "drg. Nadia Larasati",
        "pravatar_id": 28,
        "medical_history": [
            {
                "date": "2026-08-19",
                "poliklinik": "Poli Gigi & Mulut",
                "doctor": "drg. Nadia Larasati",
                "diagnosis": "Karang Gigi / Calculus Dental (K03.6)",
                "treatment": "Scaling rahang atas & bawah, Obat kumur Chlorhexidine",
            }
        ],
    },
    {
        "person_id": "MHS-2026-017",
        "no_rm": "RM-2026-017",
        "nik": "3273171209890017",
        "full_name": "Arif Budiman",
        "gender": "L",
        "age": 37,
        "blood_type": "A+",
        "insurance": "Umum",
        "allergies": "Kotrimoksazol",
        "chronic_conditions": "Sinusitis",
        "poliklinik": "Poli THT",
        "dokter": "dr. Lukman Hakim, Sp.THT-KL",
        "pravatar_id": 56,
        "medical_history": [
            {
                "date": "2026-09-12",
                "poliklinik": "Poli THT",
                "doctor": "dr. Lukman Hakim, Sp.THT-KL",
                "diagnosis": "Sinusitis Maksilaris Akut (J01.0)",
                "treatment": "Co-Amoxiclav 625mg 3x1, Pseudoephedrine",
            }
        ],
    },
    {
        "person_id": "MHS-2026-018",
        "no_rm": "RM-2026-018",
        "nik": "3273184405970018",
        "full_name": "Larasati Kusuma",
        "gender": "P",
        "age": 29,
        "blood_type": "B+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Tidak Ada Alergi",
        "chronic_conditions": "Mata Kering (Dry Eye)",
        "poliklinik": "Poli Mata",
        "dokter": "dr. Ratna Kusuma, Sp.M",
        "pravatar_id": 32,
        "medical_history": [
            {
                "date": "2026-09-20",
                "poliklinik": "Poli Mata",
                "doctor": "dr. Ratna Kusuma, Sp.M",
                "diagnosis": "Dry Eye Syndrome (H04.12)",
                "treatment": "Artificial Tears ED 4x1 tetes ODS",
            }
        ],
    },
    {
        "person_id": "MHS-2026-019",
        "no_rm": "RM-2026-019",
        "nik": "3273192911930019",
        "full_name": "Yoga Pratama Putra",
        "gender": "L",
        "age": 32,
        "blood_type": "O+",
        "insurance": "Asuransi Swasta",
        "allergies": "Metampiron (Antalgin)",
        "chronic_conditions": "Tidak Ada",
        "poliklinik": "Poli Umum",
        "dokter": "dr. Sinta Maharani",
        "pravatar_id": 59,
        "medical_history": [
            {
                "date": "2026-09-17",
                "poliklinik": "Poli Umum",
                "doctor": "dr. Sinta Maharani",
                "diagnosis": "Observasi Febris / Demam Hari ke-2 (R50.9)",
                "treatment": "Paracetamol 500mg 3x1, Cek Darah Rutin",
            }
        ],
    },
    {
        "person_id": "MHS-2026-020",
        "no_rm": "RM-2026-020",
        "nik": "3273205508950020",
        "full_name": "Rania Safitri",
        "gender": "P",
        "age": 31,
        "blood_type": "A+",
        "insurance": "BPJS Kesehatan",
        "allergies": "Debu & Dingin",
        "chronic_conditions": "Bronkitis Alergi",
        "poliklinik": "Poli Paru & Pernapasan",
        "dokter": "dr. Faisal Rahman, Sp.P",
        "pravatar_id": 36,
        "medical_history": [
            {
                "date": "2026-09-24",
                "poliklinik": "Poli Paru & Pernapasan",
                "doctor": "dr. Faisal Rahman, Sp.P",
                "diagnosis": "Bronkitis Akut (J20.9)",
                "treatment": "Ambroxol 30mg 3x1, Salbutamol 2mg",
            }
        ],
    },
]

NEGATIVE_SUBJECTS: list[dict[str, Any]] = [
    {"test_id": "UNREG-001", "label": "Pasien Belum Terdaftar 1", "pravatar_id": 60},
    {"test_id": "UNREG-002", "label": "Pasien Belum Terdaftar 2", "pravatar_id": 62},
    {"test_id": "UNREG-003", "label": "Pasien Belum Terdaftar 3", "pravatar_id": 65},
    {"test_id": "UNREG-004", "label": "Pasien Belum Terdaftar 4", "pravatar_id": 47},
    {"test_id": "UNREG-005", "label": "Pasien Belum Terdaftar 5", "pravatar_id": 49},
]


def _load_face_cascade() -> cv2.CascadeClassifier:
    xml_url = "https://cdn.jsdelivr.net/gh/opencv/opencv@4.x/data/haarcascades/haarcascade_frontalface_default.xml"
    xml_path = os.path.join(tempfile.gettempdir(), "haarcascade_frontalface_default.xml")
    if not os.path.exists(xml_path):
        urllib.request.urlretrieve(xml_url, xml_path)
    return cv2.CascadeClassifier(xml_path)


def _download_image(pravatar_id: int) -> np.ndarray:
    url = f"https://i.pravatar.cc/500?img={pravatar_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
    arr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"Gagal mendekode gambar dari {url}")
    return img


def _frame_for_webcam(img: np.ndarray) -> np.ndarray:
    bg = cv2.resize(img, (TARGET_WIDTH, TARGET_HEIGHT), interpolation=cv2.INTER_LINEAR)
    bg = cv2.GaussianBlur(bg, (51, 51), 0)
    target_portrait_size = 400
    resized_portrait = cv2.resize(
        img, (target_portrait_size, target_portrait_size), interpolation=cv2.INTER_LANCZOS4
    )
    x_offset = (TARGET_WIDTH - target_portrait_size) // 2
    y_offset = (TARGET_HEIGHT - target_portrait_size) // 2

    mask = np.zeros((target_portrait_size, target_portrait_size), dtype=np.float32)
    cv2.rectangle(mask, (12, 12), (target_portrait_size - 12, target_portrait_size - 12), 1.0, -1)
    mask = cv2.GaussianBlur(mask, (25, 25), 0)[..., None]

    roi = bg[y_offset : y_offset + target_portrait_size, x_offset : x_offset + target_portrait_size]
    blended = (resized_portrait.astype(np.float32) * mask + roi.astype(np.float32) * (1.0 - mask)).astype(np.uint8)
    bg[y_offset : y_offset + target_portrait_size, x_offset : x_offset + target_portrait_size] = blended
    return bg


def _create_positive_query_variation(img: np.ndarray, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    angle = float(rng.uniform(-3.0, 3.0))
    scale = float(rng.uniform(0.96, 1.04))
    alpha = float(rng.uniform(0.92, 1.08))
    beta = float(rng.uniform(-12, 12))

    center = (TARGET_WIDTH / 2.0, TARGET_HEIGHT / 2.0)
    rot_mat = cv2.getRotationMatrix2D(center, angle, scale)
    varied = cv2.warpAffine(
        img,
        rot_mat,
        (TARGET_WIDTH, TARGET_HEIGHT),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )
    return cv2.convertScaleAbs(varied, alpha=alpha, beta=beta)


def main() -> None:
    ENROLLED_DIR.mkdir(parents=True, exist_ok=True)
    POSITIVE_DIR.mkdir(parents=True, exist_ok=True)
    NEGATIVE_DIR.mkdir(parents=True, exist_ok=True)

    metadata_records: list[dict[str, Any]] = []
    test_cases: list[dict[str, Any]] = []

    print("Menyiapkan 20 Rekam Medis & Foto Wajah Pasien Rumah Sakit...")
    for idx, p in enumerate(ENROLLED_PATIENTS, start=1):
        person_id = p["person_id"]
        enrolled_filename = f"{person_id}.jpg"
        enrolled_path = ENROLLED_DIR / enrolled_filename
        pos_filename = f"{person_id}_query.jpg"
        pos_path = POSITIVE_DIR / pos_filename

        if not enrolled_path.exists() or not pos_path.exists():
            raw_img = _download_image(p["pravatar_id"])
            framed_img = _frame_for_webcam(raw_img)
            cv2.imwrite(str(enrolled_path), framed_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            query_img = _create_positive_query_variation(framed_img, seed=100 + idx)
            cv2.imwrite(str(pos_path), query_img, [cv2.IMWRITE_JPEG_QUALITY, 88])

        record = {
            "person_id": person_id,
            "no_rm": p["no_rm"],
            "nim": p["no_rm"],
            "nik": p["nik"],
            "full_name": p["full_name"],
            "gender": p["gender"],
            "gender_label": "Laki-laki" if p["gender"] == "L" else "Perempuan",
            "age": p["age"],
            "blood_type": p["blood_type"],
            "insurance": p["insurance"],
            "allergies": p["allergies"],
            "chronic_conditions": p["chronic_conditions"],
            "poliklinik": p["poliklinik"],
            "dokter": p["dokter"],
            "medical_history": p["medical_history"],
            "enrolled_image": f"images/enrolled/{enrolled_filename}",
            "positive_test_image": f"images/test_positive/{pos_filename}",
        }
        metadata_records.append(record)

        test_cases.append(
            {
                "case_id": f"TC-POS-{idx:02d}",
                "type": "POSITIVE",
                "expected_recognized": True,
                "expected_person_id": person_id,
                "full_name": p["full_name"],
                "image_path": f"images/test_positive/{pos_filename}",
            }
        )

    for idx, neg in enumerate(NEGATIVE_SUBJECTS, start=1):
        test_id = neg["test_id"]
        neg_filename = f"{test_id}.jpg"
        neg_path = NEGATIVE_DIR / neg_filename
        if not neg_path.exists():
            raw_img = _download_image(neg["pravatar_id"])
            framed_img = _frame_for_webcam(raw_img)
            cv2.imwrite(str(neg_path), framed_img, [cv2.IMWRITE_JPEG_QUALITY, 90])

        test_cases.append(
            {
                "case_id": f"TC-NEG-{idx:02d}",
                "type": "NEGATIVE",
                "expected_recognized": False,
                "expected_person_id": None,
                "full_name": neg["label"],
                "image_path": f"images/test_negative/{neg_filename}",
            }
        )

    metadata_json_path = BASE_DIR / "metadata.json"
    with open(metadata_json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "collection_id_default": "attendance-faces",
                "match_threshold_default": 80.0,
                "total_enrolled": len(metadata_records),
                "subjects": metadata_records,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    metadata_csv_path = BASE_DIR / "metadata.csv"
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
    with open(metadata_csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(metadata_records)

    test_cases_path = BASE_DIR / "test_cases.json"
    with open(test_cases_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "total_cases": len(test_cases),
                "positive_cases": len(ENROLLED_PATIENTS),
                "negative_cases": len(NEGATIVE_SUBJECTS),
                "cases": test_cases,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(f"Dataset 20 Pasien RS berhasil diperbarui di {metadata_json_path}!")


if __name__ == "__main__":
    main()
