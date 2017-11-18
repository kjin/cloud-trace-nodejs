import * as express from './fixtures/express4';

import { ServerWork, Server } from './base';
import * as http from 'http';

export class Express4Server implements Server {
  private app: express.Express;
  private server: http.Server;

  constructor() {
    const expressModule = require('./fixtures/express4') as typeof express;
    this.app = expressModule();
  }

  handle(options: ServerWork) {
    const method = options.method || 'get';
    const middleware = (req, res, next) => {
      options.work((response) => {
        if (response) {
          res.status(response.code).send(response.body);
        } else {
          next();
        }
      });
    }
    if (options.path) {
      this.app[method](options.path, middleware);
    } else {
      this.app[method](middleware);
    }
  }

  listen(): number {
    this.server = this.app.listen(0);
    return this.server.address().port;
  }

  shutdown(): void {
    if (this.server) {
      this.server.close();
    }
  }

  getExpectedTopStackFrameMethodName(): string {
    return 'middleware';
  }
}
