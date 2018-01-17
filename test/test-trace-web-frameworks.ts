import * as trace from './trace';
import { WebFrameworkConstructor, WebFramework } from './web-frameworks/base';
import { Express4 } from './web-frameworks/express';
import axiosModule from 'axios';
import * as assert from 'assert';
import * as semver from 'semver';
import { TraceSpan } from '../src/trace-span';
import { TraceLabels } from '../src/trace-labels';
import { StackFrame } from '../src/span-data';
import { Constants } from '../src/constants';
import * as cls from '../src/cls';
import { Connect3 } from './web-frameworks/connect';
import { Koa1 } from './web-frameworks/koa1';
import { Koa2 } from './web-frameworks/koa2';
import { Hapi8, Hapi12, Hapi15, Hapi16 } from './web-frameworks/hapi';
import { Restify3, Restify4, Restify5, Restify6 } from './web-frameworks/restify';

// The type of a stack trace object after being parsed from a trace span's stack frame label.
type TraceSpanStackFrames = {
  stack_frame: StackFrame[]
};

/**
 * Constants
 */

// The duration to give a span when it's important
const DEFAULT_SPAN_DURATION = 200;
// The acceptable window of variation in span duration
const ASSERT_SPAN_TIME_TOLERANCE_MS = 200;
// The number of times to retry counting spans in the aborted request test
const ABORTED_SPAN_RETRIES = 3;
const SERVER_SPAN_PREDICATE = (span: TraceSpan) => span.kind === 'RPC_SERVER' && span.name !== 'outer';
// The list of web frameworks to test.
const FRAMEWORKS: WebFrameworkConstructor[] = [
  Connect3,
  Express4,
  Hapi8,
  Hapi12,
  Hapi15,
  Hapi16,
  Koa1,
  Koa2,
  Restify3,
  Restify4,
  Restify5,
  Restify6
];

/**
 * Helper Function
 */

// Convenience function that, when awaited, stalls for a given duration of time
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// Assert that the given span's duration is as expected (within tolerance window).
const assertSpanDuration = (span: TraceSpan, expectedTime: number) => {
  const spanDuration = Date.parse(span.endTime) - Date.parse(span.startTime);
  const upperBound = expectedTime + ASSERT_SPAN_TIME_TOLERANCE_MS;
  assert.ok(spanDuration >= expectedTime && spanDuration <= upperBound,
    `Span duration of ${spanDuration} ms is not in the acceptable expected range of [${expectedTime}, ${upperBound}] ms`);
};

/**
 * Main
 */

describe('Web framework tracing', () => {
  let axios: typeof axiosModule;
  before(() => {
    trace.start({
      ignoreUrls: [ /ignore-me/ ]
    });
    axios = require('axios');
  });

  FRAMEWORKS.forEach((webFrameworkConstructor) => {
    const commonName = webFrameworkConstructor.commonName;
    const expectedTopStackFrame = webFrameworkConstructor.expectedTopStackFrame;
    const versionRange = webFrameworkConstructor.versionRange;

    // Skip this set for incompatible versions of Node
    const skip = !semver.satisfies(process.version, versionRange);

    (skip ? describe.skip : describe)(`Tracing ${commonName}`, () => {
      let webFramework: WebFramework;
      let port: number;
      let recordedTime: number;

      before(async () => {
        webFramework = new webFrameworkConstructor();
        webFramework.addHandler({
          path: '/one-handler',
          hasResponse: true,
          fn: async () => {
            recordedTime = Date.now();
            await wait(DEFAULT_SPAN_DURATION);
            recordedTime = Date.now() - recordedTime;
            return { statusCode: 200, message: 'hello!' };
          }
        });
        webFramework.addHandler({
          path: '/two-handlers',
          hasResponse: false,
          fn: async () => {
            recordedTime = Date.now();
            await wait(DEFAULT_SPAN_DURATION / 2);
          }
        });
        webFramework.addHandler({
          path: '/two-handlers',
          hasResponse: true,
          fn: async () => {
            await wait(DEFAULT_SPAN_DURATION / 2);
            recordedTime = Date.now() - recordedTime;
            return { statusCode: 200, message: 'hellohello!!' };
          }
        });
        webFramework.addHandler({
          path: '/propagate-hello',
          hasResponse: true,
          fn: async () => {
            await wait(0); // Add an additional link to the async execution chain.
            const response = await axios.get(`http://localhost:${port}/hello`);
            return { statusCode: response.status, message: response.data };
          }
        });
        webFramework.addHandler({
          path: '/hello',
          hasResponse: true,
          fn: async () => {
            return { statusCode: 200, message: '[incessant barking]' };
          }
        });
        webFramework.addHandler({
          path: '/error',
          hasResponse: true,
          fn: async () => {
            throw new Error('[restrained whimpering]');
          }
        });
        webFramework.addHandler({
          path: '/ignore-me',
          hasResponse: true,
          fn: async () => {
            return { statusCode: 200, message: '[unrestrained whimpering]' };
          }
        });
        port = await webFramework.listen(0);
      });

      beforeEach(() => {
        recordedTime = -Infinity;
      });

      after(() => {
        webFramework.shutdown();
      });

      afterEach(() => {
        trace.clearSpans();
      });

      it('accurately measures get time (1 handler)', async () => {
        await trace.get().runInRootSpan({
          name: 'outer'
        }, async (span) => {
          assert.ok(span);
          await axios.get(`http://localhost:${port}/one-handler`);
          span!.endSpan();
        });
        assert.strictEqual(trace.getSpans().length, 3);
        const serverSpan = trace.getOneSpan(SERVER_SPAN_PREDICATE);
        assertSpanDuration(serverSpan, DEFAULT_SPAN_DURATION);
      });
      
      it('accurately measures get time (2 handlers)', async () => {
        await trace.get().runInRootSpan({
          name: 'outer'
        }, async (span) => {
          assert.ok(span);
          // Hit endpoint with two middlewares/handlers.
          await axios.get(`http://localhost:${port}/two-handlers`);
          span!.endSpan();
        });
        assert.strictEqual(trace.getSpans().length, 3);
        const serverSpan = trace.getOneSpan(SERVER_SPAN_PREDICATE);
        assertSpanDuration(serverSpan, DEFAULT_SPAN_DURATION);
      });
      
      it('handles errors', async () => {
        await trace.get().runInRootSpan({
          name: 'outer'
        }, async (span) => {
          assert.ok(span);
          // Hit endpoint which always throws an error.
          await axios.get(`http://localhost:${port}/error`, {
            validateStatus: () => true // Obviates try/catch.
          });
          span!.endSpan();
        });
        assert.strictEqual(trace.getSpans().length, 3);
        const serverSpan = trace.getOneSpan(SERVER_SPAN_PREDICATE);
        assert.strictEqual(serverSpan.labels[TraceLabels.HTTP_RESPONSE_CODE_LABEL_KEY], '500');
      });

      it('doesn\'t trace ignored urls', async () => {
        await trace.get().runInRootSpan({
          name: 'outer'
        }, async (span) => {
          assert.ok(span);
          // Hit endpoint that always gets ignored.
          await axios.get(`http://localhost:${port}/ignore-me`);
          span!.endSpan();
        });
        assert.strictEqual(trace.getSpans().length, 2);
        assert.strictEqual(trace.getSpans(SERVER_SPAN_PREDICATE).length, 0);
      });

      it('ends span upon client abort', async () => {
        await trace.get().runInRootSpan({
          name: 'outer'
        }, async (span) => {
          assert.ok(span);
          // Hit endpoint, but time out before it has a chance to respond.
          // To ensure that a trace is written, also waits
          await axios.get(`http://localhost:${port}/one-handler`, {
              timeout: DEFAULT_SPAN_DURATION / 2
            }).catch(() => { /* swallow */ });
          // Wait remainder of server response time to ensure that trace is written.
          await wait(DEFAULT_SPAN_DURATION / 2);
          span!.endSpan();
        });
        // Check that the aborted span is written.
        // Retry in intervals because to minimize flakes -- there is no way for us
        // to be notified client-side when the server has completed the client-aborted request.
        for (let i = 0; i < ABORTED_SPAN_RETRIES; i++) {
          if (trace.getSpans().length === 3) {
            break;
          }
          if (i === ABORTED_SPAN_RETRIES - 1) {
            assert.fail(`Aborted span was not written after ${
              DEFAULT_SPAN_DURATION * ABORTED_SPAN_RETRIES
            } milliseconds.`);
          } else {
            await wait(DEFAULT_SPAN_DURATION);
          }
        }
      });

      it('propagates trace context', async () => {
        await trace.get().runInRootSpan({
          name: 'outer'
        }, async (span) => {
          assert.ok(span);
          // Hits endpoint that will make an additional outgoing HTTP request
          // (to another endpoint on the same server).
          await axios.get(`http://localhost:${port}/propagate-hello`);
          span!.endSpan();
        });
        assert.strictEqual(trace.getSpans().length, 5);
        const spans = [
          // outer
          trace.getOneSpan(s => s.name === 'outer'),
          // /propagate-hello client
          trace.getOneSpan(s => s.kind === 'RPC_CLIENT' &&
              s.labels[TraceLabels.HTTP_URL_LABEL_KEY].includes('/propagate-hello')),
          // /propagate-hello server
          trace.getOneSpan(s => s.kind === 'RPC_SERVER' &&
              s.name.includes('/propagate-hello')),
          // /hello client
          trace.getOneSpan(s => s.kind === 'RPC_CLIENT' &&
              s.labels[TraceLabels.HTTP_URL_LABEL_KEY].includes('/hello')),
          // /hello server
          trace.getOneSpan(s => s.kind === 'RPC_SERVER' &&
              s.name.includes('/hello'))
        ];
        for (let i = 0; i < spans.length - 1; i++) {
          // When i is odd, the following assert can only be true if distributed context propagation works.
          // When i is even, it can only be true if application context propagation works.
          assert.strictEqual(spans[i].spanId, spans[i + 1].parentSpanId);
        }
      });

      describe('span properties', () => {
        let serverSpan: TraceSpan;

        beforeEach(async () => {
          await trace.get().runInRootSpan({
            name: 'outer'
          }, async (span) => {
            assert.ok(span);
            // Hit an endpoint with a query parameter.
            await axios.get(`http://localhost:${port}/hello?this-is=dog`);
            span!.endSpan();
          });
          assert.strictEqual(trace.getSpans().length, 3);
          serverSpan = trace.getOneSpan(SERVER_SPAN_PREDICATE);
        });

        it('applies the correct labels', () => {
          const labels = serverSpan.labels;
          assert.strictEqual(labels[TraceLabels.HTTP_RESPONSE_CODE_LABEL_KEY], '200');
          assert.strictEqual(labels[TraceLabels.HTTP_METHOD_LABEL_KEY], 'GET');
          assert.strictEqual(labels[TraceLabels.HTTP_URL_LABEL_KEY], `http://localhost:${port}/hello?this-is=dog`);
          assert.ok(labels[TraceLabels.HTTP_SOURCE_IP]);
        });
  
        it('removes trace frames from stack', () => {
          const stackTrace: TraceSpanStackFrames = JSON.parse(serverSpan.labels[TraceLabels.STACK_TRACE_DETAILS_KEY]);
          assert.strictEqual(stackTrace.stack_frame[0].method_name, expectedTopStackFrame);
        });
  
        it('doesn\'t include query parameters in span name', () => {
          assert.strictEqual(serverSpan.name.indexOf('dog'), -1, `span name ${serverSpan.name} includes query parameters`);
        });
      });
    });
  });
});
