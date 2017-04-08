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

 var constants = require('../src/constants.js');

if (!process.env.GCLOUD_PROJECT) {
  console.log('The GCLOUD_PROJECT environment variable must be set.');
  process.exit(1);
}

var emptyLogger = {
  warn: console.warn,
  info: console.info,
  error: console.error,
  debug: console.log
};

var assert = require('assert');
var config = require('../config.js');
var file = require('../src/trace-agent.js');
var SpanData = require('../src/span-data.js');
var agent = file.get(config, emptyLogger);
var constants = require('../src/constants.js');
var cls = require('../src/cls.js');

describe('Trace Agent', function() {

  it('should return the same object on repeated application', function() {
    var agent1 = file.get(config, emptyLogger);
    var agent2 = file.get(config, emptyLogger);
    assert.strictEqual(agent1, agent2);
  });

  describe('isTraceAgentRequest', function() {
    it('should work correctly with various inputs', function() {
      assert.ok(!agent.isTraceAgentRequest());
      assert.ok(!agent.isTraceAgentRequest({}));

      var headers = { 'Foo': constants.TRACE_AGENT_REQUEST_HEADER};
      assert.ok(!agent.isTraceAgentRequest({ headers: headers }));

      headers[constants.TRACE_AGENT_REQUEST_HEADER] = 'something';
      assert.ok(agent.isTraceAgentRequest({ headers: headers }));
    });
  });
});
