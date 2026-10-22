import express from 'express';
import { getPosts, getPostBySlug } from '../controllers/posts.controller.js';

const router = express.Router();

router.get('/', getPosts);
router.get('/:slug', getPostBySlug);

export default router;
