import type { Db } from '@/engine/duckdb/types';
import { DatasetSession } from '@/engine/dataset/session';
import { importClient } from '@/engine/import/importClient';
import type { ImportOptions, ImportResult, ImportStreamResult } from '@/engine/import/types';
import { parseRecipe, recipeToOperations } from '@/engine/history/recipe';
import type { ProjectSource } from './projectSource';
import { projectStore } from './projectStore';

/** Structural subset of the worker client used when restoring a project. */
export interface ProjectImporter {
  import(file: File, options: ImportOptions): Promise<ImportResult>;
  importStream(file: File, options: ImportOptions): Promise<ImportStreamResult>;
}

export interface RestoredProject {
  session: DatasetSession;
  source: ProjectSource;
  name: string;
  steps: number;
}

/**
 * Rebuilds a saved project entirely from local data: source bytes → source
 * table → validated recipe replay. If any step fails the new session is
 * disposed and the saved record is left untouched.
 */
export async function restoreStoredProject(db: Db, importer: ProjectImporter = importClient): Promise<RestoredProject> {
  const saved = await projectStore.get();
  if (!saved) throw new Error('No saved project found in this browser.');

  const file = new File([saved.sourceBytes], saved.fileName);
  const source: ProjectSource = { file, options: saved.importOptions };
  const result: ImportResult | ImportStreamResult =
    saved.importOptions.kind === 'csv' || saved.importOptions.kind === 'tsv'
      ? await importer.importStream(file, saved.importOptions)
      : await importer.import(file, saved.importOptions);
  const session = 'rows' in result ? await DatasetSession.createStreamed(db, result) : await DatasetSession.create(db, result);

  try {
    const recipe = parseRecipe(saved.operationsJson);
    const res = await session.replay(recipeToOperations(recipe));
    if (res.failed) {
      const at = res.failed.index >= 0 ? `step ${res.failed.index + 1}` : 'the final step';
      throw new Error(`Saved history can't be replayed (${at}): ${res.failed.error}`);
    }
    return { session, source, name: saved.name, steps: recipe.operations.length };
  } catch (e) {
    await session.dispose();
    throw e;
  }
}
