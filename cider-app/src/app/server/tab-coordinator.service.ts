import { Injectable } from '@angular/core';

interface TabMessage {
  type: 'query' | 'busy';
  id: string;
}

/**
 * The browser keeps one local working copy (IndexedDB) shared by all the tabs of
 * the application. Two tabs with a project open would overwrite each other's
 * copy, so a tab only opens a project when no other tab has one open.
 *
 * Tabs talk through a BroadcastChannel (available on plain HTTP too, unlike the
 * Web Locks API): a tab asks "is a project open?" and waits briefly for an answer.
 */
@Injectable({ providedIn: 'root' })
export class TabCoordinatorService {
  static readonly ANSWER_DELAY_MS = 300;

  private readonly channel: BroadcastChannel | null =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('cider-project-tabs');
  private hasOpenProject: () => boolean = () => false;
  private readonly pendingQueries = new Map<string, () => void>();

  constructor() {
    this.channel?.addEventListener('message', (event: MessageEvent<TabMessage>) => {
      const message = event.data;
      if (message?.type === 'query' && this.hasOpenProject()) {
        this.channel?.postMessage({ type: 'busy', id: message.id } satisfies TabMessage);
      } else if (message?.type === 'busy') {
        this.pendingQueries.get(message.id)?.();
      }
    });
  }

  /** Tells this tab's coordinator how to know whether a project is open here */
  setOpenProjectCheck(check: () => boolean): void {
    this.hasOpenProject = check;
  }

  /** true if another tab of this browser has a project open */
  projectOpenInOtherTab(): Promise<boolean> {
    const channel = this.channel;
    if (!channel) {
      return Promise.resolve(false);
    }
    const id = Math.random().toString(36).slice(2);
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pendingQueries.delete(id);
        resolve(false);
      }, TabCoordinatorService.ANSWER_DELAY_MS);
      this.pendingQueries.set(id, () => {
        clearTimeout(timer);
        this.pendingQueries.delete(id);
        resolve(true);
      });
      channel.postMessage({ type: 'query', id } satisfies TabMessage);
    });
  }
}
