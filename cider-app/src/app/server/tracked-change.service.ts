import { Injectable, inject } from '@angular/core';
import { HistoryOrigin, runInHistoryContext } from '../data-services/indexed-db/card-history';
import { CurrentProjectService } from './current-project.service';

/**
 * Runs an operation on the project that must be traceable: the state before it
 * is saved as its own version (it can be restored), the operation is described
 * in the version history, and its card changes are journaled together (they can
 * be undone as a whole).
 */
@Injectable({ providedIn: 'root' })
export class TrackedChangeService {
  private readonly currentProject = inject(CurrentProjectService);

  async run<T>(origin: HistoryOrigin, label: string, action: () => Promise<T>): Promise<T> {
    await this.currentProject.checkpoint(label);
    return runInHistoryContext(origin, label, action);
  }
}
