# Dataset Pengenalan Wajah (Face Recognition Attendance)

Dataset ini disiapkan khusus untuk kebutuhan pendaftaran wajah (**enrollment**) dan pengujian akurasi (**evaluation**) pada sistem absensi berbasis **Amazon Rekognition** (`SearchFacesByImage`) dan **BlazeFace** ([`handler.py`](../backend/app/handler.py) & [`faceValidation.ts`](../src/lib/faceValidation.ts)).

---

## Struktur Direktori

```text
dataset/
├── images/
│   ├── enrolled/          # 20 foto wajah referensi mahasiswa terdaftar (640x480 JPEG)
│   ├── test_positive/     # 20 foto variasi kamera/pencahayaan untuk uji True Positive (TP)
│   └── test_negative/     # 5 foto wajah tidak terdaftar (impostor) untuk uji True Negative (TN)
├── metadata.json          # Metadata lengkap 20 mahasiswa terdaftar (format JSON)
├── metadata.csv           # Metadata 20 mahasiswa terdaftar (format CSV untuk tabel/lampiran skripsi)
├── test_cases.json        # Daftar 25 skenario pengujian (20 positif + 5 negatif)
├── evaluation_report.csv  # Hasil laporan pengujian akurasi, similarity, dan latensi
├── prepare_dataset.py     # Script pengunduh & pembuat ulang dataset gambar wajah
├── enroll_rekognition.py  # Script untuk mendaftarkan (IndexFaces) dataset ke Amazon Rekognition
└── test_verify_api.py     # Script pengujian akurasi ke API Gateway maupun simulasi Lambda lokal
```

---

## Spesifikasi Dataset

- **Jumlah Subjek Terdaftar**: 20 Mahasiswa (`MHS-2026-001` s/d `MHS-2026-020`, terdiri dari 10 Laki-laki dan 10 Perempuan di kelas `TI-4A` dan `SI-4B`).
- **Format `ExternalImageId`**: Mengikuti aturan regex Amazon Rekognition (`[a-zA-Z0-9_.\-:]+`), yang otomatis disimpan sebagai atribut `ID` pada tabel DynamoDB oleh [`_record_attendance`](../backend/app/handler.py#L117-L139).
- **Resolusi & Geometri**: `640x480` piksel (rasio 4:3 standar webcam) dengan posisi wajah terpusat di dalam kotak panduan [`faceValidation.ts`](../src/lib/faceValidation.ts).

---

## Cara Penggunaan

### 1. Validasi Dataset Secara Lokal (Tanpa Akun AWS)
Untuk memastikan seluruh gambar dan `person_id` valid sebelum dideploy ke AWS:

```powershell
python dataset/enroll_rekognition.py --dry-run
```

### 2. Mendaftarkan Wajah ke Amazon Rekognition Collection
Pastikan kredensial AWS (`aws configure`) dan paket `boto3` sudah aktif, lalu jalankan:

```powershell
# Membuat koleksi 'attendance-faces' (jika belum ada) dan mengindeks 20 foto wajah
python dataset/enroll_rekognition.py --collection-id attendance-faces --region ap-southeast-1

# Melihat daftar wajah yang sudah terdaftar di koleksi Rekognition
python dataset/enroll_rekognition.py --collection-id attendance-faces --list

# Menghapus dan membuat ulang koleksi dari awal
python dataset/enroll_rekognition.py --collection-id attendance-faces --reset
```

Hasil `FaceId` dari setiap wajah yang berhasil didaftarkan akan disimpan ke `dataset/enrolled_faces_result.json`.

### 3. Menguji Akurasi & Latensi (Untuk Data Bab Pengujian Skripsi)

#### A. Mode Simulasi Lokal (`lambda_handler`)
Menguji alur [`lambda_handler`](../backend/app/handler.py#L142-L221) secara langsung di komputer lokal tanpa biaya AWS:

```powershell
python dataset/test_verify_api.py --simulate-local
```

#### B. Mode Live Endpoint API Gateway
Menguji seluruh 25 kasus uji (`test_cases.json`) langsung ke endpoint AWS API Gateway yang sudah dideploy:

```powershell
python dataset/test_verify_api.py --api-url "https://<api-id>.execute-api.<region>.amazonaws.com/v1/attendance/verify"
```

Hasil pengujian (TP, TN, FP, FN, *Accuracy*, *Precision*, *Recall*, *Similarity Score*, dan *Latency*) akan ditampilkan di terminal serta disimpan dalam bentuk tabel ke [`evaluation_report.csv`](evaluation_report.csv).
