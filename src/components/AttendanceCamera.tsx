import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  useAttendanceVerification,
  type MedicalHistoryItem,
  type RecognizedPerson,
} from '../hooks/useAttendanceVerification';
import { useFaceDetection } from '../hooks/useFaceDetection';
import { useFrameCapture } from '../hooks/useFrameCapture';
import { useWebCamera } from '../hooks/useWebCamera';
import { captureVideoFrame } from '../lib/video';
import {
  addMedicalRecord,
  advancePoliQueue,
  DEFAULT_POLI_QUEUES,
  fetchPoliQueues,
  hasRealAllergy,
  POLIKLINIK_LIST,
  speakQueueCall,
  type PoliQueueSnapshot,
  type QueueControlAction,
} from '../lib/hospital';
import CameraView from './CameraView';
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  PlusIcon,
  PrinterIcon,
  RefreshIcon,
  ScanIcon,
  ShieldCheckIcon,
  VolumeIcon,
} from './icons';

const AUTO_POLI = 'auto';

/* -------------------------------------------------------------------------- */
/*  Generator QR Code & Barcode SVG Deterministik untuk Struk Thermal         */
/* -------------------------------------------------------------------------- */

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ThermalQrCodeSvg({ value }: { readonly value: string }) {
  const size = 21;
  const cells: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  const drawFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        cells[r0 + r]![c0 + c] = isBorder || isInner;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  let seed = hashString(value);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const inFinder =
        (r < 8 && c < 8) ||
        (r < 8 && c >= size - 8) ||
        (r >= size - 8 && c < 8);
      if (inFinder) continue;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      cells[r]![c] = (seed & 3) !== 0;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="88"
      height="88"
      shapeRendering="crispEdges"
      aria-label="QR Code Tiket Antrean"
      className="mx-auto block"
    >
      {cells.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" />
          ) : null,
        ),
      )}
    </svg>
  );
}

function ThermalBarcodeSvg({ value }: { readonly value: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 2;
  let seed = hashString(value);
  for (let i = 0; i < 34; i++) {
    seed = (Math.imul(seed, 22695477) + 1) >>> 0;
    const w = (seed % 3) + 1;
    const gap = ((seed >>> 4) % 2) + 1;
    bars.push({ x, w });
    x += w + gap;
  }

  return (
    <svg
      viewBox={`0 0 ${x + 2} 28`}
      width="180"
      height="28"
      shapeRendering="crispEdges"
      aria-label="Barcode Tiket"
      className="mx-auto block"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={28} fill="#000" />
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Struk Cetak Thermal 58mm/80mm (Hanya Tampil Saat @media print)            */
/* -------------------------------------------------------------------------- */

function ThermalPrintReceipt({
  patient,
  livePoliQueue,
}: {
  readonly patient: RecognizedPerson;
  readonly livePoliQueue?: PoliQueueSnapshot;
}) {
  const ticket = patient.queueTicket;
  if (!ticket) return null;

  const currentServingSeq =
    livePoliQueue?.currentServingSequence ?? ticket.currentServingSequence;
  const currentServingNumber =
    livePoliQueue?.currentServingNumber ?? ticket.currentServingNumber;
  const patientsAhead = Math.max(0, ticket.queueSequence - currentServingSeq);
  const qrPayload = `SIMRS|${ticket.ticketId}|${ticket.queueNumber}|${patient.noRm}`;
  const issuedDate = new Date(ticket.issuedAt || Date.now());
  const formattedTime = issuedDate.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div id="thermal-print-receipt" aria-hidden="true">
      <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '6px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700 }}>RSUD SIMRS BIOMETRIK</div>
        <div style={{ fontSize: '9px' }}>Instalasi Rawat Jalan Terpadu</div>
        <div style={{ fontSize: '9px' }}>{formattedTime} WIB</div>
      </div>

      <div style={{ textAlign: 'center', padding: '10px 0', borderBottom: '1px dashed #000' }}>
        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Nomor Antrean Poliklinik
        </div>
        <div style={{ fontSize: '34px', fontWeight: 800, lineHeight: 1.15, margin: '4px 0' }}>
          {ticket.queueNumber}
        </div>
        <div style={{ fontSize: '10px', fontWeight: 700 }}>{ticket.poliklinik}</div>
        <div style={{ fontSize: '9px' }}>{ticket.room}</div>
        <div style={{ fontSize: '9px' }}>{ticket.dokter}</div>
      </div>

      <div style={{ fontSize: '9px', padding: '8px 0', borderBottom: '1px dashed #000', lineHeight: 1.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Pasien:</span>
          <strong>{patient.fullName}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>No. RM:</span>
          <strong>{patient.noRm}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Jaminan:</span>
          <span>{patient.insurance}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Alergi:</span>
          <strong>{patient.allergies}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          <span>Sedang Dilayani:</span>
          <strong>{currentServingNumber}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Sisa Antrean:</span>
          <strong>
            {patientsAhead === 0
              ? 'Giliran Anda Sekarang'
              : `${patientsAhead} pasien (±${patientsAhead * 8} mnt)`}
          </strong>
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingTop: '8px' }}>
        <ThermalQrCodeSvg value={qrPayload} />
        <div style={{ marginTop: '6px' }}>
          <ThermalBarcodeSvg value={ticket.ticketId} />
        </div>
        <div style={{ fontSize: '8px', marginTop: '3px' }}>
          ID: {ticket.ticketId} · Biometrik {patient.similarity.toFixed(1)}%
        </div>
        <div style={{ fontSize: '8px', marginTop: '4px' }}>
          Harap tunjukkan struk ini saat dipanggil ke ruang poli.
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Panel Panggil Antrean + Suara Otomatis (Text-to-Speech) Minimalis         */
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
    <div className="no-print mb-6 rounded-2xl border border-neutral-200/80 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-semibold text-neutral-900">
            Panel Panggil Antrean Poliklinik
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

        {/* Kontrol Petugas / Dokter: Panggil Ulang (TTS), Selesai, Panggil Berikutnya */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onQueueAction(currentPoli.poliklinik, 'recall')}
            disabled={isAdvancing}
            title="Panggil ulang nomor saat ini dengan suara Bahasa Indonesia"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            <VolumeIcon width={13} height={13} className="text-neutral-600" />
            <span>Panggil Suara</span>
          </button>

          {servingStatus !== 'SELESAI' && (
            <button
              type="button"
              onClick={() => onQueueAction(currentPoli.poliklinik, 'complete')}
              disabled={isAdvancing}
              title="Tandai pemeriksaan nomor antrean saat ini selesai"
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
            title={
              canAdvance
                ? 'Panggil antrean berikutnya dan umumkan dengan suara otomatis'
                : 'Belum ada antrean menunggu berikutnya'
            }
            className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-900 px-3.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-35"
          >
            <VolumeIcon width={13} height={13} />
            <span>Panggil Berikutnya</span>
            <ChevronRightIcon width={13} height={13} />
          </button>
        </div>
      </div>

      {/* Ringkasan Status Antrean (MENUNGGU -> DIPANGGIL -> SELESAI) */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Sedang Dilayani</span>
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
            {currentPoli.currentPatientName ?? 'Pasien Poliklinik'}
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
          <span className="text-xs text-neutral-500">Sisa Menunggu</span>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            {currentPoli.totalWaiting}{' '}
            <span className="text-xs font-normal text-neutral-500">pasien</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Terakhir: <span className="font-mono">{currentPoli.latestQueueNumber}</span>
          </p>
        </div>

        <div>
          <span className="text-xs text-neutral-500">Estimasi Tunggu Baru</span>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
            ± {currentPoli.estimatedWaitMinutes + 8}{' '}
            <span className="text-xs font-normal text-neutral-500">menit</span>
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">Rata-rata 8 menit/pasien</p>
        </div>
      </div>

      {/* Transkrip Panggilan Suara TTS Aktif */}
      {lastSpokenText && (
        <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3.5 py-2 text-xs text-neutral-600">
          <div className="flex items-center gap-2 min-w-0">
            <VolumeIcon width={14} height={14} className="shrink-0 text-emerald-600" />
            <span className="truncate font-medium">
              Suara TTS: &ldquo;{lastSpokenText}&rdquo;
            </span>
          </div>
          <span className="shrink-0 text-[10px] text-neutral-400">id-ID</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty State Minimalis                                                     */
/* -------------------------------------------------------------------------- */

function EmptyState({
  activePoliQueue,
}: {
  readonly activePoliQueue: PoliQueueSnapshot;
}) {
  const nextNumber = `${activePoliQueue.prefix}-${String(
    activePoliQueue.latestQueueSequence + 1,
  ).padStart(3, '0')}`;
  const waitingForNext = Math.max(
    0,
    activePoliQueue.latestQueueSequence + 1 - activePoliQueue.currentServingSequence,
  );

  return (
    <div className="flex h-full min-h-[22rem] flex-col justify-between rounded-2xl border border-neutral-200/80 bg-white p-6">
      <div className="my-auto flex flex-col items-center text-center py-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600">
          <ScanIcon width={20} height={20} />
        </div>
        <p className="mt-3.5 text-sm font-semibold text-neutral-900">
          Menunggu Pemindaian Wajah Pasien
        </p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">
          Hadapkan wajah ke kamera dan tahan 1,5 detik. Sistem memvalidasi Liveness 3D dan menerbitkan tiket antrean otomatis.
        </p>
      </div>

      <div className="rounded-xl bg-neutral-50 p-3.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-neutral-500">
            Tiket berikutnya ({activePoliQueue.poliklinik})
          </span>
          <span className="font-mono font-semibold text-neutral-900">
            {nextNumber} · Menunggu {waitingForNext} pasien (±{waitingForNext * 8} mnt)
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Kartu Tiket Antrean Pasien Minimalis                                      */
/* -------------------------------------------------------------------------- */

function QueueTicketCard({
  patient,
  livePoliQueue,
  onQueueAction,
  isAdvancing,
  onNext,
}: {
  readonly patient: RecognizedPerson;
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

  return (
    <div className="no-print rounded-2xl border border-neutral-200/80 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-xs text-neutral-500">Nomor Antrean Pasien</span>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-4xl font-semibold tracking-tight text-neutral-900">
              {ticket.queueNumber}
            </span>
            <span className="text-xs text-neutral-500">
              Dilayani: <strong className="font-mono text-neutral-800">{currentServingNumber}</strong>
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
            ? `MENUNGGU · ${patientsAhead} pasien lagi (±${estimatedWaitMinutes} mnt)`
            : ticketStateLabel}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-100 pt-3.5 text-xs">
        <div>
          <p className="text-neutral-400">Poliklinik</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.poliklinik}</p>
        </div>
        <div>
          <p className="text-neutral-400">Ruang</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.room}</p>
        </div>
        <div>
          <p className="text-neutral-400">Dokter</p>
          <p className="mt-0.5 font-medium text-neutral-900">{ticket.dokter}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3.5">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-neutral-800"
        >
          <PrinterIcon width={14} height={14} />
          Cetak Struk Thermal
        </button>

        {!isTurnNow ? (
          <button
            type="button"
            onClick={() => onQueueAction(ticket.poliklinik, 'call_next')}
            disabled={isAdvancing}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
          >
            <VolumeIcon width={13} height={13} />
            Panggil (+1)
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

        <button
          type="button"
          onClick={onNext}
          className="inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50"
        >
          Pasien Berikutnya
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Rekam Medis Pasien + Form Tambah Riwayat Pemeriksaan Dokter               */
/* -------------------------------------------------------------------------- */

function PatientDetails({
  patient,
  onAddHistory,
}: {
  readonly patient: RecognizedPerson;
  readonly onAddHistory: (
    item: MedicalHistoryItem,
    fullHistory?: readonly MedicalHistoryItem[],
  ) => void;
}) {
  const allergy = hasRealAllergy(patient.allergies);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [treatment, setTreatment] = useState('');
  const [notePoli, setNotePoli] = useState(
    patient.queueTicket?.poliklinik ?? patient.poliklinik,
  );
  const [noteDoctor, setNoteDoctor] = useState(
    patient.queueTicket?.dokter ?? patient.dokter,
  );
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    setNotePoli(patient.queueTicket?.poliklinik ?? patient.poliklinik);
    setNoteDoctor(patient.queueTicket?.dokter ?? patient.dokter);
  }, [patient.personId, patient.poliklinik, patient.dokter, patient.queueTicket]);

  const handleSaveDoctorNote = async (e: FormEvent) => {
    e.preventDefault();
    setNoteError(null);
    if (!diagnosis.trim() || !treatment.trim()) {
      setNoteError('Diagnosis dan tindakan/resep wajib diisi.');
      return;
    }

    setIsSavingNote(true);
    const result = await addMedicalRecord({
      personId: patient.personId,
      noRm: patient.noRm,
      poliklinik: notePoli,
      doctor: noteDoctor,
      diagnosis: diagnosis.trim(),
      treatment: treatment.trim(),
    });
    setIsSavingNote(false);

    if (!result.success) {
      setNoteError(result.message);
      return;
    }

    const newEntry: MedicalHistoryItem = result.record ?? {
      date: new Date().toISOString().slice(0, 10),
      poliklinik: notePoli,
      doctor: noteDoctor,
      diagnosis: diagnosis.trim(),
      treatment: treatment.trim(),
    };

    onAddHistory(newEntry, result.medicalHistory);
    setDiagnosis('');
    setTreatment('');
    setIsAddingNote(false);
  };

  return (
    <div className="no-print rounded-2xl border border-neutral-200/80 bg-white p-5">
      {/* Identitas Pasien */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700">
            {patient.fullName
              .split(' ')
              .slice(0, 2)
              .map((w) => w[0])
              .join('')
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">
              {patient.fullName}
            </p>
            <p className="text-xs text-neutral-500">
              <span className="font-mono">{patient.noRm}</span> · {patient.gender} ·{' '}
              {patient.age} th
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          <ShieldCheckIcon width={13} height={13} />
          {patient.similarity.toFixed(1)}%
        </span>
      </div>

      {/* Ringkasan Medis */}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-neutral-100 pt-3.5 text-xs">
        <div>
          <dt className="text-neutral-400">Gol. Darah</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.bloodType}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">Jaminan</dt>
          <dd className="mt-0.5 font-medium text-neutral-900">{patient.insurance}</dd>
        </div>
        <div>
          <dt className="text-neutral-400">NIK</dt>
          <dd className="mt-0.5 font-mono font-medium text-neutral-900 truncate">
            {patient.nik || '-'}
          </dd>
        </div>
      </dl>

      {/* Alergi & Komorbid */}
      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 text-xs">
        <div
          className={`rounded-xl p-3 ${
            allergy
              ? 'bg-rose-50/90 text-rose-900 ring-1 ring-rose-200/70'
              : 'bg-neutral-50 text-neutral-700'
          }`}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {allergy && <AlertIcon width={13} height={13} className="text-rose-600" />}
            <span className={allergy ? 'text-rose-700' : 'text-neutral-400'}>
              Alergi
            </span>
          </div>
          <p className="mt-0.5 font-medium">{patient.allergies}</p>
        </div>

        <div className="rounded-xl bg-neutral-50 p-3 text-neutral-700">
          <p className="text-neutral-400">Penyakit Penyerta</p>
          <p className="mt-0.5 font-medium text-neutral-900">
            {patient.chronicConditions}
          </p>
        </div>
      </div>

      {/* Riwayat Pemeriksaan + Tombol Tambah Catatan Dokter */}
      <div className="mt-4 border-t border-neutral-100 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-neutral-900">
            Riwayat Pemeriksaan ({patient.medicalHistory.length})
          </p>
          <button
            type="button"
            onClick={() => setIsAddingNote((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:bg-neutral-50"
          >
            <PlusIcon width={12} height={12} />
            {isAddingNote ? 'Tutup Form' : 'Catat Pemeriksaan Dokter'}
          </button>
        </div>

        {/* Form Tambah Riwayat Pemeriksaan Dokter */}
        {isAddingNote && (
          <form
            onSubmit={(e) => void handleSaveDoctorNote(e)}
            className="mt-3 space-y-2.5 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3.5 text-xs"
          >
            <p className="font-semibold text-neutral-800">
              Input Pemeriksaan Baru (SOAP / Rekam Medis)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={notePoli}
                onChange={(e) => setNotePoli(e.target.value)}
                placeholder="Poliklinik"
                className="h-8 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              />
              <input
                value={noteDoctor}
                onChange={(e) => setNoteDoctor(e.target.value)}
                placeholder="Nama Dokter (DPJP)"
                className="h-8 rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              />
            </div>
            <input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="Diagnosis Klinis / ICD-10 (contoh: Observasi Febris / ISPA J06.9) *"
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              required
            />
            <input
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="Tindakan & Resep Obat (contoh: Paracetamol 500mg 3x1, Vitamin C) *"
              className="h-8 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs outline-none focus:border-neutral-900"
              required
            />
            {noteError && (
              <p className="text-[11px] font-medium text-rose-600">{noteError}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingNote(false)}
                className="rounded-full px-3 py-1 text-xs text-neutral-500 hover:text-neutral-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSavingNote}
                className="rounded-full bg-neutral-900 px-3.5 py-1 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                {isSavingNote ? 'Menyimpan…' : 'Simpan Riwayat'}
              </button>
            </div>
          </form>
        )}

        {patient.medicalHistory.length === 0 ? (
          <p className="mt-3 text-xs text-neutral-400">
            Belum ada riwayat kunjungan.
          </p>
        ) : (
          <ol className="mt-3 max-h-48 space-y-3 overflow-y-auto border-l border-neutral-200 pl-3.5 pr-1">
            {patient.medicalHistory.map((item, idx) => (
              <li key={`${item.date}-${idx}`} className="relative text-xs">
                <span className="absolute -left-[18px] top-1.5 h-1.5 w-1.5 rounded-full bg-neutral-400" />
                <p className="text-[11px] text-neutral-400">
                  {item.date} · {item.poliklinik}
                </p>
                <p className="mt-0.5 font-medium text-neutral-900">
                  {item.diagnosis}
                </p>
                <p className="text-neutral-600">{item.treatment}</p>
                <p className="text-[11px] text-neutral-400">{item.doctor}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Komponen Utama Pemindai & Antrean                                         */
/* -------------------------------------------------------------------------- */

function AttendanceCamera() {
  const frame = useFrameCapture();
  const verification = useAttendanceVerification();
  const [poli, setPoli] = useState<string>(AUTO_POLI);
  const [queues, setQueues] = useState<readonly PoliQueueSnapshot[]>(
    DEFAULT_POLI_QUEUES,
  );
  const [monitorPoli, setMonitorPoli] = useState<string>('Poli Penyakit Dalam');
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState<string | null>(null);

  const camera = useWebCamera({ enabled: frame.image === null });

  const refreshQueues = useCallback(async () => {
    const data = await fetchPoliQueues();
    setQueues(data);
  }, []);

  useEffect(() => {
    void refreshQueues();
    const id = window.setInterval(() => {
      void refreshQueues();
    }, 5000);
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
  }, [camera.status, camera.videoRef, hasFace, verification.identifyLive]);

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
    const result = await advancePoliQueue(targetPoli, action);
    const updatedQueues = result?.queues ?? queues;
    if (result?.queues) {
      setQueues(result.queues);
    } else {
      await refreshQueues();
    }

    const targetSnapshot =
      result?.queue ??
      updatedQueues.find((q) => q.poliklinik === targetPoli) ??
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
    setIsAdvancing(false);
  };

  const handleNext = () => {
    frame.discard();
    verification.reset();
    verification.clearLiveIdentity();
    void refreshQueues();
  };

  const statusText = (() => {
    if (frame.image) {
      if (verification.isSubmitting) return 'Memverifikasi wajah…';
      if (error) return error;
      if (patient?.queueTicket) return 'Terverifikasi · Tiket antrean siap';
      return 'Foto wajah berhasil diambil';
    }
    if (camera.status !== 'ready') return 'Menyiapkan kamera…';
    if (!hasFace) return 'Posisikan wajah menghadap kamera';
    if (detection.faceStatus === 'valid') return 'Tahan sebentar untuk memindai…';
    return detection.guidance;
  })();

  return (
    <div>
      {/* Struk Cetak Thermal 58mm/80mm (Hanya muncul saat window.print) */}
      {patient && (
        <ThermalPrintReceipt
          patient={patient}
          livePoliQueue={activePoliQueue}
        />
      )}

      {/* Panel Panggil Antrean + Suara TTS */}
      <MinimalQueuePanel
        queues={queues}
        activePoliName={effectivePoliName}
        onSelectPoli={(selected) => setMonitorPoli(selected)}
        onQueueAction={(target, action) => void handleQueueAction(target, action)}
        isAdvancing={isAdvancing}
        lastSpokenText={lastSpokenText}
      />

      <div className="no-print grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
        {/* Kolom Kiri: Kamera Biometrik */}
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-900">
              Kamera Pemindai Wajah
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
                <option value={AUTO_POLI}>Otomatis (Sesuai Riwayat)</option>
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
            faceSubLabel={live ? `${live.noRm} · ${live.poliklinik}` : null}
            faceAlert={live ? hasRealAllergy(live.allergies) : false}
          >
            {frame.image && verification.isSubmitting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/55 backdrop-blur-sm">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <p className="text-xs font-medium text-white">
                  Mencocokkan wajah & menerbitkan antrean…
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
                    : hasFace || frame.image
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

            {frame.image ? (
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
                disabled={camera.status !== 'ready'}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                <ScanIcon width={13} height={13} />
                Ambil Antrean
              </button>
            )}
          </div>
        </section>

        {/* Kolom Kanan: Tiket Antrean & Rekam Medis */}
        <section className="space-y-4">
          {patient ? (
            <>
              <QueueTicketCard
                patient={patient}
                livePoliQueue={activePoliQueue}
                onQueueAction={(target, action) =>
                  void handleQueueAction(target, action)
                }
                isAdvancing={isAdvancing}
                onNext={handleNext}
              />
              <PatientDetails
                patient={patient}
                onAddHistory={verification.appendMedicalHistory}
              />
            </>
          ) : (
            <EmptyState activePoliQueue={activePoliQueue} />
          )}
        </section>
      </div>
    </div>
  );
}

export default AttendanceCamera;
