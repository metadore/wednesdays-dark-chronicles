import express from 'express';
import { getArtifacts, getArtifactBySlug } from '../controllers/artifacts.controller.js';

const router = express.Router();

router.get('/', getArtifacts);
router.get('/:slug', getArtifactBySlug);

export default router;
