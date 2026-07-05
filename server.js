import dotenv from 'dotenv';
import express from 'express';
import healthRouter from './src/routes/health.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'job-rag API is running' });
});

app.use('/health', healthRouter);

app.listen(port, host, () => {
  console.log(`Server listening at http://${host}:${port}`);
});
