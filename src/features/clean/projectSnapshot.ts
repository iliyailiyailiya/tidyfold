import type { DatasetSession } from '@/engine/dataset/session';
import { toRecipe } from '@/engine/history/recipe';
import type { ProjectSource } from './projectSource';
import type { StoredProject } from './projectStore';

/** Builds the exact IndexedDB record written by the opt-in save hook. */
export async function buildStoredProject(session: DatasetSession, source: ProjectSource, now = new Date()): Promise<StoredProject> {
  const recipe = toRecipe(session.history.ops.slice(0, session.cursor), `${session.name} recipe`, now);
  return {
    id: 1,
    name: session.name,
    fileName: session.fileName,
    savedAt: now.toISOString(),
    operationsJson: JSON.stringify(recipe),
    sourceBytes: await source.file.arrayBuffer(),
    importOptions: source.options,
  };
}
