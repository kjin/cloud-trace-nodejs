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

import { CLS } from './base';
import { AsyncListenerCLS } from './async-listener';
import { AsyncHooksCLS } from './async-hooks';
import * as semver from 'semver';

import {SpanDataType} from '../constants';
import {UNCORRELATED_SPAN, UNTRACED_SPAN} from '../span-data';
import {Trace, TraceSpan} from '../trace';

/**
 * This type represents the minimal information to store in continuation-local
 * storage for a request. We store either a root span corresponding to the
 * request, or a sentinel value (UNCORRELATED_SPAN or UNTRACED_SPAN) that tells
 * us that the request is not being traced (with the exact sentinel value
 * specifying whether this is on purpose or by accident, respectively).
 *
 * When we store an actual root span, the only information we need is its
 * current trace/span fields.
 */
export type RootContext = ({
  readonly span: TraceSpan;
  readonly trace: Trace;
  readonly type: SpanDataType.ROOT;
}|{
  readonly type: SpanDataType.UNCORRELATED|SpanDataType.UNTRACED;
});

const useAH: boolean = semver.satisfies(process.version, '>=8') &&
    !!process.env.GCLOUD_TRACE_NEW_CONTEXT;
const defaultContext: RootContext = { type: SpanDataType.UNCORRELATED };
export const cls: CLS<RootContext> = useAH ?
    new AsyncHooksCLS<RootContext>(defaultContext) :
    new AsyncListenerCLS<RootContext>(defaultContext);

/**
 * Stack traces are captured when a root span is started. Because the stack
 * trace height varies on the context propagation mechanism, to keep published
 * stack traces uniform we need to remove the top-most frames when using the
 * c-l-s module. Keep track of this number here.
 */
export const ROOT_SPAN_STACK_OFFSET = useAH ? 0 : 2;
