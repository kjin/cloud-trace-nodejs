var nock = require('nock');
var trace = require('../..');

var DEFAULT_NUM_REQUESTS = 30000;

/**
 * Starts the trace agent and runs a function that represents a benchmark,
 * passing it three things:
 * - The trace agent itself
 * - The number of requests to make
 * - A callback
 * When the benchmark is finished, it should call the callback with the time
 * it took in milliseconds.
 * 
 * If started from the command line, the benchmark starts immediately, and the
 * number of requests is set to the default value DEFAULT_NUM_REQUESTS. An
 * integer can optionally be passed in as a command line argument to replace
 * this number. The results (time and number of requests sampled) will be
 * written to stdout.
 * 
 * If started from within ./test-performance.js, the benchmark will be started
 * when the parent process passes a configuration object. Upon finishing,
 * the results are passed to the parent process instead of being written to
 * stdout.
 */
module.exports = function run(fn) {
  if (process.send) {
    // is child process
    process.on('message', setupAndRun);
  } else {
    var numRequests = parseInt(process.argv[2]) || DEFAULT_NUM_REQUESTS;
    setupAndRun({ numRequests: numRequests, agent: true, config: {} });
  }

  function setupAndRun(options) {
    function setNock(projectId, delay) {
      nock('https://cloudtrace.googleapis.com')
        .persist()
        .patch('/v1/projects/' + projectId + '/traces')
        .delay(delay)
        .reply(200, function() {
          setNock();
          return 'OK';
        });
    }

    function setAuthNock() {
      return nock('https://accounts.google.com')
        .post('/o/oauth2/token')
        .once()
        .reply(200, {
          refresh_token: 'hello',
          access_token: 'goodbye',
          expiry_date: new Date(9999, 1, 1)
        });
    }

    var numSampled = 0;

    function done(time) {
      var result = { time: time, percentSampled: numSampled / options.numRequests };
      if (process.send) {
        process.send(result);
        process.disconnect();
      } else {
        console.log(result);
      }
      nock.cleanAll();
    }

    var agent;
    if (options.agent) {
      agent = trace.start(options.config || {});
      var privateAgent = agent.private_();
      if (options.writeMode === 'none') {
        // We want to drop all spans and avoid network ops
        privateAgent.traceWriter.writeSpan = function(spanData) {
          numSampled++;
        };
      } else {
        if (options.writeMode === 'mock') {
          nock.disableNetConnect();
          nock.enableNetConnect(/localhost/);
          setNock(privateAgent.config_.projectId, options.apiDelay);
          setAuthNock();
        }
        // We still want to count how many samples were taken.
        var originalWriteSpan = privateAgent.traceWriter.writeSpan;
        privateAgent.traceWriter.writeSpan = function(spanData) {
          numSampled++;
          return originalWriteSpan.apply(this, arguments);
        };
      }
    } else {
      agent = trace.start({ enabled: false });
    }

    fn(agent, options.numRequests, done);
  }
};
