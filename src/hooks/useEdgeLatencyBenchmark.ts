import { useCallback, useEffect, useRef, useState } from 'react';
import type { BlazeFaceModel } from '@tensorflow-models/blazeface';
import { validateFaces, type FaceStatus } from '../lib/faceValidation';
import { mean, percentile } from '../lib/evaluationMetrics';

/**
 * Benchmark latensi sisi klien (Edge): BlazeFace `estimateFaces` + validasi spasial
 * `validateFaces`, dijalankan di peramban pada citra uji yang sama dengan skrip Python
 * (dataset/images/test_positive & test_negative). Hasil disimpan di localStorage agar
 * dapat diekspor ulang tanpa menjalankan benchmark lagi.
 */

const TEST_IMAGE_URLS = import.meta.glob<string>(
  [
    '../../dataset/images/test_positive/*.jpg',
    '../../dataset/images/test_negative/*.jpg',
  ],
  { query: '?url', import: 'default' },
);

const STORAGE_KEY = 'simrs.edgeBenchmark.v1';

export interface EdgeSample {
  readonly file: string;
  readonly detectMs: number;
  readonly validateMs: number;
  readonly totalMs: number;
  readonly status: FaceStatus;
}

export interface EdgeBenchmarkResult {
  readonly measuredAt: string;
  readonly userAgent: string;
  readonly backend: string;
  readonly modelLoadMs: number;
  readonly firstInferenceMs: number;
  readonly avgDetectMs: number;
  readonly avgValidateMs: number;
  readonly avgTotalMs: number;
  readonly p95TotalMs: number;
  readonly samples: readonly EdgeSample[];
}

export type EdgeBenchmarkState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly progress: number; readonly total: number }
  | { readonly status: 'error'; readonly message: string };

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat ${url}`));
    img.src = url;
  });

function readStored(): EdgeBenchmarkResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EdgeBenchmarkResult) : null;
  } catch {
    return null;
  }
}

export function useEdgeLatencyBenchmark() {
  const [result, setResult] = useState<EdgeBenchmarkResult | null>(() => readStored());
  const [state, setState] = useState<EdgeBenchmarkState>({ status: 'idle' });
  const modelRef = useRef<BlazeFaceModel | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      modelRef.current?.dispose();
      modelRef.current = null;
    };
  }, []);

  const run = useCallback(async () => {
    const entries = Object.entries(TEST_IMAGE_URLS).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      setState({ status: 'error', message: 'Citra uji dataset tidak ditemukan.' });
      return;
    }
    setState({ status: 'running', progress: 0, total: entries.length });

    try {
      // Cold: muat TF.js + bobot model (konfigurasi sama dengan useBlazeFaceModel)
      const tLoad = performance.now();
      const [blazeface, tf] = await Promise.all([
        import('@tensorflow-models/blazeface'),
        import('@tensorflow/tfjs-core'),
      ]);
      await import('@tensorflow/tfjs-backend-webgl');
      await tf.setBackend('webgl');
      await tf.ready();
      modelRef.current?.dispose();
      const model = await blazeface.load({ maxFaces: 1, scoreThreshold: 0.5 });
      modelRef.current = model;
      const modelLoadMs = performance.now() - tLoad;

      const urls = await Promise.all(entries.map(([, loader]) => loader()));
      const images = await Promise.all(urls.map(loadImage));

      // Inferensi pertama memicu kompilasi shader WebGL — dilaporkan terpisah
      const tFirst = performance.now();
      await model.estimateFaces(images[0], false, false, true);
      const firstInferenceMs = performance.now() - tFirst;

      const samples: EdgeSample[] = [];
      for (let i = 0; i < images.length; i += 1) {
        if (!aliveRef.current) return;
        const img = images[i];
        const t0 = performance.now();
        const faces = await model.estimateFaces(img, false, false, true);
        const t1 = performance.now();
        const assessment = validateFaces(faces, {
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        const t2 = performance.now();
        samples.push({
          file: entries[i][0].split('/').pop() ?? entries[i][0],
          detectMs: t1 - t0,
          validateMs: t2 - t1,
          totalMs: t2 - t0,
          status: assessment.status,
        });
        setState({ status: 'running', progress: i + 1, total: images.length });
      }

      const totals = samples.map((s) => s.totalMs);
      const next: EdgeBenchmarkResult = {
        measuredAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        backend: tf.getBackend(),
        modelLoadMs: Math.round(modelLoadMs * 100) / 100,
        firstInferenceMs: Math.round(firstInferenceMs * 100) / 100,
        avgDetectMs: mean(samples.map((s) => s.detectMs)) ?? 0,
        avgValidateMs: mean(samples.map((s) => s.validateMs)) ?? 0,
        avgTotalMs: mean(totals) ?? 0,
        p95TotalMs: percentile(totals, 95) ?? 0,
        samples,
      };
      if (!aliveRef.current) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* kuota penuh — hasil tetap tampil di sesi ini */
      }
      setResult(next);
      setState({ status: 'idle' });
    } catch (error) {
      console.error('Benchmark edge gagal:', error);
      if (aliveRef.current) {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Benchmark gagal dijalankan.',
        });
      }
    }
  }, []);

  return { result, state, run, imageCount: Object.keys(TEST_IMAGE_URLS).length };
}
