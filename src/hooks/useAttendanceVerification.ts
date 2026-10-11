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
}

export interface RecognizedPerson {
  readonly personId: string;
  readonly noRm: string;
  readonly nim: string;
  readonly nik: string;
  readonly fullName: string;
  readonly gender: string;
  readonly age: number;
  readonly bloodType: string;
  readonly insurance: string;
  readonly allergies: string;
  readonly chronicConditions: string;
  readonly poliklinik: string;
  readonly dokter: string;
  readonly medicalHistory: readonly MedicalHistoryItem[];
  readonly similarity: number;
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
  readonly identifyLive: (image: string) => Promise<void>;
  readonly clearLiveIdentity: () => void;
  readonly enrollFace: (input: EnrollFaceInput) => Promise<EnrollFaceResult>;
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
  return {
    ticketId: typeof t.ticketId === 'string' ? t.ticketId : '-',
    queueNumber: t.queueNumber,
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
            gender,
            age,
            bloodType,
            insurance,
            allergies,
            chronicConditions,
            poliklinik,
            dokter,
            medicalHistory,
            similarity,
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
          queueTicket: prev?.queueTicket,
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
    identifyLive,
    clearLiveIdentity,
    enrollFace,
    reset,
  };
}
