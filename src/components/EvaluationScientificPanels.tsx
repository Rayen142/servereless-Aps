import { useMemo, useState } from 'react';
import {
  AWS_PRICING,
  SWEEP_MAX_THRESHOLD,
  SWEEP_MIN_THRESHOLD,
  confusionAtThreshold,
  deriveRates,
  estimateServerlessCost,
  type ConfusionCounts,
  type CostBreakdown,
  type CostInputs,
  type DerivedRates,
  type ScientificDataset,
  type SweepRow,
} from '../lib/evaluationMetrics';
import type {
  EdgeBenchmarkResult,
  EdgeBenchmarkState,
} from '../hooks/useEdgeLatencyBenchmark';
import { ActivityIcon, AlertIcon, ClockIcon, RefreshIcon } from './icons';

const fmtPct = (v: number) => `${v.toFixed(2)}%`;
const fmtMs = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${v.toFixed(1)} ms`;
const fmtUsd = (v: number, digits = 4) => `$${v.toFixed(digits)}`;
const fmtIdr = (v: number) =>
  `Rp ${Math.round(v).toLocaleString('id-ID')}`;

/* -------------------------------------------------------------------------- */
/*  1. Kartu Metrik Akurasi Biometrik                                         */
/* -------------------------------------------------------------------------- */

interface MetricCardsProps {
  readonly cm: ConfusionCounts;
  readonly rates: DerivedRates;
  readonly threshold: number;
  readonly positives: number;
  readonly negatives: number;
}

export function BiometricMetricCards({
  cm,
  rates,
  threshold,
  positives,
  negatives,
}: MetricCardsProps) {
  const total = cm.tp + cm.tn + cm.fp + cm.fn;
  const confusion = [
    {
      key: 'tp',
      label: 'True Positive (TP)',
      tag: 'VALID MATCH',
      value: cm.tp,
      desc: `Pasien terdaftar dikenali dengan identitas benar (dari ${positives} positif).`,
      tone: 'border-emerald-200 bg-emerald-50/70 text-emerald-900',
      tagTone: 'bg-emerald-200/70 text-emerald-950',
    },
    {
      key: 'tn',
      label: 'True Negative (TN)',
      tag: 'VALID REJECT',
      value: cm.tn,
      desc: `Wajah tidak terdaftar ditolak dengan benar (dari ${negatives} negatif).`,
      tone: 'border-teal-200 bg-teal-50/60 text-teal-900',
      tagTone: 'bg-teal-200/70 text-teal-950',
    },
    {
      key: 'fp',
      label: 'False Positive (FP)',
      tag: 'FALSE ACCEPT',
      value: cm.fp,
      desc: 'Impostor lolos atau pasien dikenali sebagai orang lain.',
      tone:
        cm.fp > 0
          ? 'border-rose-200 bg-rose-50/70 text-rose-900'
          : 'border-neutral-200 bg-neutral-50 text-neutral-800',
      tagTone: cm.fp > 0 ? 'bg-rose-200/70 text-rose-950' : 'bg-neutral-200 text-neutral-700',
    },
    {
      key: 'fn',
      label: 'False Negative (FN)',
      tag: 'FALSE REJECT',
      value: cm.fn,
      desc: 'Pasien terdaftar gagal dikenali pada ambang ini.',
      tone:
        cm.fn > 0
          ? 'border-amber-200 bg-amber-50/70 text-amber-900'
          : 'border-neutral-200 bg-neutral-50 text-neutral-800',
      tagTone: cm.fn > 0 ? 'bg-amber-200/70 text-amber-950' : 'bg-neutral-200 text-neutral-700',
    },
  ];

  const rateCards = [
    {
      key: 'far',
      label: 'FAR (False Acceptance Rate)',
      value: rates.far,
      formula: `FP / (FP + TN) = ${cm.fp} / ${cm.fp + cm.tn}`,
      tone: 'text-rose-700',
    },
    {
      key: 'frr',
      label: 'FRR (False Rejection Rate)',
      value: rates.frr,
      formula: `FN / (FN + TP) = ${cm.fn} / ${cm.fn + cm.tp}`,
      tone: 'text-amber-700',
    },
    {
      key: 'acc',
      label: 'Overall Accuracy',
      value: rates.accuracy,
      formula: `(TP + TN) / N = ${cm.tp + cm.tn} / ${total}`,
      tone: 'text-emerald-700',
    },
  ];

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Metrik Akurasi Biometrik (Confusion Matrix)
          </h3>
          <p className="text-xs text-neutral-500">
            Ambang operasional {threshold}% · {positives} citra test_positive vs{' '}
            {negatives} citra test_negative terhadap koleksi enrolled/
          </p>
        </div>
        <ActivityIcon width={16} height={16} className="text-neutral-400" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {confusion.map((c) => (
          <div key={c.key} className={`rounded-xl border p-4 ${c.tone}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">{c.label}</span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${c.tagTone}`}
              >
                {c.tag}
              </span>
            </div>
            <p className="mt-2 font-mono text-3xl font-bold">{c.value}</p>
            <p className="mt-1 text-[11px] opacity-80">{c.desc}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {rateCards.map((r) => (
          <div
            key={r.key}
            className="rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-4"
          >
            <span className="text-[11px] font-medium text-neutral-500">{r.label}</span>
            <p className={`mt-1 font-mono text-2xl font-bold ${r.tone}`}>
              {fmtPct(r.value)}
            </p>
            <span className="mt-1 block font-mono text-[10px] text-neutral-500">
              {r.formula}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        {(
          [
            ['Precision', rates.precision, 'TP/(TP+FP)'],
            ['Recall', rates.recall, 'TP/(TP+FN)'],
            ['F1-Score', rates.f1Score, '2PR/(P+R)'],
          ] as const
        ).map(([label, v, f]) => (
          <div
            key={label}
            className="flex items-center justify-between rounded-lg border border-neutral-100 bg-white px-3 py-2"
          >
            <span className="text-neutral-500">
              {label} <span className="font-mono text-[10px] text-neutral-400">{f}</span>
            </span>
            <strong className="font-mono text-neutral-900">{fmtPct(v)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Simulasi Threshold Sensitivity (FAR vs FRR)                             */
/* -------------------------------------------------------------------------- */

interface ThresholdPanelProps {
  readonly dataset: ScientificDataset;
  readonly sweep: readonly SweepRow[];
  readonly eer: SweepRow | null;
  readonly value: number;
  readonly onChange: (v: number) => void;
}

const CHART_W = 520;
const CHART_H = 200;
const PAD = { l: 36, r: 12, t: 12, b: 26 };

export function ThresholdSensitivityPanel({
  dataset,
  sweep,
  eer,
  value,
  onChange,
}: ThresholdPanelProps) {
  const cm = useMemo(
    () => confusionAtThreshold(dataset.cases, value),
    [dataset.cases, value],
  );
  const rates = deriveRates(cm);

  const x = (t: number) =>
    PAD.l +
    ((t - SWEEP_MIN_THRESHOLD) / (SWEEP_MAX_THRESHOLD - SWEEP_MIN_THRESHOLD)) *
      (CHART_W - PAD.l - PAD.r);
  const yMax = Math.max(
    20,
    Math.ceil(Math.max(...sweep.map((r) => Math.max(r.far_pct, r.frr_pct)), 0) / 10) * 10,
  );
  const y = (pct: number) =>
    CHART_H - PAD.b - (pct / yMax) * (CHART_H - PAD.t - PAD.b);
  const stepPath = (key: 'far_pct' | 'frr_pct') =>
    sweep
      .map((r, i) =>
        i === 0
          ? `M${x(r.threshold)},${y(r[key])}`
          : `H${x(r.threshold)} V${y(r[key])}`,
      )
      .join(' ');

  const negatives = dataset.cases.filter((c) => c.type !== 'POSITIVE');
  const maxImpostor = negatives.length
    ? Math.max(...negatives.map((c) => c.best_score))
    : null;
  const positives = dataset.cases.filter((c) => c.type === 'POSITIVE');
  const minGenuine = positives.length
    ? Math.min(...positives.map((c) => c.best_score))
    : null;

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Simulasi Threshold Sensitivity (FAR vs FRR)
          </h3>
          <p className="text-xs text-neutral-500">
            Klasifikasi ulang skor kemiripan terbaik tiap sampel pada ambang{' '}
            {SWEEP_MIN_THRESHOLD}%–{SWEEP_MAX_THRESHOLD}%
          </p>
        </div>
        {eer && (
          <span className="rounded-full bg-violet-50 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-violet-700">
            EER ≈ {fmtPct((eer.far_pct + eer.frr_pct) / 2)} @ {eer.threshold}%
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="font-mono text-[11px] text-neutral-400">
          {SWEEP_MIN_THRESHOLD}%
        </span>
        <input
          id="threshold-sensitivity-slider"
          type="range"
          min={SWEEP_MIN_THRESHOLD}
          max={SWEEP_MAX_THRESHOLD}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Ambang kemiripan (threshold)"
          className="h-2 flex-1 cursor-pointer accent-neutral-900"
        />
        <span className="font-mono text-[11px] text-neutral-400">
          {SWEEP_MAX_THRESHOLD}%
        </span>
        <span className="min-w-[4.5rem] rounded-full bg-neutral-900 px-3 py-1 text-center font-mono text-xs font-semibold text-white">
          {value}%
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
        {(
          [
            ['TP', cm.tp, 'text-emerald-700'],
            ['TN', cm.tn, 'text-teal-700'],
            ['FP', cm.fp, 'text-rose-700'],
            ['FN', cm.fn, 'text-amber-700'],
            ['FAR', fmtPct(rates.far), 'text-rose-700'],
            ['FRR', fmtPct(rates.frr), 'text-amber-700'],
            ['Akurasi', fmtPct(rates.accuracy), 'text-emerald-700'],
          ] as const
        ).map(([label, v, tone]) => (
          <div
            key={label}
            className="rounded-lg border border-neutral-100 bg-neutral-50/70 px-2.5 py-2 text-center transition-colors"
          >
            <span className="block text-[10px] font-medium text-neutral-500">{label}</span>
            <strong className={`font-mono text-sm ${tone}`}>{v}</strong>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-neutral-100 bg-neutral-50/50 p-2">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Kurva FAR dan FRR terhadap threshold"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={CHART_W - PAD.r}
                y1={y(yMax * f)}
                y2={y(yMax * f)}
                stroke="#e5e5e5"
                strokeDasharray="3 3"
              />
              <text
                x={PAD.l - 6}
                y={y(yMax * f) + 3}
                textAnchor="end"
                fontSize="9"
                fill="#a3a3a3"
              >
                {Math.round(yMax * f)}%
              </text>
            </g>
          ))}
          {sweep
            .filter((r) => r.threshold % 5 === 0 || r.threshold === SWEEP_MAX_THRESHOLD)
            .map((r) => (
              <text
                key={r.threshold}
                x={x(r.threshold)}
                y={CHART_H - 8}
                textAnchor="middle"
                fontSize="9"
                fill="#a3a3a3"
              >
                {r.threshold}%
              </text>
            ))}
          <line
            x1={x(value)}
            x2={x(value)}
            y1={PAD.t}
            y2={CHART_H - PAD.b}
            stroke="#171717"
            strokeWidth="1.25"
            style={{ transition: 'all 150ms ease-out' }}
          />
          {eer && (
            <circle
              cx={x(eer.threshold)}
              cy={y((eer.far_pct + eer.frr_pct) / 2)}
              r="4"
              fill="#7c3aed"
            />
          )}
          <path d={stepPath('frr_pct')} fill="none" stroke="#d97706" strokeWidth="2" />
          <path d={stepPath('far_pct')} fill="none" stroke="#e11d48" strokeWidth="2" />
        </svg>
        <div className="flex flex-wrap items-center gap-4 px-2 pb-1 text-[11px] text-neutral-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-rose-600" /> FAR
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-amber-600" /> FRR
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-violet-600" /> EER
          </span>
          {maxImpostor !== null && (
            <span className="ml-auto font-mono text-[10px] text-neutral-500">
              Skor impostor maks: {maxImpostor.toFixed(2)}% · Skor genuine min:{' '}
              {minGenuine?.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {negatives.length > 0 && negatives.length < 20 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-neutral-500">
          <AlertIcon width={12} height={12} className="mt-0.5 shrink-0 text-amber-500" />
          Hanya {negatives.length} sampel negatif — resolusi FAR{' '}
          {(100 / negatives.length).toFixed(1)}% per sampel. Tambahkan citra
          test_negative untuk estimasi FAR yang lebih stabil.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  3. Breakdown Latensi End-to-End                                           */
/* -------------------------------------------------------------------------- */

interface LatencyPanelProps {
  readonly dataset: ScientificDataset;
  readonly edge: EdgeBenchmarkResult | null;
  readonly edgeState: EdgeBenchmarkState;
  readonly edgeImageCount: number;
  readonly onRunEdge: () => void;
  readonly network: NetworkEstimate;
  readonly onNetworkChange: (n: NetworkEstimate) => void;
}

export interface NetworkEstimate {
  readonly uplinkMbps: number;
  readonly rttMs: number;
}

export function estimateNetworkMs(payloadKb: number | null, n: NetworkEstimate) {
  if (payloadKb === null || n.uplinkMbps <= 0) return null;
  return n.rttMs + (payloadKb * 8.192) / n.uplinkMbps;
}

export function LatencyBreakdownPanel({
  dataset,
  edge,
  edgeState,
  edgeImageCount,
  onRunEdge,
  network,
  onNetworkChange,
}: LatencyPanelProps) {
  const lat = dataset.latency;
  const networkEstimated = !lat.networkMeasured;
  const networkMs = lat.networkMeasured
    ? lat.networkAvgMs
    : estimateNetworkMs(dataset.avgPayloadKb, network);
  const cloudMs = lat.warmAvgMs ?? lat.cloudAvgMs;
  const edgeMs = edge?.avgTotalMs ?? null;

  const segments = [
    { key: 'edge', label: 'a) Edge', ms: edgeMs, color: 'bg-sky-500' },
    { key: 'net', label: 'b) Network', ms: networkMs, color: 'bg-violet-500' },
    { key: 'cloud', label: 'c) Cloud', ms: cloudMs, color: 'bg-emerald-500' },
  ];
  const known = segments.filter((s) => s.ms !== null) as {
    key: string;
    label: string;
    ms: number;
    color: string;
  }[];
  const totalKnown = known.reduce((s, k) => s + k.ms, 0);

  const isLocal = dataset.mode !== 'live-api';
  const running = edgeState.status === 'running';

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Breakdown Latensi End-to-End
          </h3>
          <p className="text-xs text-neutral-500">
            Rata-rata (ms) per tahap: Edge → Network → Cloud (warm)
          </p>
        </div>
        <ClockIcon width={16} height={16} className="text-neutral-400" />
      </div>

      {/* Stacked bar */}
      <div className="mt-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100">
          {known.map((s) => (
            <div
              key={s.key}
              className={`${s.color} transition-all duration-500`}
              style={{ width: `${totalKnown ? (s.ms / totalKnown) * 100 : 0}%` }}
              title={`${s.label}: ${s.ms.toFixed(1)} ms`}
            />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-500">
          <div className="flex flex-wrap gap-3">
            {segments.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${s.color}`} />
                {s.label}: <strong className="font-mono text-neutral-800">{fmtMs(s.ms)}</strong>
              </span>
            ))}
          </div>
          <span className="font-mono font-semibold text-neutral-900">
            Σ {totalKnown.toFixed(1)} ms
            {known.length < 3 && ' (parsial)'}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {/* a) Edge */}
        <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sky-900">a) Client-side Edge Detection</span>
            <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-800">
              {edge ? 'TERUKUR' : 'BELUM'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-sky-800/80">
            BlazeFace estimateFaces + validateFaces (spasial)
          </p>
          <dl className="mt-2 space-y-1 font-mono text-[11px]">
            <Row k="Rata-rata total" v={fmtMs(edge?.avgTotalMs)} strong />
            <Row k="· Deteksi BlazeFace" v={fmtMs(edge?.avgDetectMs)} />
            <Row k="· Validasi spasial" v={fmtMs(edge?.avgValidateMs)} />
            <Row k="P95" v={fmtMs(edge?.p95TotalMs)} />
            <Row k="Muat model (cold)" v={fmtMs(edge?.modelLoadMs)} />
            <Row k="Inferensi pertama" v={fmtMs(edge?.firstInferenceMs)} />
          </dl>
          <button
            id="run-edge-benchmark"
            type="button"
            onClick={onRunEdge}
            disabled={running}
            className="mt-3 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-full bg-sky-700 px-3 text-[11px] font-medium text-white transition hover:bg-sky-800 disabled:opacity-60"
          >
            <RefreshIcon width={12} height={12} className={running ? 'animate-spin' : ''} />
            {running
              ? `Mengukur ${edgeState.progress}/${edgeState.total}…`
              : edge
                ? `Ukur Ulang (${edgeImageCount} citra)`
                : `Jalankan Benchmark (${edgeImageCount} citra)`}
          </button>
          {edgeState.status === 'error' && (
            <p className="mt-1.5 text-[10px] text-rose-700">{edgeState.message}</p>
          )}
          {edge && (
            <p className="mt-1.5 text-[10px] text-sky-800/70">
              Backend {edge.backend} ·{' '}
              {new Date(edge.measuredAt).toLocaleString('id-ID')}
            </p>
          )}
        </div>

        {/* b) Network */}
        <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-violet-900">b) Network &amp; Payload Transit</span>
            <span className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] text-violet-800">
              {networkEstimated ? 'ESTIMASI' : 'TERUKUR'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-violet-800/80">
            HTTPS POST JSON base64 → API Gateway
          </p>
          <dl className="mt-2 space-y-1 font-mono text-[11px]">
            <Row k="Rata-rata transit" v={fmtMs(networkMs)} strong />
            <Row
              k="Payload rata-rata"
              v={dataset.avgPayloadKb !== null ? `${dataset.avgPayloadKb.toFixed(1)} KB` : '—'}
            />
          </dl>
          {networkEstimated && (
            <div className="mt-2 space-y-1.5">
              <label className="flex items-center justify-between gap-2 text-[11px] text-violet-900">
                Uplink (Mbps)
                <input
                  id="network-uplink-mbps"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={network.uplinkMbps}
                  onChange={(e) =>
                    onNetworkChange({ ...network, uplinkMbps: Number(e.target.value) })
                  }
                  className="h-6 w-20 rounded border border-violet-200 bg-white px-1.5 text-right font-mono text-[11px]"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[11px] text-violet-900">
                RTT (ms)
                <input
                  id="network-rtt-ms"
                  type="number"
                  min={0}
                  step={5}
                  value={network.rttMs}
                  onChange={(e) =>
                    onNetworkChange({ ...network, rttMs: Number(e.target.value) })
                  }
                  className="h-6 w-20 rounded border border-violet-200 bg-white px-1.5 text-right font-mono text-[11px]"
                />
              </label>
              <p className="text-[10px] leading-snug text-violet-800/70">
                Model: RTT + payload × 8 / uplink. Jalankan skrip dengan --api-url dan
                field serverTiming pada handler untuk pengukuran aktual.
              </p>
            </div>
          )}
        </div>

        {/* c) Cloud */}
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-900">c) Cloud Biometric Matching</span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800">
              {isLocal ? 'SIMULASI LOKAL' : 'AWS'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-emerald-800/80">
            Lambda + Rekognition SearchFacesByImage
          </p>
          <dl className="mt-2 space-y-1 font-mono text-[11px]">
            <Row k="Rata-rata (semua)" v={fmtMs(lat.cloudAvgMs)} strong />
            <Row k="SearchFacesByImage" v={fmtMs(lat.rekognitionAvgMs)} />
            <Row k="P50 / P95" v={`${fmtMs(lat.totalP50Ms)} / ${fmtMs(lat.totalP95Ms)}`} />
          </dl>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-200 bg-white p-2 text-center">
              <span className="block text-[10px] text-neutral-500">
                Cold Start ({lat.coldSamples})
              </span>
              <strong className="font-mono text-sm text-sky-800">{fmtMs(lat.coldStartMs)}</strong>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-white p-2 text-center">
              <span className="block text-[10px] text-neutral-500">
                Warm Start ({lat.warmSamples})
              </span>
              <strong className="font-mono text-sm text-emerald-800">{fmtMs(lat.warmAvgMs)}</strong>
            </div>
          </div>
          {lat.coldStartMs !== null && lat.warmAvgMs !== null && lat.warmAvgMs > 0 && (
            <p className="mt-1.5 text-[10px] text-emerald-800/80">
              Cold start {(lat.coldStartMs / lat.warmAvgMs).toFixed(1)}× lebih lambat
              {lat.coldInitMs !== null && ` · fase INIT ${lat.coldInitMs.toFixed(1)} ms`}
            </p>
          )}
          {isLocal && (
            <p className="mt-1.5 text-[10px] leading-snug text-amber-700">
              Angka ini dari lambda_handler lokal dengan mock Rekognition — bukan latensi AWS.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-neutral-500">{k}</dt>
      <dd className={strong ? 'font-bold text-neutral-900' : 'text-neutral-700'}>{v}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  4. Analisis Efisiensi Biaya Serverless                                    */
/* -------------------------------------------------------------------------- */

interface CostCardProps {
  readonly inputs: CostInputs;
  readonly onChange: (i: CostInputs) => void;
  readonly usdToIdr: number;
  readonly onRateChange: (v: number) => void;
  readonly durationSource: string;
}

export function useCostBreakdown(inputs: CostInputs): CostBreakdown {
  return useMemo(() => estimateServerlessCost(inputs), [inputs]);
}

export function ServerlessCostCard({
  inputs,
  onChange,
  usdToIdr,
  onRateChange,
  durationSource,
}: CostCardProps) {
  const cost = useCostBreakdown(inputs);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const cheaper = cost.monthlyServerlessUsd < cost.monthlyDedicatedUsd;
  const maxBar = Math.max(cost.monthlyServerlessUsd, cost.monthlyDedicatedUsd, 1e-9);

  const num = (key: keyof CostInputs, label: string, step: number, id: string) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-neutral-600">
      {label}
      <input
        id={id}
        type="number"
        min={0}
        step={step}
        value={inputs[key] as number}
        onChange={(e) => onChange({ ...inputs, [key]: Number(e.target.value) })}
        className="h-6 w-24 rounded border border-neutral-200 bg-white px-1.5 text-right font-mono text-[11px] outline-none focus:border-neutral-900"
      />
    </label>
  );

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Analisis Efisiensi Biaya Serverless
          </h3>
          <p className="text-xs text-neutral-500">
            Estimasi per 1.000 pemindaian (harga publik AWS us-east-1, tanpa Free Tier)
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
            cheaper ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {cheaper
            ? `Hemat ${cost.savingsPct.toFixed(1)}% vs dedicated`
            : `Lebih mahal ${Math.abs(cost.savingsPct).toFixed(1)}%`}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <div className="overflow-hidden rounded-xl border border-neutral-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Komponen</th>
                  <th className="px-3 py-2">Dasar Hitung</th>
                  <th className="px-3 py-2 text-right">USD / 1.000</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {cost.lines.map((l) => (
                  <tr key={l.key}>
                    <td className="px-3 py-1.5 font-medium text-neutral-800">{l.label}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-neutral-500">
                      {l.formula}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-neutral-900">
                      {fmtUsd(l.per1000Usd)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-neutral-900 text-white">
                  <td className="px-3 py-2 font-semibold" colSpan={2}>
                    Total per 1.000 pemindaian
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {fmtUsd(cost.per1000Usd)}
                    <span className="block text-[10px] font-normal text-neutral-300">
                      ≈ {fmtIdr(cost.per1000Usd * usdToIdr)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-2 text-[11px]">
            {(
              [
                ['Serverless (pay-per-use)', cost.monthlyServerlessUsd, 'bg-emerald-500'],
                ['Dedicated server (flat)', cost.monthlyDedicatedUsd, 'bg-neutral-400'],
              ] as const
            ).map(([label, v, color]) => (
              <div key={label}>
                <div className="flex justify-between text-neutral-600">
                  <span>
                    {label} — {inputs.monthlyScans.toLocaleString('id-ID')} scan/bulan
                  </span>
                  <span className="font-mono font-semibold text-neutral-900">
                    {fmtUsd(v, 2)} · {fmtIdr(v * usdToIdr)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full ${color} transition-all duration-500`}
                    style={{ width: `${(v / maxBar) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-neutral-600">
              Titik impas (break-even):{' '}
              <strong className="font-mono text-neutral-900">
                {cost.breakEvenScansPerMonth.toLocaleString('id-ID')} scan/bulan
              </strong>{' '}
              — di bawah volume ini arsitektur serverless lebih murah. Biaya dominan:
              Rekognition ({((cost.lines.find((l) => l.key === 'rekognition')?.per1000Usd ?? 0) /
                (cost.per1000Usd || 1) * 100).toFixed(1)}%).
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-neutral-100 bg-neutral-50/60 p-3.5">
          <p className="text-[11px] font-semibold text-neutral-800">Parameter Simulasi</p>
          {num('monthlyScans', 'Volume scan / bulan', 100, 'cost-monthly-scans')}
          {num('lambdaDurationMs', 'Durasi Lambda (ms)', 10, 'cost-lambda-duration')}
          {num('lambdaMemoryMb', 'Memori Lambda (MB)', 128, 'cost-lambda-memory')}
          {num('writesPerScan', 'DynamoDB WRU / scan', 1, 'cost-wru')}
          {num('readsPerScan', 'DynamoDB RRU / scan', 1, 'cost-rru')}
          {num('dedicatedMonthlyUsd', 'Dedicated server (USD/bln)', 1, 'cost-dedicated')}
          <label className="flex items-center justify-between gap-2 text-[11px] text-neutral-600">
            Kurs (Rp / USD)
            <input
              id="cost-usd-idr"
              type="number"
              min={0}
              step={50}
              value={usdToIdr}
              onChange={(e) => onRateChange(Number(e.target.value))}
              className="h-6 w-24 rounded border border-neutral-200 bg-white px-1.5 text-right font-mono text-[11px] outline-none focus:border-neutral-900"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-neutral-600">
            <input
              id="cost-include-apigw"
              type="checkbox"
              checked={inputs.includeApiGateway}
              onChange={(e) => onChange({ ...inputs, includeApiGateway: e.target.checked })}
              className="accent-neutral-900"
            />
            Sertakan API Gateway (REST)
          </label>
          <p className="text-[10px] leading-snug text-neutral-500">
            Durasi Lambda: {durationSource}. Memori 1024 MB sesuai backend/template.yaml.
          </p>
          <button
            type="button"
            onClick={() => setShowAssumptions((s) => !s)}
            className="text-[10px] font-medium text-neutral-700 underline underline-offset-2"
          >
            {showAssumptions ? 'Sembunyikan' : 'Lihat'} asumsi harga
          </button>
          {showAssumptions && (
            <ul className="space-y-0.5 font-mono text-[10px] text-neutral-500">
              <li>Lambda: ${AWS_PRICING.lambdaPerMillionRequests}/1jt req, ${AWS_PRICING.lambdaPerGbSecond}/GB-dtk</li>
              <li>Rekognition: ${AWS_PRICING.rekognitionPerImage}/gambar (1jt pertama)</li>
              <li>DynamoDB: ${AWS_PRICING.dynamoPerMillionWru}/1jt WRU, ${AWS_PRICING.dynamoPerMillionRru}/1jt RRU</li>
              <li>API Gateway REST: ${AWS_PRICING.apiGatewayPerMillion}/1jt</li>
              <li>Dedicated: EC2 t3.medium $0.0416/jam × 730 jam</li>
              <li>Tidak termasuk: Free Tier, transfer data, biaya SDM/operasional server.</li>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
