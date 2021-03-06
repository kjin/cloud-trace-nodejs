/**
 * Copyright 2017 Google Inc. All Rights Reserved.
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
var trace = require('..');

describe('index.js', function() {
  var agent;
  var checkUnpatches = [];
  beforeEach(function() {
    agent = trace.start({ forceNewAgent_: true });
  });

  afterEach(function() {
    agent.private_().stop();
    // 
    checkUnpatches.forEach(function(f) { f(); });
    checkUnpatches = [];
  });
  
  function wrapTest(nodule, property) {
    assert(nodule[property].__unwrap,
      property + ' should get wrapped on start');
    checkUnpatches.push(function() {
      assert(!nodule[property].__unwrap,
        property + ' should get unwrapped on stop');
    });
  }

  it('should wrap/unwrap module._load on start/stop', function() {
    wrapTest(require('module'), '_load');
  });

  it('should wrap/unwrap http on start/stop', function() {
    var http = require('http');
    wrapTest(http, 'request');
  });

  it('should wrap/unwrap express on start/stop', function() {
    var express = require('./hooks/fixtures/express4');
    var patchedMethods = require('methods');
    patchedMethods.push('use', 'route', 'param', 'all');
    patchedMethods.forEach(function(method) {
      wrapTest(express.application, method);
    });
  });

  it('should wrap/unwrap hapi on start/stop', function() {
    var hapi = require('./hooks/fixtures/hapi8');
    wrapTest(hapi.Server.prototype, 'connection');
  });

  it('should wrap/unwrap mongodb-core on start/stop', function() {
    var mongo = require('./hooks/fixtures/mongodb-core1');
    wrapTest(mongo.Server.prototype, 'command');
    wrapTest(mongo.Server.prototype, 'insert');
    wrapTest(mongo.Server.prototype, 'update');
    wrapTest(mongo.Server.prototype, 'remove');
    wrapTest(mongo.Cursor.prototype, 'next');
  });

  it('should wrap/unwrap redis on start/stop', function() {
    var redis = require('./hooks/fixtures/redis0.12');
    wrapTest(redis.RedisClient.prototype, 'send_command');
    wrapTest(redis, 'createClient');
  });

  it('should wrap/unwrap restify on start/stop', function() {
    var restify = require('./hooks/fixtures/restify4');
    wrapTest(restify, 'createServer');
  });
});
