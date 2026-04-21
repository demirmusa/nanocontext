import * as fs from 'fs';
import * as path from 'path';
import { ILogger, LogLevel } from '../core/interfaces/ILogger';

export class Logger implements ILogger {
  private level: LogLevel = LogLevel.INFO;
  private logFile: string | null = null;

  constructor(level?: LogLevel, logDir?: string) {
    if (level !== undefined) this.level = level;
    if (logDir) {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logFile = path.join(logDir, 'nc.log');
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.level) return;

    const timestamp = new Date().toISOString();
    const prefix = LogLevel[level].padEnd(5);
    const formatted = args.length > 0
      ? `${message} ${args.map(a => {
          if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
          if (typeof a === 'object') return JSON.stringify(a);
          return String(a);
        }).join(' ')}`
      : message;

    const line = `[${timestamp}] ${prefix} ${formatted}`;

    if (this.logFile) {
      fs.appendFileSync(this.logFile, line + '\n');
    }

    if (level >= LogLevel.ERROR) {
      console.error(line);
    } else if (level >= LogLevel.WARN) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
