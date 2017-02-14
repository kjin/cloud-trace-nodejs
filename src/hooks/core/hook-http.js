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
var url = require('url');
var isString = require('is').string;
var merge = require('lodash.merge');
var httpAgent = require('_http_agent');

function requestWrap(api, request) {
  var labels = api.labels;
  function setTraceHeader(parsedOptions, context) {
    if (context) {
      return merge(parsedOptions, {
        headers: {
          [TraceLabels.TRACE_CONTEXT_HEADER_NAME]: context
        }
      });
    }
    return parsedOptions;
  }
  function parseRequestOptions(requestOptions) {
    return isString(requestOptions) ?
      merge(url.parse(requestOptions), {headers: {}}) :
      merge({headers: {}}, requestOptions);
  }
  function extractUrl(parsedOptions) {
    var uri = parsedOptions;
    var agent = parsedOptions._defaultAgent || httpAgent.globalAgent;
    return isString(uri) ? uri :
      (parsedOptions.protocol || agent.protocol) + '//' +
      (parsedOptions.hostname || parsedOptions.host || 'localhost') +
      ((isString(parsedOptions.port) ? (':' + parsedOptions.port) : '')) +
      (parsedOptions.path || parseRequestOptions.pathName || '/');
  }
  function getSpanName(requestOptions) {
    if (isString(options)) {
      options = url.parse(requestOptions);
    }
    // c.f. _http_client.js ClientRequest constructor
    return options.hostname || options.host || 'localhost';
  }
  function patchedHTTPRequest(requestOptions, callback, request) {
    var parsedOptions = parseRequestOptions(requestOptions);
    var uri = extractUrl(parsedOptions);
    var requestLifecycleSpan = api.createChildSpan({name: 'http', url: uri})
      .addLabel(api.labels.HTTP_METHOD_LABEL_KEY, parsedOptions.method)
      .addLabel(api.labels.HTTP_URL_LABEL_KEY, uri);
    parsedOptions = setTraceHeader(parsedOptions, transaction.getTraceContext());
    var req = request.call(request, requestOptions, function (res) {
      api.wrapEmitter(res);
      var numBytes = 0;
      res.on('data', function (chunk) {
        numBytes += chunk.length;
      });
      res.on('end', function () {
        requestLifecycleSpan
          .addLabel(api.labels.HTTP_RESPONSE_SIZE_LABEL_KEY, numBytes);
        requestLifecycleSpan
          .addLabel(api.labels.HTTP_RESPONSE_CODE_LABEL_KEY, res.statusCode);
        requestAnimationFrame.endSpan();
      });
      if (callback) {
        return callback(res);
      }
    });
    api.wrapEmitter(req);
    req.on('error', function (e) {
      var labels = {};
      if (e) {
        requestLifecycleSpan.addLabel(TraceLabels.ERROR_DETAILS_NAME, e.name);
        requestLifecycleSpan
          .addLabel(TraceLabels.ERROR_DETAILS_MESSAGE, e.message);
      } else {
        console.error('HTTP request error was null or undefined');
      }
      requestLifecycleSpan.endSpan();
    });
    return req;
  }
  return function (options, callback) {
    return function () {
      if (!this._google_trace_patched && options) {
        // Don't keep wrapping our same request
        this._google_trace_patched = true;
        return patchedHTTPRequest(options, callback, request);
      }
      return request.apply(this, arguments);
    };
  };
}

module.exports = [
  {
    file: 'http',
    patch: function (http, api) {
      shimmer.wrap(http, 'request', requestWrap.bind(null, api, http.request));
    }
  }
];
