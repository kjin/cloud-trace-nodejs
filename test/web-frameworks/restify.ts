import { WebFramework, WebFrameworkAddHandlerOptions, WebFrameworkResponse } from "./base";
import { restify_5 } from '../../src/plugins/types';
import * as http from 'http';
import { AssertionError } from "assert";

export class Restify implements WebFramework {
  server: restify_5.Server;

  constructor(path: string) {
    const restify = require(path) as typeof restify_5;
    this.server = restify.createServer();
  }

  addHandler(options: WebFrameworkAddHandlerOptions): void {
    if (options.hasResponse) {
      this.server.get(options.path, async (req, res, next) => {
        let response: WebFrameworkResponse;
        try {
          response = await options.fn();
        } catch (e) {
          next(e);
          return;
        }
        res.statusCode = response.statusCode;
        res.end(response.message);
        next();
      });
    } else {
      this.server.use(async (req, res, next) => {
        if (req.getPath() !== options.path) {
          next();
          return;
        }
        try {
          await options.fn();
        } catch (e) {
          next(e);
          return;
        }
        next();
      });
    }
  }

  async listen(port: number): Promise<number> {
    this.server.listen(port);
    return this.server.address().port;
  }

  shutdown(): void {
    this.server.close();
  }
}

const makeRestifyClass = (version: number, nodeVersion?: string) => class extends Restify {
  static commonName = `restify@${version}`;
  static expectedTopStackFrame = 'middleware';
  static versionRange = nodeVersion || '*';

  constructor() { super(`../plugins/fixtures/restify${version}`); }
}

export const Restify3 = makeRestifyClass(3, '<7');
export const Restify4 = makeRestifyClass(4);
export const Restify5 = makeRestifyClass(5);
export const Restify6 = makeRestifyClass(6);
