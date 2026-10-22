import app from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`
  --------------------------------------------------
  Wednesday's Dark Chronicles Backend
  Status: Running
  Port: ${PORT}
  Env: ${process.env.NODE_ENV || 'development'}
  --------------------------------------------------
  `);
});

export { server };
