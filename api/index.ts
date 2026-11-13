import express from 'express';
import { apiRouter } from '../server/apiRoutes.ts';

const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use('/api', apiRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});
app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = typeof err.status === 'number' ? err.status : 500;
    res.status(status).json({ error: err.message || 'Internal server error.' });
  },
);

export default app;
