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

import * as assert from 'assert';
import * as path from 'path';
import * as hook from 'require-in-the-middle';
import * as shimmer from 'shimmer';

import {PluginConfigEntry} from '../src/config';
import {PluginLoader} from '../src/trace-plugin-loader';

import {TestLogger} from './logger';

export interface SimplePluginLoaderConfig {
  // An object which contains paths to files that should be loaded as plugins
  // upon loading a module with a given name.
  plugins: {[pluginName: string]: string|PluginConfigEntry[]};
}

const SEARCH_PATH = `${__dirname}/fixtures/loader/node_modules`;
const PROCESS_TAG = `${PluginLoader.CORE_MODULE}@${process.version.slice(1)}`;

const clearRequireCache = () => {
  Object.keys(require.cache).forEach(key => delete require.cache[key]);
};

describe('Trace Plugin Loader', () => {
  let logger: TestLogger;
  const makePluginLoader = (config: SimplePluginLoaderConfig) => {
    return new PluginLoader(
        logger,
        Object.assign(
            {
              samplingRate: 0,
              ignoreUrls: [],
              enhancedDatabaseReporting: false,
              ignoreContextHeader: false,
              projectId: '0',
              hook: (onRequire: hook.OnRequireFn) => {
                return hook(
                    Object.keys(config.plugins), {internals: true}, onRequire);
              }
            },
            config));
  };

  before(() => {
    module.paths.push(SEARCH_PATH);
    PluginLoader.setPluginSearchPath(SEARCH_PATH);
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clearLogs();
    clearRequireCache();
  });

  it('[sanity check]', () => {
    assert.strictEqual(require('small-number').value, 0);
    assert.strictEqual(require('large-number'), 1e100);
    assert.strictEqual(
        require('new-keyboard'), 'The QUICK BROWN FOX jumps over the LAZY DOG');
    assert.strictEqual(require('my-version-1.0'), '1.0.0');
    assert.strictEqual(require('my-version-1.1'), '1.1.0');
    assert.strictEqual(require('my-version-2.0'), '2.0.0');
  });

  it('doesn\'t patch before activation', () => {
    makePluginLoader({plugins: {'small-number': 'plugin-small-number'}});
    assert.strictEqual(require('small-number').value, 0);
  });

  it('doesn\'t patch modules for which plugins aren\'t specified', () => {
    makePluginLoader({plugins: {}}).activate();
    assert.strictEqual(require('small-number').value, 0);
  });

  it('patches modules when activated, with no plugin file field specifying the main file',
     () => {
       makePluginLoader({
         plugins: {'small-number': 'plugin-small-number'}
       }).activate();
       assert.strictEqual(require('small-number').value, 1);
       // Make sure requiring doesn't patch twice
       assert.strictEqual(require('small-number').value, 1);
       assert.strictEqual(
           logger.getNumLogsWith('info', '[small-number@0.0.1]'), 1);
     });

  it('accepts absolute paths in configuration', () => {
    makePluginLoader({
      plugins: {'small-number': `${SEARCH_PATH}/plugin-small-number`}
    }).activate();
    assert.strictEqual(require('small-number').value, 1);
    assert.strictEqual(
        logger.getNumLogsWith('info', '[small-number@0.0.1]'), 1);
  });

  it('unpatches modules when deactivated', () => {
    const loader = makePluginLoader({
                     plugins: {'small-number': 'plugin-small-number'}
                   }).activate();
    require('small-number');
    loader.deactivate();
    assert.strictEqual(require('small-number').value, 0);
    // One each for activate/deactivate
    assert.strictEqual(
        logger.getNumLogsWith('info', '[small-number@0.0.1]'), 2);
  });

  it('doesn\'t unpatch twice', () => {
    const loader = makePluginLoader({
                     plugins: {'small-number': 'plugin-small-number'}
                   }).activate();
    require('small-number');
    loader.deactivate().deactivate();
    assert.strictEqual(require('small-number').value, 0);
    // One each for activate/deactivate
    assert.strictEqual(
        logger.getNumLogsWith('info', '[small-number@0.0.1]'), 2);
  });

  it('doesn\'t unpatch modules when deactivated immediately', () => {
    makePluginLoader({
      plugins: {'small-number': 'plugin-small-number'}
    }).deactivate();
    assert.strictEqual(require('small-number').value, 0);
  });

  it('intercepts and patches internal files', () => {
    makePluginLoader({
      plugins: {'large-number': 'plugin-large-number'}
    }).activate();
    assert.strictEqual(require('large-number'), 2e100);
  });

  ['http', 'url', '[core]'].forEach(key => {
    it(`intercepts and patches core modules with key "${key}"`, () => {
      const loader =
          makePluginLoader({plugins: {[key]: 'plugin-core'}}).activate();
      assert.strictEqual(require('url').format({host: 'hi'}), 'patched-value');
      loader.deactivate();
      assert.strictEqual(require('url').format({host: 'hi'}), 'hi');
      // One each for activate/deactivate
      assert.strictEqual(
          logger.getNumLogsWith('info', `[${PROCESS_TAG}:url]`), 2);
    });
  });

  it('intercepts and patches files with circular dependencies', () => {
    makePluginLoader({
      plugins: {'new-keyboard': 'plugin-new-keyboard'}
    }).activate();
    assert.strictEqual(
        require('new-keyboard'),
        'The lab-grown ketchup Fox jumps over the chili Dog');
  });

  it('doesn\'t load plugins with falsey paths', () => {
    makePluginLoader({plugins: {'small-number': ''}}).activate();
    assert.strictEqual(require('small-number').value, 0);
  });

  it('uses pre-load version ranges to determine plugin to load', () => {
    makePluginLoader({
      plugins:
          {'my-version': [{versions: '2.x', path: 'plugin-my-version-2'}]}
    }).activate();
    assert.strictEqual(require('my-version-1.0'), '1.0.0');
    assert.strictEqual(require('my-version-1.1'), '1.1.0');
    assert.strictEqual(require('my-version-2.0'), '2.0.0-patched');
    // warns for my-version-1.x that nothing matches
    assert.strictEqual(logger.getNumLogsWith('warn', '[my-version@1.0.0]'), 1);
    assert.strictEqual(logger.getNumLogsWith('warn', '[my-version@1.1.0]'), 1);
  });

  it('uses post-load version ranges to determine how to patch internals',
     () => {
       makePluginLoader({
         plugins: {'my-version': [{path: 'plugin-my-version-1'}]}
       }).activate();
       assert.strictEqual(require('my-version-1.0'), '1.0.0-patched');
       assert.strictEqual(require('my-version-1.1'), '1.1.0-patched');
       assert.strictEqual(require('my-version-2.0'), '2.0.0');
       // warns for my-version-2.0 that nothing matches
       assert.strictEqual(
           logger.getNumLogsWith('warn', '[my-version@2.0.0]'), 1);
     });

  it('can apply several plugins at once', () => {
    makePluginLoader({
      plugins: {
        'my-version': [
          {versions: '1.1.x', path: 'plugin-my-version-1'},
          {versions: '2.x', path: 'plugin-my-version-2'}
        ]
      }
    }).activate();
    assert.strictEqual(require('my-version-1.0'), '1.0.0');
    assert.strictEqual(require('my-version-1.1'), '1.1.0-patched');
    assert.strictEqual(require('my-version-2.0'), '2.0.0-patched');
    // warns for my-version-1.0 that nothing matches
    assert.strictEqual(logger.getNumLogsWith('warn', '[my-version@1.0.0]'), 1);
  });

  it('patches pre-releases, but warns', () => {
    makePluginLoader({
      plugins:
          {'my-version': [{versions: '1.0.0', path: 'plugin-my-version-1'}]}
    }).activate();
    assert.strictEqual(require('my-version-1.0-pre'), '1.0.0-pre-patched');
    assert.strictEqual(
        logger.getNumLogsWith('warn', '[my-version@1.0.0-pre]'), 1);
  });

  it('warns when a module is patched by multiple plugins', () => {
    makePluginLoader({
      plugins: {
        'my-version':
            [{path: 'plugin-my-version-1'}, {path: 'plugin-my-version-2'}]
      }
    }).activate();
    try {
      require('my-version-1.0');
    } catch (e) {
    }
    assert.strictEqual(logger.getNumLogsWith('warn', '[my-version@1.0.0]'), 1);
  });

  it('warns when a module is patched by a non-conformant plugin', () => {
    makePluginLoader({plugins: {'[core]': 'plugin-core'}}).activate();
    require('crypto');  // neither patch nor intercept
    require('os');      // both patch and intercept
    assert.strictEqual(
        logger.getNumLogsWith('warn', `[${PROCESS_TAG}:crypto]`), 1);
    assert.strictEqual(logger.getNumLogsWith('warn', `[${PROCESS_TAG}:os]`), 1);
  });

  it('throws when the plugin throws', () => {
    makePluginLoader({
      plugins: {'my-version': 'plugin-my-version-2'}
    }).activate();
    let threw = false;
    try {
      require('my-version-1.0');
    } catch (e) {
      threw = true;
    }
    assert.ok(threw);
  });
});
