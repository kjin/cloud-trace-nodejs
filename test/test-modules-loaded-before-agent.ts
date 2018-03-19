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

import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';

describe('modules loaded before agent', () => {
  it('should log if modules were loaded before agent', () => {
    const scriptPath = [__dirname, 'fixtures', 'start-agent.js'].join(path.sep);
    const output = cp.execSync(`node ${scriptPath}`);
    console.log(output.toString());
    assert.ok(output.toString().match(/Tracing might not work.*"glob".*/));
  });
});
