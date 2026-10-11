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

export const hasRealAllergy = (allergies: string): boolean => {
  const norm = allergies.trim().toLowerCase();
  return norm !== '' && norm !== '-' && !norm.includes('tidak ada');
};
