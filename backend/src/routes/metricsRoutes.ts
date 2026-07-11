import express from 'express';
import { register } from '../services/metrics';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    // res.end() only accepts string/Buffer; passing the Error object throws a
    // TypeError inside the catch. Send its message as text instead.
    res.status(500).end(err instanceof Error ? err.message : 'Failed to collect metrics');
  }
});

export default router;
