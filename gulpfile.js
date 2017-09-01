const cp = require('child_process');
const coveralls = require('coveralls');
const crypto = require('crypto');
const del = require('del');
const _gulp = require('gulp');
const help = require('gulp-help');
const mocha = require('gulp-mocha');
const sourcemaps = require('gulp-sourcemaps');
const tslint = require('gulp-tslint');
const typescript = require('gulp-typescript');
const util = require('gulp-util');
const merge2 = require('merge2');
const path = require('path');
const through = require('through2');

// gulp-help monkeypatches tasks to have an additional description parameter
const gulp = help(_gulp);

const tslintPath = './node_modules/google-ts-style/tslint.json';
const tsconfigPath = './tsconfig.json';
const outDir = 'build';

function onError() {}

// Coalesces all specified --file parameters into a single array
const files = !util.env.file ? [] :
  Array.isArray(util.env.file) ? util.env.file : [util.env.file];

// If --dev is passed, override certain ts config options
let tsDevOptions = {};
if (util.env.dev) {
  tsDevOptions = {
    allowUnreachableCode: true,
    noUnusedParameters: false,
    noImplicitAny: false,
    noImplicitThis: false,
    noEmitOnError: false
  };
}

/**
 * Helper function that creates a gulp task function that opens files in a
 * directory that match a certain glob pattern, transpiles them, and writes them
 * to an output directory.
 * @param {Object} globs
 * @param {string=} globs.transpile The glob pattern for files to transpile.
 *   Defaults to match all *.ts files in baseDir (incl. subdirectories).
 * @param {string=} globs.copy The glob pattern for files to transpile.
 *   Defaults to match all but *.ts files in baseDir (incl. subdirectories).
 * @return A gulp task function.
 */
function makeCompileFn(globs) {
  const transpileGlob = globs.transpile || '**/*.ts';
  const copyGlob = globs.copy || '!(**/*)';
  return () => {
    const tsProject = typescript.createProject(tsconfigPath, tsDevOptions)();
    const { dts, js } = gulp.src(transpileGlob, { base: '.' })
      .pipe(sourcemaps.init())
      .pipe(tsProject)
      .on('error', onError);
    const jsmap = js.pipe(sourcemaps.write('.', {
      includeContent: false,
      sourceRoot: '.'
    }));
    const copy = gulp.src(copyGlob, { base: '.' });
    return merge2([
      js.pipe(gulp.dest(`${outDir}`)),
      dts.pipe(gulp.dest(`${outDir}/types`)),
      jsmap.pipe(gulp.dest(`${outDir}`)),
      copy.pipe(gulp.dest(`${outDir}`))
    ]);
  };
}

function makeTestFn(globs, coverage) {
  const npmBin = (binName) => path.relative(outDir, `node_modules/.bin/${binName}`);
  let result = () => {
    let testNum = 0;
    return gulp.src(globs)
      .pipe(through.obj((file, enc, cb) => {
        const moduleAndArgs = [
          ...coverage ? [
            npmBin('istanbul'),
            'cover',
            '--dir',
            `./coverage/${testNum++}`,
            npmBin('_mocha'),
            '--'
          ] : [
            npmBin('_mocha')
          ],
          '--require',
          'source-map-support/register',
          path.relative(outDir, file.path),
          '--timeout',
          '4000'
        ];
        const childProcess = cp.fork(
          moduleAndArgs[0],
          moduleAndArgs.slice(1),
          { cwd: outDir }
        );
        childProcess.on('exit', (failures) => {
          if (failures === 0) {
            cb();
          } else {
            cb(new Error(`Mocha: ${failures} failures in ${file.path}]`));
          }
        })
      }));
  };
  return result;
}

function decipher(key, iv) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'hex')
  );
  return through.obj(function (file, enc, cb) {
    file.contents = Buffer.concat([decipher.update(file.contents, 'utf8'), decipher.final()]);
    file.path = path.join(path.dirname(file.path), path.basename(file.path, '.enc'))
    this.push(file);
    cb();
  });
}

/**
 * Runs tslint on files in src/, with linting rules defined in tslint.json.
 */
gulp.task('lint', 'Emits linting errors found in src/ and test/.', () => {
  const program = require('tslint').Linter.createProgram(tsconfigPath);
  gulp.src(['src/**/*.ts', 'test/**/*.ts'])
    .pipe(tslint({
      configuration: tslintPath,
      formatter: 'prose',
      program
    }))
    .pipe(tslint.report())
    .on('warning', onError);
});

gulp.task('clean', 'Deletes transpiled code.', () => {
  return del(outDir);
});

/**
 * Transpiles TypeScript files in src/ to JavaScript according to the settings
 * found in tsconfig.json.
 * Currently, all errors are emitted twice. This is being tracked here:
 * https://github.com/ivogabe/gulp-typescript/issues/438
 */
gulp.task('compile', 'Transpiles src/.',
  makeCompileFn({ transpile: ['*.ts', 'src/**/*.ts'] }));

/**
 * Transpiles TypeScript files in both src/ and test/.
 */
gulp.task('test.compile', 'After running task dependencies, transpiles test/.', ['compile'],
  makeCompileFn({ transpile: ['test/**/*.ts', '!test/**/*.d.ts'], copy: 'test/**/!(*.ts)' }));

gulp.task('test.install-fixtures', 'Run npm install for test fixtures', () => {
  cp.execFileSync('./bin/install-test-fixtures.sh', {
    stdio: 'inherit'
  });
  return merge2([]);
});

/**
 * Transpiles src/ and test/, and then runs all unit tests.
 */
gulp.task('test', 'After running task dependencies, runs all unit tests.',
  ['test.compile', 'test.install-fixtures'],
  makeTestFn([`${outDir}/test/test-*.js`, `${outDir}/test/*/test-*.js`], false)
);

gulp.task('system-test.service-account', 'Attempts to decrypt the service account key', () => {
  if (process.env.TRAVIS_PULL_REQUEST === 'false') {
    const {
      encrypted_18363a01ae87_key: key,
      encrypted_18363a01ae87_iv: iv
    } = process.env;
    const serviceAccountKeyPath = 'node-team-test-d0b0be11c23d.json';

    return gulp.src(`${serviceAccountKeyPath}.enc`)
      .pipe(decipher(key, iv))
      .pipe(gulp.dest('.'));
  } else {
    return merge2([]);
  }
});

/**
 * Transpiles TypeScript files in both src/, then runs system tests.
 */
gulp.task('system-test', 'After running task dependencies, runs system tests.', ['compile', 'system-test.service-account'],
  makeTestFn([`system-test/*.js`], false)
);

/**
 * Transpiles src/ and test/, and then runs all unit tests with code coverage.
 */
gulp.task('coverage.test', 'After running task dependencies, runs all unit tests while gathering code coverage.',
  ['test.compile', 'test.install-fixtures'],
  makeTestFn([`${outDir}/test/test-*.js`, `${outDir}/test/*/test-*.js`], true)
);

/**
 * Transpiles src/ and test/, runs all unit tests, and reports code coverage to coveralls.
 */
gulp.task('coverage', 'After running task dependencies, reports coverage to coveralls.',
  ['coverage.test'], () => {
    gulp.src(`${outDir}/coverage/**/lcov.info`)
      .pipe(coveralls());
  }
);

/**
 * Transpiles individual files, specified by the --file flag.
 */
gulp.task('compile.single', 'Transpiles individual files specified by --file.',
  makeCompileFn({
    transpile: files.map(f => path.relative('.', f))
  })
);

/**
 * Run individual tests, specified by their pre-transpiled source path (as
 * supplied through the '--file' flag). This is intended to be used as part of a
 * VS Code "Gulp task" launch configuration; setting the "args" field to
 * ["test.single", "--file", "${file}"] makes it possible for one to debug the
 * currently open TS mocha test file in one step.
 */
gulp.task('test.single', 'After running task dependencies, runs individual test files specified by --file.',
  ['compile', 'compile.single'], () => {
    // util.env contains CLI arguments for the gulp task.
    // Determine the path to the transpiled version of this TS file.
    const getTranspiledPath = (file) => {
      const dir = path.dirname(path.relative('.', file));
      const basename = path.basename(file, '.ts');
      return `${outDir}/${dir}/${basename}.js`;
    };
    // Construct an instance of Mocha's runner API and feed it the path to the
    // transpiled source.
    require('source-map-support/register');
    return gulp.src(files.map(getTranspiledPath))
      .pipe(through.obj((file, enc, cb) => {
        // Construct a new Mocha runner instance.
        const Mocha = require('mocha');
        const runner = new Mocha();
        // Add the path to the test file to debug.
        runner.addFile(file.path);
        // Run the test suite.
        runner.run((failures) => {
          if (failures > 0) {
            cb(new Error(`Mocha: ${failures} failures in ${file.path}]`));
          } else {
            cb(null);
          }
        });
      }));
  }
);

gulp.task('default', ['help']);
