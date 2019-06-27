import { mkdirP, readFileP, spawnP, writeFileP } from './utils';

const TYPES_DIRECTORY = 'src/plugins/types';

async function mkdirSafeP(dir: string) {
  try {
    await mkdirP(dir);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') {
      throw new Error(`Error creating directory ${dir}`);
    }
    return false;
  }
}

export async function getPluginTypes(overwrite: boolean) {
  await mkdirSafeP(TYPES_DIRECTORY);

  const indexTs = (await readFileP(`${TYPES_DIRECTORY}/index.d.ts`, 'utf8') as string)
    .split('\n');
  for (const line of indexTs) {
    const matches = line.match(/^import \* as .* from '\.\/(.+)';\s*\/\/\s*(.+)@(.+)$/);
    if (!matches) {
      continue;
    }
    const [, packageName, name, version] = matches;
    const installDir = `${TYPES_DIRECTORY}/${packageName}`;
    if (overwrite || await mkdirSafeP(installDir)) {
      await spawnP('npm', ['init', '-y'], {
        cwd: installDir
      });
      await spawnP('npm', ['install', `@types/${name}@${version}`], {
        cwd: installDir
      });
      await writeFileP(`${installDir}/index.ts`,
        `import * as _ from '${name}'; export = _;\n`, 'utf8');
    }
  }
}
