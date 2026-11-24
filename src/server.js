import { env } from './config/env.js';
import { app } from './app.js';

const server = app.listen(env.port, env.host, () => {
  console.log(`Travel Agent: http://${env.host}:${env.port}`);
});

server.on('error', (error) => {
  console.error(`Server failed to start (${error.code || 'UNKNOWN'}). Check HOST and PORT.`);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}
