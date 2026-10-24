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

export interface PoliQueueSnapshot {
  readonly poliklinik: string;
  readonly prefix: string;
  readonly dokter: string;
  readonly room: string;
  readonly currentServingSequence: number;
  readonly currentServingNumber: string;
  readonly latestQueueSequence: number;
  readonly latestQueueNumber: string;
  readonly totalWaiting: number;
  readonly estimatedWaitMinutes: number;
}

export const DEFAULT_POLI_QUEUES: readonly PoliQueueSnapshot[] = [
  {
    poliklinik: 'Poli Penyakit Dalam',
    prefix: 'PD',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    room: 'Lantai 2 • Ruang 201',
    currentServingSequence: 2,
    currentServingNumber: 'PD-002',
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

export async function advancePoliQueue(
  poliklinik: string,
): Promise<readonly PoliQueueSnapshot[] | null> {
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
      }),
    });
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as { queues?: PoliQueueSnapshot[] };
    return Array.isArray(data.queues) ? data.queues : null;
  } catch {
    return null;
  }
}
