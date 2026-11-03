import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  useAttendanceVerification,
  type RecognizedPerson,
} from '../hooks/useAttendanceVerification';
import { useFaceDetection } from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import { useWebCamera } from '../hooks/useWebCamera';
import { captureVideoFrame } from '../lib/video';
import {
  DEFAULT_POLI_QUEUES,
  fetchQueueState,
  POLIKLINIK_LIST,
  resolveApiEndpoint,
  sendQueueAction,
  speakQueueCall,
  type PoliQueueSnapshot,
  type QueueControlAction,
} from '../lib/hospital';
import CameraView from './CameraView';
import {
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  RefreshIcon,
  ScanIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  VolumeIcon,
} from './icons';

const AUTO_POLI = 'auto';
const DEMO_BYPASS_RM = 'RM-2026-501B';

interface AttendanceCameraProps {
  readonly onGoToRegister?: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Panel Antrean Poliklinik Real-Time                                        */
/* -------------------------------------------------------------------------- */

function MinimalQueuePanel({
  queues,
  activePoliName,
  onSelectPoli,
  onQueueAction,
  isAdvancing,
  lastSpokenText,
}: {
  readonly queues: readonly PoliQueueSnapshot[];
  readonly activePoliName: string;
  readonly onSelectPoli: (poli: string) => void;
  readonly onQueueAction: (poli: string, action: QueueControlAction) => void;
  readonly isAdvancing: boolean;
  readonly lastSpokenText: string | null;
}) {
  const currentPoli =
    queues.find((q) => q.poliklinik === activePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const canAdvance =
    currentPoli.currentServingSequence < currentPoli.latestQueueSequence;
  const servingStatus = currentPoli.servingStatus ?? 'DIPANGGIL';

  return (
    <div className="mb-6 rounded-2xl border border-neutral-200/80 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold text-neutral-900">
            State Antrean Poliklinik Real-Time
          </span>
          <select
            value={currentPoli.poliklinik}
            onChange={(e) => onSelectPoli(e.target.value)}
            aria-label="Pilih Poliklinik"
            className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-medium text-neutral-800 outline-none transition focus:border-neutral-900 focus:bg-white"
          >
            {queues.map((q) => (
              <option key={q.poliklinik} value={q.poliklinik}>
                {q.poliklinik} ({q.currentServingNumber})
              </option>
            ))}
          </select>
          <span className="hidden md:inline-block text-xs text-neutral-400">
            {currentPoli.room} · {currentPoli.dokter}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onQueueAction(currentPoli.poliklinik, 'recall')}
            disabled={isAdvancing}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            <VolumeIcon width={13} height={13} className="text-neutral-600" />
            <span>Panggil Ulang</span>
          </button>

          {servingStatus !== 'SELESAI' && (
            <button
              type="button"
              onClick={() => onQueueAction(currentPoli.poliklinik, 'complete')}
              disabled={isAdvancing}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
            >
              <CheckIcon width={13} height={13} className="text-emerald-600" />
              <span>Selesai</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => onQueueAction(currentPoli.poliklinik, 'call_next')}
            disabled={!canAdvance || isAdvancing}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-35"
          >
            <VolumeIcon width={13} height={13} />
            <span>Panggil Berikutnya</span>
            <ChevronRightIcon width={13} height={13} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Nomor Dilayani</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                servingStatus === 'SELESAI'
                  ? 'bg-neutral-100 text-neutral-600'
                  : 'bg-emerald-50 text-emerald-700'
              }`}
            >
              {servingStatus}
            </span>
          </div>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.currentServingNumber}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {currentPoli.currentPatientName ?? 'Subjek Poliklinik'}
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Antrean Berikutnya</span>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.nextQueueNumber ?? '—'}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {currentPoli.nextPatientName
              ? `MENUNGGU · ${currentPoli.nextPatientName}`
              : 'Tidak ada antrean menunggu'}
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Total Menunggu</span>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.totalWaiting}{' '}
            <span className="text-xs font-normal text-neutral-500">subjek</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Terbit terakhir:{' '}
            <span className="font-mono">{currentPoli.latestQueueNumber}</span>
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Estimasi Tunggu</span>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            ± {currentPoli.estimatedWaitMinutes + 8}{' '}
            <span className="text-xs font-normal text-neutral-500">menit</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">8 menit / subjek</p>
        </div>
      </div>

      {lastSpokenText && (
        <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3.5 py-2 text-xs text-neutral-600">
          <div className="flex items-center gap-2 min-w-0">
            <VolumeIcon
              width={14}
              height={14}
              className="shrink-0 text-emerald-600"
            />
            <span className="truncate font-medium">
              TTS: &ldquo;{lastSpokenText}&rdquo;
            </span>
          </div>
          <span className="shrink-0 text-[10px] text-neutral-400">id-ID</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel Input Manual No. RM (Fallback Bypass RM-2026-501B)                  */
/* -------------------------------------------------------------------------- */

const normalizeRmInput = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, '').replace(/_/g, '-');

function ManualRmFallbackPanel({
  activePoliQueue,
  onManualRmSubmit,
  onGoToRegister,
  isSubmitting,
  lookupError,
}: {
  readonly activePoliQueue: PoliQueueSnapshot;
  readonly onManualRmSubmit: (noRm: string) => Promise<boolean>;
  readonly onGoToRegister?: () => void;
  readonly isSubmitting: boolean;
  readonly lookupError: string | null;
}) {
  const [rmInput, setRmInput] = useState(DEMO_BYPASS_RM);

  const nextNumber = `${activePoliQueue.prefix}-${String(
    activePoliQueue.latestQueueSequence + 1,
  ).padStart(3, '0')}`;
  const waitingForNext = Math.max(
    0,
    activePoliQueue.latestQueueSequence + 1 - activePoliQueue.currentServingSequence,
  );

  const normalizedRm = normalizeRmInput(rmInput);

  const handleRmSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalizedRm) return;
    await onManualRmSubmit(normalizedRm);
  };

  return (
    <div className="flex h-full min-h-[22rem] flex-col justify-between rounded-2xl border border-neutral-200/80 bg-white p-6">
      <div className="my-auto flex flex-col items-center text-center py-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-700">
          <ScanIcon width={20} height={20} />
        </div>
        <p className="mt-3.5 text-sm font-semibold text-neutral-900">
          Siap Mengekstraksi Vektor Biometrik Wajah
        </p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
          Arahkan wajah ke sensor kamera untuk ekstraksi vektor fitur (FaceNet /
          Rekognition) dan pencocokan jarak <em>Cosine Similarity</em> terhadap
          ambang batas (<em>threshold</em> 80%).
        </p>

        {onGoToRegister && (
          <button
            type="button"
            onClick={onGoToRegister}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-100"
          >
            <UserPlusIcon width={13} height={13} />
            Daftar Pasien Baru (Face Enrollment)
          </button>
        )}
      </div>

      <div className="space-y-3.5 border-t border-neutral-100 pt-4">
        <div className="rounded-xl bg-neutral-50 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-neutral-500">
              Estimasi Nomor ({activePoliQueue.poliklinik})
            </span>
            <span className="font-mono font-semibold text-neutral-900">
              {nextNumber} · Antrean {waitingForNext} (±{waitingForNext * 8} mnt)
            </span>
          </div>
        </div>

        {/* Form Input Manual No. RM (Fallback Bypass tanpa komputasi biometrik) */}
        <form
          onSubmit={(e) => void handleRmSubmit(e)}
          noValidate
          className="space-y-2"
          aria-label="Input Manual No. RM (Fallback Bypass)"
        >
          <div className="flex items-center justify-between">
            <label
              htmlFor="manual-rm-input"
              className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800"
            >
              <FileTextIcon width={13} height={13} className="text-neutral-500" />
              Input Manual No. RM (Fallback Bypass)
            </label>
            <button
              type="button"
              onClick={() => setRmInput(DEMO_BYPASS_RM)}
              className="font-mono text-[11px] font-medium text-emerald-700 hover:underline"
            >
              Isi {DEMO_BYPASS_RM}
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-1.5 pl-3 transition focus-within:border-neutral-900 focus-within:bg-white">
            <input
              id="manual-rm-input"
              value={rmInput}
              onChange={(e) => setRmInput(e.target.value)}
              placeholder="RM-2026-501B"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              className="h-8 min-w-0 flex-1 bg-transparent font-mono text-xs uppercase tracking-wide text-neutral-900 outline-none placeholder:text-neutral-400"
            />
            <button
              id="manual-rm-submit"
              type="submit"
              disabled={isSubmitting || normalizedRm.length === 0}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
            >
              {isSubmitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white" />
                  Memproses…
                </>
              ) : (
                <>
                  Terbitkan Antrean (Bypass)
                  <ChevronRightIcon width={12} height={12} />
                </>
              )}
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-neutral-400">
            Menggunakan <code className="font-mono text-neutral-600">{DEMO_BYPASS_RM}</code>{' '}
            menerbitkan nomor antrean secara instan tanpa mengeksekusi pencocokan
            vektor biometrik (untuk keperluan demonstrasi / kontrol pembanding).
          </p>

          {lookupError && (
            <p role="alert" className="text-[11px] font-medium text-rose-600">
              {lookupError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Kartu Hasil Identifikasi Biometrik & Nomor Antrean                        */
/* -------------------------------------------------------------------------- */

function BiometricQueueResultCard({
  patient,
  feedbackMessage,
  livePoliQueue,
  onQueueAction,
  isAdvancing,
  onNext,
}: {
  readonly patient: RecognizedPerson;
  readonly feedbackMessage?: string | null;
  readonly livePoliQueue?: PoliQueueSnapshot;
  readonly onQueueAction: (poli: string, action: QueueControlAction) => void;
  readonly isAdvancing: boolean;
  readonly onNext: () => void;
}) {
  const ticket = patient.queueTicket;
  if (!ticket) {
    return null;
  }

  const currentServingSeq =
    livePoliQueue?.currentServingSequence ?? ticket.currentServingSequence;
  const currentServingNumber =
    livePoliQueue?.currentServingNumber ?? ticket.currentServingNumber;
  const servingStatus = livePoliQueue?.servingStatus ?? 'DIPANGGIL';

  const patientsAhead = Math.max(0, ticket.queueSequence - currentServingSeq);
  const estimatedWaitMinutes = patientsAhead * 8;
  const isTurnNow = patientsAhead === 0;
  const isCompleted = isTurnNow && servingStatus === 'SELESAI';

  const ticketStateLabel = isCompleted
    ? 'SELESAI'
    : isTurnNow
      ? 'DIPANGGIL'
      : 'MENUNGGU';

  const isManualBypass = patient.verificationMethod === 'MANUAL_LOOKUP';

  return (
    <div className="space-y-4 rounded-2xl border border-neutral-200/80 bg-white p-5">
      {/* Banner Konfirmasi Ilmiah Cosine Similarity */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/85 px-3.5 py-2.5 text-xs text-emerald-950">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
            <ShieldCheckIcon width={15} height={15} className="text-emerald-600" />
            <span>
              {isManualBypass
                ? 'Bypass Manual No. RM Berhasil (Tanpa Komputasi Biometrik)'
                : 'Identifikasi Berhasil. Jarak Cosine Similarity memenuhi threshold.'}
            </span>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-mono text-[11px] font-bold text-emerald-800">
            {isManualBypass
              ? 'MANUAL BYPASS'
              : `Cosine Similarity: ${patient.similarity.toFixed(2)}%`}
          </span>
        </div>
        {feedbackMessage && (
          <p className="mt-1 text-[11px] text-emerald-800">{feedbackMessage}</p>
        )}
      </div>

      {/* Nomor Antrean Utama */}
      <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-4">
        <div>
          <span className="text-xs text-neutral-500">Nomor Antrean Terbit</span>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-4xl font-semibold tracking-tight text-neutral-900">
              {ticket.queueNumber}
            </span>
            <span className="text-xs text-neutral-500">
              Dilayani:{' '}
              <strong className="font-mono text-neutral-800">
                {currentServingNumber}
              </strong>
            </span>
          </div>
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            ticketStateLabel === 'SELESAI'
              ? 'bg-neutral-100 text-neutral-600'
              : ticketStateLabel === 'DIPANGGIL'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-800'
          }`}
        >
          {ticketStateLabel === 'MENUNGGU'
            ? `MENUNGGU · ${patientsAhead} antrean (±${estimatedWaitMinutes} mnt)`
            : ticketStateLabel}
        </span>
      </div>

      {/* Ringkasan Subjek & Metrik Latensi */}
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <div>
          <p className="text-neutral-400">Nama Subjek / Pasien</p>
          <p className="mt-0.5 font-semibold text-neutral-900">
            {patient.fullName}
          </p>
        </div>
        <div>
          <p className="text-neutral-400">Nomor RM / ID</p>
          <p className="mt-0.5 font-mono font-medium text-neutral-900">
            {patient.noRm}
          </p>
        </div>
        <div>
          <p className="text-neutral-400">Poliklinik Tujuan</p>
          <p className="mt-0.5 font-medium text-neutral-900">
            {ticket.poliklinik}
          </p>
        </div>
        <div>
          <p className="text-neutral-400">Lokasi Ruang</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.room}</p>
        </div>
        <div>
          <p className="text-neutral-400">Metode Verifikasi</p>
          <p className="mt-0.5 font-mono text-[11px] font-medium text-neutral-800">
            {isManualBypass ? 'MANUAL_RM_BYPASS' : 'FACENET_COSINE_SIMILARITY'}
          </p>
        </div>
        <div>
          <p className="text-neutral-400">Latensi Eksekusi</p>
          <p className="mt-0.5 font-mono text-[11px] font-medium text-neutral-800">
            {patient.totalLatencyMs !== undefined
              ? `${patient.totalLatencyMs.toFixed(1)} ms (${patient.coldStart ? 'COLD START' : 'WARM START'})`
              : 'Tercatat di Log'}
          </p>
        </div>
      </div>

      {/* Tombol Aksi */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3.5">
        <div className="flex items-center gap-2">
          {!isTurnNow ? (
            <button
              type="button"
              onClick={() => onQueueAction(ticket.poliklinik, 'call_next')}
              disabled={isAdvancing}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              <VolumeIcon width={13} height={13} />
              Panggil Antrean (+1)
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                onQueueAction(
                  ticket.poliklinik,
                  isCompleted ? 'recall' : 'complete',
                )
              }
              disabled={isAdvancing}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
            >
              <CheckIcon width={13} height={13} />
              {isCompleted ? 'Panggil Ulang' : 'Tandai Selesai'}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-neutral-800"
        >
          <RefreshIcon width={13} height={13} />
          Pindai Subjek Berikutnya
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Komponen Utama SIMRS Biometric Queue                                      */
/* -------------------------------------------------------------------------- */

const QUEUE_POLL_INTERVAL_MS = 4000;

function AttendanceCamera({ onGoToRegister }: AttendanceCameraProps = {}) {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const [poli, setPoli] = useState<string>(AUTO_POLI);
  const [queues, setQueues] = useState<readonly PoliQueueSnapshot[]>(
    DEFAULT_POLI_QUEUES,
  );
  const [monitorPoli, setMonitorPoli] = useState<string>('Poli Umum');
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState<string | null>(null);
  const [manualRmQuickInput, setManualRmQuickInput] = useState(DEMO_BYPASS_RM);

  const queueRequestSeqRef = useRef(0);
  const appliedQueueSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);

  const camera = useWebCamera({
    enabled: frame.image === null,
  });

  const applyQueueSnapshot = useCallback(
    (seq: number, nextQueues: readonly PoliQueueSnapshot[]): boolean => {
      if (seq < appliedQueueSeqRef.current) return false;
      appliedQueueSeqRef.current = seq;
      if (nextQueues.length > 0) {
        setQueues(nextQueues);
      }
      return true;
    },
    [],
  );

  const refreshQueues = useCallback(
    async (options: { readonly background?: boolean } = {}) => {
      const isBackground = options.background === true;
      if (isBackground) {
        if (pollInFlightRef.current) return;
        pollInFlightRef.current = true;
      }
      const seq = ++queueRequestSeqRef.current;
      try {
        const result = await fetchQueueState();
        if (result.ok) {
          applyQueueSnapshot(seq, result.data.queues);
        }
      } finally {
        if (isBackground) pollInFlightRef.current = false;
      }
    },
    [applyQueueSnapshot],
  );

  useEffect(() => {
    const poll = () => {
      if (document.hidden) return;
      void refreshQueues({ background: true });
    };
    poll();
    const id = window.setInterval(poll, QUEUE_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshQueues]);

  const issueTicket = async (image: string) => {
    await verification.submit(image, poli === AUTO_POLI ? undefined : poli);
    await refreshQueues();
  };

  const captureAndIssue = () => {
    const snap = frame.capture(camera.videoRef.current);
    if (snap) {
      verification.reset();
      void issueTicket(snap);
    }
  };

  const handleManualRmLookup = async (noRm: string): Promise<boolean> => {
    const ok = await verification.lookupManual(
      noRm,
      poli === AUTO_POLI ? undefined : poli,
    );
    if (ok) {
      await refreshQueues();
    }
    return ok;
  };

  const detection = useFaceDetection({
    videoRef: camera.videoRef,
    enabled: camera.status === 'ready' && frame.image === null,
    onHoldComplete: captureAndIssue,
  });

  const hasFace = detection.trackingBox !== null;

  useEffect(() => {
    if (camera.status !== 'ready' || !hasFace) {
      return undefined;
    }
    const identify = () => {
      const snap = captureVideoFrame(camera.videoRef.current, 0.7);
      if (snap) {
        void verification.identifyLive(snap);
      }
    };
    identify();
    const id = window.setInterval(identify, 2500);
    return () => window.clearInterval(id);
  }, [
    camera.status,
    camera.videoRef,
    hasFace,
    verification.identifyLive,
  ]);

  const live = verification.liveIdentity;
  const patient = verification.feedback?.person ?? (frame.image ? live : null);
  const error =
    verification.feedback?.type === 'error'
      ? verification.feedback.message
      : null;

  const effectivePoliName =
    patient?.queueTicket?.poliklinik ??
    (poli !== AUTO_POLI ? poli : live?.poliklinik ?? monitorPoli);

  const activePoliQueue =
    queues.find((q) => q.poliklinik === effectivePoliName) ??
    queues[0] ??
    DEFAULT_POLI_QUEUES[0];

  const handleQueueAction = async (
    targetPoli: string,
    action: QueueControlAction,
  ) => {
    setIsAdvancing(true);
    try {
      const seq = ++queueRequestSeqRef.current;
      const result = await sendQueueAction(targetPoli, action);
      if (!result.ok) {
        return;
      }
      const { data } = result;
      applyQueueSnapshot(seq, data.queues);

      if (!data.changed) {
        return;
      }

      const targetSnapshot =
        data.queue ??
        data.queues.find((q) => q.poliklinik === targetPoli) ??
        activePoliQueue;

      if (action === 'call_next' || action === 'recall') {
        const matchedPatientName =
          patient?.queueTicket?.queueNumber === targetSnapshot.currentServingNumber
            ? patient.fullName
            : targetSnapshot.currentPatientName;

        const sentence = await speakQueueCall({
          queueNumber: targetSnapshot.currentServingNumber,
          patientName: matchedPatientName,
          poliklinik: targetSnapshot.poliklinik,
          room: targetSnapshot.room,
        });
        setLastSpokenText(sentence);
      }
    } finally {
      setIsAdvancing(false);
    }
  };

  const handleNext = () => {
    frame.discard();
    verification.reset();
    verification.clearLiveIdentity();
    void refreshQueues();
  };

  const statusText = (() => {
    if (verification.isSubmitting) {
      return 'Mengekstraksi Vektor Biometrik...';
    }
    if (frame.image || verification.feedback?.person) {
      if (error) return error;
      if (patient?.queueTicket) {
        return 'Identifikasi Berhasil. Jarak Cosine Similarity memenuhi threshold.';
      }
      return 'Citra wajah berhasil diakuisisi.';
    }
    if (error) return error;
    if (camera.status !== 'ready') return 'Mengekstraksi Vektor Biometrik...';
    if (!hasFace) return 'Arahkan wajah ke area sensor kamera';
    if (detection.faceStatus === 'valid') {
      return 'Mengekstraksi Vektor Biometrik...';
    }
    return detection.guidance;
  })();

  const activeEndpointUrl = resolveApiEndpoint('verify') || 'Belum dikonfigurasi';

  return (
    <div>
      {/* Indikator Endpoint Backend Aktif (.env.local VITE_API_URL) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200/80 bg-white px-4 py-2 text-xs text-neutral-600">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-neutral-800">
            Target Endpoint (<code className="font-mono">VITE_API_URL</code>):
          </span>
          <code className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-neutral-800">
            {activeEndpointUrl}
          </code>
        </div>
        <span className="font-mono text-[11px] text-neutral-400">
          Threshold Cosine Similarity: 80.0%
        </span>
      </div>

      {/* Panel Antrean Poliklinik */}
      <MinimalQueuePanel
        queues={queues}
        activePoliName={effectivePoliName}
        onSelectPoli={(selected) => setMonitorPoli(selected)}
        onQueueAction={(target, action) => void handleQueueAction(target, action)}
        isAdvancing={isAdvancing}
        lastSpokenText={lastSpokenText}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
        {/* Kolom Kiri: (a) Pindai Wajah & (c) Bypass Cepat No. RM */}
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-900">
              Pindai Wajah (Ekstraksi Vektor Biometrik)
            </span>

            <div className="flex items-center gap-2">
              <label htmlFor="poli-select" className="text-xs text-neutral-500">
                Poli:
              </label>
              <select
                id="poli-select"
                value={poli}
                onChange={(e) => {
                  setPoli(e.target.value);
                  if (e.target.value !== AUTO_POLI) {
                    setMonitorPoli(e.target.value);
                  }
                }}
                className="h-8 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 text-xs font-medium text-neutral-800 outline-none transition focus:border-neutral-900 focus:bg-white"
              >
                <option value={AUTO_POLI}>Otomatis (Sesuai Profil)</option>
                {POLIKLINIK_LIST.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <CameraView
            camera={camera}
            detection={detection}
            capturedImage={frame.image}
            isFlashing={frame.isFlashing}
            faceLabel={live ? live.fullName : null}
            faceSubLabel={
              live
                ? `${live.noRm} · Cosine ${live.similarity.toFixed(1)}%`
                : null
            }
          >
            {verification.isSubmitting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/60 backdrop-blur-sm">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <p className="text-xs font-medium text-white">
                  Mengekstraksi Vektor Biometrik...
                </p>
              </div>
            )}
          </CameraView>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  error
                    ? 'bg-rose-500'
                    : hasFace || frame.image || patient
                      ? 'bg-emerald-500'
                      : 'bg-neutral-300'
                }`}
              />
              <span
                className={`text-xs ${
                  error ? 'font-medium text-rose-600' : 'text-neutral-600'
                }`}
              >
                {statusText}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {frame.image || patient ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={verification.isSubmitting}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                >
                  <RefreshIcon width={13} height={13} />
                  Pindai Ulang
                </button>
              ) : (
                <button
                  type="button"
                  onClick={captureAndIssue}
                  disabled={camera.status !== 'ready' || verification.isSubmitting}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
                >
                  <ScanIcon width={13} height={13} />
                  Pindai Wajah
                </button>
              )}
            </div>
          </div>

          {/* Baris Input Manual No. RM Cepat (Selalu Tersedia) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const norm = normalizeRmInput(manualRmQuickInput);
              if (norm) void handleManualRmLookup(norm);
            }}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200/80 bg-neutral-50 p-2.5"
          >
            <span className="text-[11px] font-medium text-neutral-600">
              Input Manual No. RM:
            </span>
            <input
              value={manualRmQuickInput}
              onChange={(e) => setManualRmQuickInput(e.target.value)}
              placeholder="RM-2026-501B"
              className="h-7 min-w-[130px] flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 font-mono text-xs uppercase text-neutral-900 outline-none focus:border-neutral-900"
            />
            <button
              type="submit"
              disabled={verification.isSubmitting || !manualRmQuickInput.trim()}
              className="h-7 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
            >
              Bypass No. RM
            </button>
          </form>
        </section>

        {/* Kolom Kanan: Hasil Pencocokan Vektor & Nomor Antrean */}
        <section className="space-y-4">
          {patient ? (
            <BiometricQueueResultCard
              patient={patient}
              feedbackMessage={verification.feedback?.message}
              livePoliQueue={activePoliQueue}
              onQueueAction={(target, action) =>
                void handleQueueAction(target, action)
              }
              isAdvancing={isAdvancing}
              onNext={handleNext}
            />
          ) : (
            <ManualRmFallbackPanel
              activePoliQueue={activePoliQueue}
              onManualRmSubmit={handleManualRmLookup}
              onGoToRegister={onGoToRegister}
              isSubmitting={verification.isSubmitting}
              lookupError={error}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export default AttendanceCamera;
