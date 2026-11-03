export const POLIKLINIK_LIST = [
  'Poli Umum',
  'Poli Penyakit Dalam',
  'Poli Jantung',
  'Poli Paru & Pernapasan',
  'Poli Saraf (Neurologi)',
  'Poli Mata',
  'Poli Gigi & Mulut',
  'Poli THT',
  'Poli Kulit & Kelamin',
  'Poli Ortopedi',
] as const;

export type QueueServingStatus = 'MENUNGGU' | 'DIPANGGIL' | 'SELESAI';
export type QueueControlAction = 'call_next' | 'recall' | 'complete' | 'reset';
export type QueueApiAction = 'NEXT' | 'FINISH' | 'RECALL' | 'RESET';

export const QUEUE_API_ACTION: Readonly<Record<QueueControlAction, QueueApiAction>> = {
  call_next: 'NEXT',
  complete: 'FINISH',
  recall: 'RECALL',
  reset: 'RESET',
};

/**
 * Membaca base URL secara ketat dari `import.meta.env.VITE_API_URL` (.env.local)
 * agar pengujian dapat berpindah mulus antara Local IaaS (`http://localhost:8000`)
 * dan AWS API Gateway Serverless (`https://<id>.execute-api.<region>.amazonaws.com/v1/attendance/verify`).
 */
export function getConfiguredApiBaseUrl(): string {
  const rawBase = String(import.meta.env.VITE_API_URL ?? '').trim();
  return rawBase || '(VITE_API_URL belum diatur di .env.local)';
}

export function resolveApiEndpoint(
  route:
    | 'verify'
    | 'enroll'
    | 'lookup'
    | 'queue'
    | 'queue/action'
    | 'analytics'
    | 'faces'
    | 'logs',
): string {
  const rawBase = String(import.meta.env.VITE_API_URL ?? '').trim();
  if (!rawBase) {
    return '';
  }
  const trimmed = rawBase.replace(/\/+$/, '');
  if (/\/attendance\/verify$/i.test(trimmed)) {
    return trimmed.replace(/\/verify$/i, `/${route}`);
  }
  if (/\/v1\/attendance$/i.test(trimmed)) {
    return `${trimmed}/${route}`;
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/attendance/${route}`;
  }
  return `${trimmed}/v1/attendance/${route}`;
}

export interface PoliQueueSnapshot {
  readonly poliklinik: string;
  readonly prefix: string;
  readonly dokter: string;
  readonly room: string;
  readonly currentServingSequence: number;
  readonly currentServingNumber: string;
  readonly servingStatus?: QueueServingStatus;
  readonly currentPatientName?: string;
  readonly currentPatientNoRm?: string;
  readonly nextQueueNumber?: string | null;
  readonly nextPatientName?: string | null;
  readonly latestQueueSequence: number;
  readonly latestQueueNumber: string;
  readonly totalWaiting: number;
  readonly estimatedWaitMinutes: number;
}

export interface EvaluationCaseResult {
  readonly caseId: string;
  readonly type: 'POSITIVE' | 'NEGATIVE' | string;
  readonly fullName: string;
  readonly expectedPersonId: string | null;
  readonly predictedPersonId: string | null;
  readonly similarity: number;
  readonly latencyMs: number;
  readonly outcome: 'TP' | 'TN' | 'FP' | 'FN';
}

export interface BiometricEvaluationReport {
  readonly evaluatedAt: string;
  readonly threshold: number;
  readonly totalCases: number;
  readonly tp: number;
  readonly tn: number;
  readonly fp: number;
  readonly fn: number;
  readonly accuracy: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1Score: number;
  readonly avgLatencyMs: number;
  readonly cachedEnrolledCount: number;
  readonly cases: readonly EvaluationCaseResult[];
}

export interface AttendanceLogRecord {
  readonly attendanceId: string;
  readonly Timestamp: string;
  readonly ID: string;
  readonly NoRM: string;
  readonly FullName: string;
  readonly Gender: string;
  readonly Poliklinik: string;
  readonly QueueNumber: string;
  readonly Status: string;
  readonly VerificationMethod?: string;
  readonly Similarity: number;
}

export interface SqliteDatabaseDiagnostics {
  readonly engine: string;
  readonly dbPath: string;
  readonly sizeKb?: number;
  readonly sizeKB?: number;
  readonly journalMode: string;
  readonly tables: {
    readonly patients: number;
    readonly attendance_logs: number;
    readonly poli_queues: number;
    readonly active_queue_slots: number;
  };
}

export interface HospitalAnalyticsData {
  readonly database?: SqliteDatabaseDiagnostics;
  readonly evaluation: BiometricEvaluationReport;
  readonly totalRegisteredPatients: number;
  readonly totalAttendanceLogs: number;
  readonly recentLogs: readonly AttendanceLogRecord[];
  readonly queues: readonly PoliQueueSnapshot[];
}

export interface PatientProfile {
  readonly personId: string;
  readonly canonicalPersonId: string;
  readonly rmNumber: string;
  readonly noRm: string;
  readonly fullName: string;
  readonly gender: 'Laki-laki' | 'Perempuan';
  readonly age: number;
  readonly nik: string;
  readonly defaultPoli: string;
  readonly poliklinik: string;
  readonly dokter: string;
  readonly linkedFaceIds: readonly string[];
}

export const ENROLLED_PATIENT_PROFILES: readonly PatientProfile[] = [
  {
    personId: 'MHS-2026-001',
    canonicalPersonId: 'MHS-2026-001',
    rmNumber: 'RM-2026-0001',
    noRm: 'RM-2026-0001',
    fullName: 'Aditya Pratama',
    gender: 'Laki-laki',
    age: 31,
    nik: '3273011405950001',
    defaultPoli: 'Poli Penyakit Dalam',
    poliklinik: 'Poli Penyakit Dalam',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    linkedFaceIds: ['MHS-2026-001'],
  },
  {
    personId: 'RM-2026-501B',
    canonicalPersonId: 'RM-2026-501B',
    rmNumber: 'RM-2026-501B',
    noRm: 'RM-2026-501B',
    fullName: 'Candra Hidayattuloh',
    gender: 'Laki-laki',
    age: 19,
    nik: '3273012304070001',
    defaultPoli: 'Poli Umum',
    poliklinik: 'Poli Umum',
    dokter: 'dr. Sinta Maharani',
    linkedFaceIds: [
      'RM-2026-501B',
      'RM-2026-58DB',
      'RM-2026-A204',
      '2702385671',
      'MHS-WEBCAM-USER',
    ],
  },
];

export const DEFAULT_POLI_QUEUES: readonly PoliQueueSnapshot[] = [
  {
    poliklinik: 'Poli Penyakit Dalam',
    prefix: 'PD',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    room: 'Lantai 2 • Ruang 201',
    currentServingSequence: 2,
    currentServingNumber: 'PD-002',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Aditya Pratama',
    currentPatientNoRm: 'RM-2026-0001',
    nextQueueNumber: 'PD-003',
    nextPatientName: 'Rizky Ramadhan',
    latestQueueSequence: 5,
    latestQueueNumber: 'PD-005',
    totalWaiting: 3,
    estimatedWaitMinutes: 24,
  },
  {
    poliklinik: 'Poli Umum',
    prefix: 'UM',
    dokter: 'dr. Sinta Maharani',
    room: 'Lantai 1 • Ruang 102',
    currentServingSequence: 4,
    currentServingNumber: 'UM-004',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Budi Santoso',
    currentPatientNoRm: 'RM-2026-0004',
    nextQueueNumber: 'UM-005',
    nextPatientName: 'Dewi Lestari',
    latestQueueSequence: 7,
    latestQueueNumber: 'UM-007',
    totalWaiting: 3,
    estimatedWaitMinutes: 24,
  },
  {
    poliklinik: 'Poli Jantung',
    prefix: 'JT',
    dokter: 'dr. Bambang Hartono, Sp.JP',
    room: 'Lantai 2 • Ruang 205',
    currentServingSequence: 1,
    currentServingNumber: 'JT-001',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Dimas Saputra',
    currentPatientNoRm: 'RM-2026-0005',
    nextQueueNumber: 'JT-002',
    nextPatientName: 'Agus Salim',
    latestQueueSequence: 3,
    latestQueueNumber: 'JT-003',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli Paru & Pernapasan',
    prefix: 'PR',
    dokter: 'dr. Faisal Rahman, Sp.P',
    room: 'Lantai 2 • Ruang 208',
    currentServingSequence: 2,
    currentServingNumber: 'PR-002',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Nabila Putri Maharani',
    currentPatientNoRm: 'RM-2026-0002',
    nextQueueNumber: 'PR-003',
    nextPatientName: 'Eko Prasetyo',
    latestQueueSequence: 4,
    latestQueueNumber: 'PR-004',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli Saraf (Neurologi)',
    prefix: 'SR',
    dokter: 'dr. Arifin Putra, Sp.N',
    room: 'Lantai 3 • Ruang 301',
    currentServingSequence: 1,
    currentServingNumber: 'SR-001',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Pasien SR-001',
    currentPatientNoRm: 'RM-2026-0001',
    nextQueueNumber: 'SR-002',
    nextPatientName: 'Pasien SR-002',
    latestQueueSequence: 3,
    latestQueueNumber: 'SR-003',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli Mata',
    prefix: 'MT',
    dokter: 'dr. Ratna Kusuma, Sp.M',
    room: 'Lantai 3 • Ruang 304',
    currentServingSequence: 3,
    currentServingNumber: 'MT-003',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Pasien MT-003',
    currentPatientNoRm: 'RM-2026-0003',
    nextQueueNumber: 'MT-004',
    nextPatientName: 'Pasien MT-004',
    latestQueueSequence: 5,
    latestQueueNumber: 'MT-005',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli Gigi & Mulut',
    prefix: 'GG',
    dokter: 'drg. Nadia Larasati',
    room: 'Lantai 1 • Ruang 108',
    currentServingSequence: 2,
    currentServingNumber: 'GG-002',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Pasien GG-002',
    currentPatientNoRm: 'RM-2026-0002',
    nextQueueNumber: 'GG-003',
    nextPatientName: 'Pasien GG-003',
    latestQueueSequence: 4,
    latestQueueNumber: 'GG-004',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli THT',
    prefix: 'TH',
    dokter: 'dr. Lukman Hakim, Sp.THT-KL',
    room: 'Lantai 3 • Ruang 306',
    currentServingSequence: 1,
    currentServingNumber: 'TH-001',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Pasien TH-001',
    currentPatientNoRm: 'RM-2026-0001',
    nextQueueNumber: 'TH-002',
    nextPatientName: 'Pasien TH-002',
    latestQueueSequence: 3,
    latestQueueNumber: 'TH-003',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli Kulit & Kelamin',
    prefix: 'KK',
    dokter: 'dr. Clara Wijaya, Sp.KK',
    room: 'Lantai 2 • Ruang 210',
    currentServingSequence: 2,
    currentServingNumber: 'KK-002',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Pasien KK-002',
    currentPatientNoRm: 'RM-2026-0002',
    nextQueueNumber: 'KK-003',
    nextPatientName: 'Pasien KK-003',
    latestQueueSequence: 4,
    latestQueueNumber: 'KK-004',
    totalWaiting: 2,
    estimatedWaitMinutes: 16,
  },
  {
    poliklinik: 'Poli Ortopedi',
    prefix: 'OR',
    dokter: 'dr. Kevin Santoso, Sp.OT',
    room: 'Lantai 1 • Ruang 112',
    currentServingSequence: 1,
    currentServingNumber: 'OR-001',
    servingStatus: 'DIPANGGIL',
    currentPatientName: 'Pasien OR-001',
    currentPatientNoRm: 'RM-2026-0001',
    nextQueueNumber: 'OR-002',
    nextPatientName: 'Pasien OR-002',
    latestQueueSequence: 2,
    latestQueueNumber: 'OR-002',
    totalWaiting: 1,
    estimatedWaitMinutes: 8,
  },
];

export interface QueueStateResponse {
  readonly success: boolean;
  readonly queue?: PoliQueueSnapshot | null;
  readonly queues: readonly PoliQueueSnapshot[];
  readonly minutesPerPatient?: number;
  readonly updatedAt?: string;
}

export interface QueueActionResponse extends QueueStateResponse {
  readonly status: 'QUEUE_ADVANCED' | 'QUEUE_UNCHANGED' | string;
  readonly action: string;
  readonly changed: boolean;
  readonly message: string;
}

export type QueueApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

const QUEUE_GET_TIMEOUT_MS = 4000;
const QUEUE_ACTION_TIMEOUT_MS = 8000;

function isQueueStateResponse(value: unknown): value is QueueStateResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { queues?: unknown }).queues)
  );
}

async function requestQueueApi(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<QueueApiResult<unknown>> {
  if (!url) {
    return {
      ok: false,
      error: 'VITE_API_URL belum dikonfigurasi pada .env.local.',
    };
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      body = null;
    }
    if (!resp.ok) {
      const serverMessage =
        typeof body === 'object' && body !== null
          ? (body as { message?: unknown }).message
          : undefined;
      return {
        ok: false,
        error:
          typeof serverMessage === 'string' && serverMessage
            ? serverMessage
            : `Endpoint antrean merespons HTTP ${resp.status}.`,
      };
    }
    return { ok: true, data: body };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? 'Endpoint antrean tidak merespons (timeout).'
        : 'Tidak dapat terhubung ke endpoint antrean.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchQueueState(): Promise<QueueApiResult<QueueStateResponse>> {
  const queueUrl = resolveApiEndpoint('queue');
  const result = await requestQueueApi(
    queueUrl,
    { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
    QUEUE_GET_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  return isQueueStateResponse(result.data)
    ? { ok: true, data: result.data }
    : { ok: false, error: 'Format respons antrean tidak valid.' };
}

export async function sendQueueAction(
  poliklinik: string,
  action: QueueControlAction,
): Promise<QueueApiResult<QueueActionResponse>> {
  const actionUrl = resolveApiEndpoint('queue/action');
  const result = await requestQueueApi(
    actionUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action: QUEUE_API_ACTION[action], poliklinik }),
    },
    QUEUE_ACTION_TIMEOUT_MS,
  );
  if (!result.ok) return result;
  if (!isQueueStateResponse(result.data)) {
    return { ok: false, error: 'Format respons aksi antrean tidak valid.' };
  }
  const data = result.data as Partial<QueueActionResponse> & QueueStateResponse;
  return {
    ok: true,
    data: {
      ...data,
      status: data.status ?? 'QUEUE_ADVANCED',
      action: data.action ?? action,
      changed: data.changed ?? true,
      message: data.message ?? '',
    },
  };
}

export async function fetchHospitalAnalytics(
  forceRefresh = false,
): Promise<HospitalAnalyticsData | null> {
  const baseAnalyticsUrl = resolveApiEndpoint('analytics');
  if (!baseAnalyticsUrl) {
    return null;
  }
  const analyticsUrl = baseAnalyticsUrl + (forceRefresh ? '?refresh=1' : '');
  try {
    const resp = await fetch(analyticsUrl);
    if (!resp.ok) {
      return null;
    }
    return (await resp.json()) as HospitalAnalyticsData;
  } catch {
    return null;
  }
}

function playHospitalChime(): Promise<void> {
  return new Promise((resolve) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) {
        resolve();
        return;
      }
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.14, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };

      playTone(587.33, now, 0.28);
      playTone(440.0, now + 0.25, 0.42);

      window.setTimeout(() => {
        void ctx.close().catch(() => undefined);
        resolve();
      }, 650);
    } catch {
      resolve();
    }
  });
}

function formatSpokenQueueNumber(queueNumber: string): string {
  const [prefix = '', digits = ''] = queueNumber.split('-');
  const spelledPrefix = prefix.split('').join(' ');
  const digitWords: Record<string, string> = {
    '0': 'kosong',
    '1': 'satu',
    '2': 'dua',
    '3': 'tiga',
    '4': 'empat',
    '5': 'lima',
    '6': 'enam',
    '7': 'tujuh',
    '8': 'delapan',
    '9': 'sembilan',
  };
  const spelledDigits = digits
    .split('')
    .map((d) => digitWords[d] ?? d)
    .join(' ');
  return `${spelledPrefix}, ${spelledDigits}`.trim();
}

export async function speakQueueCall(params: {
  readonly queueNumber: string;
  readonly patientName?: string | null;
  readonly poliklinik: string;
  readonly room: string;
}): Promise<string> {
  const spokenNumber = formatSpokenQueueNumber(params.queueNumber);
  const cleanRoom = params.room.replace(/•/g, ',');
  const hasRealName =
    params.patientName &&
    !params.patientName.toLowerCase().startsWith('pasien ');

  const displaySentence = hasRealName
    ? `Nomor antrean ${params.queueNumber}, atas nama ${params.patientName}, silakan menuju ${params.poliklinik}, ${cleanRoom}.`
    : `Nomor antrean ${params.queueNumber}, silakan menuju ${params.poliklinik}, ${cleanRoom}.`;

  const spokenSentence = hasRealName
    ? `Nomor antrean ${spokenNumber}, atas nama ${params.patientName}, silakan menuju ${params.poliklinik}, ${cleanRoom}.`
    : `Nomor antrean ${spokenNumber}, silakan menuju ${params.poliklinik}, ${cleanRoom}.`;

  await playHospitalChime();

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(spokenSentence);
      utterance.lang = 'id-ID';
      utterance.rate = 0.94;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const idVoice = voices.find(
        (v) =>
          v.lang.toLowerCase().includes('id-id') ||
          v.lang.toLowerCase().includes('id_') ||
          v.name.toLowerCase().includes('indonesia'),
      );
      if (idVoice) {
        utterance.voice = idVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch {
      // Abaikan jika browser memblokir sintesis suara
    }
  }

  return displaySentence;
}
