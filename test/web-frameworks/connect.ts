import { WebFramework, WebFrameworkAddHandlerOptions, WebFrameworkResponse } from "./base";
import { connect_3 } from '../../src/plugins/types';
import * as http from 'http';
import { AssertionError } from "assert";

export class Connect3 implements WebFramework {
  static commonName = 'connect@3';
  static expectedTopStackFrame = 'middleware';
  static versionRange = '*';
  app: connect_3.Server;
  server: http.Server | null = null;

  constructor() {
    const connect = require('../plugins/fixtures/connect3') as typeof connect_3;
    this.app = connect();
  }

  addHandler(options: WebFrameworkAddHandlerOptions): void {
    this.app.use(options.path, async (req: http.IncomingMessage, res: http.ServerResponse, next: Function) => {
      let response: WebFrameworkResponse | void;
      try {
        response = await options.fn();
      } catch (e) {
        // Unlike in Express, there doesn't seem to be an easily documented way
        // to silence errors
        next(e);
        return;
      }
      if (response) {
        res.statusCode = response.statusCode;
        res.end(response.message);
      } else {
        next();
      }
    });
  }

  listen(port: number): number {
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
