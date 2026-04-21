import * as crypto from 'crypto';

export function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 8);
}
