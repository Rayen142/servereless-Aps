/**
 * Utilitas evaluasi ilmiah (Bab 4) — fungsi murni tanpa React/DOM kecuali pengunduh CSV.
 *
 * Sumber data utama adalah `dataset/evaluation_summary.json` yang dihasilkan oleh
 * `dataset/test_verify_api.py`. Bila berkas itu belum ada, dasbor memakai kasus uji
 * dari endpoint backend `/analytics` sebagai cadangan.
 *
 * Definisi metrik (identik dengan skrip Python):
 * - FAR = FP / (FP + TN) × 100%
 * - FRR = FN / (FN + TP) × 100%
 * - Accuracy = (TP + TN) / N × 100%
 */
import type { BiometricEvaluationReport } from './hospital';

export const SWEEP_MIN_THRESHOLD = 75;
export const SWEEP_MAX_THRESHOLD = 99;

/** Urutan kolom WAJIB sama dengan `REPORT_CSV_COLUMNS` di dataset/test_verify_api.py */
export const REPORT_CSV_COLUMNS = [
  'case_id',
  'type',
  'full_name',
  'expected_person_id',
  'predicted_person_id',
  'recognized',
  'similarity',
  'latency_ms',
  'outcome',
  'best_match_id',
  'best_score',
  'payload_kb',
  'network_ms',
  'cloud_ms',
  'rekognition_ms',
  'start_type',
] as const;

export const SWEEP_CSV_COLUMNS = [
  'threshold',
  'tp',
  'tn',
  'fp',
  'fn',
  'far_pct',
  'frr_pct',
  'accuracy_pct',
] as const;

export const SUMMARY_CSV_COLUMNS = [
  'section',
  'metric',
  'value',
  'unit',
  'notes',
] as const;

export type Outcome = 'TP' | 'TN' | 'FP' | 'FN';

/** Baris per-sampel (snake_case agar 1:1 dengan evaluation_report.csv). */
export interface ScientificCase {
  readonly case_id: string;
  readonly type: string;
  readonly full_name: string;
  readonly expected_person_id: string;
  readonly predicted_person_id: string;
  readonly recognized: boolean;
  readonly similarity: number;
  readonly latency_ms: number;
  readonly outcome: Outcome;
  readonly best_match_id: string;
  readonly best_score: number;
  readonly payload_kb: number | null;
  readonly network_ms: number | null;
  readonly cloud_ms: number | null;
  readonly rekognition_ms: number | null;
  readonly start_type: 'COLD' | 'WARM' | '';
}

export interface ConfusionCounts {
  readonly tp: number;
  readonly tn: number;
  readonly fp: number;
  readonly fn: number;
}

export interface SweepRow extends ConfusionCounts {
  readonly threshold: number;
  readonly far_pct: number;
  readonly frr_pct: number;
  readonly accuracy_pct: number;
}

export interface LatencySummary {
  readonly totalAvgMs: number | null;
  readonly totalP50Ms: number | null;
  readonly totalP95Ms: number | null;
  readonly networkAvgMs: number | null;
  readonly networkMeasured: boolean;
  readonly cloudAvgMs: number | null;
  readonly rekognitionAvgMs: number | null;
  readonly coldStartMs: number | null;
  readonly warmAvgMs: number | null;
  readonly coldInitMs: number | null;
  readonly coldSamples: number;
  readonly warmSamples: number;
  readonly startDetection: string;
}

export interface EvaluationSummaryFile {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly mode: 'simulate-local' | 'live-api';
  readonly apiUrl: string | null;
  readonly threshold: number;
  readonly dataset: {
    readonly totalCases: number;
    readonly positiveCases: number;
    readonly negativeCases: number;
    readonly enrolledSubjects: number;
  };
  readonly confusionMatrix: ConfusionCounts;
  readonly latency: LatencySummary;
  readonly payload: { readonly avgKb: number | null };
  readonly thresholdSweep: readonly SweepRow[];
  readonly notes: readonly string[];
  readonly cases: readonly ScientificCase[];
}

export type ScientificSource = 'script' | 'backend';

/** Representasi ternormalisasi yang dipakai seluruh panel dasbor. */
export interface ScientificDataset {
  readonly source: ScientificSource;
  readonly sourceLabel: string;
  readonly mode: 'simulate-local' | 'live-api' | 'backend-local';
  readonly generatedAt: string;
  readonly threshold: number;
  readonly cases: readonly ScientificCase[];
  readonly latency: LatencySummary;
  readonly avgPayloadKb: number | null;
  readonly notes: readonly string[];
}

/* -------------------------------------------------------------------------- */
/*  Pemuatan laporan skrip (opsional — tidak menggagalkan build bila absen)    */
/* -------------------------------------------------------------------------- */

const scriptSummaryModules = import.meta.glob<EvaluationSummaryFile>(
  '../../dataset/evaluation_summary.json',
  { eager: true, import: 'default' },
);

export function loadScriptSummary(): EvaluationSummaryFile | null {
  const mod = Object.values(scriptSummaryModules)[0];
  if (!mod || !Array.isArray(mod.cases) || mod.cases.length === 0) {
    return null;
  }
  return mod;
}

export function datasetFromScript(
  summary: EvaluationSummaryFile,
): ScientificDataset {
  return {
    source: 'script',
    sourceLabel: 'dataset/evaluation_summary.json (test_verify_api.py)',
    mode: summary.mode,
    generatedAt: summary.generatedAt,
    threshold: summary.threshold,
    cases: summary.cases,
    latency: summary.latency,
    avgPayloadKb: summary.payload?.avgKb ?? null,
    notes: summary.notes ?? [],
  };
}

export function datasetFromBackend(
  report: BiometricEvaluationReport,
): ScientificDataset {
  const cases: ScientificCase[] = report.cases.map((c) => ({
    case_id: c.caseId,
    type: c.type,
    full_name: c.fullName,
    expected_person_id: c.expectedPersonId ?? '',
    predicted_person_id: c.predictedPersonId ?? '',
    recognized: c.predictedPersonId !== null,
    similarity: c.similarity,
    latency_ms: c.latencyMs,
    outcome: c.outcome,
    // Backend tidak melaporkan kandidat terbaik untuk sampel yang ditolak;
    // diasumsikan kandidat = identitas target (positif) — lihat catatan.
    best_match_id:
      c.predictedPersonId ?? (c.type === 'POSITIVE' ? (c.expectedPersonId ?? '') : ''),
    best_score: c.similarity,
    payload_kb: null,
    network_ms: null,
    cloud_ms: c.latencyMs,
    rekognition_ms: null,
    start_type: '',
  }));
  const lat = cases.map((c) => c.latency_ms);
  return {
    source: 'backend',
    sourceLabel: 'Backend GET /v1/attendance/analytics',
    mode: 'backend-local',
    generatedAt: report.evaluatedAt,
    threshold: report.threshold,
    cases,
    latency: {
      totalAvgMs: report.avgLatencyMs,
      totalP50Ms: percentile(lat, 50),
      totalP95Ms: percentile(lat, 95),
      networkAvgMs: null,
      networkMeasured: false,
      cloudAvgMs: report.avgLatencyMs,
      rekognitionAvgMs: null,
      coldStartMs: null,
      warmAvgMs: null,
      coldInitMs: null,
      coldSamples: 0,
      warmSamples: 0,
      startDetection: 'not_available',
    },
    avgPayloadKb: null,
    notes: [
      'Sumber backend lokal (ensemble OpenCV) — bukan Amazon Rekognition; cold/warm start & network tidak diukur.',
      'Kandidat terbaik untuk sampel positif yang ditolak diasumsikan = identitas target (backend tidak melaporkannya).',
    ],
  };
}

/* -------------------------------------------------------------------------- */
/*  Metrik                                                                    */
/* -------------------------------------------------------------------------- */

export function classify(
  isPositive: boolean,
  expectedId: string,
  accepted: boolean,
  predictedId: string,
): Outcome {
  if (isPositive) {
    if (accepted && predictedId === expectedId) return 'TP';
    if (accepted) return 'FP'; // salah orang (misidentification) = false accept
    return 'FN';
  }
  return accepted ? 'FP' : 'TN';
}

export function confusionAtThreshold(
  cases: readonly ScientificCase[],
  threshold: number,
): ConfusionCounts {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  for (const c of cases) {
    const accepted = c.best_score >= threshold && c.best_match_id !== '';
    const outcome = classify(
      c.type === 'POSITIVE',
      c.expected_person_id,
      accepted,
      accepted ? c.best_match_id : '',
    );
    if (outcome === 'TP') tp += 1;
    else if (outcome === 'TN') tn += 1;
    else if (outcome === 'FP') fp += 1;
    else fn += 1;
  }
  return { tp, tn, fp, fn };
}

/** Matriks konfusi pada ambang operasional = hasil aktual yang dilaporkan sistem. */
export function confusionFromOutcomes(
  cases: readonly ScientificCase[],
): ConfusionCounts {
  return cases.reduce<ConfusionCounts>(
    (acc, c) => ({
      tp: acc.tp + (c.outcome === 'TP' ? 1 : 0),
      tn: acc.tn + (c.outcome === 'TN' ? 1 : 0),
      fp: acc.fp + (c.outcome === 'FP' ? 1 : 0),
      fn: acc.fn + (c.outcome === 'FN' ? 1 : 0),
    }),
    { tp: 0, tn: 0, fp: 0, fn: 0 },
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface DerivedRates {
  readonly accuracy: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1Score: number;
  readonly far: number;
  readonly frr: number;
}

export function deriveRates({ tp, tn, fp, fn }: ConfusionCounts): DerivedRates {
  const total = tp + tn + fp + fn;
  const precision = tp + fp ? (tp / (tp + fp)) * 100 : 0;
  const recall = tp + fn ? (tp / (tp + fn)) * 100 : 0;
  return {
    accuracy: total ? round2(((tp + tn) / total) * 100) : 0,
    precision: round2(precision),
    recall: round2(recall),
    f1Score:
      precision + recall
        ? round2((2 * precision * recall) / (precision + recall))
        : 0,
    far: fp + tn ? round2((fp / (fp + tn)) * 100) : 0,
    frr: fn + tp ? round2((fn / (fn + tp)) * 100) : 0,
  };
}

export function buildThresholdSweep(
  cases: readonly ScientificCase[],
): SweepRow[] {
  const rows: SweepRow[] = [];
  for (let t = SWEEP_MIN_THRESHOLD; t <= SWEEP_MAX_THRESHOLD; t += 1) {
    const cm = confusionAtThreshold(cases, t);
    const r = deriveRates(cm);
    rows.push({
      threshold: t,
      ...cm,
      far_pct: r.far,
      frr_pct: r.frr,
      accuracy_pct: r.accuracy,
    });
  }
  return rows;
}

export function findEer(sweep: readonly SweepRow[]): SweepRow | null {
  if (sweep.length === 0) return null;
  return sweep.reduce((best, row) =>
    Math.abs(row.far_pct - row.frr_pct) < Math.abs(best.far_pct - best.frr_pct)
      ? row
      : best,
  );
}

export function percentile(values: readonly number[], pct: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const k = (sorted.length - 1) * (pct / 100);
  const lo = Math.floor(k);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return round2(sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo));
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}

/* -------------------------------------------------------------------------- */
/*  Estimasi biaya serverless (harga publik AWS us-east-1, tanpa Free Tier)    */
/* -------------------------------------------------------------------------- */

export const AWS_PRICING = {
  /** Lambda x86: USD per 1 juta request */
  lambdaPerMillionRequests: 0.2,
  /** Lambda x86: USD per GB-detik */
  lambdaPerGbSecond: 0.0000166667,
  /** Rekognition Image (Group 1 API, tier 1 juta pertama): USD per gambar */
  rekognitionPerImage: 0.001,
  /** DynamoDB on-demand (harga sejak Nov 2024): USD per 1 juta WRU */
  dynamoPerMillionWru: 0.625,
  /** DynamoDB on-demand: USD per 1 juta RRU */
  dynamoPerMillionRru: 0.125,
  /** API Gateway REST API: USD per 1 juta panggilan (tier pertama) */
  apiGatewayPerMillion: 3.5,
  /** Referensi dedicated server: EC2 t3.medium on-demand 0.0416 USD/jam × 730 jam */
  dedicatedServerMonthlyUsd: 30.37,
} as const;

export interface CostInputs {
  readonly lambdaDurationMs: number;
  readonly lambdaMemoryMb: number;
  readonly writesPerScan: number;
  readonly readsPerScan: number;
  readonly includeApiGateway: boolean;
  readonly monthlyScans: number;
  readonly dedicatedMonthlyUsd: number;
}

export interface CostLine {
  readonly key: string;
  readonly label: string;
  readonly per1000Usd: number;
  readonly formula: string;
}

export interface CostBreakdown {
  readonly lines: readonly CostLine[];
  readonly per1000Usd: number;
  readonly perScanUsd: number;
  readonly monthlyServerlessUsd: number;
  readonly monthlyDedicatedUsd: number;
  readonly breakEvenScansPerMonth: number;
  readonly savingsPct: number;
}

export function estimateServerlessCost(inputs: CostInputs): CostBreakdown {
  const n = 1000;
  const gbSeconds =
    (inputs.lambdaMemoryMb / 1024) * (inputs.lambdaDurationMs / 1000) * n;
  const lines: CostLine[] = [
    {
      key: 'lambda_requests',
      label: 'AWS Lambda — request',
      per1000Usd: (n / 1e6) * AWS_PRICING.lambdaPerMillionRequests,
      formula: `1.000 × $${AWS_PRICING.lambdaPerMillionRequests}/1 jt`,
    },
    {
      key: 'lambda_compute',
      label: 'AWS Lambda — komputasi',
      per1000Usd: gbSeconds * AWS_PRICING.lambdaPerGbSecond,
      formula: `${gbSeconds.toFixed(1)} GB-dtk × $${AWS_PRICING.lambdaPerGbSecond}`,
    },
    {
      key: 'rekognition',
      label: 'Rekognition SearchFacesByImage',
      per1000Usd: n * AWS_PRICING.rekognitionPerImage,
      formula: `1.000 × $${AWS_PRICING.rekognitionPerImage}/gambar`,
    },
    {
      key: 'dynamodb',
      label: 'DynamoDB on-demand',
      per1000Usd:
        ((n * inputs.writesPerScan) / 1e6) * AWS_PRICING.dynamoPerMillionWru +
        ((n * inputs.readsPerScan) / 1e6) * AWS_PRICING.dynamoPerMillionRru,
      formula: `${inputs.writesPerScan} WRU + ${inputs.readsPerScan} RRU / scan`,
    },
  ];
  if (inputs.includeApiGateway) {
    lines.push({
      key: 'api_gateway',
      label: 'API Gateway (REST)',
      per1000Usd: (n / 1e6) * AWS_PRICING.apiGatewayPerMillion,
      formula: `1.000 × $${AWS_PRICING.apiGatewayPerMillion}/1 jt`,
    });
  }
  const per1000Usd = lines.reduce((s, l) => s + l.per1000Usd, 0);
  const perScanUsd = per1000Usd / n;
  const monthlyServerlessUsd = perScanUsd * inputs.monthlyScans;
  return {
    lines,
    per1000Usd,
    perScanUsd,
    monthlyServerlessUsd,
    monthlyDedicatedUsd: inputs.dedicatedMonthlyUsd,
    breakEvenScansPerMonth:
      perScanUsd > 0 ? Math.round(inputs.dedicatedMonthlyUsd / perScanUsd) : 0,
    savingsPct:
      inputs.dedicatedMonthlyUsd > 0
        ? round2(
            ((inputs.dedicatedMonthlyUsd - monthlyServerlessUsd) /
              inputs.dedicatedMonthlyUsd) *
              100,
          )
        : 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Ekspor CSV (format identik dengan artefak Python)                         */
/* -------------------------------------------------------------------------- */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function buildReportCsv(cases: readonly ScientificCase[]): string {
  return toCsv(
    REPORT_CSV_COLUMNS,
    cases.map((c) => REPORT_CSV_COLUMNS.map((col) => c[col])),
  );
}

export function buildSweepCsv(sweep: readonly SweepRow[]): string {
  return toCsv(
    SWEEP_CSV_COLUMNS,
    sweep.map((r) => SWEEP_CSV_COLUMNS.map((col) => r[col])),
  );
}

export type SummaryRow = readonly [string, string, unknown, string, string];

export function buildSummaryCsv(rows: readonly SummaryRow[]): string {
  return toCsv(SUMMARY_CSV_COLUMNS, rows);
}

/** Unduh sebagai UTF-8 BOM (sama seperti `utf-8-sig` di Python) agar rapi di Excel. */
export function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
