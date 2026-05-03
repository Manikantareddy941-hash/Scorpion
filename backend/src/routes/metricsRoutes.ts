import express from 'express';
import { register } from '../services/metrics';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

export default router;
