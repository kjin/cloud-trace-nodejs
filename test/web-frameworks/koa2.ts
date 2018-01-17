import { WebFramework, WebFrameworkAddHandlerOptions } from "./base";
import { koa_2 as Koa } from '../../src/plugins/types';
import * as http from 'http';
import { AssertionError } from "assert";

export class Koa2 implements WebFramework {
  static commonName = 'koa@2';
  static expectedTopStackFrame = 'middleware';
  static versionRange = '>=7.5';
  app: Koa;
  server: http.Server | null = null;

  constructor() {
    const Koa = require('../plugins/fixtures/koa2');
    this.app = new Koa();
  }

  addHandler(options: WebFrameworkAddHandlerOptions): void {
    this.app.use(async (ctx, next) => {
      if (ctx.request.path === options.path) {
        const response = await options.fn();
        if (response) {
          ctx.response.status = response.statusCode;
          ctx.response.body = response.message;
        } else {
          await next();
        }
      } else {
        await next();
      }
    });
  }

  listen(port: number): number {
    this.app.on('error', () => { /* silence error */ });
    if (this.server) {
      throw new Error('Server already running.');
    }
    this.server = this.app.listen(port);
    return this.server!.address().port;
  }

  shutdown(): void {
    if (!this.server) {
      throw new Error('No server running');
    }
    this.server.close();
    this.server = null;
  }
}
