import { IStateStore } from '../interfaces/IStateStore';

export class FileDiscoveryService {
  constructor(private stateStore: IStateStore) {}

  list(query?: string): string[] {
    const files = this.stateStore.listTrackedFiles().sort((a, b) => a.localeCompare(b));
    if (!query) {
      return files;
    }

    const normalized = query.trim().toLowerCase();
    return files.filter(file => file.toLowerCase().includes(normalized));
  }
}
