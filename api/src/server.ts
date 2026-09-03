import app from './app';
import { config, resolveDbName } from './env';

app.listen(config.port, () => {
  console.log(`Home Kitchen API on http://localhost:${config.port} → database ${resolveDbName()}`);
});
