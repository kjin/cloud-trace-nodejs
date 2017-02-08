var shimmer = require('shimmer');
var Module = require('module');

var loadModule = true;

shimmer.wrap(Module, '_load', function(originalModuleLoad) {
  return function wrappedModuleLoad() {
    if (loadModule) {
      return originalModuleLoad.apply(this, arguments);
    }
  }
});

var pluginLoader = require('../src/trace-plugin-loader.js');

loadModule = false;

describe('Trace Plugin Loader', function() {
  it();
});

require('express');
