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

/** Objek profil pasien klinik utuh untuk unifikasi seluruh dataset biometrik SIMRS */
export interface PatientProfile {
  readonly personId: string;
  readonly canonicalPersonId?: string;
  readonly noRm: string;
  readonly fullName: string;
  readonly birthDate: string; // Tanggal Lahir (YYYY-MM-DD)
  readonly gender: 'Laki-laki' | 'Perempuan';
  readonly age: number;
  readonly nik: string;
  readonly bloodType: string;
  readonly insurance: string;
  readonly allergies: string;
  readonly chronicConditions: string;
  readonly poliklinik: string;
  readonly dokter: string;
  readonly medicalNotes: string; // Catatan Medis Singkat
  readonly medicalHistory: readonly MedicalHistoryItem[];
  readonly linkedFaceIds?: readonly string[];
}

/**
 * Daftar profil seluruh pasien terdaftar di SIMRS (20 MHS-2026-* + RM-2026-501B + RM-2026-F2C2).
 * Seluruh foto wajah di dataset/images/enrolled/ terpetakan secara utuh ke profil ini.
 */
export const ENROLLED_PATIENT_PROFILES: readonly PatientProfile[] = [
  {
    personId: 'MHS-2026-001',
    noRm: 'RM-2026-0001',
    fullName: 'Aditya Pratama',
    birthDate: '1995-05-14',
    gender: 'Laki-laki',
    age: 31,
    nik: '3273011405950001',
    bloodType: 'O+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Penisilin (Antibiotik), Udang',
    chronicConditions: 'Hipertensi Ringan',
    poliklinik: 'Poli Penyakit Dalam',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    medicalNotes: 'Hipertensi esensial (I10), kontrol rutin tekanan darah & diet rendah garam',
    medicalHistory: [
      {
        date: '2026-09-18',
        poliklinik: 'Poli Penyakit Dalam',
        doctor: 'dr. Hendra Wijaya, Sp.PD',
        diagnosis: 'Hipertensi Esensial (I10)',
        treatment: 'Amlodipine 5mg 1x1, Edukasi diet rendah garam',
      },
      {
        date: '2026-07-04',
        poliklinik: 'Poli Umum',
        doctor: 'dr. Sinta Maharani',
        diagnosis: 'Gastritis Akut (K29.1)',
        treatment: 'Omeprazole 20mg 2x1, Antasida Doen',
      },
    ],
  },
  {
    personId: 'MHS-2026-002',
    noRm: 'RM-2026-0002',
    fullName: 'Nabila Putri Maharani',
    birthDate: '1999-08-25',
    gender: 'Perempuan',
    age: 27,
    nik: '3273025808990002',
    bloodType: 'A+',
    insurance: 'Asuransi Swasta',
    allergies: 'Ibuprofen (NSAID), Debu',
    chronicConditions: 'Asma Bronkial',
    poliklinik: 'Poli Paru & Pernapasan',
    dokter: 'dr. Faisal Rahman, Sp.P',
    medicalNotes: 'Asma bronkial terkontrol (J45.9), evaluasi kapasitas paru & inhaler berkala',
    medicalHistory: [
      {
        date: '2026-09-25',
        poliklinik: 'Poli Paru & Pernapasan',
        doctor: 'dr. Faisal Rahman, Sp.P',
        diagnosis: 'Asma Bronkial Terkontrol (J45.9)',
        treatment: 'Inhaler Salbutamol, Cetirizine 10mg',
      },
      {
        date: '2026-06-12',
        poliklinik: 'Poli Umum',
        doctor: 'dr. Sinta Maharani',
        diagnosis: 'ISPA Ringan (J06.9)',
        treatment: 'Paracetamol 500mg, Vitamin C',
      },
    ],
  },
  {
    personId: 'MHS-2026-003',
    noRm: 'RM-2026-0003',
    fullName: 'Rizky Ramadhan',
    birthDate: '1988-01-21',
    gender: 'Laki-laki',
    age: 38,
    nik: '3273032101880003',
    bloodType: 'B+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Diabetes Melitus Tipe 2',
    poliklinik: 'Poli Penyakit Dalam',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    medicalNotes: 'Diabetes melitus tipe 2 (E11), kontrol rutin HbA1c & diet glikemik',
    medicalHistory: [
      {
        date: '2026-09-10',
        poliklinik: 'Poli Penyakit Dalam',
        doctor: 'dr. Hendra Wijaya, Sp.PD',
        diagnosis: 'Diabetes Melitus Tipe 2 (E11)',
        treatment: 'Metformin 500mg 2x1, Cek HbA1c rutin',
      },
    ],
  },
  {
    personId: 'MHS-2026-004',
    noRm: 'RM-2026-0004',
    fullName: 'Aulia Rahmawati',
    birthDate: '1996-04-20',
    gender: 'Perempuan',
    age: 30,
    nik: '3273046204960004',
    bloodType: 'O+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Amoxicillin',
    chronicConditions: 'Tidak Ada',
    poliklinik: 'Poli Mata',
    dokter: 'dr. Ratna Kusuma, Sp.M',
    medicalNotes: 'Miopia & astigmatisme (H52.1), koreksi kacamata refraksi',
    medicalHistory: [
      {
        date: '2026-08-29',
        poliklinik: 'Poli Mata',
        doctor: 'dr. Ratna Kusuma, Sp.M',
        diagnosis: 'Miopia & Astigmatisme (H52.1)',
        treatment: 'Resep kacamata koreksi & tetes mata Sodium Hyaluronate',
      },
    ],
  },
  {
    personId: 'MHS-2026-005',
    noRm: 'RM-2026-0005',
    fullName: 'Fajar Nugroho',
    birthDate: '1992-07-19',
    gender: 'Laki-laki',
    age: 34,
    nik: '3273051907920005',
    bloodType: 'AB+',
    insurance: 'Umum',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Dislipidemia',
    poliklinik: 'Poli Jantung',
    dokter: 'dr. Bambang Hartono, Sp.JP',
    medicalNotes: 'Hiperkolesterolemia (E78.0), evaluasi profil lipid & EKG berkala',
    medicalHistory: [
      {
        date: '2026-09-02',
        poliklinik: 'Poli Jantung',
        doctor: 'dr. Bambang Hartono, Sp.JP',
        diagnosis: 'Hiperkolesterolemia (E78.0)',
        treatment: 'Simvastatin 20mg 1x1 malam, EKG Normal',
      },
    ],
  },
  {
    personId: 'MHS-2026-006',
    noRm: 'RM-2026-0006',
    fullName: 'Siti Nurhaliza',
    birthDate: '1998-11-04',
    gender: 'Perempuan',
    age: 28,
    nik: '3273064511980006',
    bloodType: 'A+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Antibiotik Sulfa',
    chronicConditions: 'Tidak Ada',
    poliklinik: 'Poli Gigi & Mulut',
    dokter: 'drg. Nadia Larasati',
    medicalNotes: 'Pulpitis irreversible molar 1 (K04.0), perawatan saluran akar',
    medicalHistory: [
      {
        date: '2026-09-14',
        poliklinik: 'Poli Gigi & Mulut',
        doctor: 'drg. Nadia Larasati',
        diagnosis: 'Pulpitis Irreversible Molar 1 (K04.0)',
        treatment: 'Perawatan saluran akar tahap 1, Asam Mefenamat 500mg',
      },
    ],
  },
  {
    personId: 'MHS-2026-007',
    noRm: 'RM-2026-0007',
    fullName: 'Dimas Wahyu Saputra',
    birthDate: '1991-03-11',
    gender: 'Laki-laki',
    age: 35,
    nik: '3273071103910007',
    bloodType: 'O+',
    insurance: 'Asuransi Swasta',
    allergies: 'Kacang Tanah',
    chronicConditions: 'Vertigo Perifer',
    poliklinik: 'Poli Saraf (Neurologi)',
    dokter: 'dr. Arifin Putra, Sp.N',
    medicalNotes: 'Benign Paroxysmal Positional Vertigo (H81.1), terapi vestibular & flunarizine',
    medicalHistory: [
      {
        date: '2026-09-21',
        poliklinik: 'Poli Saraf (Neurologi)',
        doctor: 'dr. Arifin Putra, Sp.N',
        diagnosis: 'Benign Paroxysmal Positional Vertigo (H81.1)',
        treatment: 'Betahistine Mesylate 6mg 3x1, Flunarizine 5mg',
      },
    ],
  },
  {
    personId: 'MHS-2026-008',
    noRm: 'RM-2026-0008',
    fullName: 'Intan Permatasari',
    birthDate: '1997-09-05',
    gender: 'Perempuan',
    age: 29,
    nik: '3273085409970008',
    bloodType: 'B+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Dermatitis Atopik',
    poliklinik: 'Poli Kulit & Kelamin',
    dokter: 'dr. Clara Wijaya, Sp.KK',
    medicalNotes: 'Dermatitis atopik (L20), perawatan barrier kulit & antihistamin',
    medicalHistory: [
      {
        date: '2026-08-30',
        poliklinik: 'Poli Kulit & Kelamin',
        doctor: 'dr. Clara Wijaya, Sp.KK',
        diagnosis: 'Dermatitis Atopik (L20)',
        treatment: 'Krim Hydrocortisone 1%, Loratadine 10mg',
      },
    ],
  },
  {
    personId: 'MHS-2026-009',
    noRm: 'RM-2026-0009',
    fullName: 'Bagas Kurniawan',
    birthDate: '1985-12-28',
    gender: 'Laki-laki',
    age: 40,
    nik: '3273092812850009',
    bloodType: 'A+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Aspirin',
    chronicConditions: 'Asam Urat (Gout)',
    poliklinik: 'Poli Penyakit Dalam',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    medicalNotes: 'Gout arthritis (M10.9), kontrol asam urat & diet rendah purin',
    medicalHistory: [
      {
        date: '2026-09-19',
        poliklinik: 'Poli Penyakit Dalam',
        doctor: 'dr. Hendra Wijaya, Sp.PD',
        diagnosis: 'Gout Arthritis (M10.9)',
        treatment: 'Allopurinol 100mg 1x1, Kolkisin 0.5mg',
      },
    ],
  },
  {
    personId: 'MHS-2026-010',
    noRm: 'RM-2026-0010',
    fullName: 'Dewi Anggraini',
    birthDate: '1994-02-16',
    gender: 'Perempuan',
    age: 32,
    nik: '3273106002940010',
    bloodType: 'O+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Seafood (Kepiting)',
    chronicConditions: 'Tidak Ada',
    poliklinik: 'Poli THT',
    dokter: 'dr. Lukman Hakim, Sp.THT-KL',
    medicalNotes: 'Rhinitis alergi (J30.4), fluticasone nasal spray & kontrol pemicu alergi',
    medicalHistory: [
      {
        date: '2026-09-05',
        poliklinik: 'Poli THT',
        doctor: 'dr. Lukman Hakim, Sp.THT-KL',
        diagnosis: 'Rhinitis Alergi (J30.4)',
        treatment: 'Fluticasone Nasal Spray, Cetirizine 10mg',
      },
    ],
  },
  {
    personId: 'MHS-2026-011',
    noRm: 'RM-2026-0011',
    fullName: 'Ilham Maulana',
    birthDate: '1990-06-15',
    gender: 'Laki-laki',
    age: 36,
    nik: '3273111506900011',
    bloodType: 'B+',
    insurance: 'Umum',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Nyeri Punggung Bawah',
    poliklinik: 'Poli Ortopedi',
    dokter: 'dr. Kevin Santoso, Sp.OT',
    medicalNotes: 'Low back pain / muscle spasm (M54.5), rujukan fisioterapi lumbosakral',
    medicalHistory: [
      {
        date: '2026-09-11',
        poliklinik: 'Poli Ortopedi',
        doctor: 'dr. Kevin Santoso, Sp.OT',
        diagnosis: 'Low Back Pain / Muscle Spasm (M54.5)',
        treatment: 'Eperisone HCl 50mg 2x1, Rujukan Fisioterapi',
      },
    ],
  },
  {
    personId: 'MHS-2026-012',
    noRm: 'RM-2026-0012',
    fullName: 'Putri Ayu Lestari',
    birthDate: '1998-03-24',
    gender: 'Perempuan',
    age: 28,
    nik: '3273124903980012',
    bloodType: 'AB+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Paracetamol Dosis Tinggi',
    chronicConditions: 'Migrain Kronis',
    poliklinik: 'Poli Saraf (Neurologi)',
    dokter: 'dr. Arifin Putra, Sp.N',
    medicalNotes: 'Migraine without aura (G43.0), terapi triptan & edukasi pola tidur',
    medicalHistory: [
      {
        date: '2026-09-22',
        poliklinik: 'Poli Saraf (Neurologi)',
        doctor: 'dr. Arifin Putra, Sp.N',
        diagnosis: 'Migraine without Aura (G43.0)',
        treatment: 'Sumatriptan 50mg prn, Vitamin B Kompleks',
      },
    ],
  },
  {
    personId: 'MHS-2026-013',
    noRm: 'RM-2026-0013',
    fullName: 'Reza Pahlevi',
    birthDate: '1987-10-08',
    gender: 'Laki-laki',
    age: 39,
    nik: '3273130810870013',
    bloodType: 'O+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'GERD',
    poliklinik: 'Poli Penyakit Dalam',
    dokter: 'dr. Hendra Wijaya, Sp.PD',
    medicalNotes: 'Gastroesophageal reflux disease (K21.9), terapi PPI & sukralfat',
    medicalHistory: [
      {
        date: '2026-09-15',
        poliklinik: 'Poli Penyakit Dalam',
        doctor: 'dr. Hendra Wijaya, Sp.PD',
        diagnosis: 'Gastroesophageal Reflux Disease (K21.9)',
        treatment: 'Lansoprazole 30mg 1x1, Sucralfate Sirup 3x1',
      },
    ],
  },
  {
    personId: 'MHS-2026-014',
    noRm: 'RM-2026-0014',
    fullName: 'Anisa Fitriani',
    birthDate: '1999-07-25',
    gender: 'Perempuan',
    age: 27,
    nik: '3273145207990014',
    bloodType: 'A+',
    insurance: 'Asuransi Swasta',
    allergies: 'Lateks',
    chronicConditions: 'Anemia Defisiensi Besi',
    poliklinik: 'Poli Umum',
    dokter: 'dr. Sinta Maharani',
    medicalNotes: 'Anemia defisiensi besi (D50.9), suplementasi ferosulfat & evaluasi Hb',
    medicalHistory: [
      {
        date: '2026-09-08',
        poliklinik: 'Poli Umum',
        doctor: 'dr. Sinta Maharani',
        diagnosis: 'Anemia Defisiensi Besi (D50.9)',
        treatment: 'Ferrous Sulfate 300mg 1x1, Asam Folat',
      },
    ],
  },
  {
    personId: 'MHS-2026-015',
    noRm: 'RM-2026-0015',
    fullName: 'Hendra Gunawan',
    birthDate: '1983-04-23',
    gender: 'Laki-laki',
    age: 43,
    nik: '3273152304830015',
    bloodType: 'B+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Ciprofloxacin',
    chronicConditions: 'Hipertensi & Kolesterol',
    poliklinik: 'Poli Jantung',
    dokter: 'dr. Bambang Hartono, Sp.JP',
    medicalNotes: 'Hypertensive heart disease (I11.9), kontrol tekanan darah & lipid rutin',
    medicalHistory: [
      {
        date: '2026-09-27',
        poliklinik: 'Poli Jantung',
        doctor: 'dr. Bambang Hartono, Sp.JP',
        diagnosis: 'Hypertensive Heart Disease (I11.9)',
        treatment: 'Candersartan 8mg 1x1, Atorvastatin 20mg 1x1',
      },
    ],
  },
  {
    personId: 'MHS-2026-016',
    noRm: 'RM-2026-0016',
    fullName: 'Citra Kirana Dewi',
    birthDate: '1996-01-07',
    gender: 'Perempuan',
    age: 30,
    nik: '3273166701960016',
    bloodType: 'O+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Tidak Ada',
    poliklinik: 'Poli Gigi & Mulut',
    dokter: 'drg. Nadia Larasati',
    medicalNotes: 'Calculus dental (K03.6), pembersihan karang gigi & kontrol periodonsium',
    medicalHistory: [
      {
        date: '2026-08-19',
        poliklinik: 'Poli Gigi & Mulut',
        doctor: 'drg. Nadia Larasati',
        diagnosis: 'Karang Gigi / Calculus Dental (K03.6)',
        treatment: 'Scaling rahang atas & bawah, Obat kumur Chlorhexidine',
      },
    ],
  },
  {
    personId: 'MHS-2026-017',
    noRm: 'RM-2026-0017',
    fullName: 'Arif Budiman',
    birthDate: '1989-09-12',
    gender: 'Laki-laki',
    age: 37,
    nik: '3273171209890017',
    bloodType: 'A+',
    insurance: 'Umum',
    allergies: 'Kotrimoksazol',
    chronicConditions: 'Sinusitis',
    poliklinik: 'Poli THT',
    dokter: 'dr. Lukman Hakim, Sp.THT-KL',
    medicalNotes: 'Sinusitis maksilaris akut (J01.0), terapi dekongestan & antibiotik',
    medicalHistory: [
      {
        date: '2026-09-12',
        poliklinik: 'Poli THT',
        doctor: 'dr. Lukman Hakim, Sp.THT-KL',
        diagnosis: 'Sinusitis Maksilaris Akut (J01.0)',
        treatment: 'Co-Amoxiclav 625mg 3x1, Pseudoephedrine',
      },
    ],
  },
  {
    personId: 'MHS-2026-018',
    noRm: 'RM-2026-0018',
    fullName: 'Larasati Kusuma',
    birthDate: '1997-05-14',
    gender: 'Perempuan',
    age: 29,
    nik: '3273184405970018',
    bloodType: 'B+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Mata Kering (Dry Eye)',
    poliklinik: 'Poli Mata',
    dokter: 'dr. Ratna Kusuma, Sp.M',
    medicalNotes: 'Dry eye syndrome (H04.12), tetes air mata buatan & observasi kornea',
    medicalHistory: [
      {
        date: '2026-09-20',
        poliklinik: 'Poli Mata',
        doctor: 'dr. Ratna Kusuma, Sp.M',
        diagnosis: 'Dry Eye Syndrome (H04.12)',
        treatment: 'Artificial Tears ED 4x1 tetes ODS',
      },
    ],
  },
  {
    personId: 'MHS-2026-019',
    noRm: 'RM-2026-0019',
    fullName: 'Yoga Pratama Putra',
    birthDate: '1993-11-29',
    gender: 'Laki-laki',
    age: 32,
    nik: '3273192911930019',
    bloodType: 'O+',
    insurance: 'Asuransi Swasta',
    allergies: 'Metampiron (Antalgin)',
    chronicConditions: 'Tidak Ada',
    poliklinik: 'Poli Umum',
    dokter: 'dr. Sinta Maharani',
    medicalNotes: 'Observasi febris (R50.9), evaluasi darah rutin & terapi simtomatik',
    medicalHistory: [
      {
        date: '2026-09-17',
        poliklinik: 'Poli Umum',
        doctor: 'dr. Sinta Maharani',
        diagnosis: 'Observasi Febris / Demam Hari ke-2 (R50.9)',
        treatment: 'Paracetamol 500mg 3x1, Cek Darah Rutin',
      },
    ],
  },
  {
    personId: 'MHS-2026-020',
    noRm: 'RM-2026-0020',
    fullName: 'Rania Safitri',
    birthDate: '1995-08-15',
    gender: 'Perempuan',
    age: 31,
    nik: '3273205508950020',
    bloodType: 'A+',
    insurance: 'BPJS Kesehatan',
    allergies: 'Debu & Dingin',
    chronicConditions: 'Bronkitis Alergi',
    poliklinik: 'Poli Paru & Pernapasan',
    dokter: 'dr. Faisal Rahman, Sp.P',
    medicalNotes: 'Bronkitis akut (J20.9), ekspektoran & bronkodilator',
    medicalHistory: [
      {
        date: '2026-09-24',
        poliklinik: 'Poli Paru & Pernapasan',
        doctor: 'dr. Faisal Rahman, Sp.P',
        diagnosis: 'Bronkitis Akut (J20.9)',
        treatment: 'Ambroxol 30mg 3x1, Salbutamol 2mg',
      },
    ],
  },
  {
    personId: 'RM-2026-501B',
    canonicalPersonId: 'RM-2026-501B',
    noRm: 'RM-2026-501B',
    fullName: 'Candra Hidayattuloh',
    birthDate: '2007-04-12',
    gender: 'Laki-laki',
    age: 19,
    nik: '3273012304070001',
    bloodType: 'B+',
    insurance: 'Umum',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Tidak Ada',
    poliklinik: 'Poli Umum',
    dokter: 'dr. Sinta Maharani',
    medicalNotes: 'Observasi demam, batuk pilek & pusing; tanda vital normal stabil',
    linkedFaceIds: [
      'RM-2026-501B',
      'RM-2026-58DB',
      'RM-2026-A204',
      '2702385671',
      'MHS-WEBCAM-USER',
    ],
    medicalHistory: [
      {
        date: '2026-10-24',
        poliklinik: 'Poli Kulit & Kelamin',
        doctor: 'dr. Clara Wijaya, Sp.KK',
        diagnosis: 'Batuk & pusing, observasi tanda vital',
        treatment: 'Pendaftaran Pasien Baru & Pemeriksaan Tanda Vital',
      },
      {
        date: '2026-10-11',
        poliklinik: 'Poli Umum',
        doctor: 'dr. Sinta Maharani',
        diagnosis: 'Observasi Febris, Demam & batuk pilek',
        treatment: 'Pemeriksaan tanda vital, Paracetamol 500mg, Ambroxol sirup',
      },
    ],
  },
  {
    personId: 'RM-2026-F2C2',
    canonicalPersonId: 'RM-2026-F2C2',
    noRm: 'RM-2026-F2C2',
    fullName: 'SYAMANZA',
    birthDate: '2005-02-16',
    gender: 'Laki-laki',
    age: 21,
    nik: '1231111602980007',
    bloodType: 'B+',
    insurance: 'Umum',
    allergies: 'Tidak Ada Alergi',
    chronicConditions: 'Observasi Appendicitis (Usus Buntu)',
    poliklinik: 'Poli Umum',
    dokter: 'dr. Sinta Maharani',
    medicalNotes: 'Nyeri perut kanan bawah / observasi appendicitis / perih lambung',
    medicalHistory: [
      {
        date: '2026-10-11',
        poliklinik: 'Poli Umum',
        doctor: 'dr. Sinta Maharani',
        diagnosis: 'Nyeri perut kanan bawah (obs. appendicitis) & gastritis',
        treatment: 'Pemeriksaan tanda vital, Antasida, evaluasi bedah umum',
      },
    ],
  },
];

/**
 * Mencari profil pasien lengkap berdasarkan ID wajah, Nomor RM (3-digit atau 4-digit), NIK, atau Nama.
 */
export function resolvePatientProfile(query: string): PatientProfile | undefined {
  const norm = query.trim().toLowerCase();
  if (!norm) return undefined;

  // 1. Pencarian eksak pada personId, canonicalPersonId, noRm, nik, atau linkedFaceIds
  for (const profile of ENROLLED_PATIENT_PROFILES) {
    if (
      profile.personId.toLowerCase() === norm ||
      profile.noRm.toLowerCase() === norm ||
      profile.nik.toLowerCase() === norm ||
      profile.linkedFaceIds?.some((id) => id.toLowerCase() === norm)
    ) {
      return profile;
    }
  }

  // 2. Normalisasi format RM (misal RM-2026-001 -> RM-2026-0001)
  const rmMatch = norm.match(/^rm-2026-(\d{1,4})$/i);
  if (rmMatch && rmMatch[1]) {
    const num = Number.parseInt(rmMatch[1], 10);
    const normalized4 = `rm-2026-${String(num).padStart(4, '0')}`;
    const found = ENROLLED_PATIENT_PROFILES.find(
      (p) => p.noRm.toLowerCase() === normalized4,
    );
    if (found) return found;
  }

  // 3. Pencarian substring pada Nama Lengkap
  return ENROLLED_PATIENT_PROFILES.find((p) =>
    p.fullName.toLowerCase().includes(norm),
  );
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

export const hasRealAllergy = (allergies: string): boolean => {
  const norm = allergies.trim().toLowerCase();
  return norm !== '' && norm !== '-' && !norm.includes('tidak ada');
};

/**
 * Mengambil status antrean poliklinik secara real-time via endpoint GET /queue (atau /queues).
 */
export async function fetchPoliQueues(): Promise<readonly PoliQueueSnapshot[]> {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    return DEFAULT_POLI_QUEUES;
  }

  // Coba endpoint GET /queue terlebih dahulu, fallback ke /queues
  const queueUrl = apiUrl.replace(/\/verify\/?$/, '/queue');
  try {
    const resp = await fetch(queueUrl);
    if (resp.ok) {
      const data = (await resp.json()) as { queues?: PoliQueueSnapshot[] };
      if (Array.isArray(data.queues) && data.queues.length > 0) {
        return data.queues;
      }
    }
  } catch {
    /* coba endpoint fallback */
  }

  const fallbackUrl = apiUrl.replace(/\/verify\/?$/, '/queues');
  try {
    const resp = await fetch(fallbackUrl);
    if (resp.ok) {
      const data = (await resp.json()) as { queues?: PoliQueueSnapshot[] };
      if (Array.isArray(data.queues) && data.queues.length > 0) {
        return data.queues;
      }
    }
  } catch {
    /* abaikan */
  }

  return DEFAULT_POLI_QUEUES;
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

/**
 * Memanggil atau memajukan nomor antrean poliklinik melalui POST /queue/action (atau POST /queues/advance).
 */
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

  const payload = JSON.stringify({
    action: queueAction,
    poliklinik,
    queueAction,
  });

  // 1. Coba endpoint POST /queue/action
  const actionUrl = apiUrl.replace(/\/verify\/?$/, '/queue/action');
  try {
    const resp = await fetch(actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        queue?: PoliQueueSnapshot;
        queues?: PoliQueueSnapshot[];
      };
      if (Array.isArray(data.queues)) {
        return { queue: data.queue, queues: data.queues };
      }
    }
  } catch {
    /* coba fallback */
  }

  // 2. Fallback ke POST /queues/advance atau base verify URL
  const fallbackUrl = apiUrl.replace(/\/verify\/?$/, '/queues/advance');
  try {
    const resp = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'advance_queue',
        poliklinik,
        queueAction,
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        queue?: PoliQueueSnapshot;
        queues?: PoliQueueSnapshot[];
      };
      if (Array.isArray(data.queues)) {
        return { queue: data.queue, queues: data.queues };
      }
    }
  } catch {
    /* coba verify endpoint */
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
    if (!resp.ok) return null;
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
        message: data.message ?? 'Catatan pemeriksaan berhasil disimpan.',
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
