import {Logger, logger} from '@google-cloud/common';

const PASS_THROUGH_LOG_LEVEL = Number(process.env.GCLOUD_TEST_LOG_LEVEL || 0);

// tslint:disable-next-line:no-any
type LoggerFunction = (message: any, ...args: any[]) => void;

export class TestLogger implements Logger {
  private logs:
      {[k in keyof Logger]:
           string[]} = {error: [], warn: [], info: [], debug: [], silly: []};
  private innerLogger = logger({level: logger.LEVELS[PASS_THROUGH_LOG_LEVEL]});

  private makeLoggerFn(logLevel: keyof Logger): LoggerFunction {
    // tslint:disable-next-line:no-any
    return (message: any, ...args: any[]) => {
      this.logs[logLevel].push([message, ...args].join(' '));
      this.innerLogger[logLevel](message, ...args);
    };
  }

  error = this.makeLoggerFn('error');
  warn = this.makeLoggerFn('warn');
  info = this.makeLoggerFn('info');
  debug = this.makeLoggerFn('debug');
  silly = this.makeLoggerFn('silly');

  getLogs(logLevel: keyof Logger): string[] {
    return this.logs[logLevel];
  }

  getNumLogsWith(logLevel: keyof Logger, str: string): number {
    return this.logs[logLevel].filter(line => line.includes(str)).length;
  }

  clearLogs(): void {
    (Object.keys(this.logs) as Array<keyof Logger>)
        .forEach(logLevel => this.logs[logLevel].length = 0);
  }
}
