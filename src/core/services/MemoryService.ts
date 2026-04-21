import { IMemoryStore } from '../interfaces/IMemoryStore';
import { MemoryRecord } from '../interfaces/types';

export class MemoryService {
  constructor(private memoryStore: IMemoryStore) {}

  remember(text: string, ref?: string): Promise<MemoryRecord> {
    return this.memoryStore.add(text, ref);
  }

  list(search?: string): Promise<MemoryRecord[]> {
    return this.memoryStore.list(search);
  }

  forget(id: string): Promise<boolean> {
    return this.memoryStore.remove(id);
  }

  forgetBefore(date: string): Promise<number> {
    return this.memoryStore.removeBefore(date);
  }

  findSimilar(text: string, threshold?: number): Promise<MemoryRecord[]> {
    return this.memoryStore.findSimilar(text, threshold);
  }
}
