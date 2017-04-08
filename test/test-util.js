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
var Module = require('module');
var semver = require('semver');
var util = require('../src/util.js');
var path = require('path');
var constants = require('../src/constants.js');

describe('util.truncate', function() {
  it('should truncate objects larger than size', function() {
    assert.strictEqual(util.truncate('abcdefghijklmno', 5), 'ab...');
  });

  it('should not truncate objects smaller than size', function() {
    assert.strictEqual(util.truncate('abcdefghijklmno', 50), 'abcdefghijklmno');
  });

  it('should handle unicode characters', function() {
    var longName = Array(120).join('☃');
    assert.strictEqual(util.truncate(longName, constants.TRACE_SERVICE_SPAN_NAME_LIMIT),
      Array(42).join('☃') + '...');
  });
});

describe('util.packageNameFromPath', function() {
  it('should work for standard packages', function() {
    var p = path.join('.',
               'appengine-sails',
               'node_modules',
               'testmodule',
               'index.js');
    assert.equal(util.packageNameFromPath(p),
      'testmodule');
  });

  it('should work for namespaced packages', function() {
    var p = path.join('.',
               'appengine-sails',
               'node_modules',
               '@google',
               'cloud-trace',
               'index.js');
    assert.equal(util.packageNameFromPath(p),
      path.join('@google','cloud-trace'));
  });
});

describe('util.findModuleVersion', function() {
  it('should correctly find package.json for userspace packages', function() {
    var pjson = require('../package.json');
    var modulePath = util.findModulePath('glob', module);
    assert(semver.satisfies(util.findModuleVersion(modulePath, Module._load),
        pjson.devDependencies.glob));
  });

  it('should not break for core packages', function() {
    var modulePath = util.findModulePath('http', module);
    assert.equal(util.findModuleVersion(modulePath, Module._load), process.version);
  });

  it('should work with namespaces', function() {
    var modulePath = util.findModulePath('@google-cloud/common', module);
    var truePackage =
      require('../node_modules/@google-cloud/common/package.json');
    assert.equal(util.findModuleVersion(modulePath, Module._load), truePackage.version);
  });
});

describe('util.stringifyTraceContext', function() {
  it('generates a well-formatted stringified context', function() {
    cls.getNamespace().run(function() {
      var spanData = {
        traceId: 'ffeeddccbbaa99887766554433221100',
        spanId: 100,
        options: 2
      };
      var context = util.stringifyTraceContext(spanData);
      assert.strictEqual(context, 'ffeeddccbbaa99887766554433221100/100;o=2');
    });
  });

  it('sets trace enabled bit when traced', function() {
    cls.getNamespace().run(function() {
      var spanData = agent.createRootSpanData('name', 1, 2);
      spanData.options = 2;
      var context = agent.generateTraceContext(spanData, true);
      var parsed = agent.parseContextFromHeader(context);
      assert.equal(parsed.options, 3);
    });
  });

  it('leaves options alone when untraced', function() {
    cls.getNamespace().run(function() {
      var spanData = agent.createRootSpanData('name', 1, 2);
      spanData.options = 2;
      var context = agent.generateTraceContext(spanData, false);
      var parsed = agent.parseContextFromHeader(context);
      assert.equal(parsed.options, 2);
    });
  });

  it('noop on nullSpan', function() {
    cls.getNamespace().run(function() {
      var context = util.generateTraceContext(SpanData.nullSpan);
      assert.equal(context, '');
    });
  });
});

describe('util.parseTraceContext', function() {
  describe('valid inputs', function() {
    it('should return expected values: 123456/667;o=1', function() {
      var result = util.parseTraceContext(
        '123456/667;o=1');
      assert(result);
      assert.equal(result.traceId, '123456');
      assert.equal(result.spanId, 667);
      assert.equal(result.options, '1');
    });

    it('should return expected values:' +
        '123456/123456123456123456123456123456123456;o=1', function() {
      var result = util.parseTraceContext(
        '123456/123456123456123456123456123456123456;o=1');
      assert(result);
      assert.equal(result.traceId, '123456');
      assert.equal(result.spanId, '123456123456123456123456123456123456');
      assert.equal(result.options, '1');
    });

    it('should return expected values: 123456/667', function() {
      var result = util.parseTraceContext(
        '123456/667');
      assert(result);
      assert.equal(result.traceId, '123456');
      assert.equal(result.spanId, 667);
      assert(!result.options);
    });

    it('should return expected values: 123456;o=1', function() {
      var result = util.parseTraceContext(
        '123456;o=1');
      assert(result);
      assert.equal(result.traceId, '123456');
      assert(!result.spanId);
      assert.equal(result.options, '1');
    });

    it('should return expected values: 123456', function() {
      var result = util.parseTraceContext(
        '123456');
      assert(result);
      assert.equal(result.traceId, '123456');
      assert(!result.spanId);
      assert(!result.options);
    });
  });

  describe('invalid inputs', function() {
    var inputs = [
      '',
      null,
      undefined,
      'o=1;123456',
      '123;456;o=1',
      '123/o=1;456',
      '123/abc/o=1'
    ];
    inputs.forEach(function(s) {
      it('should reject ' + s, function() {
        var result = util.parseTraceContext(s);
        assert.ok(!result);
      });
    });
  });
});
