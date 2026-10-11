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
import { CameraIcon, CheckIcon, RefreshIcon, UploadIcon } from './icons';

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
  'h-11 w-full rounded-xl border border-neutral-200 bg-white px-3.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-900';

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
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-neutral-600">
        {label}
        {hint && <span className="font-normal text-neutral-400">{hint}</span>}
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
      setError('Nama lengkap wajib diisi.');
      return;
    }
    if (!photo) {
      setError('Ambil foto wajah pasien terlebih dahulu.');
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
      medicalHistoryNotes: form.complaint.trim() || 'Pemeriksaan awal pasien baru',
      image: photo,
    });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    // Simpan berhasil: tampilkan ringkasan, kosongkan form untuk pasien berikutnya.
    setSaved(result.person ?? null);
    setForm(EMPTY_FORM);
    resetPhoto();
    void refreshCount();
    nameInputRef.current?.focus();
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Kamera */}
      <section className="space-y-4">
        <CameraView
          camera={camera}
          detection={detection}
          capturedImage={photo}
          isFlashing={frame.isFlashing}
          faceLabel={detection.trackingBox ? form.fullName.trim() || 'Pasien baru' : null}
        />

        <div className="flex flex-wrap items-center gap-2">
          {photo ? (
            <button
              type="button"
              onClick={resetPhoto}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50"
            >
              <RefreshIcon width={15} height={15} />
              Ambil ulang
            </button>
          ) : (
            <button
              type="button"
              onClick={() => frame.capture(camera.videoRef.current)}
              disabled={camera.status !== 'ready'}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-40"
            >
              <CameraIcon width={15} height={15} />
              Ambil foto
            </button>
          )}

          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50">
            <UploadIcon width={15} height={15} />
            Unggah
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
          </label>

          <span className="ml-auto flex items-center gap-2 text-sm text-neutral-500">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                photo ? 'bg-emerald-500' : detection.trackingBox ? 'bg-emerald-500' : 'bg-neutral-300'
              }`}
            />
            {photo ? 'Foto siap' : detection.trackingBox ? 'Wajah terdeteksi' : 'Menunggu wajah'}
          </span>
        </div>

        {saved && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              <CheckIcon width={16} height={16} />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-emerald-900">
                {saved.fullName} terdaftar · {saved.noRm}
              </p>
              <p className="mt-0.5 text-emerald-800/80">
                Antrean {saved.queueTicket?.queueNumber ?? '-'} · {saved.poliklinik}. Form sudah
                dikosongkan untuk pasien berikutnya.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSaved(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900"
            >
              Tutup
            </button>
          </div>
        )}
      </section>

      {/* Form */}
      <section>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-8">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Data pasien</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {patientCount !== null ? `${patientCount} pasien terdaftar. ` : ''}
              Isi data lalu simpan — form otomatis kosong untuk pasien berikutnya.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Nama lengkap" className="col-span-2">
              <input
                ref={nameInputRef}
                value={form.fullName}
                onChange={(e) => update('fullName', e.target.value)}
                placeholder="Budi Santoso"
                className={inputClass}
              />
            </Field>

            <Field label="Jenis kelamin" className="col-span-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
                {(['Laki-laki', 'Perempuan'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => update('gender', g)}
                    className={`h-9 rounded-lg text-sm transition ${
                      form.gender === g
                        ? 'bg-white font-medium text-neutral-900 shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="NIK" hint="opsional">
              <input
                value={form.nik}
                onChange={(e) => update('nik', e.target.value.replace(/\D/g, '').slice(0, 16))}
                inputMode="numeric"
                placeholder="16 digit"
                className={inputClass}
              />
            </Field>

            <Field label="Usia">
              <input
                value={form.age}
                onChange={(e) => update('age', e.target.value.replace(/\D/g, '').slice(0, 3))}
                inputMode="numeric"
                placeholder="Tahun"
                className={inputClass}
              />
            </Field>

            <Field label="Golongan darah">
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

            <Field label="Jaminan">
              <select
                value={form.insurance}
                onChange={(e) => update('insurance', e.target.value)}
                className={inputClass}
              >
                <option>BPJS Kesehatan</option>
                <option>Asuransi Swasta</option>
                <option>Umum</option>
              </select>
            </Field>
          </div>

          <div className="space-y-4 border-t border-neutral-100 pt-8">
            <h3 className="text-sm font-semibold text-neutral-900">Informasi medis</h3>

            <Field label="Poliklinik tujuan">
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

            <Field label="Alergi" hint="kosongkan jika tidak ada">
              <input
                value={form.allergies}
                onChange={(e) => update('allergies', e.target.value)}
                placeholder="Penisilin, seafood…"
                className={inputClass}
              />
            </Field>

            <Field label="Penyakit penyerta" hint="opsional">
              <input
                value={form.chronicConditions}
                onChange={(e) => update('chronicConditions', e.target.value)}
                placeholder="Hipertensi, diabetes…"
                className={inputClass}
              />
            </Field>

            <Field label="Keluhan utama" hint="opsional">
              <textarea
                value={form.complaint}
                onChange={(e) => update('complaint', e.target.value)}
                rows={2}
                placeholder="Demam sejak 2 hari…"
                className={`${inputClass} h-auto resize-none py-3`}
              />
            </Field>
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-neutral-100 pt-6">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setError(null);
                resetPhoto();
              }}
              className="text-sm text-neutral-500 transition hover:text-neutral-900"
            >
              Kosongkan
            </button>

            <div className="flex items-center gap-2">
              {onGoToAttendance && (
                <button
                  type="button"
                  onClick={onGoToAttendance}
                  className="h-11 rounded-full px-4 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
                >
                  Batal
                </button>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-neutral-900 px-6 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
              >
                {isSaving && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
                {isSaving ? 'Menyimpan…' : 'Simpan pasien'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export default FaceRegistrationPage;
