/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var assert = require('assert');
var fork = require('child_process').fork;
var path = require('path');
var minimist = require('minimist');
var _ = require('lodash');
var util = require('util');
var config = require('../../config.js').trace;

// write modes
//   - none: trace-writer#write does nothing
//   - mock: use nock to simulate api server with delay 'api-delay'
//   - full: let runner contact api server directly
var argv = minimist(process.argv.slice(2), {
  default: {
    'num-runs': 10,
    'num-requests': 3000,
    'api-delay': 0,
    'write-mode': 'none'
  }
});
if (!argv._.length === 0) {
  console.log('Please specify framework to test: [express, http, mongo, restify]');
  return;
}

var numRuns = argv['num-runs'];
var testNames = argv._;

var childArgs = {
  numRequests: argv['num-requests'],
  apiDelay: argv['api-delay'],
  writeMode: argv['write-mode']
};

var tests = {
  http: 'http/http-performance-runner.js',
  express: 'express/express-performance-runner.js',
  mongo: 'mongo/mongo-performance-runner.js',
  restify: 'restify/restify-performance-runner.js'
};

var results = {};
var next = function() {
  for (var test in results) {
    for (var label in results[test]) {
      var length = results[test][label].raw.length;
      results[test][label].mean = results[test][label].raw.reduce(function(previousValue, currentValue) {
        return {
          time: previousValue.time + currentValue.time / length,
          percentSampled: previousValue.numSampled + currentValue.numSampled / length
        };
      }, { time: 0, percentSampled: 0 });
      delete results[test][label].raw;
    }
  }
  console.log(JSON.stringify(results, null, 2));
};

function queueSpawn(testName, label, options) {
  function queue() {
    var prevNext = next;
    next = function() {
      console.log('--- Running ' + testName + ' with config ' + label);
      var child = fork(path.join(__dirname, tests[testName]), [], {
        // execArgv: ['--debug-brk']
      });
      setTimeout(function() {
        child.send(options);
        child.on('message', function (message) {
          if (!results[testName]) {
            results[testName] = {};
          }
          if (!results[testName][label]) {
            results[testName][label] = { raw: [] };
          }
          results[testName][label].raw.push(message);
        });
        child.on('close', function (code) {
          setTimeout(prevNext, 200);
        });
      }, 200);
    };
  }
  for (var i = 0; i < numRuns; i++) {
    queue();
  }
}

for (var test of testNames) {
  var filteredPlugins = { [test]: config.plugins[test] };
  queueSpawn(test, 'base', _.assign({}, childArgs, { agent: false }));
  queueSpawn(test, 'instrumented-sampled', _.assign({}, childArgs, { agent: true, config: { plugins: filteredPlugins } }));
  queueSpawn(test, 'instrumented-sample-all', _.assign({}, childArgs, { agent: true, config: { samplingRate: 0, plugins: filteredPlugins } }));
}

next();
