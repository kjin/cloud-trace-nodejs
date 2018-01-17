import { WebFramework, WebFrameworkAddHandlerOptions, WebFrameworkResponse } from "./base";
import { hapi_16 } from '../../src/plugins/types';
import * as http from 'http';
import { AssertionError } from "assert";

export class Hapi implements WebFramework {
  server: hapi_16.Server;
  // In Hapi, handlers are added after a connection is specified.
  // Since a port number is required to initialize a connection,
  // addHandler() pushes callbacks to this array, whose contents will be
  // invoked lazily upon calling listen().
  queuedHandlers: Array<() => void> = [];

  constructor(path: string) {
    const hapi = require(path) as typeof hapi_16;
    this.server = new hapi.Server();
  }

  addHandler(options: WebFrameworkAddHandlerOptions): void {
    this.queuedHandlers.push(() => {
      if (options.hasResponse) {
        this.server.route({
          method: 'get',
          path: options.path,
          handler: async (request, reply) => {
            let response: WebFrameworkResponse;
            try {
              response = await options.fn();
            } catch (e) {
              reply(e);
              return;
            }
            reply(response.message).statusCode = response.statusCode;
          }
        });
      } else {
        this.server.ext('onPreHandler', async (request, reply) => {
          try {
            await options.fn();
          } catch (e) {
            reply(e);
            return;
          }
          reply.continue();
        });
      }
    });
  }

  async listen(port: number): Promise<number> {
    this.server.connection({ host: 'localhost', port });
    this.queuedHandlers.forEach(fn => fn());
    this.queuedHandlers = [];
    await new Promise((resolve, reject) => this.server.start((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    }));
    return Number(this.server.info!.port);
  }

  shutdown(): void {
    this.server.stop();
  }
}

const makeHapiClass = (version: number) => class extends Hapi {
  static commonName = `hapi@${version}`;
  static expectedTopStackFrame = 'middleware';
  static versionRange = '*';

  constructor() { super(`../plugins/fixtures/hapi${version}`); }
}

export const Hapi8 = makeHapiClass(8);
export const Hapi12 = makeHapiClass(12);
export const Hapi15 = makeHapiClass(15);
export const Hapi16 = makeHapiClass(16);
