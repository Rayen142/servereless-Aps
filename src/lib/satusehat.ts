/**
 * Modul Interoperabilitas SATUSEHAT Kementerian Kesehatan RI (Standar HL7 FHIR R4)
 * Mengonversi profil pasien terverifikasi biometrik, tiket antrean (Encounter),
 * diagnosis berstandar ICD-10 (Condition), serta persetujuan UU PDP (Consent)
 * ke dalam format JSON Bundle HL7 FHIR R4 sesuai Playbook SATUSEHAT Kemenkes.
 */

import type { RecognizedPerson } from '../hooks/useAttendanceVerification';
import { parseIcd10FromText } from './icd10';

export interface FhirBundle {
  readonly resourceType: 'Bundle';
  readonly id: string;
  readonly meta: {
    readonly lastUpdated: string;
    readonly profile: readonly string[];
  };
  readonly type: 'transaction';
  readonly entry: readonly {
    readonly fullUrl: string;
    readonly resource: Record<string, unknown>;
    readonly request: {
      readonly method: 'POST' | 'PUT';
      readonly url: string;
    };
  }[];
}

function deterministicUuid(seedText: string): string {
  let h1 = 0xdeadbeef ^ seedText.length;
  let h2 = 0x41c6ce57 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    const ch = seedText.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex3 = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
  const hex4 = ((h1 + h2) >>> 0).toString(16).padStart(8, '0');

  return `${hex1}-${hex2.slice(0, 4)}-4${hex2.slice(5, 8)}-a${hex3.slice(1, 4)}-${hex3.slice(4, 8)}${hex4}`;
}

/**
 * Membangun HL7 FHIR R4 Transaction Bundle standar SATUSEHAT Kemenkes RI
 * untuk pasien yang sedang diverifikasi/dilayani.
 */
export function buildSatusehatFhirBundle(patient: RecognizedPerson): FhirBundle {
  const nowIso = new Date().toISOString();
  const orgId = '100027912'; // Contoh Organization ID Fasyankes terdaftar di SATUSEHAT
  const patientUuid = `urn:uuid:${deterministicUuid(`Patient-${patient.noRm}`)}`;
  const encounterUuid = `urn:uuid:${deterministicUuid(`Encounter-${patient.noRm}-${patient.queueTicket?.ticketId ?? nowIso.slice(0, 10)}`)}`;
  const consentUuid = `urn:uuid:${deterministicUuid(`Consent-${patient.noRm}`)}`;

  const fhirGender =
    patient.gender.toLowerCase().includes('perempuan') ||
    patient.gender.toUpperCase() === 'P'
      ? 'female'
      : 'male';

  const patientResource = {
    resourceType: 'Patient',
    identifier: [
      {
        use: 'official',
        system: 'https://fhir.kemkes.go.id/id/nik',
        value: patient.nik && patient.nik !== '-' ? patient.nik : '3273010000000000',
      },
      {
        use: 'usual',
        system: `http://sys-ids.kemkes.go.id/mr/${orgId}`,
        value: patient.noRm,
      },
    ],
    active: true,
    name: [
      {
        use: 'official',
        text: patient.fullName,
      },
    ],
    gender: fhirGender,
    birthDate: patient.birthDate && patient.birthDate !== '-' ? patient.birthDate : '1995-01-01',
    managingOrganization: {
      reference: `Organization/${orgId}`,
      display: 'RSUD SIMRS Biometrik Terpadu',
    },
    extension: [
      {
        url: 'https://fhir.kemkes.go.id/r4/StructureDefinition/biometricVerification',
        valueCodeableConcept: {
          coding: [
            {
              system: 'http://terminology.kemkes.go.id/CodeSystem/biometric-method',
              code: 'FACE-ENSEMBLE-LBPH-HOG-ORB',
              display: `Verified Biometric Face (${patient.similarity.toFixed(1)}%)`,
            },
          ],
        },
      },
    ],
  };

  const consentResource = {
    resourceType: 'Consent',
    status: 'active',
    scope: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/consentscope',
          code: 'patient-privacy',
          display: 'Privacy Consent',
        },
      ],
    },
    category: [
      {
        coding: [
          {
            system: 'http://loinc.org',
            code: '59284-0',
            display: 'Patient Consent',
          },
        ],
        text: 'Persetujuan Pemrosesan Data Pribadi Spesifik (Biometrik Wajah & RME) sesuai UU PDP No. 27 Tahun 2022 & Permenkes No. 24 Tahun 2022',
      },
    ],
    patient: {
      reference: patientUuid,
      display: patient.fullName,
    },
    dateTime: patient.consentTimestamp || nowIso,
    policyRule: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'OPTIN',
          display: 'Opt-In dengan Persetujuan Eksplisit Pasien',
        },
      ],
    },
  };

  const encounterResource = {
    resourceType: 'Encounter',
    identifier: [
      {
        system: `http://sys-ids.kemkes.go.id/encounter/${orgId}`,
        value: patient.queueTicket?.ticketId ?? `ENC-${patient.noRm}-${nowIso.slice(0, 10)}`,
      },
    ],
    status: 'in-progress',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory',
    },
    subject: {
      reference: patientUuid,
      display: patient.fullName,
    },
    participant: [
      {
        type: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
                code: 'ATND',
                display: 'attender',
              },
            ],
          },
        ],
        individual: {
          display: patient.queueTicket?.dokter ?? patient.dokter,
        },
      },
    ],
    period: {
      start: patient.queueTicket?.issuedAt || nowIso,
    },
    location: [
      {
        location: {
          display: `${patient.queueTicket?.poliklinik ?? patient.poliklinik} (${patient.queueTicket?.room ?? 'Instalasi Rawat Jalan'})`,
        },
        status: 'active',
      },
    ],
    serviceProvider: {
      reference: `Organization/${orgId}`,
    },
  };

  const conditionEntries = (
    patient.medicalHistory.length > 0
      ? patient.medicalHistory.slice(0, 3)
      : [
          {
            date: nowIso.slice(0, 10),
            poliklinik: patient.poliklinik,
            doctor: patient.dokter,
            diagnosis: patient.medicalNotes || 'Pemeriksaan Kesehatan Umum (Z00.0)',
            treatment: 'Observasi & edukasi medis rawat jalan',
          },
        ]
  ).map((hist, idx) => {
    const icd = parseIcd10FromText(hist.diagnosis);
    const condUuid = `urn:uuid:${deterministicUuid(`Condition-${patient.noRm}-${idx}-${icd.code}`)}`;
    return {
      fullUrl: condUuid,
      resource: {
        resourceType: 'Condition',
        clinicalStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
              code: 'active',
              display: 'Active',
            },
          ],
        },
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-category',
                code: 'encounter-diagnosis',
                display: 'Encounter Diagnosis',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: icd.system,
              code: icd.code,
              display: icd.display,
            },
          ],
          text: hist.diagnosis,
        },
        subject: {
          reference: patientUuid,
          display: patient.fullName,
        },
        encounter: {
          reference: encounterUuid,
        },
        recordedDate: hist.date,
        note: [
          {
            text: `Terapi/Tindakan: ${hist.treatment} (DPJP: ${hist.doctor})`,
          },
        ],
      },
      request: {
        method: 'POST' as const,
        url: 'Condition',
      },
    };
  });

  return {
    resourceType: 'Bundle',
    id: `satusehat-bundle-${patient.noRm.toLowerCase()}`,
    meta: {
      lastUpdated: nowIso,
      profile: ['https://fhir.kemkes.go.id/r4/StructureDefinition/Bundle'],
    },
    type: 'transaction',
    entry: [
      {
        fullUrl: patientUuid,
        resource: patientResource,
        request: { method: 'POST', url: 'Patient' },
      },
      {
        fullUrl: consentUuid,
        resource: consentResource,
        request: { method: 'POST', url: 'Consent' },
      },
      {
        fullUrl: encounterUuid,
        resource: encounterResource,
        request: { method: 'POST', url: 'Encounter' },
      },
      ...conditionEntries,
    ],
  };
}

export function downloadSatusehatFhirJson(patient: RecognizedPerson): void {
  const bundle = buildSatusehatFhirBundle(patient);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `satusehat_fhir_r4_${patient.noRm}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
