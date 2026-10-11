"""Script pendaftaran (enrollment/indexing) dataset wajah ke Amazon Rekognition Collection.

Contoh penggunaan:
  # Validasi lokal (tanpa memanggil AWS / tanpa kredensial AWS):
  python dataset/enroll_rekognition.py --dry-run

  # Daftarkan seluruh 20 wajah ke Amazon Rekognition Collection 'attendance-faces':
  python dataset/enroll_rekognition.py --collection-id attendance-faces --region ap-southeast-1

  # Reset (hapus & buat ulang) koleksi sebelum mendaftarkan ulang:
  python dataset/enroll_rekognition.py --collection-id attendance-faces --reset

  # Lihat daftar wajah yang sudah terdaftar di koleksi:
  python dataset/enroll_rekognition.py --collection-id attendance-faces --list
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
METADATA_PATH = BASE_DIR / "metadata.json"
ENROLLED_OUTPUT_PATH = BASE_DIR / "enrolled_faces_result.json"

MAX_IMAGE_BYTES = 5 * 1024 * 1024
EXTERNAL_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_.\-:]+$")


def _load_metadata() -> dict[str, Any]:
    if not METADATA_PATH.exists():
        raise FileNotFoundError(
            f"File metadata tidak ditemukan di {METADATA_PATH}. "
            "Jalankan `python dataset/prepare_dataset.py` terlebih dahulu."
        )
    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _validate_local_dataset(subjects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    validated: list[dict[str, Any]] = []
    for subj in subjects:
        person_id = subj["person_id"]
        if not EXTERNAL_ID_PATTERN.match(person_id):
            raise ValueError(
                f"person_id '{person_id}' tidak valid untuk ExternalImageId Amazon Rekognition "
                "(harus cocok dengan [a-zA-Z0-9_.\\-:]+)"
            )
        img_path = BASE_DIR / subj["enrolled_image"]
        if not img_path.exists():
            raise FileNotFoundError(f"File gambar tidak ditemukan: {img_path}")
        size_bytes = img_path.stat().st_size
        if size_bytes == 0 or size_bytes > MAX_IMAGE_BYTES:
            raise ValueError(
                f"Ukuran file {img_path} ({size_bytes} bytes) tidak valid (maks 5 MB)."
            )
        validated.append(
            {
                **subj,
                "abs_path": img_path,
                "size_bytes": size_bytes,
            }
        )
    return validated


def _get_rekognition_client(region: str | None):
    try:
        import boto3
    except ImportError as exc:
        print(
            "Error: Paket 'boto3' belum terinstal. Jalankan:\n"
            "  pip install -r backend/requirements.txt",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc

    if region:
        return boto3.client("rekognition", region_name=region)
    return boto3.client("rekognition")


def _ensure_collection(client: Any, collection_id: str, reset: bool = False) -> None:
    from botocore.exceptions import ClientError

    if reset:
        try:
            client.delete_collection(CollectionId=collection_id)
            print(f"[RESET] Koleksi '{collection_id}' lama berhasil dihapus.")
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code", "")
            if code != "ResourceNotFoundException":
                raise

    try:
        resp = client.create_collection(CollectionId=collection_id)
        arn = resp.get("CollectionArn", "-")
        print(f"[CREATE] Koleksi '{collection_id}' berhasil dibuat (ARN: {arn}).")
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code", "")
        if code == "ResourceAlreadyExistsException":
            print(f"[INFO] Koleksi '{collection_id}' sudah ada, melanjutkan indexing...")
        else:
            raise


def _list_collection_faces(client: Any, collection_id: str) -> None:
    faces: list[dict[str, Any]] = []
    pagination_token: str | None = None

    while True:
        kwargs: dict[str, Any] = {"CollectionId": collection_id, "MaxResults": 100}
        if pagination_token:
            kwargs["NextToken"] = pagination_token
        resp = client.list_faces(**kwargs)
        faces.extend(resp.get("Faces", []))
        pagination_token = resp.get("NextToken")
        if not pagination_token:
            break

    print(f"\nDaftar Wajah pada Koleksi '{collection_id}' (Total: {len(faces)}):")
    print("-" * 72)
    print(f"{'No':<4} | {'ExternalImageId':<16} | {'FaceId':<38} | {'Confidence'}")
    print("-" * 72)
    for idx, face in enumerate(faces, start=1):
        ext_id = face.get("ExternalImageId", "-")
        face_id = face.get("FaceId", "-")
        conf = face.get("Confidence", 0.0)
        print(f"{idx:<4} | {ext_id:<16} | {face_id:<38} | {conf:.2f}%")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Daftarkan dataset wajah ke Amazon Rekognition Collection."
    )
    parser.add_argument(
        "--collection-id",
        default="attendance-faces",
        help="ID koleksi Amazon Rekognition (default: attendance-faces)",
    )
    parser.add_argument(
        "--region",
        default=None,
        help="AWS Region (contoh: ap-southeast-1)",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Hapus dan buat ulang koleksi sebelum mendaftarkan wajah",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Tampilkan daftar wajah yang terdaftar di koleksi Rekognition",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validasi kelengkapan gambar & metadata secara lokal tanpa memanggil AWS",
    )
    args = parser.parse_args()

    metadata = _load_metadata()
    subjects = metadata.get("subjects", [])
    validated = _validate_local_dataset(subjects)

    if args.dry_run:
        print(f"[DRY-RUN] Validasi lokal berhasil untuk {len(validated)} subjek!")
        print(f"Target Collection ID : {args.collection_id}")
        print("-" * 80)
        print(f"{'Person ID':<15} | {'NIM':<11} | {'Nama Mahasiswa':<24} | {'File Size':<10}")
        print("-" * 80)
        for item in validated:
            kb = item["size_bytes"] / 1024
            print(
                f"{item['person_id']:<15} | {item['nim']:<11} | {item['full_name']:<24} | {kb:>6.1f} KB"
            )
        print("-" * 80)
        print("Seluruh gambar siap didaftarkan ke Amazon Rekognition.")
        return

    client = _get_rekognition_client(args.region)

    if args.list:
        _list_collection_faces(client, args.collection_id)
        return

    _ensure_collection(client, args.collection_id, reset=args.reset)

    enrolled_results: list[dict[str, Any]] = []
    print(f"\nMendaftarkan {len(validated)} wajah ke koleksi '{args.collection_id}'...")

    for idx, item in enumerate(validated, start=1):
        person_id = item["person_id"]
        image_bytes = item["abs_path"].read_bytes()

        response = client.index_faces(
            CollectionId=args.collection_id,
            Image={"Bytes": image_bytes},
            ExternalImageId=person_id,
            DetectionAttributes=["DEFAULT"],
            MaxFaces=1,
            QualityFilter="AUTO",
        )

        records = response.get("FaceRecords", [])
        if not records:
            print(f"  [{idx:02d}/{len(validated)}] {person_id} -> GAGAL (Wajah tidak terdeteksi)")
            continue

        face_info = records[0].get("Face", {})
        face_id = face_info.get("FaceId")
        confidence = face_info.get("Confidence", 0.0)
        enrolled_results.append(
            {
                "person_id": person_id,
                "nim": item["nim"],
                "full_name": item["full_name"],
                "face_id": face_id,
                "confidence": confidence,
                "image": item["enrolled_image"],
            }
        )
        print(
            f"  [{idx:02d}/{len(validated)}] {person_id} ({item['full_name']}) "
            f"-> FaceId: {face_id} (Confidence: {confidence:.2f}%)"
        )

    with open(ENROLLED_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(
            {
                "collection_id": args.collection_id,
                "enrolled_count": len(enrolled_results),
                "faces": enrolled_results,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )

    print(f"\nSelesai! {len(enrolled_results)}/{len(validated)} wajah berhasil didaftarkan.")
    print(f"Bukti hasil pendaftaran disimpan di: {ENROLLED_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
