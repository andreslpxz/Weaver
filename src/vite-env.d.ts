/// <reference types="vite/client" />

// mammoth no publica declaraciones de tipos propias ni hay @types/mammoth
// en el registro. Se declara aquí una firma mínima con lo que usa
// `src/notebooks/sources.ts` (extractRawText), para no perder chequeo de
// tipos en el resto del proyecto ni tener que usar `any` en el call site.
declare module 'mammoth' {
  export interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;
}
