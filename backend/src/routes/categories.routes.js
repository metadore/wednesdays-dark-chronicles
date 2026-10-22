import express from 'express';
import { getCategories, getArtifactCategories } from '../controllers/categories.controller.js';

const router = express.Router();

router.get('/', getCategories);
router.get('/artifact-categories', getArtifactCategories);

export default router;
