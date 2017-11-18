// Imported for types only. These should not result in require() calls.
import * as trace from '../../src';

import * as assert from 'assert';
import { generateTraceContext } from '../../src/util';
import { Server } from './servers/base';
import { Express4Server } from './servers/express';
import { assertSpanDurationCorrect, httpGet, SERVER_WAIT, StopWatch, TestTraceAgent } from './common';

describe('trace support for express', () => {
  let traceAgent: TestTraceAgent;
  let tracer: trace.PluginTypes.TraceAgent;
  let server: Server;

  before(() => {
    traceAgent = new TestTraceAgent();
    tracer = traceAgent.start({
      samplingRate: 0,
      ignoreUrls: [/\/ignore-me/]
    });
  });

  beforeEach(() => {
    server = new Express4Server();
  });

  afterEach(() => {
    server.shutdown();
    traceAgent.clearTraces();
  });

  describe('root span', () => {
    describe('request time', () => {
      it('should be correct for get requests', () => {
        server.handle({
          path: '/',
          work: (cb) => {
            setTimeout(() => {
              cb({ code: 200 });
            }, SERVER_WAIT);
          }
        });
        const port = server.listen();

        const watch = new StopWatch();
        return httpGet(`http://localhost:${port}`).then(() => {
          watch.lap();
          const traces = traceAgent.getTraces();
          assert.strictEqual(traces.length, 1);
          const traceSpans = traces[0].spans;
          assert.strictEqual(traceSpans.length, 1);
          const traceSpan = traceSpans[0];
          assert.strictEqual(traceSpan.kind, 'RPC_SERVER');
          assertSpanDurationCorrect(traceSpan, watch.getLastLap());
        });
      });

      it('should be correct when a request is aborted', () => {
        const watch = new StopWatch();
        return new Promise((res) => {
          server.handle({
            path: '/',
            work: (cb) => {
              setTimeout(() => {
                watch.lap();
                cb();
                setImmediate(res);
              }, SERVER_WAIT);
            }
          });
          const port = server.listen();

          httpGet(`http://localhost:${port}`, (req) => {
            setTimeout(() => {
              req.abort();
            }, SERVER_WAIT / 2);
          }).then(() => {
            assert.fail('request was not aborted successfully');
          }, () => { /* catch error from aborted request */ });
        }).then(() => {
          const traces = traceAgent.getTraces();
          assert.strictEqual(traces.length, 1);
          const traceSpans = traces[0].spans;
          assert.strictEqual(traceSpans.length, 1);
          const traceSpan = traceSpans[0];
          assert.strictEqual(traceSpan.kind, 'RPC_SERVER');
          assertSpanDurationCorrect(traceSpan, watch.getLastLap());
        });
      });
    });

    it('should have a suitable name', () => {
      server.handle({
        path: '/hello',
        work: (cb) => {
          cb({ code: 200, body: 'hello!' });
        }
      });
      const port = server.listen();

      return httpGet(`http://localhost:${port}/hello?this-is=dog`).then(() => {
        const traces = traceAgent.getTraces();
        assert.strictEqual(traces.length, 1);
        const traceSpans = traces[0].spans;
        assert.strictEqual(traceSpans.length, 1);
        const traceSpan = traceSpans[0];
        assert.ok(traceSpan.name.indexOf('this-is=dog') === -1, `span path name contains query parameters: ${traceSpan.name}`);
      });
    });

    it('should have response code, method, URL, and source IP as labels', () => {
      server.handle({
        path: '/hello',
        work: (cb) => {
          cb({ code: 200, body: 'hello!' });
        }
      });
      const port = server.listen();

      return httpGet(`http://localhost:${port}/hello?this-is=dog`)
        .then(() => {
          const traces = traceAgent.getTraces();
          assert.strictEqual(traces.length, 1);
          const traceSpans = traces[0].spans;
          assert.strictEqual(traceSpans.length, 1);
          const traceSpan = traceSpans[0];
          const spanUrl = traceSpan.labels[tracer.labels.HTTP_URL_LABEL_KEY];
          assert.ok(spanUrl.endsWith('/hello?this-is=dog'), `span path label doesn\'t contain path: ${spanUrl}`);
          assert.strictEqual(traceSpan.labels[tracer.labels.HTTP_RESPONSE_CODE_LABEL_KEY], '200');
          assert.strictEqual(traceSpan.labels[tracer.labels.HTTP_METHOD_LABEL_KEY], 'GET');
          assert.ok(!!traceSpan.labels[tracer.labels.HTTP_SOURCE_IP], `span path label doesn\'t have a source IP`);
        });
    });

    it('should have the correct stack trace', () => {
      server.handle({
        path: '/',
        work: (cb) => {
          cb({ code: 200 });
        }
      });
      const port = server.listen();

      return httpGet(`http://localhost:${port}`).then(() => {
        const traces = traceAgent.getTraces();
        assert.strictEqual(traces.length, 1);
        const traceSpans = traces[0].spans;
        assert.strictEqual(traceSpans.length, 1);
        const traceSpan = traceSpans[0];

        const stackFrames = JSON.parse(traceSpan.labels[tracer.labels.STACK_TRACE_DETAILS_KEY]);
        assert.ok(stackFrames.stack_frame && stackFrames.stack_frame.length > 0, 'span doesn\'t have any associated stack frames');
        const expectedTopFrame = server.getExpectedTopStackFrameMethodName();
        assert.strictEqual(stackFrames.stack_frame[0].method_name, expectedTopFrame);
      });
    });
  });

  it('should propagate trace context across async boundaries', () => {
    server.handle({
      path: '/',
      work: (cb) => {
        const childSpan = tracer.createChildSpan({ name: 'my-child' });
        if (childSpan) {
          childSpan.endSpan();
        }
        cb({ code: 200 });
      }
    });
    const port = server.listen();

    return httpGet(`http://localhost:${port}`).then(() => {
      const traces = traceAgent.getTraces();
      assert.strictEqual(traces.length, 1);
      const traceSpans = traces[0].spans;
      assert.strictEqual(traceSpans.length, 2);
      const rootSpan = traceSpans[0];
      assert.strictEqual(rootSpan.kind, 'RPC_SERVER');
      const childSpan = traceSpans[1];
      assert.strictEqual(childSpan.kind, 'RPC_CLIENT');
    });
  });

  it('should process distributed trace context', () => {
    server.handle({
      path: '/',
      work: (cb) => {
        cb({ code: 200 });
      }
    });
    const port = server.listen();

    return httpGet({
      protocol: 'http:',
      host: 'localhost',
      port,
      headers: {
        [tracer.constants.TRACE_CONTEXT_HEADER_NAME]: generateTraceContext({
          traceId: 'aabbccddeeff',
          spanId: '112233',
          options: 1
        })
      }
    }).then(() => {
      const traces = traceAgent.getTraces();
      assert.strictEqual(traces.length, 1);
      assert.strictEqual(traces[0].traceId, 'aabbccddeeff');
      const traceSpans = traces[0].spans;
      assert.strictEqual(traceSpans.length, 1);
      const traceSpan = traceSpans[0];
      assert.strictEqual(traceSpan.parentSpanId, '112233');
    });
  });

  it('should not create a root span for ignored URLs', () => {
    server.handle({
      path: '/ignore-me',
      work: (cb) => {
        cb({ code: 200 });
      }
    });
    const port = server.listen();
    return httpGet(`http://localhost:${port}/ignore-me`).then(() => {
      const traces = traceAgent.getTraces();
      assert.strictEqual(traces.length, 0);
    });
  });
});
