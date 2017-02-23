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

/**
 * This file represents a benchmarking harness. It runs one or more benchmarks
 * a number of times and retrieves its average running time.
 */

// All available tests
var tests = {
  http: 'http/http-performance-runner.js',
  express: 'express/express-performance-runner.js',
  mongo: 'mongo/mongo-performance-runner.js',
  restify: 'restify/restify-performance-runner.js'
};

var configurations = {
  'base': { enabled: false },
  'instrumented-sampled': {},
  'instrumented-sample-all': { samplingRate: 0 }
};

// write modes
//   - none: trace-writer#write does nothing
//   - mock: use nock to simulate api server with delay 'api-delay'
//   - full: let runner contact api server directly (we likely never want this)
var argv = minimist(process.argv.slice(2), {
  default: {
    'num-runs': 5,
    'num-requests': 3000,
    'api-delay': 0,
    'write-mode': 'none'
  }
});
if (!argv._.length === 0) {
  console.log('Please specify at least one framework to test: [' +
    Object.keys(tests).join(', ') + ']');
  return;
}

var numRuns = argv['num-runs'];
var testNames = argv._;
var configNames = Object.keys(configurations);

var childArgs = {
  numRequests: argv['num-requests'],
  apiDelay: argv['api-delay'],
  writeMode: argv['write-mode']
};

var results = {};
var next = function() {
  for (var test in results) {
    for (var config in results[test]) {
      var length = results[test][config].raw.length;
      results[test][config].mean = results[test][config].raw.reduce(function(previousValue, currentValue) {
        return {
          time: previousValue.time + currentValue.time / length,
          percentSampled: previousValue.percentSampled + currentValue.percentSampled / length
        };
      }, { time: 0, percentSampled: 0 });
      delete results[test][config].raw;
    }
  }
  console.log(JSON.stringify(results, null, 2));
};

function queueSpawn(testName, configName, options) {
  function queue() {
    var prevNext = next;
    next = function() {
      console.log('--- Running ' + testName + ' with config ' + configName);
      var child = fork(path.join(__dirname, tests[testName]), [], {
        // execArgv: ['--debug-brk']
      });
      setTimeout(function() {
        child.send(options);
        child.on('message', function (message) {
          if (!results[testName]) {
            results[testName] = {};
          }
          if (!results[testName][configName]) {
            results[testName][configName] = { raw: [] };
          }
          results[testName][configName].raw.push(message);
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
  var filteredPluginConfig = { plugins: { [test]: config.plugins[test] } };
  for (var config of configNames) {
    queueSpawn(test, config, _.assign({}, childArgs, {
      config: _.assign({}, filteredPluginConfig, configurations[config])
    }));
  }
}

next();
