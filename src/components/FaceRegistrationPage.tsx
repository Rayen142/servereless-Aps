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
  ShieldCheckIcon,
  UploadIcon,
} from './icons';

interface FaceRegistrationPageProps {
  readonly onGoToAttendance?: () => void;
}

interface FormState {
  fullName: string;
  gender: 'Laki-laki' | 'Perempuan';
  birthDate: string;
  nik: string;
  age: string;
  bloodType: string;
  insurance: string;
  poliklinik: string;
  allergies: string;
  chronicConditions: string;
  complaint: string;
  consentAccepted: boolean;
}

const EMPTY_FORM: FormState = {
  fullName: '',
  gender: 'Laki-laki',
  birthDate: '1995-01-01',
  nik: '',
  age: '31',
  bloodType: 'O+',
  insurance: 'BPJS Kesehatan',
  poliklinik: 'Poli Umum',
  allergies: '',
  chronicConditions: '',
  complaint: '',
  consentAccepted: false,
};

const POSE_SLOTS = [
  { index: 0, label: 'Pose 1 · Depan', hint: 'Wajib (Utama)' },
  { index: 1, label: 'Pose 2 · Serong Kiri', hint: 'Opsional (+Akurasi)' },
  { index: 2, label: 'Pose 3 · Serong Kanan', hint: 'Opsional (+Akurasi)' },
] as const;

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

  const [posePhotos, setPosePhotos] = useState<[string | null, string | null, string | null]>([
    null,
    null,
    null,
  ]);
  const [activeSlot, setActiveSlot] = useState<0 | 1 | 2>(0);

  const currentSlotPhoto = posePhotos[activeSlot];
  const capturedPoses = posePhotos.filter((p): p is string => Boolean(p));

  const camera = useWebCamera({ enabled: currentSlotPhoto === null });
  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready' && currentSlotPhoto === null,
    onHoldComplete: () => undefined,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showConsentClause, setShowConsentClause] = useState(false);
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
      /* abaikan jika server sedang dimuat */
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const setSlotImage = (slot: 0 | 1 | 2, dataUrl: string | null) => {
    setPosePhotos((prev) => {
      const next: [string | null, string | null, string | null] = [...prev];
      next[slot] = dataUrl;
      return next;
    });
  };

  const handleCaptureCurrentSlot = () => {
    const shot = frame.capture(camera.videoRef.current);
    if (shot) {
      setSlotImage(activeSlot, shot);
      frame.discard();
    }
  };

  const resetCurrentSlot = () => {
    setSlotImage(activeSlot, null);
    frame.discard();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetAllPhotos = () => {
    setPosePhotos([null, null, null]);
    setActiveSlot(0);
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
        setSlotImage(activeSlot, reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleBirthDateChange = (val: string) => {
    update('birthDate', val);
    const year = Number.parseInt(val.slice(0, 4), 10);
    if (Number.isFinite(year) && year >= 1900 && year <= 2026) {
      update('age', String(Math.max(0, 2026 - year)));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.fullName.trim()) {
      setError('Nama lengkap pasien wajib diisi.');
      nameInputRef.current?.focus();
      return;
    }
    if (capturedPoses.length === 0) {
      setError('Ambil atau unggah minimal 1 foto wajah pasien (Pose Depan) terlebih dahulu.');
      return;
    }
    if (!form.consentAccepted) {
      setError(
        'Persetujuan pemrosesan data biometrik & rekam medis (UU PDP No. 27/2022) wajib dicentang sebelum pendaftaran.',
      );
      return;
    }

    setIsSaving(true);
    const age = Number.parseInt(form.age, 10);
    const [primaryImage, ...extraImages] = capturedPoses;
    const consentTimestamp = new Date().toISOString();

    const result = await verification.enrollFace({
      fullName: form.fullName.trim(),
      gender: form.gender,
      birthDate: form.birthDate || '1995-01-01',
      nik: form.nik.trim() || undefined,
      age: Number.isFinite(age) ? age : undefined,
      bloodType: form.bloodType,
      insurance: form.insurance,
      poliklinik: form.poliklinik,
      allergies: form.allergies.trim() || 'Tidak Ada Alergi',
      chronicConditions: form.chronicConditions.trim() || 'Tidak Ada',
      medicalHistoryNotes:
        form.complaint.trim() || 'Pendaftaran Pasien Baru & Pemeriksaan Awal (Z00.0)',
      image: primaryImage,
      extraImages,
      consentAccepted: true,
      consentTimestamp,
    });
    setIsSaving(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setSaved(result.person ?? null);
    setForm(EMPTY_FORM);
    resetAllPhotos();
    void refreshCount();
    nameInputRef.current?.focus();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start">
      {/* Kolom Kiri: Kamera Multi-Pose */}
      <section className="space-y-4">
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 space-y-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-neutral-900">
                Perekaman Wajah Multi-Pose
              </span>
              <p className="text-[11px] text-neutral-500">
                Ambil 1 foto utama atau hingga 3 sudut wajah untuk akurasi pengenalan maksimal
              </p>
            </div>
            {patientCount !== null && (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                {patientCount} sampel aktif
              </span>
            )}
          </div>

          {/* Pemilih Slot Multi-Pose */}
          <div className="grid grid-cols-3 gap-2">
            {POSE_SLOTS.map((slot) => {
              const slotImg = posePhotos[slot.index];
              const isSelected = activeSlot === slot.index;
              return (
                <button
                  key={slot.index}
                  type="button"
                  onClick={() => setActiveSlot(slot.index)}
                  className={`flex items-center gap-2 rounded-xl border p-2 text-left transition ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : slotImg
                        ? 'border-emerald-200 bg-emerald-50/50 text-neutral-900 hover:border-emerald-300'
                        : 'border-neutral-200 bg-neutral-50/70 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-black/10 bg-neutral-200">
                    {slotImg ? (
                      <img
                        src={slotImg}
                        alt={slot.label}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-neutral-500">
                        #{slot.index + 1}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold">
                      {slot.label.replace(/^Pose \d · /, '')}
                    </p>
                    <p
                      className={`truncate text-[10px] ${
                        isSelected
                          ? 'text-neutral-300'
                          : slotImg
                            ? 'font-medium text-emerald-700'
                            : 'text-neutral-400'
                      }`}
                    >
                      {slotImg ? 'Tersimpan ✓' : slot.hint}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <CameraView
            camera={camera}
            detection={detection}
            capturedImage={currentSlotPhoto}
            isFlashing={frame.isFlashing}
            faceLabel={
              detection.trackingBox
                ? `${form.fullName.trim() || 'Pasien Baru'} (${POSE_SLOTS[activeSlot].label})`
                : null
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-2">
              {currentSlotPhoto ? (
                <button
                  type="button"
                  onClick={resetCurrentSlot}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
                >
                  <RefreshIcon width={13} height={13} />
                  Ulangi {POSE_SLOTS[activeSlot].label.split(' · ')[0]}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCaptureCurrentSlot}
                  disabled={camera.status !== 'ready'}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
                >
                  <CameraIcon width={13} height={13} />
                  Ambil {POSE_SLOTS[activeSlot].label.split(' · ')[0]}
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

              {currentSlotPhoto && activeSlot < 2 && !posePhotos[(activeSlot + 1) as 1 | 2] && (
                <button
                  type="button"
                  onClick={() => setActiveSlot((activeSlot + 1) as 1 | 2)}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-emerald-50 px-3 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100"
                >
                  + Tambah Pose {activeSlot + 2}
                </button>
              )}
            </div>

            <span className="text-xs text-neutral-500">
              {capturedPoses.length > 0
                ? `${capturedPoses.length}/3 pose siap disimpan`
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
                    Pasien berhasil didaftarkan & Persetujuan UU PDP Tercatat
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

      {/* Kolom Kanan: Formulir Pendaftaran Minimalis + Informed Consent UU PDP */}
      <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-neutral-900">
              Data Identitas & Medis Pasien
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
              <ShieldCheckIcon width={11} height={11} />
              Kepatuhan UU PDP & RME
            </span>
          </div>

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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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

            <Field label="Tanggal Lahir">
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => handleBirthDateChange(e.target.value)}
                className={inputClass}
              />
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
            <Field label="NIK" hint="16 digit (IHS SATUSEHAT)">
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
              placeholder="Contoh: Pemeriksaan tekanan darah & keluhan pusing (I10)"
              className={inputClass}
            />
          </Field>

          {/* Kotak Persetujuan Eksplisit (Informed Consent UU PDP No. 27/2022 & Permenkes 24/2022) */}
          <div
            className={`rounded-xl border p-3.5 text-xs transition ${
              form.consentAccepted
                ? 'border-emerald-200 bg-emerald-50/50'
                : 'border-neutral-200 bg-neutral-50/80'
            }`}
          >
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.consentAccepted}
                onChange={(e) => update('consentAccepted', e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-neutral-900"
              />
              <span className="leading-relaxed text-neutral-700">
                <strong className="font-semibold text-neutral-900">
                  Persetujuan Pemrosesan Data Pribadi Spesifik (UU PDP No. 27/2022):
                </strong>{' '}
                Pasien telah membaca, memahami, dan menyetujui perekaman fitur biometrik wajah serta penyimpanan Rekam Medis Elektronik (RME) untuk keperluan identifikasi layanan kesehatan di RSUD SIMRS Biometrik.
              </span>
            </label>

            <div className="mt-2 flex items-center justify-between pl-6">
              <button
                type="button"
                onClick={() => setShowConsentClause((v) => !v)}
                className="text-[11px] font-medium text-neutral-600 underline hover:text-neutral-900"
              >
                {showConsentClause
                  ? 'Sembunyikan Rincian Klausul Hukum'
                  : 'Lihat Rincian Klausul UU PDP & Permenkes RME'}
              </button>
              <span className="font-mono text-[10px] text-neutral-400">
                Pasal 20 & Pasal 22 UU 27/2022
              </span>
            </div>

            {showConsentClause && (
              <div className="mt-2.5 space-y-1.5 rounded-lg border border-neutral-200/80 bg-white p-3 text-[11px] leading-relaxed text-neutral-600">
                <p>
                  <strong>1. Pembatasan Tujuan:</strong> Citra dan vektor deskriptor wajah (CLAHE + LBPH + HOG + ORB) hanya diproses untuk verifikasi kehadiran rawat jalan otomatis dan pencegahan duplikasi tiket antrean.
                </p>
                <p>
                  <strong>2. Keamanan & Penyimpanan:</strong> Data disimpan secara terisolasi pada basis data relasional SIMRS (SQLite WAL / Cloud DynamoDB) sesuai standar Rekam Medis Elektronik (Permenkes No. 24 Tahun 2022).
                </p>
                <p>
                  <strong>3. Standar Interoperabilitas:</strong> Data kunjungan (Encounter) dan diagnosis (Condition ICD-10) diformat mengikuti standar HL7 FHIR R4 SATUSEHAT Kementerian Kesehatan RI.
                </p>
                <p>
                  <strong>4. Hak Subjek Data:</strong> Sesuai UU PDP No. 27 Tahun 2022, pasien berhak menarik kembali persetujuan (opt-out) atau meminta penghapusan sampel biometrik melalui loket Rekam Medis.
                </p>
              </div>
            )}
          </div>

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
                resetAllPhotos();
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
                {isSaving
                  ? 'Menyimpan…'
                  : `Simpan (${capturedPoses.length || 1} Pose) & Ambil Antrean`}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

export default FaceRegistrationPage;
