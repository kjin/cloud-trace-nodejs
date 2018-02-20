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

import {Logger} from '@google-cloud/common';
import Module = require('module');
import * as hook from 'require-in-the-middle';
import * as path from 'path';
import * as semver from 'semver';
import * as shimmer from 'shimmer';
import * as util from './util';
import * as builtinModules from 'builtin-modules';
import {TraceAgent, TraceAgentConfig} from './trace-api';
import {Patch, Plugin} from './plugin-types';
import { Singleton } from './util';

/**
 * Plugins are user-provided objects containing functions that should be run
 * when a module is loaded, with the intent of monkeypatching a module to be
 * loaded. Each plugin is specific to a module.
 *
 * Plugin objects are a list of load hooks, each of which consists
 * of a file path of a module-internal file to patch, a patch/intercept/hook
 * function, as well as the version range of the module for which that file
 * should be patched. (See ./plugin-types for the exact interface.)
 */

export interface PluginLoaderConfig extends TraceAgentConfig {
  // An object which contains paths to files that should be loaded as plugins
  // upon loading a module with a given name.
  plugins: {[pluginName: string]: string};
}

/**
 * An interface representing configuration passed to the plugin loader, which
 * includes TraceAgent configuration as well.
 */
export interface PluginLoaderSingletonConfig extends PluginLoaderConfig {
  forceNewAgent_: boolean;
}

export interface PluginWrapperOptions {
  name: string;
  path: string;
}

/**
 * A class that abstracts over a user-provided Plugin object.
 */
export class PluginWrapper {
  // Sentinel value to indicate that a plugin has not been loaded into memory
  // yet.
  private static readonly NOT_LOADED: Plugin = [];
  private unpatchFns: Array<() => void> = [];
  // A logger.
  private logger: Logger;
  // Configuration for a TraceAgent instance.
  private traceConfig: TraceAgentConfig;
  // Display-friendly name of the module being patched by this plugin.
  private name: string;
  // The path to the plugin.
  private path: string;
  // The exported value of the plugin, or NOT_LOADED if it hasn't been
  // loaded yet.
  private pluginExportedValue: Plugin = PluginWrapper.NOT_LOADED;
  private traceApiInstances: TraceAgent[] = [];

  /**
   * Constructs a new PluginWrapper instance.
   * @param logger The logger to use.
   * @param options Initialization fields for this object.
   * @param traceConfig Configuration for a TraceAgent instance.
   */
  constructor(
      logger: Logger, options: PluginWrapperOptions,
      traceConfig: TraceAgentConfig) {
    this.logger = logger;
    this.name = options.name;
    this.path = options.path;
    this.traceConfig = traceConfig;
  }

  /**
   * Returns whether the given version of the module is supported by this
   * plugin. This may load the plugin into memory.
   * @param version A semver version string.
   */
  isSupported(version: string): boolean {
    // The plugin is lazily loaded here.
    const plugin = this.getPluginExportedValue();
    // Count the number of Patch/Intercept objects with compatible version
    // ranges
    let numFiles = 0;
    plugin.forEach(instrumentation => {
      const postLoadVersions = instrumentation.versions;
      if (!postLoadVersions || semver.satisfies(version, postLoadVersions)) {
        numFiles++;
      }
    });
    // We consider a module to be unsupported if there are no Patch/Intercept
    // objects with compatible version ranges at all.
    return numFiles > 0;
  }

  /**
   * Call unpatch methods when they were provided.
   */
  unapplyAll() {
    this.unpatchFns.reverse().forEach(fn => fn());
    this.unpatchFns.length = 0;
    this.traceApiInstances.forEach(traceApi => traceApi.disable());
    this.traceApiInstances.length = 0;
  }

  /**
   * Applies this object's underlying plugin patches to a file, returning the
   * patched or intercepted value.
   * @param moduleExports The module exports of the file.
   * @param file The file path, relative to the module root.
   * @param version The module version.
   */
  applyPlugin<T>(moduleExports: T, file: string, version: string): T {
    // Pre-compute a string used in logs for code clarity.
    const logString = `${this.name}@${version}${file ? `:${file}` : ''}`;
    // Get the exported value of the plugin value (loading it if it doesn't
    // exist)
    const plugin = this.getPluginExportedValue();
    // Get a list of supported patches. This is the subset of objects in the
    // plugin exported value with matching file/version fields.
    const supportedPatches = plugin.filter(
        instrumentation =>
            semver.satisfies(version, instrumentation.versions || '*') &&
            (file === instrumentation.file ||
             (!file && !instrumentation.file)));
    if (supportedPatches.length > 1) {
      this.logger.warn(`PluginWrapper#applyPlugin: [${
          logString}] Plugin has more than one patch/intercept object for this file. Applying all.`);
    }

    // Apply each patch object.
    return supportedPatches.reduce<T>((exportedValue, instrumentation) => {
      // TODO(kjin): The only benefit of creating a new TraceAgent object per
      // patched file is to give us granularity in log messages. See if we can
      // refactor the TraceAgent class to avoid this.

      this.logger.info(
          `PluginWrapper#applyPlugin: [${logString}] Applying plugin.`);
      if (instrumentation.patch) {
        instrumentation.patch(
            exportedValue, this.createTraceAgentInstance(logString));
        // Queue a function to run if the plugin gets disabled.
        if (instrumentation.unpatch) {
          this.unpatchFns.push(() => {
            this.logger.info(
                `PluginWrapper#unapplyAll: [${logString}] Unpatching file.`);
            instrumentation.unpatch!(exportedValue);
          });
        }
        // The patch object should only have either patch() or intercept().
        if (instrumentation.intercept) {
          this.logger.warn(`PluginWrapper#applyPlugin: [${
              logString}] Patch object has both patch() and intercept() for this file. Only applying patch().`);
        }
      } else if (instrumentation.intercept) {
        exportedValue = instrumentation.intercept(
            exportedValue, this.createTraceAgentInstance(file));
      } else {
        this.logger.warn(`PluginWrapper#applyPlugin: [${
            logString}] Patch object has no known functions for patching this file.`);
      }
      return exportedValue;
    }, moduleExports as T);
  }

  // Helper function to get the cached plugin value if it wasn't loaded yet.
  getPluginExportedValue(): Plugin {
    if (this.pluginExportedValue === PluginWrapper.NOT_LOADED) {
      this.pluginExportedValue = require(this.path);
    }
    return this.pluginExportedValue;
  }

  private createTraceAgentInstance(file: string) {
    const traceApi = new TraceAgent(file);
    traceApi.enable(this.logger, this.traceConfig);
    this.traceApiInstances.push(traceApi);
    return traceApi;
  }
}

// States for the Plugin Loader
enum PluginLoaderState {
  NO_HOOK,
  ACTIVATED,
  DEACTIVATED
}

/**
 * A class providing functionality to hook into module loading and apply
 * plugins to enable tracing.
 */
export class PluginLoader {
  // Key on which core modules are stored.
  static readonly CORE_MODULE = '[core]';
  // The function to call to register a require hook.
  private enableRequireHook: (onRequire: hook.OnRequireFn) => void;
  // A logger.
  private logger: Logger;
  // A map mapping module names to their respective plugins.
  private pluginMap: Map<string, PluginWrapper[]> = new Map();
  // A map caching version strings for a module based on their base path.
  private moduleVersionCache: Map<string, string|null> = new Map();
  // The current state of the plugin loader.
  private state: PluginLoaderState = PluginLoaderState.NO_HOOK;

  /**
   * Constructs a new PluginLoader instance.
   * @param logger The logger to use.
   * @param config The configuration for this instance.
   */
  constructor(logger: Logger, config: PluginLoaderConfig) {
    this.logger = logger;

    // Since each plugin can be specified as a string|PluginConfigEntry[],
    // canonicalize the format here by transforming values that are strings
    // into PluginConfigEntry object arrays.
    // Also, coalesce all plugins which are keyed on a built-in module name,
    // because they each have the capability to patch any core module.
    const canonicalPlugins:
        {[pluginName: string]: string[];} = {[PluginLoader.CORE_MODULE]: []};

    Object.keys(config.plugins).forEach(key => {
      const value = config.plugins[key];

      // Core module plugins share a common key.
      if (builtinModules.indexOf(key) !== -1) {
        // this set of plugins modifies built-in modules
        key = PluginLoader.CORE_MODULE;
      } else if (!canonicalPlugins[key]) {
        canonicalPlugins[key] = [];
      }

      if (value) {
        if (typeof value === 'string') {
          // Convert the given string value to a PluginConfigEntry
          // (unless it's falsey).
          // TODO: Begin on the path of deprecating this?
          canonicalPlugins[key].push(value);
        } else {
          this.logger.error(`PluginLoader#constructor: [${
              key}] Value is not a string... ignoring.`);
        }
      }
    });

    // Now, use the object with predictable values to build the database of
    // plugin objects.
    Object.keys(canonicalPlugins).forEach(key => {
      const value = canonicalPlugins[key];
      if (value.length === 0) {
        return;
      }

      // Assign a list of PluginWrapper instances to be queried when
      // a module with the given name (as key) is loaded.
      this.pluginMap.set(
          key,
          value.map(
              value =>
                  new PluginWrapper(logger, {name: key, path: value}, config)));
    });

    // Eagerly load the plugin for core modules.
    if (this.pluginMap.has(PluginLoader.CORE_MODULE)) {
      this.pluginMap.get(PluginLoader.CORE_MODULE)!.forEach(pluginWrapper => {
        pluginWrapper.getPluginExportedValue();
      });
    }

    // Define the function that will attach a require hook upon activate.
    // This must register the hook in the following way:
    // * The hook is only called the first time a file is loaded.
    // * This hook is called at least for each file that is loaded for
    //   modules with associated plugins.
    this.enableRequireHook = (onRequire) => {
      const builtins =
          this.pluginMap.has(PluginLoader.CORE_MODULE) ? builtinModules : [];
      hook(
          PluginLoader.union(this.pluginMap.keys(), builtins),
          {internals: true}, onRequire);
    };
  }

  /**
   * Activates plugin loading/patching by hooking into the require method.
   */
  activate(): PluginLoader {
    if (this.state === PluginLoaderState.NO_HOOK) {
      this.logger.info(`PluginLoader#activate: Adding require hook.`);
      // Enable the require hook.
      this.enableRequireHook((exportedValue, moduleStr, baseDir) => {
        if (this.state === PluginLoaderState.ACTIVATED) {
          // Skip processing for non-js files (such as package.json)
          if (!baseDir || path.basename(moduleStr) !== 'package.json') {
            // Get module name and internal file path (if exists).
            const parsedModuleStr = PluginLoader.parseModuleString(moduleStr);
            let name = parsedModuleStr.name;
            let file = parsedModuleStr.file;

            // For core modules, use [core] as the name, and the core module as
            // the "file".
            const isCoreModule = builtinModules.indexOf(name) !== -1;
            if (isCoreModule) {
              file = name;
              name = PluginLoader.CORE_MODULE;
            }

            // Check if the module has associated plugins.
            if (this.pluginMap.has(name)) {
              // Determine whether this is the main module. Only used to prevent
              // logspam for modules that aren't supported and have a lot of
              // internal files.
              const isMainModule = file.length === 0 && !isCoreModule;

              // Get the module version.
              let version = this.getVersion(baseDir);
              if (version) {
                // Warn for pre-releases.
                if (!!semver.prerelease(version)) {
                  if (isMainModule) {
                    this.logger.warn(`PluginLoader#onRequire: [${name}@${
                        version}] This module is in pre-release. Applying plugin anyways.`);
                  }
                  version = version.split('-')[0];
                }

                // Get the list of supported plugins.
                const supportedPlugins =
                    this.getSupportedPlugins(name, version);
                if (isMainModule) {
                  if (supportedPlugins.length === 0) {
                    this.logger.warn(`PluginLoader#onRequire: [${name}@${
                        version}] This module is not supported by the configured set of plugins.`);
                  } else if (supportedPlugins.length > 1) {
                    this.logger.warn(`PluginLoader#onRequire: [${name}@${
                        version}] This module is supported by more than one plugin. Applying all of them.`);
                  }
                }

                // Apply each supported plugin.
                exportedValue = supportedPlugins.reduce((value, plugin) => {
                  return plugin.applyPlugin(value, file, version!);
                }, exportedValue);
              } else if (isMainModule) {
                this.logger.error(`PluginLoader#activate: [${
                    name}] This module's version could not be determined. Not applying plugins.`);
              }
            }
          }
        }
        return exportedValue;
      });
      this.state = PluginLoaderState.ACTIVATED;
    } else if (this.state === PluginLoaderState.DEACTIVATED) {
      throw new Error('Currently cannot re-activate plugin loader.');
    }
    this.logger.info(`PluginLoader#activate: Activated.`);
    return this;
  }

  /**
   * Deactivates the plugin loader, preventing additional plugins from getting
   * loaded or applied, as well as unpatching any modules for which plugins
   * specified an unpatching method.
   */
  deactivate(): PluginLoader {
    if (this.state === PluginLoaderState.ACTIVATED) {
      // Unpatch the unpatchable functions.
      for (const pluginsList of this.pluginMap.values()) {
        pluginsList.forEach(plugin => plugin.unapplyAll());
      }
      this.state = PluginLoaderState.DEACTIVATED;
    }
    this.logger.info(`PluginLoader#deactivate: Deactivated.`);
    return this;
  }

  isActive() {
    return this.state === PluginLoaderState.ACTIVATED;
  }

  /**
   * Gets a list of plugins that support a module at the given version.
   * @param name The module for which plugins should be gotten.
   * @param version The version of the module.
   */
  private getSupportedPlugins(name: string, version: string): PluginWrapper[] {
    if (!this.pluginMap.has(name)) {
      return [];
    }
    return this.pluginMap.get(name)!.filter(
        plugin => plugin.isSupported(version));
  }

  /**
   * Adds a search path for plugin modules. Intended for testing purposes only.
   * @param searchPath The path to add.
   */
  static setPluginSearchPath(searchPath: string) {
    module.paths = [searchPath];
  }

  /**
   * Separates the internal file path from the name of a module in a module
   * string, returning both (or just the name if it's the main module).
   * @param moduleStr The module string; in the form of either `${module}` or
   *   `${module}/${path}`
   */
  static parseModuleString(moduleStr: string): {name: string, file: string} {
    const parts = moduleStr.split(path.sep);
    let indexOfFile = 1;
    if (parts[0].startsWith('@')) {  // for @org/package
      indexOfFile = 2;
    }
    return {
      name: parts.slice(0, indexOfFile).join(path.sep),
      file: parts.slice(indexOfFile).join(path.sep)
    };
  }

  // Get the version for a module at a given directory from its package.json
  // file, or null if it can't be read or parsed.
  // A falsey baseDir suggests a core module, for which the running Node
  // version is returned instead.
  private getVersion(baseDir?: string): string|null {
    if (baseDir) {
      if (this.moduleVersionCache.has(baseDir)) {
        return this.moduleVersionCache.get(baseDir)!;
      } else {
        const pjsonPath = path.join(baseDir, 'package.json');
        let version: string|null;
        try {
          version = require(pjsonPath).version;
          // Treat the version as if it's not there if it can't be parsed,
          // since for our purposes it's all the same.
          if (!semver.parse(version!)) {
            this.logger.error(`PluginLoader#getVersion: [${pjsonPath}|${
                version}] Version string could not be parsed.`);
            version = null;
          }
        } catch (e) {
          this.logger.error(`PluginLoader#getVersion: [${
              pjsonPath}] An error occurred while retrieving version string. ${
              e.message}`);
          version = null;
        }
        // Cache this value for future lookups.
        // This happens if a plugin has multiple internal files patched.
        this.moduleVersionCache.set(baseDir, version);
        return version;
      }
    } else {                            // core module
      return process.version.slice(1);  // starts with v
    }
  }

  // Helper function to get the union of elements in two iterables
  private static union<T>(a: Iterable<T>, b: Iterable<T>): T[] {
    return Array.from(new Set(Array.from(a).concat(Array.from(b))));
  }
}

export const pluginLoader = new Singleton(PluginLoader);
