import { useCallback, useEffect, useRef, useState } from 'react';

export interface MedicalHistoryItem {
  readonly date: string;
  readonly poliklinik: string;
  readonly doctor: string;
  readonly diagnosis: string;
  readonly treatment: string;
}

export interface QueueTicket {
  readonly ticketId: string;
  readonly queueNumber: string;
  readonly queueSequence: number;
  readonly currentServingNumber: string;
  readonly currentServingSequence: number;
  readonly latestQueueNumber: string;
  readonly patientsAhead: number;
  readonly estimatedWaitMinutes: number;
  readonly noRm: string;
  readonly fullName: string;
  readonly gender: string;
  readonly insurance: string;
  readonly poliklinik: string;
  readonly dokter: string;
  readonly room: string;
  readonly allergies: string;
  readonly hasAllergyAlert: boolean;
  readonly status: string;
  readonly issuedAt: string;
  readonly isExistingTicket?: boolean;
}

export interface RecognizedPerson {
  readonly personId: string;
  readonly noRm: string;
  readonly nim: string;
  readonly nik: string;
  readonly fullName: string;
  readonly birthDate?: string;
  readonly gender: string;
  readonly age: number;
  readonly bloodType: string;
  readonly insurance: string;
  readonly allergies: string;
  readonly chronicConditions: string;
  readonly poliklinik: string;
  readonly dokter: string;
  readonly medicalNotes?: string;
  readonly medicalHistory: readonly MedicalHistoryItem[];
  readonly similarity: number;
  readonly alreadyQueued?: boolean;
  readonly queueTicket?: QueueTicket;
}

export interface VerificationFeedback {
  readonly type: 'success' | 'error';
  readonly message: string;
  readonly person?: RecognizedPerson;
}

export interface EnrollFaceInput {
  readonly fullName: string;
  readonly gender: 'Laki-laki' | 'Perempuan';
  readonly birthDate?: string;
  readonly noRm?: string;
  readonly nik?: string;
  readonly age?: number;
  readonly bloodType?: string;
  readonly insurance?: string;
  readonly allergies?: string;
  readonly chronicConditions?: string;
  readonly poliklinik?: string;
  readonly medicalHistoryNotes?: string;
  readonly image: string;
  readonly extraImages?: readonly string[];
}

export interface EnrollFaceResult {
  readonly success: boolean;
  readonly message: string;
  readonly person?: RecognizedPerson;
}

export interface UseAttendanceVerificationResult {
  readonly isSubmitting: boolean;
  readonly feedback: VerificationFeedback | null;
  readonly liveIdentity: RecognizedPerson | null;
  readonly submit: (image: string, poliklinik?: string) => Promise<void>;
  readonly lookupManual: (query: string, poliklinik?: string) => Promise<boolean>;
  readonly identifyLive: (image: string) => Promise<void>;
  readonly clearLiveIdentity: () => void;
  readonly enrollFace: (input: EnrollFaceInput) => Promise<EnrollFaceResult>;
  readonly appendMedicalHistory: (
    item: MedicalHistoryItem,
    fullHistory?: readonly MedicalHistoryItem[],
  ) => void;
  /** Membatalkan permintaan yang berjalan dan menghapus umpan balik. */
  readonly reset: () => void;
}

interface VerifyResponse {
  readonly success: boolean;
  readonly message?: string;
  readonly person?: RecognizedPerson;
}

const MESSAGES = {
  notConfigured: 'Endpoint verifikasi belum dikonfigurasi.',
  recorded: 'Pasien lama terverifikasi & tiket antrean otomatis diterbitkan.',
  notRecognized: 'Wajah pasien belum terdaftar di database Rekam Medis RS.',
  notFound: 'Data pasien dengan NIK / No. RM tersebut tidak ditemukan.',
  unreachable: 'Tidak dapat terhubung ke layanan biometrik RS.',
  enrollFailed: 'Gagal mendaftarkan pasien baru.',
} as const;

const parseMedicalHistory = (raw: unknown): readonly MedicalHistoryItem[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .map((item) => ({
      date: typeof item.date === 'string' ? item.date : '-',
      poliklinik: typeof item.poliklinik === 'string' ? item.poliklinik : '-',
      doctor: typeof item.doctor === 'string' ? item.doctor : '-',
      diagnosis: typeof item.diagnosis === 'string' ? item.diagnosis : '-',
      treatment: typeof item.treatment === 'string' ? item.treatment : '-',
    }));
};

const parseQueueTicket = (raw: unknown): QueueTicket | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.queueNumber !== 'string') {
    return undefined;
  }
  const parts = t.queueNumber.split('-');
  const prefix = parts[0] || 'PL';
  const parsedSeq = Number.parseInt(parts[1] ?? '1', 10);
  const queueSequence =
    typeof t.queueSequence === 'number'
      ? t.queueSequence
      : Number.isFinite(parsedSeq)
        ? parsedSeq
        : 1;
  const fallbackServingSeq = Math.max(1, queueSequence - 3);
  const currentServingSequence =
    typeof t.currentServingSequence === 'number'
      ? t.currentServingSequence
      : fallbackServingSeq;
  const currentServingNumber =
    typeof t.currentServingNumber === 'string'
      ? t.currentServingNumber
      : `${prefix}-${String(currentServingSequence).padStart(3, '0')}`;
  const latestQueueNumber =
    typeof t.latestQueueNumber === 'string'
      ? t.latestQueueNumber
      : t.queueNumber;
  const patientsAhead =
    typeof t.patientsAhead === 'number'
      ? t.patientsAhead
      : Math.max(0, queueSequence - currentServingSequence);
  const estimatedWaitMinutes =
    typeof t.estimatedWaitMinutes === 'number'
      ? t.estimatedWaitMinutes
      : patientsAhead * 8;

  return {
    ticketId: typeof t.ticketId === 'string' ? t.ticketId : '-',
    queueNumber: t.queueNumber,
    queueSequence,
    currentServingNumber,
    currentServingSequence,
    latestQueueNumber,
    patientsAhead,
    estimatedWaitMinutes,
    noRm: typeof t.noRm === 'string' ? t.noRm : '-',
    fullName: typeof t.fullName === 'string' ? t.fullName : '-',
    gender: typeof t.gender === 'string' ? t.gender : '-',
    insurance:
      typeof t.insurance === 'string' ? t.insurance : 'BPJS Kesehatan',
    poliklinik: typeof t.poliklinik === 'string' ? t.poliklinik : 'Poli Umum',
    dokter: typeof t.dokter === 'string' ? t.dokter : '-',
    room: typeof t.room === 'string' ? t.room : 'Lantai 1',
    allergies:
      typeof t.allergies === 'string' ? t.allergies : 'Tidak Ada Alergi',
    hasAllergyAlert: t.hasAllergyAlert === true,
    status:
      typeof t.status === 'string' ? t.status : 'MENUNGGU PANGGILAN POLI',
    issuedAt: typeof t.issuedAt === 'string' ? t.issuedAt : '',
    isExistingTicket: t.isExistingTicket === true,
  };
};

const parseVerifyResponse = (body: unknown): VerifyResponse => {
  if (typeof body !== 'object' || body === null) {
    return { success: false };
  }

  const record = body as Record<string, unknown>;
  const success = record.success === true;
  const message =
    typeof record.message === 'string' ? record.message : undefined;

  const personId =
    typeof record.personId === 'string' ? record.personId : undefined;
  const fullName =
    typeof record.fullName === 'string' ? record.fullName : personId;
  const noRm =
    typeof record.noRm === 'string'
      ? record.noRm
      : typeof record.nim === 'string'
        ? record.nim
        : (personId ?? '-');
  const gender = typeof record.gender === 'string' ? record.gender : '-';
  const nik = typeof record.nik === 'string' ? record.nik : '-';
  const age = typeof record.age === 'number' ? record.age : 30;
  const birthDate =
    typeof record.birthDate === 'string'
      ? record.birthDate
      : typeof record.birth_date === 'string'
        ? record.birth_date
        : typeof record.tanggalLahir === 'string'
          ? record.tanggalLahir
          : undefined;
  const medicalNotes =
    typeof record.medicalNotes === 'string'
      ? record.medicalNotes
      : typeof record.medical_notes === 'string'
        ? record.medical_notes
        : undefined;
  const bloodType =
    typeof record.bloodType === 'string' ? record.bloodType : 'O+';
  const insurance =
    typeof record.insurance === 'string' ? record.insurance : 'BPJS Kesehatan';
  const allergies =
    typeof record.allergies === 'string'
      ? record.allergies
      : 'Tidak Ada Alergi';
  const chronicConditions =
    typeof record.chronicConditions === 'string'
      ? record.chronicConditions
      : 'Tidak Ada';
  const poliklinik =
    typeof record.poliklinik === 'string' ? record.poliklinik : 'Poli Umum';
  const dokter = typeof record.dokter === 'string' ? record.dokter : '-';
  const medicalHistory = parseMedicalHistory(record.medicalHistory);
  const queueTicket = parseQueueTicket(record.queueTicket);
  const alreadyQueued =
    record.alreadyQueued === true || queueTicket?.isExistingTicket === true;
  const similarity =
    typeof record.similarity === 'number'
      ? record.similarity
      : typeof record.confidence === 'number'
        ? record.confidence
        : 0;

  return {
    success,
    message,
    person:
      success && personId && fullName
        ? {
            personId,
            noRm,
            nim: noRm,
            nik,
            fullName,
            birthDate,
            gender,
            age,
            bloodType,
            insurance,
            allergies,
            chronicConditions,
            poliklinik,
            dokter,
            medicalNotes,
            medicalHistory,
            similarity,
            alreadyQueued,
            queueTicket,
          }
        : undefined,
  };
};

export function useAttendanceVerification(): UseAttendanceVerificationResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<VerificationFeedback | null>(null);
  const [liveIdentity, setLiveIdentity] = useState<RecognizedPerson | null>(
    null,
  );
  const inFlightRef = useRef<AbortController | null>(null);
  const liveInFlightRef = useRef(false);

  const abortInFlight = useCallback(() => {
    inFlightRef.current?.abort();
    inFlightRef.current = null;
  }, []);

  const submit = useCallback(
    async (image: string, poliklinik?: string): Promise<void> => {
      if (inFlightRef.current) {
        return;
      }

      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) {
        setFeedback({ type: 'error', message: MESSAGES.notConfigured });
        return;
      }

      const controller = new AbortController();
      inFlightRef.current = controller;
      const isCurrent = (): boolean => inFlightRef.current === controller;

      setIsSubmitting(true);
      setFeedback(null);

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image, poliklinik }),
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        const payload = parseVerifyResponse(body);

        if (!isCurrent()) {
          return;
        }

        if (payload.person) {
          setLiveIdentity(payload.person);
        }

        setFeedback(
          response.ok && payload.success
            ? {
                type: 'success',
                message: payload.message ?? MESSAGES.recorded,
                person: payload.person,
              }
            : {
                type: 'error',
                message: payload.message ?? MESSAGES.notRecognized,
              },
        );
      } catch {
        if (isCurrent()) {
          setFeedback({ type: 'error', message: MESSAGES.unreachable });
        }
      } finally {
        if (isCurrent()) {
          inFlightRef.current = null;
          setIsSubmitting(false);
        }
      }
    },
    [],
  );

  const lookupManual = useCallback(
    async (query: string, poliklinik?: string): Promise<boolean> => {
      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) {
        setFeedback({ type: 'error', message: MESSAGES.notConfigured });
        return false;
      }

      const lookupUrl = apiUrl.replace(/\/verify\/?$/, '/lookup');
      setIsSubmitting(true);
      setFeedback(null);

      try {
        const response = await fetch(lookupUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'lookup_manual',
            query: query.trim(),
            poliklinik,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        const payload = parseVerifyResponse(body);

        if (response.ok && payload.success && payload.person) {
          setLiveIdentity(payload.person);
          setFeedback({
            type: 'success',
            message: payload.message ?? MESSAGES.recorded,
            person: payload.person,
          });
          return true;
        }

        setFeedback({
          type: 'error',
          message: payload.message ?? MESSAGES.notFound,
        });
        return false;
      } catch {
        setFeedback({ type: 'error', message: MESSAGES.unreachable });
        return false;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const identifyLive = useCallback(async (image: string): Promise<void> => {
    if (liveInFlightRef.current) {
      return;
    }

    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl) {
      return;
    }

    liveInFlightRef.current = true;
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, identifyOnly: true }),
      });
      const body: unknown = await response.json().catch(() => null);
      const payload = parseVerifyResponse(body);
      if (response.ok && payload.success && payload.person) {
        setLiveIdentity((prev) => ({
          ...payload.person!,
          queueTicket: payload.person!.queueTicket ?? prev?.queueTicket,
        }));
      }
    } catch {
      // Abaikan kegagalan identifikasi latar belakang agar stream video tetap mulus
    } finally {
      liveInFlightRef.current = false;
    }
  }, []);

  const clearLiveIdentity = useCallback(() => {
    setLiveIdentity(null);
  }, []);

  const enrollFace = useCallback(
    async (input: EnrollFaceInput): Promise<EnrollFaceResult> => {
      const apiUrl = import.meta.env.VITE_API_URL;
      if (!apiUrl) {
        return { success: false, message: MESSAGES.notConfigured };
      }

      const enrollUrl = apiUrl.replace(/\/verify\/?$/, '/enroll');
      try {
        const response = await fetch(enrollUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'enroll',
            fullName: input.fullName,
            gender: input.gender,
            birthDate: input.birthDate,
            noRm: input.noRm,
            nik: input.nik,
            age: input.age,
            bloodType: input.bloodType,
            insurance: input.insurance,
            allergies: input.allergies,
            chronicConditions: input.chronicConditions,
            poliklinik: input.poliklinik,
            medicalHistoryNotes: input.medicalHistoryNotes,
            image: input.image,
            extraImages: input.extraImages,
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        const payload = parseVerifyResponse(body);

        if (response.ok && payload.success) {
          if (payload.person) {
            setLiveIdentity(payload.person);
          }
          return {
            success: true,
            message:
              payload.message ??
              `Pasien ${input.fullName} berhasil didaftarkan.`,
            person: payload.person,
          };
        }

        return {
          success: false,
          message: payload.message ?? MESSAGES.enrollFailed,
        };
      } catch {
        return { success: false, message: MESSAGES.unreachable };
      }
    },
    [],
  );

  const appendMedicalHistory = useCallback(
    (
      item: MedicalHistoryItem,
      fullHistory?: readonly MedicalHistoryItem[],
    ) => {
      setLiveIdentity((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          medicalHistory:
            fullHistory && fullHistory.length > 0
              ? fullHistory
              : [item, ...prev.medicalHistory],
        };
      });
      setFeedback((prev) => {
        if (!prev?.person) return prev;
        return {
          ...prev,
          person: {
            ...prev.person,
            medicalHistory:
              fullHistory && fullHistory.length > 0
                ? fullHistory
                : [item, ...prev.person.medicalHistory],
          },
        };
      });
    },
    [],
  );

  const reset = useCallback(() => {
    abortInFlight();
    setIsSubmitting(false);
    setFeedback(null);
  }, [abortInFlight]);

  useEffect(() => abortInFlight, [abortInFlight]);

  return {
    isSubmitting,
    feedback,
    liveIdentity,
    submit,
    lookupManual,
    identifyLive,
    clearLiveIdentity,
    enrollFace,
    appendMedicalHistory,
    reset,
  };
}
