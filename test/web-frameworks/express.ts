import { WebFramework, WebFrameworkAddHandlerOptions, WebFrameworkResponse } from "./base";
import { express_4 } from '../../src/plugins/types';
import * as http from 'http';
import { AssertionError } from "assert";

export class Express4 implements WebFramework {
  static commonName = 'express@4';
  static expectedTopStackFrame = 'middleware';
  static versionRange = '*';
  app: express_4.Application;
  server: http.Server | null = null;

  constructor() {
    const express = require('../plugins/fixtures/express4') as typeof express_4;
    this.app = express();
  }

  addHandler(options: WebFrameworkAddHandlerOptions): void {
    this.app.get(options.path, async (req, res, next) => {
      let response: WebFrameworkResponse | void;
      try {
        response = await options.fn();
      } catch (e) {
        next(e);
        return;
      }
      if (response) {
        res.status(response.statusCode);
        res.send(response.message);
      } else {
        next();
      }
    });
  }

  listen(port: number): number {
    this.app.use((err: Error, req: {}, res: express_4.Response, next: {}) => {
      // silence error
      if (err) {
        res.sendStatus(500);
      }
    });
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
