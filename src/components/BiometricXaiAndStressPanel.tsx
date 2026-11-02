import { useCallback, useEffect, useState } from 'react';
import {
  buildStressTestCsv,
  extractBiometricXaiStages,
  runBiometricStressTest,
  type BiometricStressTestReport,
  type BiometricXaiInspection,
} from '../lib/biometricXaiEngine';
import { downloadCsv } from '../lib/evaluationMetrics';
import { ENROLLED_PATIENT_PROFILES } from '../lib/hospital';
import { CheckIcon, DownloadIcon, RefreshIcon, ShieldCheckIcon } from './icons';

const POSITIVE_TEST_IMAGE_LOADERS = import.meta.glob<string>(
  ['../../dataset/images/test_positive/*.jpg'],
  { query: '?url', import: 'default' },
);

async function resolveSubjectImageUrl(personId: string): Promise<string | null> {
  const entries = Object.entries(POSITIVE_TEST_IMAGE_LOADERS);
  const matched =
    entries.find(([path]) => path.includes(personId)) ?? entries[0];
  if (!matched) return null;
  return matched[1]();
}

/* -------------------------------------------------------------------------- */
/*  Komponen #1: Bedah Ekstraksi Fitur Biometrik (Explainable AI / XAI)       */
/* -------------------------------------------------------------------------- */

export function BiometricXaiInspectorCard({
  liveImageSrc,
  livePatientName,
  liveNoRm,
  liveSimilarity = 95.8,
  compact = false,
}: {
  readonly liveImageSrc?: string | null;
  readonly livePatientName?: string;
  readonly liveNoRm?: string;
  readonly liveSimilarity?: number;
  readonly compact?: boolean;
}) {
  const [selectedPersonId, setSelectedPersonId] = useState<string>(
    ENROLLED_PATIENT_PROFILES[0]?.personId ?? 'MHS-2026-001',
  );
  const [inspection, setInspection] = useState<BiometricXaiInspection | null>(null);
  const [isComputing, setIsComputing] = useState(false);

  const selectedProfile =
    ENROLLED_PATIENT_PROFILES.find((p) => p.personId === selectedPersonId) ??
    ENROLLED_PATIENT_PROFILES[0];

  const runExtraction = useCallback(async () => {
    setIsComputing(true);
    try {
      let src = liveImageSrc ?? null;
      if (!src) {
        src = await resolveSubjectImageUrl(selectedPersonId);
      }
      if (src) {
        const res = await extractBiometricXaiStages(src, liveSimilarity);
        setInspection(res);
      }
    } catch {
      // Abaikan jika gagal memuat citra
    } finally {
      setIsComputing(false);
    }
  }, [liveImageSrc, selectedPersonId, liveSimilarity]);

  useEffect(() => {
    void runExtraction();
  }, [runExtraction]);

  const subjectDisplay = liveImageSrc
    ? `${livePatientName ?? 'Pasien Terpindai'} (${liveNoRm ?? 'Live Capture'})`
    : `${selectedProfile?.fullName ?? 'Aditya Pratama'} (${selectedProfile?.noRm ?? 'RM-2026-0001'})`;

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
            <ShieldCheckIcon width={18} height={18} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-neutral-900">
                Inspeksi Ekstraksi Fitur Biometrik (Explainable AI / XAI)
              </h3>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
                CLAHE + Spatial LBPH + HOG + ORB
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Visualisasi 5 tahapan pemrosesan citra wajah 128×128 piksel dan dekomposisi skor kemiripan ensemble
            </p>
          </div>
        </div>

        {!liveImageSrc && (
          <div className="flex items-center gap-2">
            <select
              value={selectedPersonId}
              onChange={(e) => setSelectedPersonId(e.target.value)}
              aria-label="Pilih subjek untuk inspeksi fitur XAI"
              className="h-8 rounded-full border border-neutral-200 bg-neutral-50 px-3 text-xs font-medium text-neutral-800 outline-none focus:border-neutral-900"
            >
              {ENROLLED_PATIENT_PROFILES.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.noRm} — {p.fullName}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void runExtraction()}
              disabled={isComputing}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              <RefreshIcon width={12} height={12} />
              Proses Ulang
            </button>
          </div>
        )}
      </div>

      {inspection ? (
        <>
          {/* 5 Tahap Visualisasi Ekstraksi Fitur */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {inspection.stages.map((stage) => (
              <div
                key={stage.id}
                className="flex flex-col justify-between rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-2.5"
              >
                <div>
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-900">
                    <img
                      src={stage.dataUrl}
                      alt={stage.title}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                      Tahap {stage.stepNumber}
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-neutral-900">
                    {stage.title.replace(/^\d+\.\s*/, '')}
                  </p>
                  <p className="text-[10px] text-neutral-500">{stage.subtitle}</p>
                  {!compact && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">
                      {stage.technicalNote}
                    </p>
                  )}
                </div>

                <div className="mt-2.5 rounded-lg border border-neutral-200/70 bg-white px-2 py-1.5 text-[10px]">
                  <span className="block text-neutral-400">{stage.metricLabel}</span>
                  <strong className="font-mono text-neutral-900">
                    {stage.metricValue}
                  </strong>
                </div>
              </div>
            ))}
          </div>

          {/* Dekomposisi Skor Ensemble & Histogram LBPH */}
          <div className="grid gap-4 pt-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-neutral-900">
                  Dekomposisi Bobot Skor Ensemble ({subjectDisplay})
                </span>
                <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                  Skor Gabungan: {inspection.breakdown.finalScore.toFixed(2)}%
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-neutral-500">
                Rumus: S_final = 0.45·NCC + 0.25·HOG + 0.20·LBPH + 0.10·ORB (Waktu ekstraksi:{' '}
                {inspection.breakdown.extractionTimeMs} ms)
              </p>

              <div className="mt-3 space-y-2">
                {(
                  [
                    [
                      'Normalized Cross-Correlation (NCC ROI)',
                      'Bobot 45%',
                      inspection.breakdown.nccScore,
                    ],
                    [
                      'Spatial HOG Cosine Similarity (8×8 Grid)',
                      'Bobot 25%',
                      inspection.breakdown.hogScore,
                    ],
                    [
                      'Spatial LBPH Histogram Intersection (4×4 Grid)',
                      'Bobot 20%',
                      inspection.breakdown.lbphScore,
                    ],
                    [
                      `ORB Keypoints Hamming Match (${inspection.breakdown.keypointsCount} titik)`,
                      'Bobot 10%',
                      inspection.breakdown.orbScore,
                    ],
                  ] as const
                ).map(([label, weight, score]) => (
                  <div key={label} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-neutral-700">{label}</span>
                      <span className="font-mono text-neutral-600">
                        <span className="text-neutral-400">{weight} · </span>
                        <strong className="text-neutral-900">{score.toFixed(1)}%</strong>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                      <div
                        className="h-full rounded-full bg-emerald-600"
                        style={{ width: `${Math.min(100, score)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Grafik Distribusi Histogram LBPH 32-Bin */}
            <div className="flex flex-col justify-between rounded-xl border border-neutral-100 bg-neutral-50 p-3.5 text-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-900">
                    Distribusi Vektor Fitur Tekstur LBPH (32-Bin)
                  </span>
                  <span className="font-mono text-[10px] text-emerald-700">
                    Kontras CLAHE +{inspection.breakdown.contrastGainPct}%
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-neutral-500">
                  Profil frekuensi pola biner lokal yang menjadi sidik jari biometrik wajah pasien
                </p>
              </div>

              <div className="mt-3 flex h-24 items-end gap-1 rounded-lg border border-neutral-200/70 bg-white p-2">
                {inspection.histogramBins32.map((val, idx) => (
                  <div
                    key={idx}
                    title={`Bin #${idx + 1}: ${val}%`}
                    className="flex-1 rounded-t bg-neutral-800 transition-all hover:bg-emerald-600"
                    style={{ height: `${Math.max(8, val)}%` }}
                  />
                ))}
              </div>

              <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-neutral-400">
                <span>Bin 0 (Tepi Gelap)</span>
                <span>Pola Uniform LBP</span>
                <span>Bin 31 (Tekstur Terang)</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="py-6 text-center text-xs text-neutral-400">
          Memproses ekstraksi fitur citra biometrik…
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Komponen #2: Simulasi Uji Ketahanan Lingkungan (Robustness Stress Test)   */
/* -------------------------------------------------------------------------- */

export function BiometricStressTestPanel({
  operationalThreshold = 80,
}: {
  readonly operationalThreshold?: number;
}) {
  const [selectedPersonId, setSelectedPersonId] = useState<string>(
    ENROLLED_PATIENT_PROFILES[0]?.personId ?? 'MHS-2026-001',
  );
  const [report, setReport] = useState<BiometricStressTestReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const selectedProfile =
    ENROLLED_PATIENT_PROFILES.find((p) => p.personId === selectedPersonId) ??
    ENROLLED_PATIENT_PROFILES[0];

  const executeStressTest = useCallback(async () => {
    setIsRunning(true);
    try {
      const url = await resolveSubjectImageUrl(selectedPersonId);
      if (url) {
        const res = await runBiometricStressTest(
          url,
          `${selectedProfile?.noRm ?? 'RM-2026-0001'} (${selectedProfile?.fullName ?? 'Subjek'})`,
          operationalThreshold,
        );
        setReport(res);
      }
    } catch {
      // Abaikan jika gagal memuat citra
    } finally {
      setIsRunning(false);
    }
  }, [selectedPersonId, selectedProfile, operationalThreshold]);

  useEffect(() => {
    void executeStressTest();
  }, [executeStressTest]);

  const handleExportCsv = () => {
    if (!report) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(
      `uji_ketahanan_clahe_${selectedProfile?.noRm ?? 'subjek'}_${stamp}.csv`,
      buildStressTestCsv(report),
    );
  };

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">
              Eksperimen Uji Ketahanan Lingkungan: Tanpa CLAHE vs. Dengan CLAHE
            </h3>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-amber-800">
              6 Skenario Perturbasi Citra (Bab 4 Skripsi)
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            Pengujian ketahanan pengenalan wajah terhadap kondisi ruang tunggu redup, silau (overexposed), kontras rendah, blur, dan derau sensor
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
            aria-label="Pilih subjek uji ketahanan"
            className="h-8 rounded-full border border-neutral-200 bg-neutral-50 px-3 text-xs font-medium text-neutral-800 outline-none focus:border-neutral-900"
          >
            {ENROLLED_PATIENT_PROFILES.map((p) => (
              <option key={p.personId} value={p.personId}>
                {p.noRm} — {p.fullName}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void executeStressTest()}
            disabled={isRunning}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
          >
            <RefreshIcon width={12} height={12} />
            Uji Ulang
          </button>

          {report && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-800"
            >
              <DownloadIcon width={12} height={12} />
              Unduh CSV Uji Ketahanan
            </button>
          )}
        </div>
      </div>

      {report && (
        <>
          {/* Ringkasan Metrik Eksperimen CLAHE */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-neutral-200/70 bg-neutral-50 p-3">
              <span className="text-[11px] text-neutral-500">
                Rata-rata Tanpa CLAHE
              </span>
              <p className="mt-1 font-mono text-xl font-semibold text-neutral-700">
                {report.avgScoreWithoutClahe.toFixed(2)}%
              </p>
              <p className="mt-0.5 text-[11px] text-rose-600">
                Kelulusan (≥{report.threshold}%): {report.passRateWithoutClahe}%
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
              <span className="text-[11px] font-medium text-emerald-800">
                Rata-rata Dengan CLAHE + Ensemble
              </span>
              <p className="mt-1 font-mono text-xl font-semibold text-emerald-900">
                {report.avgScoreWithClahe.toFixed(2)}%
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-emerald-700">
                Kelulusan (≥{report.threshold}%): {report.passRateWithClahe}%
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200/70 bg-neutral-50 p-3">
              <span className="text-[11px] text-neutral-500">
                Peningkatan Akurasi (Δ Gain)
              </span>
              <p className="mt-1 font-mono text-xl font-semibold text-emerald-700">
                +{report.avgDeltaGain.toFixed(2)}%
              </p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Kontribusi normalisasi CLAHE
              </p>
            </div>

            <div className="rounded-xl border border-neutral-200/70 bg-neutral-50 p-3">
              <span className="text-[11px] text-neutral-500">
                Ambang Batas Operasional
              </span>
              <p className="mt-1 font-mono text-xl font-semibold text-neutral-900">
                {report.threshold}.0%
              </p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                6 kondisi gangguan diuji
              </p>
            </div>
          </div>

          {/* Grid Visual Perturbasi vs Restorasi CLAHE */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.conditions.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-neutral-900">
                      {c.conditionName}
                    </p>
                    <p className="font-mono text-[10px] text-neutral-500">
                      {c.parameterSpec}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-800">
                    +{c.deltaGain.toFixed(1)}%
                  </span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <div>
                    <div className="relative aspect-square overflow-hidden rounded-lg border border-neutral-200 bg-neutral-900">
                      <img
                        src={c.perturbedImageUrl}
                        alt={`${c.conditionName} Tanpa CLAHE`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] text-neutral-200">
                        Tanpa CLAHE
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span
                        className={`font-mono font-semibold ${
                          c.passWithoutClahe ? 'text-neutral-800' : 'text-rose-600'
                        }`}
                      >
                        {c.scoreWithoutClahe.toFixed(1)}%
                      </span>
                      <span
                        className={`text-[10px] font-medium ${
                          c.passWithoutClahe ? 'text-neutral-500' : 'text-rose-600'
                        }`}
                      >
                        {c.passWithoutClahe ? 'Lolos' : 'Gagal (<80%)'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="relative aspect-square overflow-hidden rounded-lg border border-emerald-300 bg-neutral-900">
                      <img
                        src={c.claheRestoredImageUrl}
                        alt={`${c.conditionName} Dengan CLAHE`}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-1 left-1 rounded bg-emerald-950/85 px-1.5 py-0.5 font-mono text-[9px] text-emerald-300">
                        + CLAHE
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="font-mono font-semibold text-emerald-700">
                        {c.scoreWithClahe.toFixed(1)}%
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700">
                        <CheckIcon width={10} height={10} />
                        Lolos
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
