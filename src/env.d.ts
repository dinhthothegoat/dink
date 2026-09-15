/**
 * Build-time constants Vite substitutes into the bundle.
 *
 * Declared rather than read at runtime because there is no package.json in a
 * browser, and declared HERE rather than inline so the compiler enforces that
 * `vite.config.ts` and the code agree about what exists.
 */
declare const __APP_VERSION__: string;
