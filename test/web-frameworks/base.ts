/**
 * An interface representation information that might be returned by a handler function.
 */
export interface WebFrameworkResponse {
  statusCode: number;
  message: string;
}

/**
 * The underlying type of objects passed to WebFramework#addHandler.
 */
export type WebFrameworkAddHandlerOptions = {
  path: string;
} & ({
  hasResponse: false;
  fn: () => Promise<void>;
} | {
  hasResponse: true;
  fn: () => Promise<WebFrameworkResponse>;
});

/**
 * Abstraction over a web framework.
 */
export interface WebFramework {
  /**
   * Adds a handler (or middleware) to the instantiated framework to handle
   * requests with the given options.path, performing (potentially asynchronous) work defined by options.fn.
   */
  addHandler(options: WebFrameworkAddHandlerOptions): void;
  /**
   * Start serving on the given port, returning the port number.
   * If port is set to 0, an ephemeral port number will be chosen (and returned).
   */
  listen(port: number): number|Promise<number>;
  /**
   * Shut down the server.
   */
  shutdown(): void;
}

/**
 * Defines the static members that should exist on a class that implements
 * WebFramework.
 */
export interface WebFrameworkConstructor {
  new(): WebFramework;
  versionRange: string;
  commonName: string;
  expectedTopStackFrame: string;
}
