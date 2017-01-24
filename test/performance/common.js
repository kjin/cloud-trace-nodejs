var nock = require('nock');
var trace = require('../..');

var DEFAULT_NUM_REQUESTS = 300000;

module.exports = function run(fn) {
  if (process.send) {
    // is child process
    process.on('message', setupAndRun);
  } else if (process.argv[2]) {
    var minimist = require('minimist');
    var args = minimist(process.argv.slice(2));
    setupAndRun({
      numRequests: args['num-requests'] || DEFAULT_NUM_REQUESTS,
      agent: args['agent'] || true
    });
  } else {
    setupAndRun({ numRequests: DEFAULT_NUM_REQUESTS, agent: true, config: {} });
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

    var numRequests = 0;

    function done(time) {
      var result = { time: time, numRequests: numRequests };
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
      if (options.writeMode === 'mock') {
        nock.disableNetConnect();
        nock.enableNetConnect(/localhost/);
        setNock(privateAgent.config_.projectId, options.apiDelay);
        setAuthNock();
      } else if (options.writeMode === 'none') {
        // We want to drop all spans and avoid network ops
        privateAgent.traceWriter.writeSpan = function(spanData) {
          numRequests++;
        };
      }
    } else {
      agent = trace.start({ enabled: false });
    }

    fn(agent, options.numRequests, done);
  }
};
