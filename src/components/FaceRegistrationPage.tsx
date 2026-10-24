import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  useAttendanceVerification,
  type RecognizedPerson,
} from '../hooks/useAttendanceVerification';
import { useFaceDetection } from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import { useWebCamera } from '../hooks/useWebCamera';
import { POLIKLINIK_LIST } from '../lib/hospital';
import CameraView from './CameraView';
import {
  CameraIcon,
  CheckIcon,
  RefreshIcon,
  UploadIcon,
} from './icons';

interface FaceRegistrationPageProps {
  readonly onGoToAttendance?: () => void;
}

interface FormState {
  fullName: string;
  gender: 'Laki-laki' | 'Perempuan';
  nik: string;
  age: string;
  bloodType: string;
  insurance: string;
  poliklinik: string;
  allergies: string;
  chronicConditions: string;
  complaint: string;
}

const EMPTY_FORM: FormState = {
  fullName: '',
  gender: 'Laki-laki',
  nik: '',
  age: '',
  bloodType: 'O+',
  insurance: 'BPJS Kesehatan',
  poliklinik: 'Poli Umum',
  allergies: '',
  chronicConditions: '',
  complaint: '',
};

const inputClass =
  'h-9 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-900';

function Field({
  label,
  hint,
  children,
  className = '',
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 flex items-baseline justify-between text-xs font-medium text-neutral-600">
        {label}
        {hint && <span className="font-normal text-neutral-400 text-[11px]">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function FaceRegistrationPage({ onGoToAttendance }: FaceRegistrationPageProps) {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const photo = uploadedImage ?? frame.image;

  const camera = useWebCamera({ enabled: photo === null });
  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready' && photo === null,
    onHoldComplete: () => undefined,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RecognizedPerson | null>(null);
  const [patientCount, setPatientCount] = useState<number | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const refreshCount = useCallback(async () => {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) return;
    try {
      const resp = await fetch(apiUrl.replace(/\/verify\/?$/, '/faces'));
      const data = (await resp.json()) as { count?: number };
      if (typeof data.count === 'number') setPatientCount(data.count);
    } catch {
      /* abaikan */
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const resetPhoto = () => {
    setUploadedImage(null);
    frame.discard();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        frame.discard();
        setUploadedImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.fullName.trim()) {
      setError('Nama lengkap pasien wajib diisi.');
      nameInputRef.current?.focus();
      return;
    }
    if (!photo) {
      setError('Ambil atau unggah foto wajah pasien terlebih dahulu.');
      return;
    }

    setIsSaving(true);
    const age = Number.parseInt(form.age, 10);
    const result = await verification.enrollFace({
      fullName: form.fullName.trim(),
      gender: form.gender,
      nik: form.nik.trim() || undefined,
      age: Number.isFinite(age) ? age : undefined,
      bloodType: form.bloodType,
      insurance: form.insurance,
      poliklinik: form.poliklinik,
      allergies: form.allergies.trim() || 'Tidak Ada Alergi',
      chronicConditions: form.chronicConditions.trim() || 'Tidak Ada',
      medicalHistoryNotes:
        form.complaint.trim() || 'Pendaftaran Pasien Baru & Pemeriksaan Awal',
      image: photo,
    });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setSaved(result.person ?? null);
    setForm(EMPTY_FORM);
    resetPhoto();
    void refreshCount();
    nameInputRef.current?.focus();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start">
      {/* Kolom Kiri: Kamera */}
      <section className="space-y-4">
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-900">
              Foto Wajah Pasien
            </span>
            {patientCount !== null && (
              <span className="text-xs text-neutral-400">
                {patientCount} pasien terdaftar
              </span>
            )}
          </div>

          <CameraView
            camera={camera}
            detection={detection}
            capturedImage={photo}
            isFlashing={frame.isFlashing}
            faceLabel={
              detection.trackingBox
                ? form.fullName.trim() || 'Pasien Baru'
                : null
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-2">
              {photo ? (
                <button
                  type="button"
                  onClick={resetPhoto}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
                >
                  <RefreshIcon width={13} height={13} />
                  Ambil Ulang
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => frame.capture(camera.videoRef.current)}
                  disabled={camera.status !== 'ready'}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
                >
                  <CameraIcon width={13} height={13} />
                  Ambil Foto
                </button>
              )}

              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50">
                <UploadIcon width={13} height={13} />
                Unggah
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUpload}
                  className="hidden"
                />
              </label>
            </div>

            <span className="text-xs text-neutral-500">
              {photo
                ? 'Foto siap disimpan'
                : detection.trackingBox
                  ? 'Wajah terdeteksi'
                  : 'Hadapkan wajah'}
            </span>
          </div>
        </div>

        {saved && (
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <CheckIcon width={12} height={12} />
                </span>
                <div>
                  <p className="font-semibold text-emerald-950">
                    Pasien berhasil didaftarkan
                  </p>
                  <p className="mt-0.5 text-emerald-800">
                    {saved.fullName} (<span className="font-mono">{saved.noRm}</span>) ·
                    Antrean <strong className="font-mono">{saved.queueTicket?.queueNumber ?? '-'}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSaved(null)}
                className="text-emerald-700 hover:text-emerald-950"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Kolom Kanan: Formulir Pendaftaran Minimalis */}
      <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <p className="text-xs font-semibold text-neutral-900">
            Data Identitas & Medis Pasien
          </p>

          <Field label="Nama Lengkap *">
            <input
              ref={nameInputRef}
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              placeholder="Nama sesuai KTP"
              className={inputClass}
              required
            />
          </Field>

          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Jenis Kelamin">
              <select
                value={form.gender}
                onChange={(e) =>
                  update('gender', e.target.value as 'Laki-laki' | 'Perempuan')
                }
                className={inputClass}
              >
                <option value="Laki-laki">Laki-laki</option>
                <option value="Perempuan">Perempuan</option>
              </select>
            </Field>

            <Field label="Usia (th)">
              <input
                value={form.age}
                onChange={(e) =>
                  update('age', e.target.value.replace(/\D/g, '').slice(0, 3))
                }
                inputMode="numeric"
                placeholder="30"
                className={inputClass}
              />
            </Field>

            <Field label="Gol. Darah">
              <select
                value={form.bloodType}
                onChange={(e) => update('bloodType', e.target.value)}
                className={inputClass}
              >
                {['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-'].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="NIK" hint="16 digit">
              <input
                value={form.nik}
                onChange={(e) =>
                  update('nik', e.target.value.replace(/\D/g, '').slice(0, 16))
                }
                inputMode="numeric"
                placeholder="3273xxxxxxxxxxxx"
                className={inputClass}
              />
            </Field>

            <Field label="Jaminan">
              <select
                value={form.insurance}
                onChange={(e) => update('insurance', e.target.value)}
                className={inputClass}
              >
                <option>BPJS Kesehatan</option>
                <option>Asuransi Swasta</option>
                <option>Umum (Mandiri)</option>
              </select>
            </Field>
          </div>

          <Field label="Poliklinik Tujuan">
            <select
              value={form.poliklinik}
              onChange={(e) => update('poliklinik', e.target.value)}
              className={inputClass}
            >
              {POLIKLINIK_LIST.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Alergi Obat / Makanan" hint="opsional">
              <input
                value={form.allergies}
                onChange={(e) => update('allergies', e.target.value)}
                placeholder="Kosongkan jika tidak ada"
                className={inputClass}
              />
            </Field>

            <Field label="Penyakit Penyerta" hint="opsional">
              <input
                value={form.chronicConditions}
                onChange={(e) => update('chronicConditions', e.target.value)}
                placeholder="Hipertensi, Asma, dll."
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Keluhan Utama / Catatan Awal">
            <input
              value={form.complaint}
              onChange={(e) => update('complaint', e.target.value)}
              placeholder="Contoh: Pemeriksaan tekanan darah & keluhan pusing"
              className={inputClass}
            />
          </Field>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-neutral-100 pt-3.5">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setError(null);
                resetPhoto();
              }}
              className="text-xs text-neutral-500 hover:text-neutral-800"
            >
              Reset
            </button>

            <div className="flex items-center gap-2">
              {onGoToAttendance && (
                <button
                  type="button"
                  onClick={onGoToAttendance}
                  className="h-8 rounded-full px-3.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Batal
                </button>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                {isSaving ? 'Menyimpan…' : 'Simpan & Ambil Antrean'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export default FaceRegistrationPage;
