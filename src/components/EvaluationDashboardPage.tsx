import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ENROLLED_PATIENT_PROFILES,
  fetchHospitalAnalytics,
  type HospitalAnalyticsData,
} from '../lib/hospital';
import {
  buildSatusehatFhirBundle,
  downloadSatusehatFhirJson,
} from '../lib/satusehat';
import {
  buildReportCsv,
  buildSummaryCsv,
  buildSweepCsv,
  buildThresholdSweep,
  confusionAtThreshold,
  confusionFromOutcomes,
  datasetFromBackend,
  datasetFromScript,
  deriveRates,
  downloadCsv,
  estimateServerlessCost,
  findEer,
  loadScriptSummary,
  SWEEP_MAX_THRESHOLD,
  SWEEP_MIN_THRESHOLD,
  type CostInputs,
  type ScientificDataset,
  type ScientificSource,
  type SummaryRow,
} from '../lib/evaluationMetrics';
import { useEdgeLatencyBenchmark } from '../hooks/useEdgeLatencyBenchmark';
import {
  BiometricMetricCards,
  LatencyBreakdownPanel,
  ServerlessCostCard,
  ThresholdSensitivityPanel,
  estimateNetworkMs,
  type NetworkEstimate,
} from './EvaluationScientificPanels';
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  FileTextIcon,
  RefreshIcon,
  ShieldCheckIcon,
  UsersIcon,
} from './icons';

/** Laporan skrip dibaca sekali saat modul dimuat (artefak statis hasil test_verify_api.py). */
const SCRIPT_SUMMARY = loadScriptSummary();

const DEFAULT_LAMBDA_DURATION_MS = 400;
const DEFAULT_USD_TO_IDR = 16000;

const clampThreshold = (t: number) =>
  Math.min(SWEEP_MAX_THRESHOLD, Math.max(SWEEP_MIN_THRESHOLD, Math.round(t)));

const fileStamp = () => new Date().toISOString().slice(0, 10);

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
  const [preferredSource, setPreferredSource] = useState<ScientificSource>(
    SCRIPT_SUMMARY ? 'script' : 'backend',
  );
  const [sliderThreshold, setSliderThreshold] = useState<number | null>(null);
  const [network, setNetwork] = useState<NetworkEstimate>({
    uplinkMbps: 10,
    rttMs: 40,
  });
  const [usdToIdr, setUsdToIdr] = useState(DEFAULT_USD_TO_IDR);
  const [costOverrides, setCostOverrides] = useState<CostInputs | null>(null);
  const edgeBench = useEdgeLatencyBenchmark();

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

  const evalReport = data?.evaluation ?? null;

  /* -------------------- Sumber data ilmiah ternormalisasi -------------------- */
  const dataset: ScientificDataset | null = useMemo(() => {
    const fromScript = SCRIPT_SUMMARY ? datasetFromScript(SCRIPT_SUMMARY) : null;
    const fromBackend =
      evalReport && evalReport.cases.length > 0 ? datasetFromBackend(evalReport) : null;
    if (preferredSource === 'script') return fromScript ?? fromBackend;
    return fromBackend ?? fromScript;
  }, [evalReport, preferredSource]);

  const operationalThreshold = dataset?.threshold ?? 80;
  const activeThreshold = clampThreshold(sliderThreshold ?? operationalThreshold);

  const sweep = useMemo(
    () => (dataset ? buildThresholdSweep(dataset.cases) : []),
    [dataset],
  );
  const eer = useMemo(() => findEer(sweep), [sweep]);
  const operationalCm = useMemo(
    () =>
      dataset
        ? confusionFromOutcomes(dataset.cases)
        : { tp: 0, tn: 0, fp: 0, fn: 0 },
    [dataset],
  );
  const operationalRates = deriveRates(operationalCm);

  const measuredLambdaMs =
    dataset?.mode === 'live-api'
      ? (dataset.latency.warmAvgMs ?? dataset.latency.cloudAvgMs)
      : null;
  const costInputs: CostInputs = costOverrides ?? {
    lambdaDurationMs: measuredLambdaMs ?? DEFAULT_LAMBDA_DURATION_MS,
    lambdaMemoryMb: 1024,
    writesPerScan: 1,
    readsPerScan: 0,
    includeApiGateway: true,
    monthlyScans: 1000,
    dedicatedMonthlyUsd: 30.37,
  };
  const durationSource =
    costOverrides !== null
      ? 'diubah manual'
      : measuredLambdaMs !== null
        ? `rata-rata warm terukur (${measuredLambdaMs.toFixed(0)} ms)`
        : `asumsi ${DEFAULT_LAMBDA_DURATION_MS} ms (ganti dengan Duration CloudWatch)`;

  if (isLoading && !data && !SCRIPT_SUMMARY) {
    return (
      <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-neutral-200/80 bg-white p-8 text-center">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
        <p className="mt-3 text-xs font-medium text-neutral-600">
          Menghitung metrik evaluasi biometrik & memuat log kunjungan dari database…
        </p>
      </div>
    );
  }

  const cases = dataset?.cases ?? [];
  const positiveCasesCount = cases.filter((c) => c.type === 'POSITIVE').length;
  const negativeCasesCount = cases.length - positiveCasesCount;

  const filteredCases = cases.filter((c) =>
    caseFilter === 'ALL' ? true : c.type === caseFilter,
  );

  /* ------------------------------ Ekspor CSV ------------------------------ */
  const exportReportCsv = () => {
    if (!dataset) return;
    downloadCsv(`evaluation_report_${fileStamp()}.csv`, buildReportCsv(dataset.cases));
  };

  const exportSweepCsv = () => {
    if (sweep.length === 0) return;
    downloadCsv(`evaluation_threshold_sweep_${fileStamp()}.csv`, buildSweepCsv(sweep));
  };

  const exportSummaryCsv = () => {
    if (!dataset) return;
    const lat = dataset.latency;
    const edge = edgeBench.result;
    const cost = estimateServerlessCost(costInputs);
    const netMs = lat.networkMeasured
      ? lat.networkAvgMs
      : estimateNetworkMs(dataset.avgPayloadKb, network);
    const rows: SummaryRow[] = [
      ['dataset', 'source', dataset.sourceLabel, '', ''],
      ['dataset', 'mode', dataset.mode, '', ''],
      ['dataset', 'generated_at', dataset.generatedAt, '', ''],
      ['dataset', 'total_cases', cases.length, 'sampel', ''],
      ['dataset', 'positive_cases', positiveCasesCount, 'sampel', 'test_positive/'],
      ['dataset', 'negative_cases', negativeCasesCount, 'sampel', 'test_negative/'],
      ['dataset', 'threshold', operationalThreshold, '%', 'MATCH_THRESHOLD'],
      ['confusion_matrix', 'TP', operationalCm.tp, 'sampel', ''],
      ['confusion_matrix', 'TN', operationalCm.tn, 'sampel', ''],
      ['confusion_matrix', 'FP', operationalCm.fp, 'sampel', ''],
      ['confusion_matrix', 'FN', operationalCm.fn, 'sampel', ''],
      ['metrics', 'accuracy', operationalRates.accuracy, '%', '(TP+TN)/N'],
      ['metrics', 'precision', operationalRates.precision, '%', 'TP/(TP+FP)'],
      ['metrics', 'recall', operationalRates.recall, '%', 'TP/(TP+FN)'],
      ['metrics', 'f1_score', operationalRates.f1Score, '%', '2PR/(P+R)'],
      ['metrics', 'far', operationalRates.far, '%', 'FP/(FP+TN)'],
      ['metrics', 'frr', operationalRates.frr, '%', 'FN/(FN+TP)'],
      ['metrics', 'eer_threshold', eer?.threshold ?? '', '%', '|FAR-FRR| minimum'],
      ['latency', 'edge_avg_ms', edge?.avgTotalMs ?? '', 'ms', 'BlazeFace + validateFaces (browser)'],
      ['latency', 'edge_detect_avg_ms', edge?.avgDetectMs ?? '', 'ms', ''],
      ['latency', 'edge_validate_avg_ms', edge?.avgValidateMs ?? '', 'ms', ''],
      ['latency', 'edge_p95_ms', edge?.p95TotalMs ?? '', 'ms', ''],
      ['latency', 'edge_model_load_ms', edge?.modelLoadMs ?? '', 'ms', 'cold load TF.js + bobot'],
      ['latency', 'edge_first_inference_ms', edge?.firstInferenceMs ?? '', 'ms', 'kompilasi shader WebGL'],
      [
        'latency',
        'network_avg_ms',
        netMs !== null ? Math.round(netMs * 100) / 100 : '',
        'ms',
        lat.networkMeasured
          ? 'terukur'
          : `estimasi RTT ${network.rttMs} ms + uplink ${network.uplinkMbps} Mbps`,
      ],
      ['latency', 'cloud_avg_ms', lat.cloudAvgMs ?? '', 'ms', dataset.mode],
      ['latency', 'rekognition_avg_ms', lat.rekognitionAvgMs ?? '', 'ms', 'SearchFacesByImage'],
      ['latency', 'cold_start_ms', lat.coldStartMs ?? '', 'ms', lat.startDetection],
      ['latency', 'warm_avg_ms', lat.warmAvgMs ?? '', 'ms', ''],
      ['latency', 'total_p50_ms', lat.totalP50Ms ?? '', 'ms', ''],
      ['latency', 'total_p95_ms', lat.totalP95Ms ?? '', 'ms', ''],
      ['payload', 'avg_payload', dataset.avgPayloadKb ?? '', 'KB', 'JSON base64'],
      ...cost.lines.map<SummaryRow>((l) => [
        'cost',
        `${l.key}_per_1000`,
        Number(l.per1000Usd.toFixed(6)),
        'USD',
        l.formula,
      ]),
      ['cost', 'total_per_1000', Number(cost.per1000Usd.toFixed(6)), 'USD', 'us-east-1, tanpa Free Tier'],
      ['cost', 'total_per_1000_idr', Math.round(cost.per1000Usd * usdToIdr), 'IDR', `kurs ${usdToIdr}`],
      ['cost', 'monthly_scans', costInputs.monthlyScans, 'scan', ''],
      ['cost', 'monthly_serverless', Number(cost.monthlyServerlessUsd.toFixed(4)), 'USD', ''],
      ['cost', 'monthly_dedicated', cost.monthlyDedicatedUsd, 'USD', 'EC2 t3.medium on-demand'],
      ['cost', 'break_even_scans', cost.breakEvenScansPerMonth, 'scan/bulan', ''],
      ...dataset.notes.map<SummaryRow>((n) => ['notes', 'catatan', '', '', n]),
    ];
    downloadCsv(`evaluation_summary_${fileStamp()}.csv`, buildSummaryCsv(rows));
  };

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
                {dataset ? 'Backend Evaluasi Tidak Terhubung' : 'Data Evaluasi Tidak Tersedia'}
              </p>
              <p className="mt-0.5 text-rose-800">
                {loadError ??
                  'Tidak dapat memuat laporan evaluasi dari server backend. Metrik tidak ditampilkan untuk menjaga integritas data pengujian.'}
                {dataset?.source === 'script' &&
                  ' Metrik ilmiah di bawah tetap ditampilkan dari laporan skrip dataset/evaluation_summary.json.'}
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
              {dataset?.source === 'script'
                ? dataset.mode === 'live-api'
                  ? 'Live API Gateway + Amazon Rekognition'
                  : 'Simulasi lambda_handler (mock Rekognition)'
                : 'Ensemble CLAHE + Spatial LBPH + HOG + ORB'}
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
            Hasil Pengujian Akurasi Biometrik &amp; Performa Sistem
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            {dataset
              ? `Pengujian ${cases.length} skenario uji (${positiveCasesCount} subjek terdaftar positif & ${negativeCasesCount} wajah tidak terdaftar negatif) dengan ambang batas kemiripan ${operationalThreshold}%. Sumber: ${dataset.sourceLabel} · ${new Date(dataset.generatedAt).toLocaleString('id-ID')}.`
              : 'Menunggu koneksi ke layanan evaluasi biometrik atau jalankan `python dataset/test_verify_api.py` untuk menghasilkan laporan.'}
          </p>
          {SCRIPT_SUMMARY && evalReport && (
            <div
              className="mt-2 inline-flex items-center gap-1 rounded-full bg-neutral-100 p-1 text-[11px]"
              role="tablist"
              aria-label="Sumber data evaluasi"
            >
              {(
                [
                  ['script', 'Laporan Skrip (Bab 4)'],
                  ['backend', 'Backend /analytics'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  id={`source-toggle-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={preferredSource === key}
                  onClick={() => {
                    setPreferredSource(key);
                    setSliderThreshold(null);
                  }}
                  className={`rounded-full px-2.5 py-1 font-medium transition ${
                    preferredSource === key
                      ? 'bg-white text-neutral-900 shadow-sm'
                      : 'text-neutral-500 hover:text-neutral-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            id="export-report-csv"
            type="button"
            onClick={exportReportCsv}
            disabled={cases.length === 0}
            title="Kolom identik dengan dataset/evaluation_report.csv"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            <DownloadIcon width={14} height={14} />
            CSV Per-Sampel
          </button>
          <button
            id="export-summary-csv"
            type="button"
            onClick={exportSummaryCsv}
            disabled={cases.length === 0}
            title="Ringkasan metrik, latensi, dan biaya (section,metric,value,unit,notes)"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            <DownloadIcon width={14} height={14} />
            CSV Ringkasan Bab 4
          </button>
          <button
            id="export-sweep-csv"
            type="button"
            onClick={exportSweepCsv}
            disabled={sweep.length === 0}
            title="Sensitivitas threshold 75%–99% (FAR vs FRR)"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            <DownloadIcon width={14} height={14} />
            CSV Sweep Threshold
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

      {dataset && dataset.notes.length > 0 && (
        <ul className="space-y-1 rounded-2xl border border-amber-200/70 bg-amber-50/60 px-5 py-3 text-[11px] text-amber-900">
          {dataset.notes.map((n) => (
            <li key={n} className="flex items-start gap-1.5">
              <AlertIcon width={12} height={12} className="mt-0.5 shrink-0 text-amber-600" />
              {n}
            </li>
          ))}
        </ul>
      )}

      {dataset && (
        <>
          {/* 1. Metrik Akurasi Biometrik */}
          <BiometricMetricCards
            cm={operationalCm}
            rates={operationalRates}
            threshold={operationalThreshold}
            positives={positiveCasesCount}
            negatives={negativeCasesCount}
          />

          {/* 2. Threshold Sensitivity + Tabel Sampel */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <ThresholdSensitivityPanel
              dataset={dataset}
              sweep={sweep}
              eer={eer}
              value={activeThreshold}
              onChange={setSliderThreshold}
            />

            <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-neutral-900">
                    Rincian Sampel Pengujian ({cases.length})
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Skor terbaik, latensi, hasil aktual & hasil pada ambang {activeThreshold}%
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

              <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-xl border border-neutral-100">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                    <tr>
                      <th className="px-3 py-2">Kode</th>
                      <th className="px-3 py-2">Subjek Uji</th>
                      <th className="px-3 py-2">Prediksi ID</th>
                      <th className="px-3 py-2 text-right">Skor</th>
                      <th className="px-3 py-2 text-right">Latency</th>
                      <th className="px-3 py-2 text-center">Hasil</th>
                      <th className="px-3 py-2 text-center">@{activeThreshold}%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {filteredCases.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-8 text-center text-xs text-neutral-400"
                        >
                          Data hasil pengujian tidak tersedia.
                        </td>
                      </tr>
                    ) : (
                      filteredCases.map((c) => {
                        const at = confusionAtThreshold([c], activeThreshold);
                        const atOutcome = at.tp ? 'TP' : at.tn ? 'TN' : at.fp ? 'FP' : 'FN';
                        const tone = (o: string) =>
                          o === 'TP'
                            ? 'bg-emerald-50 text-emerald-700'
                            : o === 'TN'
                              ? 'bg-teal-50 text-teal-700'
                              : o === 'FP'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-amber-50 text-amber-700';
                        return (
                          <tr key={c.case_id} className="hover:bg-neutral-50/70">
                            <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">
                              {c.case_id}
                            </td>
                            <td className="px-3 py-2 font-medium text-neutral-900">
                              {c.full_name}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-neutral-600">
                              {c.predicted_person_id || 'DITOLAK'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-neutral-800">
                              {c.best_score.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[11px] text-neutral-500">
                              {c.latency_ms.toFixed(1)} ms
                              {c.start_type === 'COLD' && (
                                <span className="ml-1 rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-800">
                                  COLD
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${tone(c.outcome)}`}
                              >
                                {c.outcome}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 font-mono text-[10px] font-bold transition-colors ${tone(atOutcome)}`}
                              >
                                {atOutcome}
                              </span>
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

          {/* 3. Breakdown Latensi End-to-End */}
          <LatencyBreakdownPanel
            dataset={dataset}
            edge={edgeBench.result}
            edgeState={edgeBench.state}
            edgeImageCount={edgeBench.imageCount}
            onRunEdge={() => void edgeBench.run()}
            network={network}
            onNetworkChange={setNetwork}
          />

          {/* 4. Analisis Efisiensi Biaya Serverless */}
          <ServerlessCostCard
            inputs={costInputs}
            onChange={setCostOverrides}
            usdToIdr={usdToIdr}
            onRateChange={setUsdToIdr}
            durationSource={durationSource}
          />
        </>
      )}

      {/* Diagnostik Database Lokal SQLite */}
      {data?.database && (
        <section className="space-y-2 rounded-2xl border border-neutral-200/80 bg-white p-5 text-xs text-neutral-600">
          <div className="flex items-center justify-between">
            <span className="font-medium text-neutral-700">
              Database Lokal SQLite (Relational WAL)
            </span>
            <span className="font-mono text-[11px] font-semibold text-emerald-700">
              {data.database.dbPath ?? 'dataset/simrs_biometric.db'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] sm:grid-cols-5">
            {(
              [
                ['Tabel patients', data.database.tables.patients, 'baris'],
                ['medical_records', data.database.tables.medical_records, 'baris'],
                ['attendance_logs', data.database.tables.attendance_logs, 'baris'],
                ['poli_queues', data.database.tables.poli_queues, 'poli'],
                ['queue_slots (Aktif)', data.database.tables.active_queue_slots, 'slot'],
              ] as const
            ).map(([label, v, unit]) => (
              <div
                key={label}
                className="rounded-lg border border-neutral-200/60 bg-neutral-50 px-2.5 py-1.5"
              >
                <span className="block text-neutral-400">{label}</span>
                <strong className="font-mono text-neutral-900">
                  {v !== undefined ? `${v} ${unit}` : 'Tidak tersedia'}
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}

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
