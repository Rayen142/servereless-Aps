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
  UserPlusIcon,
  UsersIcon,
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
  'h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-500/10';

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
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-semibold text-slate-700">
        {label}
        {hint && <span className="font-normal text-slate-400 text-[11px]">{hint}</span>}
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
      medicalHistoryNotes: form.complaint.trim() || 'Pendaftaran Pasien Baru & Pemeriksaan Awal',
      image: photo,
    });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    // Berhasil: simpan feedback, reset form untuk pasien berikutnya
    setSaved(result.person ?? null);
    setForm(EMPTY_FORM);
    resetPhoto();
    void refreshCount();
    nameInputRef.current?.focus();
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start">
      {/* Kolom Perekaman Wajah */}
      <section className="space-y-4">
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <CameraIcon width={16} height={16} className="text-teal-600" />
              Perekaman Biometrik Wajah
            </h3>
            {patientCount !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                <UsersIcon width={12} height={12} />
                {patientCount} Pasien di Database
              </span>
            )}
          </div>

          <CameraView
            camera={camera}
            detection={detection}
            capturedImage={photo}
            isFlashing={frame.isFlashing}
            faceLabel={detection.trackingBox ? form.fullName.trim() || 'Pasien Baru' : null}
          />

          {/* Action buttons under camera */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              {photo ? (
                <button
                  type="button"
                  onClick={resetPhoto}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
                >
                  <RefreshIcon width={14} height={14} />
                  Ambil Ulang
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => frame.capture(camera.videoRef.current)}
                  disabled={camera.status !== 'ready'}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white transition hover:bg-slate-800 active:scale-[0.98] disabled:opacity-40 shadow-sm"
                >
                  <CameraIcon width={14} height={14} />
                  Ambil Foto Pasien
                </button>
              )}

              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]">
                <UploadIcon width={14} height={14} />
                Unggah File
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span
                className={`h-2 w-2 rounded-full ${
                  photo
                    ? 'bg-emerald-500'
                    : detection.trackingBox
                      ? 'bg-teal-500'
                      : 'bg-slate-300'
                }`}
              />
              <span>
                {photo
                  ? 'Foto Siap Disimpan'
                  : detection.trackingBox
                    ? 'Wajah Pasien Terdeteksi'
                    : 'Posisikan Wajah ke Kamera'}
              </span>
            </div>
          </div>
        </div>

        {/* Notifikasi Pendaftaran Berhasil */}
        {saved && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm transition-all">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <CheckIcon width={18} height={18} />
              </div>
              <div className="flex-1 text-xs">
                <p className="font-bold text-emerald-950 text-sm">
                  Pendaftaran Berhasil Disimpan
                </p>
                <p className="mt-0.5 text-emerald-800 font-medium">
                  {saved.fullName} (No. RM:{' '}
                  <span className="font-mono font-bold">{saved.noRm}</span>)
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-emerald-200/70 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-950">
                    Nomor Antrean: {saved.queueTicket?.queueNumber ?? '-'}
                  </span>
                  {saved.queueTicket && (
                    <span className="rounded bg-white/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-900 border border-emerald-200">
                      Sedang Dilayani: {saved.queueTicket.currentServingNumber}
                    </span>
                  )}
                  <span className="text-emerald-800 font-semibold">
                    · Menunggu {saved.queueTicket?.patientsAhead ?? 0} pasien lagi (
                    ± {saved.queueTicket?.estimatedWaitMinutes ?? 0} menit)
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSaved(null)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Kolom Formulir Rekam Medis */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-card">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-base font-bold text-slate-900">
              Formulir Rekam Medis & Admisi Pasien
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Lengkapi informasi identitas dan anamnesis awal pasien untuk pendaftaran database SIMRS.
            </p>
          </div>

          {/* Bagian 1: Data Identitas Pasien */}
          <div className="space-y-3.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
              1. Identitas Pasien
            </p>

            <Field label="Nama Lengkap Pasien *">
              <input
                ref={nameInputRef}
                value={form.fullName}
                onChange={(e) => update('fullName', e.target.value)}
                placeholder="Contoh: Budi Santoso"
                className={inputClass}
                required
              />
            </Field>

            <Field label="Jenis Kelamin">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                {(['Laki-laki', 'Perempuan'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => update('gender', g)}
                    className={`h-8 rounded-lg text-xs font-semibold transition ${
                      form.gender === g
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="NIK (Nomor Induk Kependudukan)" hint="16 digit">
                <input
                  value={form.nik}
                  onChange={(e) => update('nik', e.target.value.replace(/\D/g, '').slice(0, 16))}
                  inputMode="numeric"
                  placeholder="3273xxxxxxxxxxxx"
                  className={inputClass}
                />
              </Field>

              <Field label="Usia Pasien" hint="dalam tahun">
                <input
                  value={form.age}
                  onChange={(e) => update('age', e.target.value.replace(/\D/g, '').slice(0, 3))}
                  inputMode="numeric"
                  placeholder="Contoh: 28"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Golongan Darah">
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

              <Field label="Jaminan Kesehatan">
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
          </div>

          {/* Bagian 2: Poliklinik & Skrining Klinis */}
          <div className="space-y-3.5 border-t border-slate-100 pt-5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700">
              2. Poliklinik & Skrining Klinis
            </p>

            <Field label="Poliklinik Tujuan Pertama">
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

            <Field label="Riwayat Alergi Obat / Makanan" hint="kosongkan jika tidak ada">
              <input
                value={form.allergies}
                onChange={(e) => update('allergies', e.target.value)}
                placeholder="Contoh: Penisilin, Amoxicillin, Udang"
                className={inputClass}
              />
            </Field>

            <Field label="Penyakit Penyerta / Kronis" hint="opsional">
              <input
                value={form.chronicConditions}
                onChange={(e) => update('chronicConditions', e.target.value)}
                placeholder="Contoh: Hipertensi, Asma, Diabetes"
                className={inputClass}
              />
            </Field>

            <Field label="Keluhan Utama Saat Ini" hint="alasan berobat">
              <textarea
                value={form.complaint}
                onChange={(e) => update('complaint', e.target.value)}
                rows={2}
                placeholder="Contoh: Demam tinggi 3 hari, batuk kering dan sakit tenggorokan"
                className={`${inputClass} h-auto resize-none py-2.5`}
              />
            </Field>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-700">
              {error}
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-5">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setError(null);
                resetPhoto();
              }}
              className="text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              Reset Formulir
            </button>

            <div className="flex items-center gap-2.5">
              {onGoToAttendance && (
                <button
                  type="button"
                  onClick={onGoToAttendance}
                  className="h-10 rounded-xl px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Kembali
                </button>
              )}
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-teal-700 px-5 text-xs font-bold text-white transition hover:bg-teal-800 active:scale-[0.98] disabled:opacity-50 shadow-sm"
              >
                {isSaving ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Menyimpan Pasien…
                  </>
                ) : (
                  <>
                    <UserPlusIcon width={15} height={15} />
                    Simpan Pasien Baru
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export default FaceRegistrationPage;
