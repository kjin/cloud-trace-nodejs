# Object tree style

Plugins are of the form:

```js
module.exports = {
  [versions]: {
    [file]: { patch: patchFunction },
    // ...
    [file]: { patch: patchFunction }
  },
  // ...
  [versions]: {
    [file]: { patch: patchFunction },
    // ...
    [file]: { patch: patchFunction }
  }
};
```

* `versions` is a semver condition describing the versions for which this
  patch applies.
* `file` is the path to the file itself. Use `''` to specify the root file.
* Each `versions`-`file` pair corresponds to an object which describes how the
  specified module should be modified. In the common case it will have a `patch`
  field whose value is a patching function of the form
  `(module, api) => { return }`. Could also have `unpatch`, `intercept`, etc.
  * `module` will be the value of `require(options.file)`
  * `api` will expose an interface for creating spans, propagating context,
    etc

This is the simplest way to go, no need to `require` anything additional.

## Examples

```js
// koa
function patchKoa(module, api) { /* */ }
function patchKoaNext(module, api) { /* */ }
module.exports = {
  '1.x': {
    '': { patch: patchKoa }
  },
  '2.x': {
    '': { patch: patchKoaNext }
  }
};

// gRPC
function patchClient(module, api) { /* */ }
function patchServer(module, api) { /* */ }
module.exports = {
  '1.x': {
    'src/node/src/client.js': { patch: patchClient },
    'src/node/src/server.js': { patch: patchServer }
  }
}
```

# Plugin object from trace agent

Plugins are of the form:

```js
const TraceAgentPlugin = require('@google-cloud/trace').Plugin

// ...

module.exports = TraceAgentPlugin(moduleName, supportedVersions)
  .patch(options, patchFunction)
  // ...
  .patch(options, patchFunction);
```

* `TraceAgentPlugin` returns an object on which `patch` can be called
* `moduleName` is the name of the module to patch
* `supportedVersions` is a semver condition describing global filter of versions
  to support
* Each call to `patch`:
  * `options` is an object with the following fields:
    * `file` is the path of a file internal to the module. If omitted, defaults
      to `''` (root file)
    * `versions` is a semver condition describing the versions for which this
      patch applies. If omitted, the given file will be patched for all versions
    * If a function is passed as this argument, assumes `options` to be `{}` and
      treats the argument as `patchFunction`
    * If a string is passed as this argument, assumes it to be the `file` field
      of `options`
  * `patchFunction` is the same as in previous section.
* We can add additional methods such as `intercept` used in `hook-connect`
  (replace module entirely) by exposing it on the object returned by
  `TraceAgentPlugin`

## Examples

```js
// koa
function patchKoa(module, api) { /* */ }
function patchKoaNext(module, api) { /* */ }
module.exports = TraceAgentPlugin('koa')
  .patch({ versions: '1.x' }, patchKoa)
  .patch({ versions: '2.x' }, patchKoaNext)

// gRPC
function patchClient(module, api) { /* */ }
function patchServer(module, api) { /* */ }
module.exports = TraceAgentPlugin('grpc', '1.x')
  .patch({ file: 'src/node/src/client.js' }, patchClient),
  .patch({ file: 'src/node/src/server.js' }, patchServer)
}
```

# Object set

There is a middle ground where `module.exports` is an array (or a better way to
represent an iterable set) where each member is an object that combines all the
`option`s from the chained patching method with the patch function, like:

```js
// koa
function patchKoa(module, api) { /* */ }
function patchKoaNext(module, api) { /* */ }
module.exports = [
  { versions: '1.x', patch: patchKoa },
  { versions: '2.x', patch: patchKoaNext }
];

// gRPC
function patchClient(module, api) { /* */ }
function patchServer(module, api) { /* */ }
module.exports = [
  { file: 'src/node/src/client.js', versions: '1.x', patch: patchClient },
  { file: 'src/node/src/server.js', versions: '1.x', patch: patchServer }
];
```

# Comparison

* Object tree
  * Advantages
    * No dependency on our agent module
    * Grouping of patch versions is good if done correctly
    * Similar to what we have now
  * Disadvantages
    * Arbitrary strings as keys (not sure if this is actually bad)
    * Possibly harder to verify correct structure
    * Hard to document (cannot do so as JSDoc)
* Exported plugin object
  * Advantages
    * Information specifying what to patch (file, version, etc.) are coalesced,
      and future
    * Less verbose
    * Can express global default settings
    * Can use JSDoc to describe interface
  * Disadvantages
    * Circular dependency on our agent module
    * Most plugins are simple enough (not many patch functions) that the
      improvement in readability may be minimal
    * Repeated information (versions, etc.)
* Object set
  * Advantages
    * No dependency on our agent module
    * Less verbose
  * Disadvantages
    * Hard to document (cannot do so as JSDoc)
    * Repeated information (versions, etc.)
