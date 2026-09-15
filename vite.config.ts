import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

/**
 * The version the game prints has to come from the one place it is set.
 *
 * Day 21 packaged a desktop build, ran it, and read "v1.1" off the panel of
 * something tagged v1.2.1. The string had been typed into index.html on Day 11
 * and nothing had any reason to look at it again — not the tests, which ask the
 * simulation questions, and not a person, because a stale version number looks
 * exactly like a fresh one.
 *
 * It matters more now than it did yesterday. A build that somebody downloads
 * and reports a bug against is only useful if it can say which build it is.
 */
const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
