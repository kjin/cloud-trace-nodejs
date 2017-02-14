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

var shimmer = require('shimmer');
var Module = require('module');
var assert = require('assert');
var proxyquire = require('proxyquire');
var path = require('path');

// Save logs because in some cases we want to verify that something was logged.
var logs = {
  error: '',
  warn: '',
  info: ''
};

// Facilitates loading "fake" modules upon calling require().
// See the 'Plugin Loader Test' test to see the intended behavior of surrounding
// functions.
var fakeModules = {};
var fakeModuleDirectory = '';
// Adds module moduleName to the set of fake modules, using mock as the object
// being "exported" by this module. In addition, providing version makes it
// accessible by calling findModuleVersion.
function addModuleMock(moduleName, version, mock, inDirectory) {
  inDirectory = inDirectory || '';
  if (!fakeModules[inDirectory]) {
    fakeModules[inDirectory] = {};
  }
  fakeModules[inDirectory][moduleName.replace('/', path.sep)] = {
    exports: mock,
    version: version
  };
}
// Gets a mocked module. Doesn't have to be used in unit tests.
function getModuleMock(modulePath) {
  var separatorIndex = modulePath.indexOf('#');
  var moduleDirectory = '';
  var moduleName = modulePath;
  if (separatorIndex !== -1) {
    moduleDirectory = modulePath.split('#')[0];
    moduleName = modulePath.split('#')[1].replace('/', path.sep);
  }
  if (fakeModules[moduleDirectory] && fakeModules[moduleDirectory][moduleName]) {
    return fakeModules[moduleDirectory][moduleName];
  }
  return {
    exports: undefined,
    version: undefined
  };
}
// Sets a string that is prepended to the module path in findModulePath.
// This allows us to simulate different versions of the same module being
// require'd from different locations, and is only used in the test that shows
// that the plugin loader can patch two versions of the same module.
function setFakeModuleDirectory(moduleDirectory) {
  fakeModuleDirectory = moduleDirectory || '';
}

// This function creates an object with just enough properties to appear to the
// plugin loader as the trace agent. It accepts the list of plugins that the
// plugin loader reads.
function createFakeAgent(plugins) {
  function writeToLog(log, data) {
    logs[log] += data + '\n';
  }
  return {
    logger: {
      error: writeToLog.bind(null, 'error'),
      warn: writeToLog.bind(null, 'warn'),
      info: writeToLog.bind(null, 'info')
    },
    config: function() {
      return { plugins: plugins };
    }
  };
}

var proxyUtil = {
  findModulePath: function(request) {
    // In the real findModulePath, the resolved path of a module
    // depends on the directory of the file from which require() is called.
    return (fakeModuleDirectory ? (fakeModuleDirectory + '#') : '') +
      request.replace('/', path.sep);
  },
  findModuleVersion: function(modulePath) {
    return getModuleMock(modulePath).version;
  }
};

describe('Trace Plugin Loader', function() {
  var pluginLoader;

  before(function() {
    // Wrap Module._load so that it loads from our fake module set rather than the
    // real thing
    shimmer.wrap(Module, '_load', function(originalModuleLoad) {
      return function wrappedModuleLoad(modulePath) {
        return getModuleMock(modulePath).exports ||
          originalModuleLoad.apply(this, arguments);
      };
    });

    // proxyquire the plugin loader with stubbed module utility methods
    pluginLoader = proxyquire('../src/trace-plugin-loader.js', {
      './util.js': proxyUtil
    });
  });

  after(function() {
    shimmer.unwrap(Module, '_load');
  });

  afterEach(function() {
    pluginLoader.deactivate();
    logs.error = '';
    logs.warn = '';
    logs.info = '';
    fakeModules = {};
    setFakeModuleDirectory();
  });

  describe('Plugin Loader Test', function() {
    it('works properly', function() {
      addModuleMock('fake-module', '1.0.0', 'result');
      addModuleMock('fake-module', '2.0.0', 'new-result', 'fake-parent');

      assert.strictEqual(require('fake-module'), 'result',
        'addModuleMock makes require() return mocked module');
      assert.strictEqual(proxyUtil.findModulePath('fake-module'), 'fake-module',
        'Stubbed findModulePath gives name of module when no module directory is set');
      assert.strictEqual(proxyUtil.findModuleVersion('fake-module'), '1.0.0',
        'addModuleMock makes stubbed findModuleVersion return mocked version no.');
      
      setFakeModuleDirectory('fake-parent');
      assert.strictEqual(require('fake-module'), 'new-result',
        'setFakeModuleDirectory affects result of require()');
      assert.strictEqual(proxyUtil.findModulePath('fake-module'),
        'fake-parent#fake-module',
        'Stubbed findModulePath includes module directory in name when set');
      assert.strictEqual(proxyUtil.findModuleVersion('fake-module'), '2.0.0',
        'Switching to new directory yields new module version number');
      
      setFakeModuleDirectory();
      assert.strictEqual(require('fake-module'), 'result',
        'Switching to original directory yields original module export');
      assert.strictEqual(proxyUtil.findModuleVersion('fake-module'), '1.0.0',
        'Switching to original directory yields original module version number');
    });
  });

  /**
   * Loads two modules (one of them twice), and makes sure that plugins are
   * applied correctly.
   */
  it('loads plugins no more than once', function() {
    var patched = [];
    addModuleMock('module-a', '1.0.0', {});
    addModuleMock('module-b', '1.0.0', {});
    addModuleMock('module-a-plugin', '', [
      { patch: function() { patched.push('a'); } }
    ]);
    addModuleMock('module-b-plugin', '', [
      { file: '', patch: function() { patched.push('b'); } }
    ]);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-a': 'module-a-plugin',
      'module-b': 'module-b-plugin'
    }));
    assert.deepEqual(patched, [],
      'No patches are initially loaded');
    require('module-a');
    assert.deepEqual(patched, ['a'],
      'Patches are applied when the relevant patch is loaded');
    assert(logs.info.indexOf('Patching module-a at version 1.0.0') !== -1,
      'Info log is emitted when a module if patched');
    require('module-a');
    assert.deepEqual(patched, ['a'],
      'Patches aren\'t applied twice');
    require('module-b');
    assert.deepEqual(patched, ['a', 'b'],
      'Multiple plugins can be loaded, and file can be set to an empty string');
  });

  /**
   * Loads two plugins that each monkeypatch modules, and checks that they are
   * actually monkeypatched.
   */
  it('applies patches', function() {
    addModuleMock('module-c', '1.0.0', {
      getStatus: function() { return 'not wrapped'; }
    });
    addModuleMock('module-d', '1.0.0', {
      getStatus: function() { return 'not wrapped'; }
    });
    addModuleMock('module-c-plugin', '', [
      {
        patch: function(originalModule, api) {
          assert.ok(!!api.createTransaction,
            'Patch functions are given a reference to the agent public API');
          shimmer.wrap(originalModule, 'getStatus', function() {
            return function() { return 'wrapped'; };
          });
        }
      }
    ]);
    assert.strictEqual(require('module-c').getStatus(), 'not wrapped',
      'Plugin loader shouldn\'t affect module before plugin is loaded');
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-c': 'module-c-plugin'
    }));
    assert.strictEqual(require('module-c').getStatus(), 'wrapped',
      'Plugin patch() method is called the right arguments');
    assert.strictEqual(require('module-d').getStatus(), 'not wrapped',
      'Modules for which there aren\'t plugins won\'t be patched');
  });

  /**
   * Loads one module to check that plugin patches that aren't compatible don't
   * get applied. Then, loads another module with no compatible patches to check
   * that nothing gets patched at all.
   */
  it('respects patch set semver conditions', function() {
    var patched = [];
    addModuleMock('module-e', '1.0.0', {});
    addModuleMock('module-f', '2.0.0', {});
    addModuleMock('module-e-plugin', '', [
      { versions: '1.x', patch: function() { patched.push('e-1.x'); } },
      { versions: '2.x', patch: function() { patched.push('e-2.x'); } }
    ]);
    addModuleMock('module-f-plugin', '', [
      { versions: '1.x', patch: function() { patched.push('f-1.x'); } }
    ]);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-e': 'module-e-plugin',
      'module-f': 'module-f-plugin'
    }));
    assert.deepEqual(patched, []);
    require('module-e');
    assert.deepEqual(patched, ['e-1.x'],
      'Only patches with a correct semver condition are loaded');
    require('module-f');
    assert.deepEqual(patched, ['e-1.x'],
      'No patches are loaded if the module version isn\'t supported at all');
    assert(logs.warn.indexOf('module-f: version 2.0.0 not supported') !== -1,
      'A warning is printed if the module version isn\'t supported at all');
  });

  /**
   * Loads a module with internal exports and patches them, and then makes sure
   * that they are actually patched.
   */
  it('patches internal files in modules', function() {
    addModuleMock('module-g', '1.0.0', {
      createSentence: function() {
        return require('module-g/subject').get() + ' ' +
          require('module-g/predicate').get() + '.';
      }
    });
    addModuleMock('module-g/subject', '', {
      get: function() {
        return 'bad tests';
      }
    });
    addModuleMock('module-g/predicate', '', {
      get: function() {
        return 'don\'t make sense';
      }
    });
    addModuleMock('module-g-plugin', '', [
      {
        file: 'subject',
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'get', function() {
            return function() {
              return 'good tests';
            };
          });
        }
      },
      {
        file: 'predicate',
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'get', function() {
            return function() {
              return 'make sense';
            };
          });
        }
      }
    ]);
    assert.strictEqual(require('module-g').createSentence(),
      'bad tests don\'t make sense.');
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-g': 'module-g-plugin'
    }));
    assert.strictEqual(require('module-g').createSentence(),
      'good tests make sense.',
      'Files internal to a module are patched');
  });

  /**
   * Alternately loads two versions of the same module, and checks that each one
   * is patched differently.
   */
  it('can patch multiple different versions of the same module', function() {
    var v1 = { getVersion: function() { return '1.0.0'; } };
    var v2 = { getVersion: function() { return '2.0.0'; } };
    addModuleMock('module-h', '1.0.0', v1, 'somewhere');
    addModuleMock('module-h', '2.0.0', v2, 'somewhere-else');
    addModuleMock('module-h-plugin', '', [
      {
        versions: '1.x',
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'getVersion', function(origGetVersion) {
            return function() {
              return origGetVersion() + ' is ok';
            };
          });
        }
      },
      {
        versions: '2.x',
        patch: function(originalModule, api) {
          shimmer.wrap(originalModule, 'getVersion', function(origGetVersion) {
            return function() {
              return origGetVersion() + ' is better';
            };
          });
        }
      }
    ]);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-h': 'module-h-plugin'
    }));
    setFakeModuleDirectory('somewhere');
    assert.strictEqual(require('module-h').getVersion(), '1.0.0 is ok',
      'Initial patch is correct');
    setFakeModuleDirectory('somehwere-else');
    assert.strictEqual(require('module-h').getVersion(), '2.0.0 is better',
      'Second loaded version is also patched');
    setFakeModuleDirectory('somewhere');
    assert.strictEqual(require('module-h').getVersion(), '1.0.0 is ok',
      'First loaded version doesn\'t get patched again');
  });

  /**
   * Uses module interception to replace module export completely
   */
  it('can intercept modules', function() {
    addModuleMock('module-i', '1.0.0', function() { return 1; });
    addModuleMock('module-i-plugin', '', [{
      intercept: function(originalModule, api) {
        assert.ok(!!api.createTransaction,
          'Intercept functions are given a reference to the agent public API');
        return function() { return originalModule() + 1; };
      }
    }]);
    assert.strictEqual(require('module-i')(), 1);
    // Activate plugin loader
    pluginLoader.activate(createFakeAgent({
      'module-i': 'module-i-plugin'
    }));
    assert.strictEqual(require('module-i')(), 2,
      'Module can be intercepted');
  });

  /**
   * Patches a module, then immediately unpatches it, then patches it again to
   * show that patching isn't irreversible (and neither is unpatching)
   */
  it('can unpatch', function() {
    // Unfortunately, intercepted modules cannot be patched.
    addModuleMock('module-j', '1.0.0', {
      getPatchMode: function() { return 'none'; }
    });
    addModuleMock('module-j-plugin', '', [{
      patch: function(originalModule, api) {
        shimmer.wrap(originalModule, 'getPatchMode', function() {
          return function() { return 'patch'; };
        });
      },
      unpatch: function(originalModule) {
        shimmer.unwrap(originalModule, 'getPatchMode');
      }
    }]);
    assert.strictEqual(require('module-j').getPatchMode(), 'none');
    pluginLoader.activate(createFakeAgent({
      'module-j': 'module-j-plugin'
    }));
    assert.strictEqual(require('module-j').getPatchMode(), 'patch');
    pluginLoader.deactivate();
    assert.strictEqual(require('module-j').getPatchMode(), 'none',
      'Module gets unpatched');
    pluginLoader.activate(createFakeAgent({
      'module-j': 'module-j-plugin'
    }));
    assert.strictEqual(require('module-j').getPatchMode(), 'patch',
      'Patches still work after unpatching');
  });
});
