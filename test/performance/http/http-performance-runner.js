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

var run = require('../common.js');
run(function(traceApi, N, done) {
  var http = require('http');
  var port = 8080;
  var httpAgent = new http.Agent({maxSockets: 50});

  var smileyServer = http.createServer(function(req, res) {
    res.end(':)');
  });

  var work = function() {
    var responses = 0;

    var start = process.hrtime();
    for (var i = 0; i < N; ++i) {
      traceApi.runInRootSpan({ name: 'outer' }, function(rootSpan) {
        http.get({port: port, agent: httpAgent, path: '/'}, function(res) {
          var buffer = '';
          if (rootSpan) {
            rootSpan.endSpan();
          }
          res.resume();
          res.on('data', function(data) {
            buffer += data;
          });
          res.on('end', function() {
            if (++responses === N) {
              smileyServer.close();

              var diff = process.hrtime(start);
              done((diff[0] * 1e3 + diff[1] / 1e6).toFixed()); // ms.
            }
          });
        });
      });
    }
  };

  smileyServer.listen(port, work);
});
