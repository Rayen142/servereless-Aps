/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Basis endpoint antrean (default: /api/queue → GET state, POST /action). */
  readonly VITE_QUEUE_API_URL?: string;
}