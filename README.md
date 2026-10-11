# servereless-Aps

## Real-time Attendance

Aplikasi absensi berbasis pengenalan wajah real-time dengan React, Tailwind CSS, AWS Lambda, dan DynamoDB.

## Struktur

- `src/`: frontend React dan TypeScript.
  - `components/AttendanceCamera.tsx`: UI kamera absensi (hanya komposisi Tailwind, pemanggilan hook, dan tampilan status).
  - `hooks/`: `useWebCamera` (WebRTC dan pelepasan track), `useFaceDetection` + `useBlazeFaceModel` (loop BlazeFace, timer auto-capture 1,5 detik), `useFrameCapture`, dan `useAttendanceVerification`.
  - `lib/`: logika murni tanpa React, yaitu `faceValidation` (validasi posisi wajah pada dimensi intrinsik video dengan toleransi 12%) dan `video` (guard frame dan penangkapan JPEG).
- `backend/app/`: handler Python untuk AWS Lambda.
- `backend/requirements.txt`: dependensi runtime backend.
- `backend/template.yaml`: definisi AWS SAM untuk API Gateway, Lambda, dan DynamoDB.

## Menjalankan frontend

```powershell
npm install
npm run build
npm run dev
```

Salin `.env.example` menjadi `.env.local`, lalu isi `VITE_API_URL` dengan URL endpoint API Gateway.

## Konfigurasi backend

Lambda menggunakan environment variables berikut:

- `ATTENDANCE_TABLE_NAME`: nama tabel DynamoDB log absensi.
- `REKOGNITION_COLLECTION_ID`: ID koleksi wajah Amazon Rekognition yang sudah berisi wajah terdaftar.
- `MATCH_THRESHOLD`: ambang similarity Rekognition, default `80`.

Deploy dengan AWS SAM dari folder `backend/` setelah koleksi Rekognition dibuat:

```powershell
sam build
sam deploy --guided
```

Frontend mengirim `{ "image": "<base64 data URL>" }` ke endpoint tersebut. Lambda mengembalikan `200` untuk verifikasi berhasil atau wajah tidak dikenali, `400` untuk payload invalid, dan `500` untuk kegagalan layanan.