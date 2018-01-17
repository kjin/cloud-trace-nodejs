/// <reference path="../src/types.d.ts" />

import * as trace from '../src';
import * as assert from 'assert';
import * as common from '@google-cloud/common';
import { TraceWriter, traceWriter, LabelObject, TraceWriterConfig, TraceWriterSingletonConfig } from '../src/trace-writer';
import { PluginTypes, Config } from '../src';
import { SpanData } from '../src/span-data';
import { TraceSpan } from '../src/trace-span';

export { PluginTypes, Config };

const spans: TraceSpan[] = [];

class TestTraceWriter extends TraceWriter {
  constructor(logger: common.Logger, config: TraceWriterConfig) {
    super(logger, config);
  }
  initialize(cb: (err?: Error) => void): void {
    this.getConfig().projectId = '0';
    cb();
  }
  writeSpan(spanData: SpanData): void {
    spanData.trace.spans.forEach(span => spans.push(span));
  }
}

let singleton: TraceWriter | null = null;

traceWriter.create = (logger: common.Logger, config: TraceWriterSingletonConfig, cb?: (err?: Error) => void): TraceWriter => {
  if (singleton) {
    throw new Error('Trace Writer already created.');
  }
  singleton = new TestTraceWriter(logger, config);
  singleton.initialize(cb || (() => {}));
  return singleton;
},

traceWriter.get = (): TraceWriter => {
  if (!singleton) {
    throw new Error('Trace Writer not initialized.');
  }
  return singleton;
};

export type Predicate<T> = (value: T) => boolean;

export function start(projectConfig?: Config): PluginTypes.TraceAgent {
  const agent = trace.start(Object.assign({
    samplingRate: 0
  }, projectConfig));
  return agent;
}

export function get(): PluginTypes.TraceAgent {
  return trace.get();
}

export function getSpans(predicate?: Predicate<TraceSpan>): TraceSpan[] {
  if (!predicate) {
    predicate = () => true;
  }
  return spans.filter(predicate);
}

export function getOneSpan(predicate?: Predicate<TraceSpan>): TraceSpan {
  const spans = getSpans(predicate);
  assert.strictEqual(spans.length, 1);
  return spans[0];
}

export function clearSpans(): void {
  spans.length = 0;
}


