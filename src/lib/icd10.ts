/**
 * Katalog Referensi Kode Diagnosis Standar WHO ICD-10 (International Classification of Diseases, 10th Revision)
 * Sesuai standar pengkodean klaim INA-CBGs BPJS Kesehatan dan HL7 FHIR R4 Condition SATUSEHAT Kemenkes RI.
 */

export interface Icd10Entry {
  readonly code: string;
  readonly nameId: string;
  readonly nameEn: string;
  readonly poliklinik: string;
  readonly defaultTreatment: string;
}

export const ICD10_CATALOG: readonly Icd10Entry[] = [
  // Poli Penyakit Dalam
  {
    code: 'I10',
    nameId: 'Hipertensi Esensial (Primer)',
    nameEn: 'Essential (primary) hypertension',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Amlodipine 5mg 1x1, Edukasi diet rendah garam & kontrol TD',
  },
  {
    code: 'E11.9',
    nameId: 'Diabetes Melitus Tipe 2 Tanpa Komplikasi',
    nameEn: 'Type 2 diabetes mellitus without complications',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Metformin 500mg 2x1, Evaluasi HbA1c & diet glikemik',
  },
  {
    code: 'K29.7',
    nameId: 'Gastritis (Dispepsia Organik)',
    nameEn: 'Gastritis, unspecified',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Omeprazole 20mg 2x1 ac, Antasida Doen 3x1',
  },
  {
    code: 'K21.9',
    nameId: 'GERD (Refluks Gastroesofageal)',
    nameEn: 'Gastro-oesophageal reflux disease without oesophagitis',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Lansoprazole 30mg 1x1, Sukralfat susp 3x10ml',
  },
  {
    code: 'E78.5',
    nameId: 'Hiperlipidemia / Dislipidemia',
    nameEn: 'Hyperlipidaemia, unspecified',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Simvastatin 20mg 1x1 malam, Diet rendah lemak jenuh',
  },
  {
    code: 'E05.9',
    nameId: 'Tirotoksikosis (Hipertiroidisme)',
    nameEn: 'Thyrotoxicosis, unspecified',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Methimazole 10mg 1x1, Propranolol 10mg 2x1, Cek FT4/TSH',
  },
  {
    code: 'M10.9',
    nameId: 'Artritis Gout (Asam Urat Tinggi)',
    nameEn: 'Gout, unspecified',
    poliklinik: 'Poli Penyakit Dalam',
    defaultTreatment: 'Allopurinol 100mg 1x1, Natrium Diklofenak 50mg 2x1',
  },

  // Poli Umum
  {
    code: 'J06.9',
    nameId: 'Infeksi Saluran Pernapasan Akut (ISPA)',
    nameEn: 'Acute upper respiratory infection, unspecified',
    poliklinik: 'Poli Umum',
    defaultTreatment: 'Paracetamol 500mg 3x1, Cetirizine 10mg 1x1, Vitamin C 500mg',
  },
  {
    code: 'K30',
    nameId: 'Dispepsia Fungsional',
    nameEn: 'Functional dyspepsia',
    poliklinik: 'Poli Umum',
    defaultTreatment: 'Omeprazole 20mg 1x1, Domperidone 10mg 3x1 ac',
  },
  {
    code: 'A09',
    nameId: 'Gastroenteritis Akut (Diare Infeksius)',
    nameEn: 'Infectious gastroenteritis and colitis, unspecified',
    poliklinik: 'Poli Umum',
    defaultTreatment: 'Oralit setiap BAB cair, Zinc 20mg 1x1, Attapulgite 2 tab',
  },
  {
    code: 'R50.9',
    nameId: 'Observasi Febris (Demam Akut)',
    nameEn: 'Fever, unspecified',
    poliklinik: 'Poli Umum',
    defaultTreatment: 'Paracetamol 500mg 3x1 prn demam, Hidrasi cukup, Cek Darah Rutin',
  },
  {
    code: 'R51',
    nameId: 'Cephalgia Akut (Nyeri Kepala Primer)',
    nameEn: 'Headache',
    poliklinik: 'Poli Umum',
    defaultTreatment: 'Paracetamol 500mg 3x1, Istirahat cukup & evaluasi pemicu',
  },
  {
    code: 'A01.0',
    nameId: 'Demam Tifoid (Typhoid Fever)',
    nameEn: 'Typhoid fever',
    poliklinik: 'Poli Umum',
    defaultTreatment: 'Cefixime 200mg 2x1 (7 hari), Paracetamol 500mg 3x1, Diet lunak',
  },

  // Poli Jantung
  {
    code: 'I25.1',
    nameId: 'Penyakit Jantung Koroner (CAD / Aterosklerotik)',
    nameEn: 'Atherosclerotic heart disease',
    poliklinik: 'Poli Jantung',
    defaultTreatment: 'Aspilet 80mg 1x1, Bisoprolol 2.5mg 1x1, Atorvastatin 20mg 1x1',
  },
  {
    code: 'I20.9',
    nameId: 'Angina Pektoris Stabil',
    nameEn: 'Angina pectoris, unspecified',
    poliklinik: 'Poli Jantung',
    defaultTreatment: 'ISDN 5mg sublingual prn nyeri dada, Bisoprolol 5mg 1x1, EKG',
  },
  {
    code: 'I50.9',
    nameId: 'Gagal Jantung Kongestif (CHF)',
    nameEn: 'Heart failure, unspecified',
    poliklinik: 'Poli Jantung',
    defaultTreatment: 'Furosemide 40mg 1x1 pagi, Candesartan 8mg 1x1, Spironolactone 25mg',
  },
  {
    code: 'I48.9',
    nameId: 'Fibrilasi Atrium (Aritmia Jantung)',
    nameEn: 'Atrial fibrillation and atrial flutter, unspecified',
    poliklinik: 'Poli Jantung',
    defaultTreatment: 'Bisoprolol 2.5mg 1x1, Warfarin/Antikoagulan sesuai INR, EKG 12 Lead',
  },
  {
    code: 'I11.9',
    nameId: 'Penyakit Jantung Hipertensi (HHD)',
    nameEn: 'Hypertensive heart disease without (congestive) heart failure',
    poliklinik: 'Poli Jantung',
    defaultTreatment: 'Candesartan 16mg 1x1, Amlodipine 5mg 1x1, Evaluasi Ekokardiografi',
  },

  // Poli Paru & Pernapasan
  {
    code: 'J45.9',
    nameId: 'Asma Bronkial',
    nameEn: 'Asthma, unspecified',
    poliklinik: 'Poli Paru & Pernapasan',
    defaultTreatment: 'Inhaler Salbutamol 100mcg prn sesak, Budesonide/Formoterol 2x1 puff',
  },
  {
    code: 'J44.9',
    nameId: 'Penyakit Paru Obstruktif Kronik (PPOK / COPD)',
    nameEn: 'Chronic obstructive pulmonary disease, unspecified',
    poliklinik: 'Poli Paru & Pernapasan',
    defaultTreatment: 'Tiotropium Bromide inhaler 1x1, N-Acetylcysteine 200mg 3x1, Stop merokok',
  },
  {
    code: 'J18.9',
    nameId: 'Bronkopneumonia / Pneumonia Komunitas',
    nameEn: 'Pneumonia, unspecified',
    poliklinik: 'Poli Paru & Pernapasan',
    defaultTreatment: 'Azithromycin 500mg 1x1, Ambroxol 30mg 3x1, Rontgen Thorax PA',
  },
  {
    code: 'A15.0',
    nameId: 'Tuberkulosis (TB) Paru Terkonfirmasi Bakteriologis',
    nameEn: 'Tuberculosis of lung, confirmed by sputum microscopy',
    poliklinik: 'Poli Paru & Pernapasan',
    defaultTreatment: 'OAT KDT Kategori 1 sesuai berat badan, Pyridoxine (Vit B6) 10mg 1x1',
  },

  // Poli Saraf (Neurologi)
  {
    code: 'G43.9',
    nameId: 'Migrain Tanpa Aura',
    nameEn: 'Migraine, unspecified',
    poliklinik: 'Poli Saraf (Neurologi)',
    defaultTreatment: 'Sumatriptan 50mg prn serangan, Flunarizine 5mg 1x1 malam',
  },
  {
    code: 'G44.2',
    nameId: 'Tension-Type Headache (Nyeri Kepala Tegang)',
    nameEn: 'Tension-type headache',
    poliklinik: 'Poli Saraf (Neurologi)',
    defaultTreatment: 'Ibuprofen 400mg 2x1 pc, Eperisone HCl 50mg 2x1',
  },
  {
    code: 'H81.1',
    nameId: 'Vertigo Posisi Paroksismal Jinak (BPPV)',
    nameEn: 'Benign paroxysmal vertigo',
    poliklinik: 'Poli Saraf (Neurologi)',
    defaultTreatment: 'Betahistine Mesylate 6mg 3x1, Manuver Epley, Dimenhydrinate prn mual',
  },
  {
    code: 'G54.0',
    nameId: 'Neuropati Perifer / Radikulopati',
    nameEn: 'Brachial plexus disorders',
    poliklinik: 'Poli Saraf (Neurologi)',
    defaultTreatment: 'Mecobalamin 500mcg 2x1, Gabapentin 100mg 1x1 malam',
  },

  // Poli Mata
  {
    code: 'H52.1',
    nameId: 'Miopia (Rabun Jauh)',
    nameEn: 'Myopia',
    poliklinik: 'Poli Mata',
    defaultTreatment: 'Koreksi visus dengan resep kacamata lensa sferis negatif, Sodium Hyaluronate tetes mata',
  },
  {
    code: 'H52.2',
    nameId: 'Astigmatisme (Silinder)',
    nameEn: 'Astigmatism',
    poliklinik: 'Poli Mata',
    defaultTreatment: 'Resep kacamata lensa silindris korektif, Artificial tears 4x1 tetes ODS',
  },
  {
    code: 'H10.9',
    nameId: 'Konjungtivitis Akut',
    nameEn: 'Conjunctivitis, unspecified',
    poliklinik: 'Poli Mata',
    defaultTreatment: 'Levofloxacin 0.5% eye drops 4x1 tetes, Artificial tears, Hindari mengucek mata',
  },
  {
    code: 'H25.9',
    nameId: 'Katarak Senilis',
    nameEn: 'Senile cataract, unspecified',
    poliklinik: 'Poli Mata',
    defaultTreatment: 'Cendo Catarlent eye drops 3x1, Persiapan evaluasi biometri & fakoemulsifikasi',
  },

  // Poli Gigi & Mulut
  {
    code: 'K02.1',
    nameId: 'Karies Dentin (Gigi Berlubang)',
    nameEn: 'Caries of dentine',
    poliklinik: 'Poli Gigi & Mulut',
    defaultTreatment: 'Restorasi tambal Composite Resin / Glass Ionomer Cement (GIC)',
  },
  {
    code: 'K04.0',
    nameId: 'Pulpitis Reversibel / Irreversibel',
    nameEn: 'Pulpitis',
    poliklinik: 'Poli Gigi & Mulut',
    defaultTreatment: 'Perawatan Saluran Akar (PSA), Asam Mefenamat 500mg 3x1 pc',
  },
  {
    code: 'K05.0',
    nameId: 'Gingivitis Akut & Kalkulus Dental',
    nameEn: 'Acute gingivitis',
    poliklinik: 'Poli Gigi & Mulut',
    defaultTreatment: 'Scaling ultrasonic rahang atas & bawah, Obat kumur Chlorhexidine 0.12%',
  },
  {
    code: 'K01.1',
    nameId: 'Impaksi Gigi Molar Ketiga (Gigi Bungsu)',
    nameEn: 'Impacted teeth',
    poliklinik: 'Poli Gigi & Mulut',
    defaultTreatment: 'Rontgen Panoramik, Persiapan Odontektomi, Amoxicillin 500mg 3x1',
  },

  // Poli THT
  {
    code: 'H66.9',
    nameId: 'Otitis Media Akut (OMA)',
    nameEn: 'Otitis media, unspecified',
    poliklinik: 'Poli THT',
    defaultTreatment: 'Amoxicillin 500mg 3x1, Ofloxacin ear drops 2x3 tetes, Pseudoephedrine',
  },
  {
    code: 'J30.4',
    nameId: 'Rinitis Alergi',
    nameEn: 'Allergic rhinitis, unspecified',
    poliklinik: 'Poli THT',
    defaultTreatment: 'Loratadine 10mg 1x1, Fluticasone furoate nasal spray 1x2 semprot',
  },
  {
    code: 'J03.9',
    nameId: 'Tonsilitis Akut',
    nameEn: 'Acute tonsillitis, unspecified',
    poliklinik: 'Poli THT',
    defaultTreatment: 'Cefadroxil 500mg 2x1, Ibuprofen 400mg 3x1, Kumur antiseptik hangat',
  },
  {
    code: 'H61.2',
    nameId: 'Serumen Prop (Impaksi Serumen Telinga)',
    nameEn: 'Impacted cerumen',
    poliklinik: 'Poli THT',
    defaultTreatment: 'Irigasi/Ekstraksi serumen liang telinga, Karbogliserin tetes telinga',
  },

  // Poli Kulit & Kelamin
  {
    code: 'L20.9',
    nameId: 'Dermatitis Atopik',
    nameEn: 'Atopic dermatitis, unspecified',
    poliklinik: 'Poli Kulit & Kelamin',
    defaultTreatment: 'Hydrocortisone 2.5% cream 2x1 oles tipis, Cetirizine 10mg 1x1, Pelembap',
  },
  {
    code: 'L23.9',
    nameId: 'Dermatitis Kontak Alergi',
    nameEn: 'Allergic contact dermatitis, unspecified cause',
    poliklinik: 'Poli Kulit & Kelamin',
    defaultTreatment: 'Mometasone furoate 0.1% cream 2x1, Loratadine 10mg 1x1, Hindari alergen',
  },
  {
    code: 'B35.4',
    nameId: 'Tinea Corporis (Infeksi Jamur Kulit)',
    nameEn: 'Tinea corporis',
    poliklinik: 'Poli Kulit & Kelamin',
    defaultTreatment: 'Ketoconazole 2% cream 2x1 selama 14 hari, Jaga kulit tetap kering',
  },
  {
    code: 'L50.9',
    nameId: 'Urtikaria Akut (Biduran)',
    nameEn: 'Urticaria, unspecified',
    poliklinik: 'Poli Kulit & Kelamin',
    defaultTreatment: 'Cetirizine 10mg 1x1, Bedak Salicyl / Calamine lotion 2x1',
  },

  // Poli Ortopedi
  {
    code: 'M54.5',
    nameId: 'Low Back Pain (Nyeri Punggung Bawah / LBP)',
    nameEn: 'Low back pain',
    poliklinik: 'Poli Ortopedi',
    defaultTreatment: 'Meloxicam 15mg 1x1 pc, Eperisone 50mg 2x1, Fisioterapi & edukasi ergonomi',
  },
  {
    code: 'M17.9',
    nameId: 'Osteoartritis Genu (Pengapuran Sendi Lutut)',
    nameEn: 'Gonarthrosis, unspecified',
    poliklinik: 'Poli Ortopedi',
    defaultTreatment: 'Celecoxib 200mg 1x1, Glucosamine 500mg 2x1, Latihan penguatan quadriceps',
  },
  {
    code: 'S93.4',
    nameId: 'Sprain & Strain Pergelangan Kaki (Ankle Sprain)',
    nameEn: 'Sprain and strain of ankle',
    poliklinik: 'Poli Ortopedi',
    defaultTreatment: 'Protokol RICE, Elastic bandage, Natrium Diklofenak 50mg 2x1',
  },
  {
    code: 'M75.1',
    nameId: 'Sindrom Rotator Cuff (Nyeri Bahu)',
    nameEn: 'Rotator cuff syndrome',
    poliklinik: 'Poli Ortopedi',
    defaultTreatment: 'Meloxicam 7.5mg 2x1, Fisioterapi ROM bahu, Kompres hangat',
  },
];

/**
 * Mencari daftar kode ICD-10 berdasarkan kata kunci (kode, nama Indonesia, nama Inggris)
 * dan memprioritaskan entri yang sesuai dengan poliklinik aktif.
 */
export function searchIcd10Catalog(
  query: string,
  preferredPoliklinik?: string,
  limit = 8,
): readonly Icd10Entry[] {
  const q = query.trim().toLowerCase();

  const filtered = ICD10_CATALOG.filter((item) => {
    if (!q) return true;
    return (
      item.code.toLowerCase().includes(q) ||
      item.nameId.toLowerCase().includes(q) ||
      item.nameEn.toLowerCase().includes(q) ||
      item.poliklinik.toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const aPoliMatch =
      preferredPoliklinik && a.poliklinik === preferredPoliklinik ? 0 : 1;
    const bPoliMatch =
      preferredPoliklinik && b.poliklinik === preferredPoliklinik ? 0 : 1;
    if (aPoliMatch !== bPoliMatch) return aPoliMatch - bPoliMatch;

    if (q) {
      const aCodeStarts = a.code.toLowerCase().startsWith(q) ? 0 : 1;
      const bCodeStarts = b.code.toLowerCase().startsWith(q) ? 0 : 1;
      if (aCodeStarts !== bCodeStarts) return aCodeStarts - bCodeStarts;
    }
    return a.code.localeCompare(b.code);
  });

  return sorted.slice(0, limit);
}

/**
 * Memformat entri ICD-10 menjadi teks standar rekam medis:
 * contoh: "Hipertensi Esensial (Primer) (I10)"
 */
export function formatIcd10Diagnosis(entry: Icd10Entry): string {
  return `${entry.nameId} (${entry.code})`;
}

/**
 * Mengekstrak kode ICD-10 dan tampilan nama diagnosis dari string diagnosis rekam medis.
 * Contoh input: "Hipertensi Esensial (I10)" -> { code: "I10", display: "Hipertensi Esensial" }
 */
export function parseIcd10FromText(diagnosisText: string): {
  readonly code: string;
  readonly display: string;
  readonly system: string;
} {
  const match = diagnosisText.match(/\(([A-Z]\d{2}(?:\.\d{1,2})?)\)/i);
  if (match && match[1]) {
    const code = match[1].toUpperCase();
    const catalogItem = ICD10_CATALOG.find((c) => c.code === code);
    const display =
      catalogItem?.nameEn ??
      diagnosisText.replace(match[0], '').trim() ??
      diagnosisText;
    return {
      code,
      display,
      system: 'http://hl7.org/fhir/sid/icd-10',
    };
  }

  // Coba cocokkan langsung awalan kode seperti "I10 - Hipertensi"
  const prefixMatch = diagnosisText.match(/^([A-Z]\d{2}(?:\.\d{1,2})?)\s*[-·:]\s*(.+)$/i);
  if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
    const code = prefixMatch[1].toUpperCase();
    return {
      code,
      display: prefixMatch[2].trim(),
      system: 'http://hl7.org/fhir/sid/icd-10',
    };
  }

  return {
    code: 'Z00.0',
    display: diagnosisText || 'General medical examination',
    system: 'http://hl7.org/fhir/sid/icd-10',
  };
}
