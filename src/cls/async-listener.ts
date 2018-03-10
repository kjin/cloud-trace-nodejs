/**
 * Copyright 2018 Google Inc. All Rights Reserved.
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

import * as cls from 'continuation-local-storage';
import { CLS, Func } from './base';
import { EventEmitter } from 'events';

export class AsyncListenerCLS<Context extends {}> implements CLS<Context> {
  static readonly TRACE_NAMESPACE = 'com.google.cloud.trace';
  static readonly ROOT_CONTEXT_KEY = 'root';
  private readonly defaultContext: Context;

  constructor(defaultContext: Context) {
    this.defaultContext = defaultContext;
  }

  isEnabled(): boolean {
    return !!this.getNamespace();
  }

  enable(): void {
    cls.createNamespace(AsyncListenerCLS.TRACE_NAMESPACE);
  }

  disable(): void {
    cls.destroyNamespace(AsyncListenerCLS.TRACE_NAMESPACE);
  }

  private getNamespace(): cls.Namespace {
    return cls.getNamespace(AsyncListenerCLS.TRACE_NAMESPACE);
  }

  getContext(): Context {
    const result = this.getNamespace().get(AsyncListenerCLS.ROOT_CONTEXT_KEY);
    if (!result) {
      return this.defaultContext;
    }
    return result;
  }

  setContext(value: Context): void {
    this.getNamespace().set(AsyncListenerCLS.ROOT_CONTEXT_KEY, value);
  }

  runWithNewContext<T>(fn: Func<T>): T {
    return this.getNamespace().runAndReturn(fn);
  }

  bindWithCurrentContext<T>(fn: Func<T>): Func<T> {
    return this.getNamespace().bind(fn) as Func<T>;
  }

  bindEmitterWithCurrentContext<T>(ee: EventEmitter): void {
    return this.getNamespace().bindEmitter(ee);
  }
}
