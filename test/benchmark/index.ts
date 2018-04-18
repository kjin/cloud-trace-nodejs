import * as trace from '../trace';

trace.setPluginLoader();
const api = trace.start({
  samplingRate: 0
});

import * as express from 'express';
import axios from 'axios';
import { writeFileSync } from 'fs';

async function main() {
  // const starts = [];
  // const ends = [];

  const app = express();

  app.get('/', (req, res) => {
    res.send('hello!');
    // setImmediate(() => res.send('hello!'), 200);
  });

  const server = app.listen(3000);

  const start = process.hrtime();
  // const notifyEvery = 1000;
  
  await api.runInRootSpan({ name: 'outer' }, async span => {
    for (let i = 0; i < 10000; i++) {
      // starts.push(process.hrtime());
      await axios.get('http://localhost:3000');
      // ends.push(process.hrtime());
      // if ((i + 1) % notifyEvery === 0) {
      //   console.log(`Completed ${i + 1} requests`);
      // }
    }
    span.endSpan();
  });

  const duration = process.hrtime(start);
  console.log(duration[0] + duration[1] / 1e9);

  server.close();

  // writeFileSync('output.csv', starts.map((e, i) => `${i},${(ends[i][0] + ends[i][1] / 1e9) - (e[0] + e[1] / 1e9)}`).join('\n'));
}
main().catch(console.error);
