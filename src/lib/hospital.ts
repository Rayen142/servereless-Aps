import type { MedicalHistoryItem } from '../hooks/useAttendanceVerification';

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
  readonly Allergies: string;
  readonly Poliklinik: string;
  readonly QueueNumber: string;
  readonly Status: string;
  readonly VerificationMethod?: string;
  readonly Similarity: number;
}

export interface HospitalAnalyticsData {
  readonly evaluation: BiometricEvaluationReport;
  readonly totalRegisteredPatients: number;
  readonly totalAttendanceLogs: number;
  readonly recentLogs: readonly AttendanceLogRecord[];
  readonly queues: readonly PoliQueueSnapshot[];
}

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
    currentPatientNoRm: 'RM-2026-001',
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
    currentPatientNoRm: 'RM-2026-004',
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
    currentPatientNoRm: 'RM-2026-005',
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
    currentPatientNoRm: 'RM-2026-002',
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
    currentPatientNoRm: 'RM-2026-001',
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
    currentPatientNoRm: 'RM-2026-003',
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
    currentPatientNoRm: 'RM-2026-002',
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
    currentPatientNoRm: 'RM-2026-001',
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
    currentPatientNoRm: 'RM-2026-002',
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
    currentPatientNoRm: 'RM-2026-001',
    nextQueueNumber: 'OR-002',
    nextPatientName: 'Pasien OR-002',
    latestQueueSequence: 2,
    latestQueueNumber: 'OR-002',
    totalWaiting: 1,
    estimatedWaitMinutes: 8,
  },
];

export const hasRealAllergy = (allergies: string): boolean => {
  const norm = allergies.trim().toLowerCase();
  return norm !== '' && norm !== '-' && !norm.includes('tidak ada');
};

export async function fetchPoliQueues(): Promise<readonly PoliQueueSnapshot[]> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    return DEFAULT_POLI_QUEUES;
  }
  const queuesUrl = apiUrl.replace(/\/verify\/?$/, '/queues');
  try {
    const resp = await fetch(queuesUrl);
    if (!resp.ok) {
      return DEFAULT_POLI_QUEUES;
    }
    const data = (await resp.json()) as { queues?: PoliQueueSnapshot[] };
    return Array.isArray(data.queues) && data.queues.length > 0
      ? data.queues
      : DEFAULT_POLI_QUEUES;
  } catch {
    return DEFAULT_POLI_QUEUES;
  }
}

export async function fetchHospitalAnalytics(
  forceRefresh = false,
): Promise<HospitalAnalyticsData | null> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    return null;
  }
  const analyticsUrl =
    apiUrl.replace(/\/verify\/?$/, '/analytics') +
    (forceRefresh ? '?refresh=1' : '');
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

export async function advancePoliQueue(
  poliklinik: string,
  queueAction: QueueControlAction = 'call_next',
): Promise<{
  readonly queue?: PoliQueueSnapshot;
  readonly queues: readonly PoliQueueSnapshot[];
} | null> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    return null;
  }
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'advance_queue',
        poliklinik,
        queueAction,
      }),
    });
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as {
      queue?: PoliQueueSnapshot;
      queues?: PoliQueueSnapshot[];
    };
    return Array.isArray(data.queues)
      ? { queue: data.queue, queues: data.queues }
      : null;
  } catch {
    return null;
  }
}

export interface AddMedicalRecordInput {
  readonly personId: string;
  readonly noRm: string;
  readonly poliklinik: string;
  readonly doctor: string;
  readonly diagnosis: string;
  readonly treatment: string;
}

export interface AddMedicalRecordResult {
  readonly success: boolean;
  readonly message: string;
  readonly record?: MedicalHistoryItem;
  readonly medicalHistory?: readonly MedicalHistoryItem[];
}

export async function addMedicalRecord(
  input: AddMedicalRecordInput,
): Promise<AddMedicalRecordResult> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    return {
      success: false,
      message: 'Endpoint layanan SIMRS belum dikonfigurasi.',
    };
  }
  const medicalUrl = apiUrl.replace(/\/verify\/?$/, '/medical-record');
  try {
    const resp = await fetch(medicalUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add_medical_record',
        ...input,
      }),
    });
    const data = (await resp.json().catch(() => null)) as {
      success?: boolean;
      message?: string;
      record?: MedicalHistoryItem;
      medicalHistory?: MedicalHistoryItem[];
    } | null;

    if (resp.ok && data?.success) {
      return {
        success: true,
        message:
          data.message ?? 'Catatan pemeriksaan berhasil disimpan.',
        record: data.record,
        medicalHistory: data.medicalHistory,
      };
    }
    return {
      success: false,
      message: data?.message ?? 'Gagal menyimpan catatan pemeriksaan.',
    };
  } catch {
    return {
      success: false,
      message: 'Tidak dapat terhubung ke server SIMRS.',
    };
  }
}

/** Memainkan nada ting-tong lembut sebelum panggilan suara TTS dimulai. */
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

      // Nada Ding-Dong (C5 -> A4)
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

/**
 * Mengeluarkan panggilan suara otomatis Bahasa Indonesia menggunakan Web Speech API.
 * Contoh: "Nomor antrean U M kosong kosong empat, atas nama Budi Santoso, silakan menuju Poli Umum, Lantai 1 Ruang 102"
 */
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
