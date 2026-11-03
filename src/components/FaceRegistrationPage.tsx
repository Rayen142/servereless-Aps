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
import { POLIKLINIK_LIST, resolveApiEndpoint } from '../lib/hospital';
import CameraView from './CameraView';
import {
  CameraIcon,
  CheckIcon,
  RefreshIcon,
  ShieldCheckIcon,
  UploadIcon,
} from './icons';

interface FaceRegistrationPageProps {
  readonly onGoToAttendance?: () => void;
}

interface FormState {
  fullName: string;
  gender: 'Laki-laki' | 'Perempuan';
  noRm: string;
  age: string;
  poliklinik: string;
}

const EMPTY_FORM: FormState = {
  fullName: '',
  gender: 'Laki-laki',
  noRm: '',
  age: '25',
  poliklinik: 'Poli Umum',
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
        {hint && (
          <span className="font-normal text-neutral-400 text-[11px]">{hint}</span>
        )}
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

  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);

  const camera = useWebCamera({ enabled: capturedPhoto === null });
  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready' && capturedPhoto === null,
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
    const facesUrl = resolveApiEndpoint('faces');
    if (!facesUrl) return;
    try {
      const resp = await fetch(facesUrl);
      const data = (await resp.json()) as { count?: number };
      if (typeof data.count === 'number') setPatientCount(data.count);
    } catch {
      /* abaikan jika server sedang dimuat */
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const handleCapturePhoto = () => {
    const shot = frame.capture(camera.videoRef.current);
    if (shot) {
      setCapturedPhoto(shot);
      frame.discard();
    }
  };

  const resetPhoto = () => {
    setCapturedPhoto(null);
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
        setCapturedPhoto(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.fullName.trim()) {
      setError('Nama lengkap subjek/pasien wajib diisi.');
      nameInputRef.current?.focus();
      return;
    }
    if (!capturedPhoto) {
      setError('Ambil atau unggah citra wajah terlebih dahulu.');
      return;
    }

    setIsSaving(true);
    const age = Number.parseInt(form.age, 10);

    const result = await verification.enrollFace({
      fullName: form.fullName.trim(),
      gender: form.gender,
      noRm: form.noRm.trim() || undefined,
      age: Number.isFinite(age) ? age : 25,
      poliklinik: form.poliklinik,
      image: capturedPhoto,
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start">
      {/* Kolom Kiri: Akuisisi Citra Wajah */}
      <section className="space-y-4">
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-neutral-900">
                Akuisisi Citra Wajah (Face Enrollment)
              </span>
              <p className="text-[11px] text-neutral-500">
                Citra wajah akan diekstraksi menjadi vektor embedding pada koleksi biometrik
              </p>
            </div>
            {patientCount !== null && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 font-mono text-[11px] font-medium text-neutral-600">
                {patientCount} subjek terdaftar
              </span>
            )}
          </div>

          <CameraView
            camera={camera}
            detection={detection}
            capturedImage={capturedPhoto}
            isFlashing={frame.isFlashing}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            {capturedPhoto ? (
              <button
                type="button"
                onClick={resetPhoto}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                <RefreshIcon width={13} height={13} />
                Ambil Ulang Citra
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCapturePhoto}
                disabled={camera.status !== 'ready'}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                <CameraIcon width={13} height={13} />
                Ambil Foto Wajah
              </button>
            )}

            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50">
              <UploadIcon width={13} height={13} />
              Unggah File Citra
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Kartu Hasil Pendaftaran Vektor */}
        {saved && (
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-800">
                <ShieldCheckIcon width={16} height={16} />
                <span className="text-xs font-semibold">
                  Registrasi Vektor Biometrik Berhasil
                </span>
              </div>
              {saved.queueTicket && (
                <span className="rounded-lg bg-neutral-900 px-2.5 py-1 font-mono text-xs font-semibold text-white">
                  {saved.queueTicket.queueNumber}
                </span>
              )}
            </div>

            <div className="text-xs text-neutral-700 space-y-0.5">
              <p className="font-semibold text-neutral-900">{saved.fullName}</p>
              <p className="text-neutral-500">
                No. RM: <span className="font-mono">{saved.noRm}</span> ·{' '}
                {saved.poliklinik}
              </p>
            </div>

            {onGoToAttendance && (
              <button
                type="button"
                onClick={onGoToAttendance}
                className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800"
              >
                <CheckIcon width={12} height={12} />
                Ke Halaman Pindai Wajah
              </button>
            )}
          </div>
        )}
      </section>

      {/* Kolom Kanan: Form Identitas Dasar & Poliklinik */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-2xl border border-neutral-200/80 bg-white p-5 space-y-4"
      >
        <div className="border-b border-neutral-100 pb-3">
          <h2 className="text-sm font-semibold text-neutral-900">
            Data Identitas Subjek &amp; Tujuan Antrean
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Pendaftaran subjek baru untuk pengujian ekstraksi vektor wajah dan penerbitan nomor antrean.
          </p>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Nama Lengkap *" className="sm:col-span-2">
            <input
              ref={nameInputRef}
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              placeholder="Contoh: Budi Santoso"
              className={inputClass}
              required
            />
          </Field>

          <Field label="No. RM / ID Subjek" hint="Opsional (Otomatis jika kosong)">
            <input
              value={form.noRm}
              onChange={(e) => update('noRm', e.target.value)}
              placeholder="RM-2026-XXXX"
              className={`${inputClass} font-mono uppercase`}
            />
          </Field>

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

          <Field label="Usia (Tahun)">
            <input
              type="number"
              min={1}
              max={120}
              value={form.age}
              onChange={(e) => update('age', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Poliklinik Tujuan">
            <select
              value={form.poliklinik}
              onChange={(e) => update('poliklinik', e.target.value)}
              className={inputClass}
            >
              {POLIKLINIK_LIST.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3.5">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-neutral-900 px-5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Mengekstraksi Vektor Biometrik...
              </>
            ) : (
              <>
                <CheckIcon width={13} height={13} />
                Daftarkan Vektor Wajah &amp; Terbitkan Antrean
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export default FaceRegistrationPage;
