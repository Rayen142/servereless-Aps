import { useCallback, useEffect, useState } from 'react';
import {
  ENROLLED_PATIENT_PROFILES,
  fetchHospitalAnalytics,
  type EvaluationCaseResult,
  type HospitalAnalyticsData,
} from '../lib/hospital';
import {
  buildSatusehatFhirBundle,
  downloadSatusehatFhirJson,
} from '../lib/satusehat';
import {
  ActivityIcon,
  AlertIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshIcon,
  ShieldCheckIcon,
  UsersIcon,
} from './icons';

function exportEvaluationCsv(cases: readonly EvaluationCaseResult[]) {
  const headers = [
    'Case_ID',
    'Type',
    'Full_Name',
    'Expected_ID',
    'Predicted_ID',
    'Similarity_Pct',
    'Latency_Ms',
    'Outcome',
  ];
  const rows = cases.map((c) => [
    c.caseId,
    c.type,
    `"${c.fullName.replace(/"/g, '""')}"`,
    c.expectedPersonId ?? '-',
    c.predictedPersonId ?? 'NOT_RECOGNIZED',
    c.similarity.toFixed(2),
    c.latencyMs.toFixed(2),
    c.outcome,
  ]);
  const csvContent =
    'data:text/csv;charset=utf-8,' +
    [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute(
    'download',
    `evaluasi_biometrik_simrs_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function EvaluationDashboardPage() {
  const [data, setData] = useState<HospitalAnalyticsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReEvaluating, setIsReEvaluating] = useState(false);
  const [caseFilter, setCaseFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE'>(
    'ALL',
  );
  const [logSearch, setLogSearch] = useState('');
  const [selectedSampleRm, setSelectedSampleRm] = useState<string>(
    ENROLLED_PATIENT_PROFILES[0]?.noRm ?? 'RM-2026-0001',
  );

  const loadAnalytics = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsReEvaluating(true);
    } else {
      setIsLoading(true);
    }
    setLoadError(null);

    const result = await fetchHospitalAnalytics(forceRefresh);
    if (result && result.evaluation) {
      setData(result);
    } else {
      setData(null);
      setLoadError(
        'Data evaluasi tidak tersedia — gagal mengambil metrik dari server backend SIMRS. Pastikan server lokal (port 8000) atau endpoint cloud aktif.',
      );
    }
    setIsLoading(false);
    setIsReEvaluating(false);
  }, []);

  useEffect(() => {
    void loadAnalytics(false);
  }, [loadAnalytics]);

  if (isLoading && !data) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-neutral-200/80 bg-white p-8 text-center">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
        <p className="mt-3 text-xs font-medium text-neutral-600">
          Menghitung metrik evaluasi biometrik & memuat log kunjungan dari database…
        </p>
      </div>
    );
  }

  const evalReport = data?.evaluation ?? null;
  const cases = evalReport?.cases ?? [];
  const positiveCasesCount = cases.filter((c) => c.type === 'POSITIVE').length;
  const negativeCasesCount = cases.filter((c) => c.type === 'NEGATIVE').length;

  const filteredCases = cases.filter((c) =>
    caseFilter === 'ALL' ? true : c.type === caseFilter,
  );

  const logs = data?.recentLogs ?? [];
  const filteredLogs = logs.filter((l) => {
    if (!logSearch.trim()) return true;
    const q = logSearch.toLowerCase();
    return (
      l.FullName?.toLowerCase().includes(q) ||
      l.NoRM?.toLowerCase().includes(q) ||
      l.QueueNumber?.toLowerCase().includes(q) ||
      l.Poliklinik?.toLowerCase().includes(q)
    );
  });

  const sampleProfile =
    ENROLLED_PATIENT_PROFILES.find((p) => p.noRm === selectedSampleRm) ??
    ENROLLED_PATIENT_PROFILES[0];

  const sampleFhirBundle = sampleProfile
    ? buildSatusehatFhirBundle({
        personId: sampleProfile.personId,
        noRm: sampleProfile.noRm,
        nim: sampleProfile.noRm,
        nik: sampleProfile.nik,
        fullName: sampleProfile.fullName,
        birthDate: sampleProfile.birthDate,
        gender: sampleProfile.gender,
        age: sampleProfile.age,
        bloodType: sampleProfile.bloodType,
        insurance: sampleProfile.insurance,
        allergies: sampleProfile.allergies,
        chronicConditions: sampleProfile.chronicConditions,
        poliklinik: sampleProfile.poliklinik,
        dokter: sampleProfile.dokter,
        medicalNotes: sampleProfile.medicalNotes,
        medicalHistory: sampleProfile.medicalHistory,
        similarity: 96.4,
        consentAccepted: true,
      })
    : null;

  return (
    <div className="space-y-6">
      {/* Peringatan Jujur Jika Backend Tidak Tersedia (Tanpa Angka Cadangan Palsu) */}
      {(!evalReport || loadError) && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50/90 p-5 text-xs text-rose-950">
          <div className="flex items-start gap-3">
            <AlertIcon
              width={18}
              height={18}
              className="mt-0.5 shrink-0 text-rose-600"
            />
            <div>
              <p className="font-semibold text-rose-900">
                Data Evaluasi Tidak Tersedia
              </p>
              <p className="mt-0.5 text-rose-800">
                {loadError ??
                  'Tidak dapat memuat laporan evaluasi dari server backend. Metrik tidak ditampilkan untuk menjaga integritas data pengujian.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadAnalytics(true)}
            disabled={isReEvaluating}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-rose-700 px-3.5 text-xs font-medium text-white transition hover:bg-rose-800 disabled:opacity-50"
          >
            <RefreshIcon
              width={13}
              height={13}
              className={isReEvaluating ? 'animate-spin' : ''}
            />
            Coba Muat Ulang
          </button>
        </div>
      )}

      {/* Top Action & Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200/80 bg-white p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <ShieldCheckIcon width={13} height={13} />
              Ensemble CLAHE + Spatial LBPH + HOG + ORB
            </span>
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 font-mono text-[11px] font-medium text-neutral-600">
              RAM Cache:{' '}
              {evalReport !== null
                ? `${evalReport.cachedEnrolledCount} Vektor Wajah`
                : 'Data tidak tersedia'}
            </span>
            {data?.database && (
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-sky-700">
                DB: {data.database.engine} (
                {data.database.journalMode.toUpperCase()} •{' '}
                {data.database.sizeKb ?? data.database.sizeKB ?? 0} KB)
              </span>
            )}
          </div>
          <h2 className="mt-2 text-base font-semibold text-neutral-900">
            Hasil Pengujian Akurasi Biometrik & Performa Sistem
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {evalReport
              ? `Pengujian otomatis terhadap ${evalReport.totalCases} skenario uji (${positiveCasesCount} subjek terdaftar positif & ${negativeCasesCount} wajah tidak terdaftar negatif) dengan ambang batas kemiripan ${evalReport.threshold}%.`
              : 'Menunggu koneksi ke layanan evaluasi biometrik untuk menampilkan rincian skenario uji.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportEvaluationCsv(cases)}
            disabled={cases.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            <DownloadIcon width={14} height={14} />
            Ekspor CSV Skripsi
          </button>

          <button
            type="button"
            onClick={() => void loadAnalytics(true)}
            disabled={isReEvaluating}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            <RefreshIcon
              width={14}
              height={14}
              className={isReEvaluating ? 'animate-spin' : ''}
            />
            {isReEvaluating
              ? 'Menguji Dataset…'
              : evalReport
                ? `Uji Ulang ${evalReport.totalCases} Sampel`
                : 'Jalankan Pengujian'}
          </button>
        </div>
      </div>

      {/* 5 Kartu Metrik Utama (Tanpa Nilai Hardcoded Palsu) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Accuracy (Akurasi)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport ? `${evalReport.accuracy.toFixed(1)}%` : '—'}
          </p>
          <span className="mt-1 block text-[11px] font-medium text-emerald-600">
            {evalReport
              ? `(TP + TN) / ${evalReport.totalCases} sampel`
              : 'Data tidak tersedia'}
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Precision (Presisi)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport ? `${evalReport.precision.toFixed(1)}%` : '—'}
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            {evalReport
              ? `TP / (TP + FP) · ${evalReport.fp} False Accept`
              : 'Data tidak tersedia'}
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Recall (Sensitivitas)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport ? `${evalReport.recall.toFixed(1)}%` : '—'}
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            {evalReport
              ? `TP / (TP + FN) · ${evalReport.tp}/${positiveCasesCount} Terdeteksi`
              : 'Data tidak tersedia'}
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            F1-Score
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700">
            {evalReport ? `${evalReport.f1Score.toFixed(1)}%` : '—'}
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            {evalReport
              ? 'Harmonic Mean Precision & Recall'
              : 'Data tidak tersedia'}
          </span>
        </div>

        <div className="col-span-2 sm:col-span-1 rounded-2xl border border-neutral-200/80 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-neutral-400">
              Rata-rata Latency
            </span>
            <ClockIcon width={13} height={13} className="text-neutral-400" />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport ? (
              <>
                {evalReport.avgLatencyMs.toFixed(1)}{' '}
                <span className="text-xs font-normal text-neutral-500">ms</span>
              </>
            ) : (
              '—'
            )}
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            {evalReport
              ? 'In-Memory Descriptor Cache Aktif'
              : 'Data tidak tersedia'}
          </span>
        </div>
      </div>

      {/* Confusion Matrix & Tabel Sampel Uji */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Confusion Matrix */}
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Confusion Matrix (Matriks Konfusi)
              </h3>
              <p className="text-xs text-neutral-500">
                {evalReport
                  ? `Evaluasi klasifikasi biner pada threshold ${evalReport.threshold}%`
                  : 'Data matriks konfusi tidak tersedia'}
              </p>
            </div>
            <ActivityIcon width={16} height={16} className="text-neutral-400" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-900">
                  True Positive (TP)
                </span>
                <span className="rounded bg-emerald-200/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-950">
                  VALID MATCH
                </span>
              </div>
              <p className="mt-2 font-mono text-3xl font-bold text-emerald-900">
                {evalReport ? evalReport.tp : '—'}
              </p>
              <p className="mt-1 text-[11px] text-emerald-800">
                Pasien terdaftar berhasil dikenali sesuai identitas No. RM.
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-700">
                  False Positive (FP)
                </span>
                <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-700">
                  FALSE ACCEPT
                </span>
              </div>
              <p className="mt-2 font-mono text-3xl font-bold text-neutral-900">
                {evalReport ? evalReport.fp : '—'}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">
                Wajah asing yang salah dikenali sebagai pasien terdaftar.
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-700">
                  False Negative (FN)
                </span>
                <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-700">
                  FALSE REJECT
                </span>
              </div>
              <p className="mt-2 font-mono text-3xl font-bold text-neutral-900">
                {evalReport ? evalReport.fn : '—'}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">
                Pasien terdaftar yang gagal dikenali oleh sistem kamera.
              </p>
            </div>

            <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-teal-900">
                  True Negative (TN)
                </span>
                <span className="rounded bg-teal-200/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-teal-950">
                  VALID REJECT
                </span>
              </div>
              <p className="mt-2 font-mono text-3xl font-bold text-teal-900">
                {evalReport ? evalReport.tn : '—'}
              </p>
              <p className="mt-1 text-[11px] text-teal-800">
                Wajah tidak terdaftar berhasil ditolak secara akurat.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-xl border border-neutral-100 bg-neutral-50/80 p-3 text-xs text-neutral-600">
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-700">
                Database Lokal SQLite (Relational WAL)
              </span>
              <span className="font-mono text-[11px] font-semibold text-emerald-700">
                {data?.database?.dbPath ?? 'dataset/simrs_biometric.db'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] sm:grid-cols-3">
              <div className="rounded-lg bg-white px-2.5 py-1.5 border border-neutral-200/60">
                <span className="text-neutral-400 block">Tabel patients</span>
                <strong className="font-mono text-neutral-900">
                  {data?.database?.tables.patients !== undefined
                    ? `${data.database.tables.patients} baris`
                    : data?.totalRegisteredPatients !== undefined
                      ? `${data.totalRegisteredPatients} baris`
                      : 'Tidak tersedia'}
                </strong>
              </div>
              <div className="rounded-lg bg-white px-2.5 py-1.5 border border-neutral-200/60">
                <span className="text-neutral-400 block">medical_records</span>
                <strong className="font-mono text-neutral-900">
                  {data?.database?.tables.medical_records !== undefined
                    ? `${data.database.tables.medical_records} baris`
                    : 'Tidak tersedia'}
                </strong>
              </div>
              <div className="rounded-lg bg-white px-2.5 py-1.5 border border-neutral-200/60">
                <span className="text-neutral-400 block">attendance_logs</span>
                <strong className="font-mono text-neutral-900">
                  {data?.database?.tables.attendance_logs !== undefined
                    ? `${data.database.tables.attendance_logs} baris`
                    : data?.totalAttendanceLogs !== undefined
                      ? `${data.totalAttendanceLogs} baris`
                      : 'Tidak tersedia'}
                </strong>
              </div>
              <div className="rounded-lg bg-white px-2.5 py-1.5 border border-neutral-200/60">
                <span className="text-neutral-400 block">poli_queues</span>
                <strong className="font-mono text-neutral-900">
                  {data?.database?.tables.poli_queues !== undefined
                    ? `${data.database.tables.poli_queues} poli`
                    : 'Tidak tersedia'}
                </strong>
              </div>
              <div className="rounded-lg bg-white px-2.5 py-1.5 border border-neutral-200/60 col-span-2 sm:col-span-2">
                <span className="text-neutral-400 block">queue_slots (Aktif)</span>
                <strong className="font-mono text-neutral-900">
                  {data?.database?.tables.active_queue_slots !== undefined
                    ? `${data.database.tables.active_queue_slots} slot antrean aktif`
                    : 'Tidak tersedia'}
                </strong>
              </div>
            </div>
          </div>
        </section>

        {/* Tabel Detail Kasus Uji Dataset */}
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Rincian Sampel Pengujian Biometrik ({cases.length})
              </h3>
              <p className="text-xs text-neutral-500">
                Skor kemiripan dan waktu komputasi per citra uji
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-1 text-xs">
              {(['ALL', 'POSITIVE', 'NEGATIVE'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setCaseFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    caseFilter === f
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  {f === 'ALL'
                    ? `Semua (${cases.length})`
                    : f === 'POSITIVE'
                      ? `Positif (${positiveCasesCount})`
                      : `Negatif (${negativeCasesCount})`}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-neutral-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Kode</th>
                  <th className="px-3 py-2">Subjek Uji</th>
                  <th className="px-3 py-2">Prediksi ID</th>
                  <th className="px-3 py-2 text-right">Kemiripan</th>
                  <th className="px-3 py-2 text-right">Latency</th>
                  <th className="px-3 py-2 text-center">Hasil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredCases.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-xs text-neutral-400"
                    >
                      Data hasil pengujian tidak tersedia.
                    </td>
                  </tr>
                ) : (
                  filteredCases.map((c) => (
                    <tr key={c.caseId} className="hover:bg-neutral-50/70">
                      <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">
                        {c.caseId}
                      </td>
                      <td className="px-3 py-2 font-medium text-neutral-900">
                        {c.fullName}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">
                        {c.predictedPersonId ?? 'DITOLAK'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-neutral-800">
                        {c.similarity.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-neutral-500">
                        {c.latencyMs.toFixed(1)} ms
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${
                            c.outcome === 'TP'
                              ? 'bg-emerald-50 text-emerald-700'
                              : c.outcome === 'TN'
                                ? 'bg-teal-50 text-teal-700'
                                : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {c.outcome}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Wawasan & Simulasi Interoperabilitas SATUSEHAT Kemenkes RI (HL7 FHIR R4) */}
      <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <FileTextIcon width={18} height={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-neutral-900">
                  Arsitektur & Simulasi Integrasi SATUSEHAT Kemenkes RI (Standar HL7 FHIR R4)
                </h3>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
                  Permenkes No. 24/2022 & UU PDP No. 27/2022
                </span>
              </div>
              <p className="text-xs text-neutral-500">
                Pemetaan skema database relasional SIMRS Biometrik ke Resource standar HL7 FHIR R4 (Patient, Consent, Encounter, Condition ICD-10)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedSampleRm}
              onChange={(e) => setSelectedSampleRm(e.target.value)}
              aria-label="Pilih Pasien untuk Simulasi FHIR"
              className="h-8 rounded-full border border-neutral-200 bg-neutral-50 px-3 text-xs font-medium text-neutral-800 outline-none focus:border-neutral-900"
            >
              {ENROLLED_PATIENT_PROFILES.map((p) => (
                <option key={p.noRm} value={p.noRm}>
                  {p.noRm} — {p.fullName} ({p.poliklinik})
                </option>
              ))}
            </select>

            {sampleProfile && (
              <button
                type="button"
                onClick={() =>
                  downloadSatusehatFhirJson({
                    personId: sampleProfile.personId,
                    noRm: sampleProfile.noRm,
                    nim: sampleProfile.noRm,
                    nik: sampleProfile.nik,
                    fullName: sampleProfile.fullName,
                    birthDate: sampleProfile.birthDate,
                    gender: sampleProfile.gender,
                    age: sampleProfile.age,
                    bloodType: sampleProfile.bloodType,
                    insurance: sampleProfile.insurance,
                    allergies: sampleProfile.allergies,
                    chronicConditions: sampleProfile.chronicConditions,
                    poliklinik: sampleProfile.poliklinik,
                    dokter: sampleProfile.dokter,
                    medicalNotes: sampleProfile.medicalNotes,
                    medicalHistory: sampleProfile.medicalHistory,
                    similarity: 96.4,
                    consentAccepted: true,
                  })
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-800"
              >
                <DownloadIcon width={13} height={13} />
                Unduh Bundle FHIR (.json)
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3 text-xs">
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3.5">
              <p className="font-semibold text-neutral-900">
                Pemetaan Entitas Lokal (SQLite) → HL7 FHIR R4 SATUSEHAT
              </p>
              <ul className="mt-2 space-y-2 text-[11px] text-neutral-600">
                <li className="flex items-start gap-2">
                  <CheckIcon width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <strong>Tabel <code>patients</code> → Resource <code>Patient</code>:</strong>{' '}
                    Memetakan <code>nik</code> ke sistem identifier resmi <code>https://fhir.kemkes.go.id/id/nik</code> (IHS Number) serta <code>no_rm</code> ke identifier rekam medis internal RS.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckIcon width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <strong>Persetujuan Biometrik → Resource <code>Consent</code>:</strong>{' '}
                    Mencatat bukti <em>Opt-In</em> eksplisit pasien atas pemrosesan wajah & RME sesuai Pasal 20 UU PDP No. 27 Tahun 2022 (LOINC <code>59284-0</code>).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckIcon width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <strong>Tabel <code>queue_slots</code> & <code>attendance_logs</code> → Resource <code>Encounter</code>:</strong>{' '}
                    Mencatat kunjungan rawat jalan (<code>class: AMB</code>), waktu kedatangan terverifikasi wajah, lokasi poliklinik, dan dokter DPJP.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckIcon width={13} height={13} className="mt-0.5 shrink-0 text-emerald-600" />
                  <span>
                    <strong>Tabel <code>medical_records</code> → Resource <code>Condition</code>:</strong>{' '}
                    Mengonversi diagnosis dokter menjadi struktur <code>code.coding</code> dengan sistem <code>http://hl7.org/fhir/sid/icd-10</code>.
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3.5 text-[11px] text-sky-950">
              <p className="font-semibold text-sky-900">
                Alur Pengiriman API Gateway SATUSEHAT (Bab Pembahasan Skripsi):
              </p>
              <p className="mt-1 leading-relaxed text-sky-800">
                1. <strong>OAuth2 Client Credentials:</strong> Backend menukar <code>client_id</code> & <code>client_secret</code> Fasyankes ke endpoint <code>/oauth2/v1/accesstoken</code> untuk memperoleh Bearer Token.<br />
                2. <strong>Validasi Biometrik & ICD-10:</strong> Setelah pasien terverifikasi wajah dan dokter menyimpan diagnosis ICD-10, sistem membentuk <code>Bundle (type: transaction)</code>.<br />
                3. <strong>Transaksi Atomik FHIR:</strong> Payload dikirim melalui <code>POST https://api-satusehat.kemkes.go.id/fhir-r4/v1</code> secara asinkron.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-neutral-950 p-3.5 text-xs text-neutral-100">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="font-mono text-[11px] font-semibold text-emerald-400">
                Preview Payload: Bundle Transaction HL7 FHIR R4 ({sampleProfile?.noRm})
              </span>
              <span className="font-mono text-[10px] text-neutral-400">
                application/fhir+json
              </span>
            </div>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-black/40 p-2.5 font-mono text-[10px] leading-relaxed text-emerald-300">
              {sampleFhirBundle
                ? JSON.stringify(sampleFhirBundle, null, 2)
                : '// Pilih pasien untuk melihat struktur JSON FHIR R4'}
            </pre>
          </div>
        </div>
      </section>

      {/* Tabel Riwayat Log Kunjungan & Tiket Antrean */}
      <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <UsersIcon width={16} height={16} className="text-neutral-500" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Log Penerbitan Tiket Antrean & Verifikasi Pasien (
                {data?.totalAttendanceLogs ?? logs.length})
              </h3>
              <p className="text-xs text-neutral-500">
                Rekam jejak seluruh verifikasi wajah biometrik maupun pencarian
                manual NIK/No. RM
              </p>
            </div>
          </div>

          <input
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder="Cari nama, No. RM, poli, atau tiket…"
            className="h-8 w-full sm:w-64 rounded-full border border-neutral-200 bg-neutral-50 px-3.5 text-xs outline-none transition focus:border-neutral-900 focus:bg-white"
          />
        </div>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-neutral-100">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
              <tr>
                <th className="px-3.5 py-2.5">Waktu (WIB)</th>
                <th className="px-3.5 py-2.5">Tiket Antrean</th>
                <th className="px-3.5 py-2.5">No. RM</th>
                <th className="px-3.5 py-2.5">Nama Pasien</th>
                <th className="px-3.5 py-2.5">Poliklinik</th>
                <th className="px-3.5 py-2.5">Metode</th>
                <th className="px-3.5 py-2.5 text-right">Kemiripan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-xs text-neutral-400"
                  >
                    Tidak ada log kunjungan yang cocok.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log, i) => {
                  const dateFormatted = log.Timestamp
                    ? new Date(log.Timestamp).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-';
                  const isManual = log.VerificationMethod === 'MANUAL_LOOKUP';
                  return (
                    <tr
                      key={log.attendanceId || `${log.QueueNumber}-${i}`}
                      className="hover:bg-neutral-50/70"
                    >
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-neutral-500">
                        {dateFormatted}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className="rounded bg-neutral-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                          {log.QueueNumber}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-neutral-600">
                        {log.NoRM}
                      </td>
                      <td className="px-3.5 py-2.5 font-medium text-neutral-900">
                        {log.FullName}
                      </td>
                      <td className="px-3.5 py-2.5 text-neutral-700">
                        {log.Poliklinik}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            isManual
                              ? 'bg-amber-50 text-amber-800'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          <CheckIcon width={10} height={10} />
                          {isManual ? 'Manual NIK/RM' : 'Biometrik Wajah'}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono font-medium text-neutral-800">
                        {Number(log.Similarity ?? 0).toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default EvaluationDashboardPage;
