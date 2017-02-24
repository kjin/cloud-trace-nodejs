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
  var express = require('express');
  var http = require('http');
  var path = '/';
  var port = 8080;
  var agent = new http.Agent({maxSockets: 50});

  var app = express();
  app.get(path, function(req, res) {
    res.end(':)');
  });

  var smileyServer = app.listen(port, function() {
    var responses = 0;

    var start = process.hrtime();
    for (var i = 0; i < N; ++i) {
      http.get({port: port, agent: agent, path: path}, function(res) {
        res.resume();
        res.on('end', function() {
          if (++responses === N) {
            var diff = process.hrtime(start);
            smileyServer.close(function() {
              done((diff[0] * 1e3 + diff[1] / 1e6).toFixed()); //ms.
            });
          }
        });
      });
    }
  });
});
