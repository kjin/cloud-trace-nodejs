import * as trace from '../../src';
import { TraceSpan } from '../../src/trace-span';
import { Trace } from '../../src/trace';
import { TraceWriter } from '../../src/trace-writer';
import { oauth2 as nockOAuth2 } from '../nocks';

import * as assert from 'assert';
import * as http from 'http';
import { URL } from 'url';

export const SERVER_WAIT = 200;
export const EPSILON = 20;

/**
 * Given a span, assert that the duration of the span is within an accepted threshold of a given expected duration.
 * @param span The span whose duration should be assessed.
 * @param expected The expected duration of the span, in milliseconds.
 */
export function assertSpanDurationCorrect(span: TraceSpan, expected: number): void {
  const actual = Date.parse(span.endTime) - Date.parse(span.startTime);
  assert.ok(actual - expected <= EPSILON, `Difference between actual and expected span times is too large: ${actual} - ${expected} > ${EPSILON}`);
};

/**
 * Makes a GET request to a given URL, and returns a Promise that resolves when the response is completed.
 * @param options The parameter to pass to http.get.
 */
export function httpGet(options: http.RequestOptions | string | URL, cb?: (req: http.ClientRequest) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(options, (res) => {
      res.on('end', () => setImmediate(resolve));
      res.on('error', (err) => setImmediate(reject.bind(null, err)));
      res.resume();
    });
    req.on('error', (err) => setImmediate(reject.bind(null, err)));
    if (cb) {
      cb(req);
    }
  })
};

/**
 * A class that represents a stopwatch.
 */
export class StopWatch {
  private times: number[] = [0];

  /**
   * Creates a new StopWatch object. This automatically calls lap().
   */
  constructor() {
    this.lap();
  }

  /**
   * Record the current time.
   */
  lap(): void {
    this.times.push(Date.now());
  }

  /**
   * Returns the time between the last two laps.
   * This function should not be called before lap() has been called twice.
   */
  getLastLap(): number {
    return this.times[this.times.length - 1] - this.times[this.times.length - 2];
  }
}

/**
 * A class that exposes the interface of the Trace Agent module, with
 * additional hooks and functions to access trace spans created within the
 * module.
 */
export class TestTraceAgent {
  private traceAgent: typeof trace;
  private traces: Trace[] = [];
  private traceWriter: TraceWriter;

  /**
   * Creates a new TestTraceAgent object.
   */
  constructor() {
    this.traceAgent = require('../../src') as typeof trace;
  }

  /**
   * Starts the Trace Agent, patching it so that traces don't get published
   * to the network or otherwise flushed.
   * @param config The config object passed to the Trace Agent.
   */
  start(config?: trace.Config): trace.PluginTypes.TraceAgent {
    nockOAuth2();
    const agent = this.traceAgent.start(Object.assign({
      samplingRate: 0,
      projectId: '0'
    }, config));
    this.traceWriter = require('../../src/trace-writer').traceWriter.get();

    this.traceWriter.queueTrace = (trace: Trace) => {
      this.traces.push(trace);
    };
    return agent;
  }

  /**
   * Gets the Trace Agent.
   */
  get(): trace.PluginTypes.TraceAgent {
    return this.traceAgent.get();
  }

  /**
   * Gets a list of Trace objects written by the underlying TraceWriter.
   */
  getTraces(): Trace[] {
    return this.traces.map(x => x);
  }

  /**
   * Clears the list of Trace objects written by the underlying TraceWriter.
   */
  clearTraces(): void {
    this.traces = [];
  }
}
