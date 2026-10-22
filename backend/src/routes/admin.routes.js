
import express from 'express';
import { protect } from '../middleware/auth.js';
import { doubleCsrfProtection } from '../middleware/csrf.js';
import * as adminCtrl from '../controllers/admin.controller.js';
import * as adminStoriesCtrl from '../controllers/admin-stories.controller.js';

const router = express.Router();

// All admin routes are protected by JWT authentication
router.use(protect);

// --- Blog Post Admin ---
router.get('/posts', adminCtrl.adminGetPosts);
router.get('/posts/:id', adminCtrl.adminGetPostById);
router.post('/posts', doubleCsrfProtection, adminCtrl.adminCreatePost);
router.put('/posts/:id', doubleCsrfProtection, adminCtrl.adminUpdatePost);
router.patch('/posts/:id/publish', doubleCsrfProtection, adminCtrl.adminTogglePostPublish);
router.delete('/posts/:id', doubleCsrfProtection, adminCtrl.adminDeletePost);

// --- Artifact Admin ---
router.get('/artifacts', adminCtrl.adminGetArtifacts);
router.get('/artifacts/:id', adminCtrl.adminGetArtifactById);
router.post('/artifacts', doubleCsrfProtection, adminCtrl.adminCreateArtifact);
router.put('/artifacts/:id', doubleCsrfProtection, adminCtrl.adminUpdateArtifact);
router.patch('/artifacts/:id/publish', doubleCsrfProtection, adminCtrl.adminToggleArtifactPublish);
router.delete('/artifacts/:id', doubleCsrfProtection, adminCtrl.adminDeleteArtifact);

// --- Category Admin ---
router.get('/categories', adminCtrl.adminGetCategories);
router.post('/categories', doubleCsrfProtection, adminCtrl.adminCreateCategory);
router.put('/categories/:id', doubleCsrfProtection, adminCtrl.adminUpdateCategory);
router.delete('/categories/:id', doubleCsrfProtection, adminCtrl.adminDeleteCategory);

// --- Branching Story Admin ---
// Every route below sits behind `protect` (the router-wide JWT guard) and
// every mutation additionally requires a valid CSRF token.
router.get('/stories', adminStoriesCtrl.adminGetStories);
router.get('/stories/:id', adminStoriesCtrl.adminGetStoryById);
router.get('/stories/:id/validate', adminStoriesCtrl.adminValidateStory);
router.post('/stories', doubleCsrfProtection, adminStoriesCtrl.adminCreateStory);
router.put('/stories/:id', doubleCsrfProtection, adminStoriesCtrl.adminUpdateStory);
router.patch('/stories/:id/publish', doubleCsrfProtection, adminStoriesCtrl.adminToggleStoryPublish);
router.delete('/stories/:id', doubleCsrfProtection, adminStoriesCtrl.adminDeleteStory);

router.post('/stories/:id/nodes', doubleCsrfProtection, adminStoriesCtrl.adminCreateNode);
router.put('/stories/:id/nodes/:nodeId', doubleCsrfProtection, adminStoriesCtrl.adminUpdateNode);
router.delete('/stories/:id/nodes/:nodeId', doubleCsrfProtection, adminStoriesCtrl.adminDeleteNode);

router.post('/stories/:id/nodes/:nodeId/choices', doubleCsrfProtection, adminStoriesCtrl.adminCreateChoice);
router.put('/stories/:id/choices/:choiceId', doubleCsrfProtection, adminStoriesCtrl.adminUpdateChoice);
router.delete('/stories/:id/choices/:choiceId', doubleCsrfProtection, adminStoriesCtrl.adminDeleteChoice);

router.post('/stories/:id/start', doubleCsrfProtection, adminStoriesCtrl.adminSetStartingNode);

export default router;
