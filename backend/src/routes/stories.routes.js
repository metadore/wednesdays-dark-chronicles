import express from 'express';
import {
  getStories,
  getStoryBySlug,
  getStoryNode,
  followStoryChoice,
} from '../controllers/stories.controller.js';

const router = express.Router();

/**
 * Public, read-only endpoints for interactive stories.
 *
 *   GET /api/stories
 *       List the published stories.
 *   GET /api/stories/:slug
 *       A published story with its starting node.
 *   GET /api/stories/:slug/nodes/:nodeId
 *       A node of that story and the choices that leave it.
 *   GET /api/stories/:slug/nodes/:nodeId/choices/:choiceId
 *       Follow a choice to its destination node.
 */
router.get('/', getStories);
router.get('/:slug', getStoryBySlug);
router.get('/:slug/nodes/:nodeId', getStoryNode);
router.get('/:slug/nodes/:nodeId/choices/:choiceId', followStoryChoice);

export default router;
