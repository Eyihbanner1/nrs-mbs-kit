/**
 * Minimal typing for the optional "qrcode" package, which is only loaded when
 * someone asks for a PNG. Keeps the kit free of required dependencies.
 */
declare module 'qrcode' {
  export function toFile(path: string, text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): Promise<void>;
}
