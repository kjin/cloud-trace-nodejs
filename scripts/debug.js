/*
Utility which can directly run the source-mapped JS file from a TS file path
To use with VS Code, add this to launch.json:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Launch current file as mocha test",
  "args": [ "${file}" ],
  "program": "${workspaceRoot}/bin/debug"
}
```
*/

const [_bin, _script, input] = process.argv;

require('source-map-support/register');
const execa = require('execa');
const path = require('path');
const ts = require('typescript');
const Mocha = require('mocha');

async function main() {
  try {
    await execa('npm', ['run', 'compile-all'], {
      stdio: 'inherit'
    });
    await execa('npm', ['run', 'init-test-fixtures'], {
      stdio: 'inherit'
    });
  } catch (e) {
    console.error(e);
    throw e;
  }

  let precompiledPath = input;
  const extName = path.extname(precompiledPath);
  if (extName.length > 0) {
    precompiledPath = precompiledPath.slice(0, -extName.length);
  }
  const transformedPath = path.resolve('build', path.relative(path.resolve(__dirname, '..'), precompiledPath));

  await new Promise((resolve, reject) => new Mocha()
    .enableTimeouts(false)
    .addFile(transformedPath)
    .run(failures => {
      !failures ? resolve() : reject(failures);
    }));
}

main().catch(() => {
  process.exit(1);
});
