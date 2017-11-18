/**
 * An interface that describes a server response.
 */
export interface ServerResponseDetails {
  /**
   * The status code of the response.
   */
  code: number;

  /**
   * The response body.
   */
  body?: string;
}

/**
 * An interface that describes a piece of work to be run on a server.
 */
export interface ServerWork {
  /**
   * If specified, this work will only be run when the incoming request path matches this value.
   */
  path?: string;

  /**
   * If specified, this work will only be run when the incoming request method matches this value.
   */
  method?: string;

  /**
   * The work to do. The function passed as this field must call the done function.
   * If done is called with an argument, no further work will be done for this request.
   */
  work: (done: (response?: ServerResponseDetails) => void) => void;
}

/**
 * An interface that describes 
 */
export interface Server {
  /**
   * Push a piece of work onto a stack of callbacks to run upon an incoming request,
   * in whatever way is idiomatic to the web framework.
   */
  handle(options: ServerWork): void;

  /**
   * Listens on a port, returning the port number.
   */
  listen(): number;

  /**
   * Shuts down the server.
   */
  shutdown(): void;

  /**
   * Gets the expected name of the function at the top of the call stack
   * when a root span is created.
   */
  getExpectedTopStackFrameMethodName(): string;
}