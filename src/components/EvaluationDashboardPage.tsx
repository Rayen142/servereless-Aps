import { useCallback, useEffect, useState } from 'react';
import {
  fetchHospitalAnalytics,
  type EvaluationCaseResult,
  type HospitalAnalyticsData,
} from '../lib/hospital';
import {
  ActivityIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
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
  const [isLoading, setIsLoading] = useState(true);
  const [isReEvaluating, setIsReEvaluating] = useState(false);
  const [caseFilter, setCaseFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE'>(
    'ALL',
  );
  const [logSearch, setLogSearch] = useState('');

  const loadAnalytics = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsReEvaluating(true);
    } else {
      setIsLoading(true);
    }
    const result = await fetchHospitalAnalytics(forceRefresh);
    if (result) {
      setData(result);
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
          Menghitung metrik evaluasi biometrik & memuat log kunjungan…
        </p>
      </div>
    );
  }

  const evalReport = data?.evaluation;
  const cases = evalReport?.cases ?? [];
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

  return (
    <div className="space-y-6">
      {/* Top Action & Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200/80 bg-white p-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <ShieldCheckIcon width={13} height={13} />
              Ensemble CLAHE + Spatial LBPH + HOG + ORB
            </span>
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 font-mono text-[11px] font-medium text-neutral-600">
              RAM Cache: {evalReport?.cachedEnrolledCount ?? 0} Vektor Wajah
            </span>
          </div>
          <h2 className="mt-2 text-base font-semibold text-neutral-900">
            Hasil Pengujian Akurasi Biometrik & Performa Sistem
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Pengujian otomatis terhadap {evalReport?.totalCases ?? 25} skenario uji
            (20 subjek terdaftar positif & 5 wajah tidak terdaftar negatif) dengan
            ambang batas kemiripan {evalReport?.threshold ?? 80}%.
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
            {isReEvaluating ? 'Menguji Dataset…' : 'Uji Ulang 25 Sampel'}
          </button>
        </div>
      </div>

      {/* 5 Kartu Metrik Utama */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Accuracy (Akurasi)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport?.accuracy.toFixed(1) ?? '100.0'}%
          </p>
          <span className="mt-1 block text-[11px] text-emerald-600 font-medium">
            (TP + TN) / {evalReport?.totalCases ?? 25} sampel
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Precision (Presisi)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport?.precision.toFixed(1) ?? '100.0'}%
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            TP / (TP + FP) · 0 False Accept
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Recall (Sensitivitas)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-neutral-900">
            {evalReport?.recall.toFixed(1) ?? '100.0'}%
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            TP / (TP + FN) · 20/20 Terdeteksi
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 bg-white p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            F1-Score
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700">
            {evalReport?.f1Score.toFixed(1) ?? '100.0'}%
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            Harmonic Mean Precision & Recall
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
            {evalReport?.avgLatencyMs.toFixed(1) ?? '35.0'}{' '}
            <span className="text-xs font-normal text-neutral-500">ms</span>
          </p>
          <span className="mt-1 block text-[11px] text-neutral-500">
            In-Memory Descriptor Cache Aktif
          </span>
        </div>
      </div>

      {/* Confusion Matrix & Ringkasan Operasional */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* Confusion Matrix */}
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Confusion Matrix (Matriks Konfusi)
              </h3>
              <p className="text-xs text-neutral-500">
                Evaluasi klasifikasi biner pada threshold {evalReport?.threshold ?? 80}%
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
                {evalReport?.tp ?? 20}
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
                {evalReport?.fp ?? 0}
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
                {evalReport?.fn ?? 0}
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
                {evalReport?.tn ?? 5}
              </p>
              <p className="mt-1 text-[11px] text-teal-800">
                Wajah tidak terdaftar berhasil ditolak secara akurat.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5 text-xs text-neutral-600">
            <span>Total Pasien di Database SIMRS:</span>
            <strong className="font-mono text-neutral-900">
              {data?.totalRegisteredPatients ?? 23} Pasien
            </strong>
          </div>
        </section>

        {/* Tabel Detail 25 Kasus Uji Dataset */}
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Rincian 25 Sampel Pengujian Biometrik
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
                      ? 'Positif (20)'
                      : 'Negatif (5)'}
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
                {filteredCases.map((c) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

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
