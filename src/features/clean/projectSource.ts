import type { ImportOptions } from '@/engine/import/types';

/**
 * The in-memory source of a saved project. Keeping the `File` (rather than
 * eagerly reading bytes) means opting out of persistence costs nothing.
 */
export interface ProjectSource {
  file: File;
  options: ImportOptions;
}
