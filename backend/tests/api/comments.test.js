import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config.js';
import { resetCommentLimiter } from '../../src/routes/comment.routes.js';
import { signAdminToken } from '../helpers/admin-token.js';
import {
  MAX_CONTENT_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_NESTING_DEPTH,
} from '../../src/controllers/comment.controller.js';

/**
 * Phase 8.1 — Comment feature verification suite.
 *
 * Every record created here is tagged with a unique run id so that cleanup is
 * restricted to the rows this suite created. No pre-existing post, artifact,
 * category, inquiry or user record is modified or deleted.
 */

const RUN_ID = `phase81-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const PUBLISHED_POST_SLUG = `${RUN_ID}-published-post`;
const SECOND_POST_SLUG = `${RUN_ID}-second-post`;
const UNPUBLISHED_POST_SLUG = `${RUN_ID}-unpublished-post`;

describe('Phase 8.1 :: Comments & Séance Moderation', () => {
  let adminToken;
  let agent;

  // --- Fixtures ---------------------------------------------------------
  let publishedPost;
  let secondPost;
  let unpublishedPost;

  // Ids of every comment this suite creates, for scoped cleanup.
  const createdCommentIds = new Set();

  // --- Helpers ----------------------------------------------------------

  const track = (comment) => {
    if (comment && comment.id) createdCommentIds.add(comment.id);
    return comment;
  };

  /**
   * The rate limiter keys on the client IP. Supertest presents the loopback
   * address as 127.0.0.1, so that is the key to clear between tests.
   */
  const RATE_LIMIT_KEY = '127.0.0.1';

  const clearRateLimit = async () => {
    try {
      await resetCommentLimiter(RATE_LIMIT_KEY);
    } catch (e) {
      // A store without reset support is not fatal for the suite.
    }
  };

  /** Fetch a fresh CSRF token bound to this agent's session cookie. */
  const csrfToken = async (targetAgent = agent) => {
    const res = await targetAgent.get('/api/auth/csrf-token');
    expect(res.status, 'csrf-token endpoint should be reachable').to.equal(200);
    expect(res.body.token, 'csrf token should be present').to.be.a('string').and.not.empty;
    return res.body.token;
  };

  const submitComment = async (payload, targetAgent = agent) => {
    const token = await csrfToken(targetAgent);
    return targetAgent
      .post('/api/comments')
      .set('x-csrf-token', token)
      .send(payload);
  };

  /**
   * Administrative calls go through a dedicated agent that is logged in, so the
   * JWT cookie and the CSRF session cookie travel together in the same jar.
   */
  const adminAgent = request.agent(app);

  const adminPatch = async (id, body) => {
    const token = await csrfToken(adminAgent);
    return adminAgent
      .patch(`/api/comments/admin/${id}`)
      .set('x-csrf-token', token)
      .send(body);
  };

  const adminDelete = async (id) => {
    const token = await csrfToken(adminAgent);
    return adminAgent
      .delete(`/api/comments/admin/${id}`)
      .set('x-csrf-token', token);
  };

  const publicList = async (postId) => {
    const res = await request(app).get(`/api/comments/${postId}`);
    expect(res.status).to.equal(200);
    return res.body;
  };

  /** Collect every comment id present in a public thread payload. */
  const collectIds = (nodes, acc = []) => {
    for (const n of nodes || []) {
      acc.push(n.id);
      collectIds(n.replies, acc);
    }
    return acc;
  };

  before(async () => {
    agent = request.agent(app);

    // Admin identity for the moderation endpoints. This test user is created
    // with a unique run-scoped name and removed during cleanup.
    const bcrypt = await import('bcryptjs');
    const adminPassword = 'Phase81-Test-Password!';
    const adminUser = await prisma.user.create({
      data: {
        username: `${RUN_ID}-admin`,
        password: await bcrypt.hash(adminPassword, 10),
      },
    });
    createdCommentIds.add(`__admin__${adminUser.id}`);
    adminToken = signAdminToken(adminUser);

    // Log the dedicated admin agent in so its cookie jar carries both the JWT
    // cookie and the CSRF session cookie.
    const loginRes = await adminAgent
      .post('/api/auth/login')
      .send({ username: adminUser.username, password: adminPassword });
    expect(loginRes.status, 'admin login should succeed').to.equal(200);

    publishedPost = await prisma.post.create({
      data: {
        title: 'Phase 8.1 Published Post',
        slug: PUBLISHED_POST_SLUG,
        content: 'Published content for the comment verification suite.',
        published: true,
        publishedAt: new Date(),
      },
    });

    secondPost = await prisma.post.create({
      data: {
        title: 'Phase 8.1 Second Post',
        slug: SECOND_POST_SLUG,
        content: 'A second published article used to prove reply scoping.',
        published: true,
        publishedAt: new Date(),
      },
    });

    unpublishedPost = await prisma.post.create({
      data: {
        title: 'Phase 8.1 Unpublished Post',
        slug: UNPUBLISHED_POST_SLUG,
        content: 'Unpublished content.',
        published: false,
      },
    });
  });

  // Every test starts from a clean rate-limit budget so that the submission
  // tests are not starved by earlier requests in the same file.
  beforeEach(async () => {
    await clearRateLimit();
  });

  after(async () => {
    // Cleanup is strictly limited to rows this suite created.
    for (const id of createdCommentIds) {
      if (id.startsWith('__admin__')) {
        await prisma.user.deleteMany({ where: { id: id.slice('__admin__'.length) } });
        continue;
      }
      // deleteMany on a non-existent id is a no-op, so re-running is safe.
      await prisma.comment.deleteMany({ where: { id } });
    }

    await prisma.post.deleteMany({
      where: { slug: { in: [PUBLISHED_POST_SLUG, SECOND_POST_SLUG, UNPUBLISHED_POST_SLUG] } },
    });

    // Release the rate-limit counters so the next suite starts clean.
    await resetCommentLimiter('::ffff:127.0.0.1');
    await resetCommentLimiter('127.0.0.1');
  });

  // =====================================================================
  // 1. Submitting comments to published articles
  // =====================================================================
  describe('1. Submission to published articles', () => {
    beforeEach(async () => {
      // Each submission test starts with a fresh rate-limit budget.
      await clearRateLimit();
    });

    it('accepts a comment on a published article', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'The Seer',
        content: 'The archive whispers back.',
      });

      expect(res.status).to.equal(201);
      expect(res.body).to.have.property('message');
      expect(res.body.status).to.equal('pending');
    });

    it('persists the submitted comment against the correct article', async () => {
      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, content: 'The archive whispers back.' },
      }));

      expect(created, 'comment should exist in the database').to.not.be.null;
      expect(created.postId).to.equal(publishedPost.id);
      expect(created.parentId).to.equal(null);
      expect(created.author).to.equal('The Seer');
    });
  });

  // =====================================================================
  // 2. Rejecting comments on unpublished or nonexistent articles
  // =====================================================================
  describe('2. Rejection on unpublished / nonexistent articles', () => {
    it('rejects a comment on an unpublished article with 404', async () => {
      const res = await submitComment({
        postId: unpublishedPost.id,
        author: 'The Seer',
        content: 'Should never be stored.',
      });

      expect(res.status).to.equal(404);
      expect(res.body.error).to.be.a('string');
    });

    it('rejects a comment on a nonexistent article with 404', async () => {
      const res = await submitComment({
        postId: '00000000-0000-4000-8000-000000000000',
        author: 'The Seer',
        content: 'Should never be stored.',
      });

      expect(res.status).to.equal(404);
    });

    it('stores no comment for an unpublished article', async () => {
      const count = await prisma.comment.count({ where: { postId: unpublishedPost.id } });
      expect(count).to.equal(0);
    });
  });

  // =====================================================================
  // 3. Empty and excessively long inputs
  // =====================================================================
  describe('3. Empty and oversized inputs', () => {
    it('rejects an empty content field', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'The Seer',
        content: '',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects a whitespace-only content field', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'The Seer',
        content: '    ',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects a missing author field', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        content: 'No author supplied.',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects a missing postId', async () => {
      const res = await submitComment({
        author: 'The Seer',
        content: 'No article supplied.',
      });
      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/postId/i);
    });

    it(`rejects content longer than ${MAX_CONTENT_LENGTH} characters`, async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'The Seer',
        content: 'x'.repeat(MAX_CONTENT_LENGTH + 1),
      });
      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/too long/i);
    });

    it(`rejects an author longer than ${MAX_AUTHOR_LENGTH} characters`, async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'a'.repeat(MAX_AUTHOR_LENGTH + 1),
        content: 'Long author name.',
      });
      expect(res.status).to.equal(400);
    });

    it('accepts content exactly at the maximum length', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'The Seer',
        content: 'y'.repeat(MAX_CONTENT_LENGTH),
      });
      expect(res.status).to.equal(201);
      track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, content: 'y'.repeat(MAX_CONTENT_LENGTH) },
      }));
    });
  });

  // =====================================================================
  // 4. Creating valid replies
  // =====================================================================
  describe('4. Valid replies', () => {
    let parent;

    before(async () => {
      parent = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          author: 'Root Speaker',
          content: 'A top level comment to reply to.',
          status: 'approved',
        },
      }));
    });

    it('creates a reply linked to its parent', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        parentId: parent.id,
        author: 'Reply Voice',
        content: 'A reply to the top level comment.',
      });

      expect(res.status).to.equal(201);
      expect(res.body.status).to.equal('pending');
    });

    it('stores the reply with the correct parentId and postId', async () => {
      const reply = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, content: 'A reply to the top level comment.' },
      }));

      expect(reply).to.not.be.null;
      expect(reply.parentId).to.equal(parent.id);
      expect(reply.postId).to.equal(publishedPost.id);
    });
  });

  // =====================================================================
  // 5. Rejecting replies associated with another article
  // =====================================================================
  describe('5. Cross-article replies', () => {
    it('rejects a reply whose parent belongs to a different article', async () => {
      const foreignParent = track(await prisma.comment.create({
        data: {
          postId: secondPost.id,
          author: 'Other Speaker',
          content: 'Comment on a different article.',
          status: 'approved',
        },
      }));

      const res = await submitComment({
        postId: publishedPost.id,
        parentId: foreignParent.id,
        author: 'Cross Poster',
        content: 'This reply belongs to the wrong article.',
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/different article/i);
    });

    it('stores no reply for a cross-article parent', async () => {
      const count = await prisma.comment.count({
        where: { content: 'This reply belongs to the wrong article.' },
      });
      expect(count).to.equal(0);
    });

    it('rejects a reply whose parent does not exist', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        parentId: '00000000-0000-4000-8000-000000000000',
        author: 'Ghost Reply',
        content: 'Reply to a non-existent parent.',
      });

      expect(res.status).to.equal(404);
    });
  });

  // =====================================================================
  // 6. Enforcing maximum nesting depth
  // =====================================================================
  describe('6. Maximum nesting depth', () => {
    /**
     * MAX_NESTING_DEPTH = 3 means a comment may be nested at most 3 levels
     * below the top-level comment:
     *   depth 0 = top level, depth 1 = reply, depth 2 = reply to a reply,
     *   depth 3 = reply to that. A reply at depth 4 is refused.
     */
    const buildChain = async (length) => {
      const ids = [];
      let parentId = null;
      for (let i = 0; i < length; i++) {
        const c = track(await prisma.comment.create({
          data: {
            postId: publishedPost.id,
            parentId,
            author: `Chain ${i + 1}`,
            content: `Chain level ${i + 1}.`,
            status: 'approved',
          },
        }));
        ids.push(c.id);
        parentId = c.id;
      }
      return ids;
    };

    it('accepts a reply at exactly the maximum allowed depth', async () => {
      // Build a chain that reaches the maximum permitted depth (3).
      const chain = await buildChain(MAX_NESTING_DEPTH);
      const deepest = chain[chain.length - 1];

      const res = await submitComment({
        postId: publishedPost.id,
        parentId: deepest,
        author: 'AtMaxDepth',
        content: 'A reply sitting exactly at the maximum depth.',
      });

      expect(res.status).to.equal(201);

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, content: 'A reply sitting exactly at the maximum depth.' },
      }));
      expect(created.parentId).to.equal(deepest);
    });

    it('rejects a reply that would exceed the maximum depth', async () => {
      // One level deeper than the maximum: the reply would sit at depth 4.
      const chain = await buildChain(MAX_NESTING_DEPTH + 1);
      const tooDeep = chain[chain.length - 1];

      const res = await submitComment({
        postId: publishedPost.id,
        parentId: tooDeep,
        author: 'TooDeep',
        content: 'This reply should be refused for exceeding the depth limit.',
      });

      expect(res.status).to.equal(400);
      expect(res.body.error).to.match(/depth/i);
    });

    it('stores no comment for a reply that exceeds the depth limit', async () => {
      const count = await prisma.comment.count({
        where: { content: 'This reply should be refused for exceeding the depth limit.' },
      });
      expect(count).to.equal(0);
    });

    it('accepts a reply to a top-level comment', async () => {
      const chain = await buildChain(1);
      const res = await submitComment({
        postId: publishedPost.id,
        parentId: chain[0],
        author: 'DirectReply',
        content: 'A direct reply to a top level comment.',
      });
      expect(res.status).to.equal(201);
    });
  });

  // =====================================================================
  // 7. New comments defaulting to pending
  // =====================================================================
  describe('7. Default moderation status', () => {
    it('stores a new comment with status "pending"', async () => {
      await submitComment({
        postId: publishedPost.id,
        author: 'Default Status',
        content: 'This comment should default to pending.',
      });

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, content: 'This comment should default to pending.' },
      }));

      expect(created).to.not.be.null;
      expect(created.status).to.equal('pending');
    });

    it('returns status "pending" in the creation response', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'Default Status',
        content: 'Response should report pending.',
      });

      expect(res.status).to.equal(201);
      expect(res.body.status).to.equal('pending');
    });
  });

  // =====================================================================
  // 8. Pending and rejected comments remaining hidden publicly
  // =====================================================================
  describe('8. Pending and rejected comments stay hidden', () => {
    let pendingComment;
    let rejectedComment;

    before(async () => {
      pendingComment = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          author: 'Pending Voice',
          content: 'Pending comment body.',
          status: 'pending',
        },
      }));

      rejectedComment = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          author: 'Rejected Voice',
          content: 'Rejected comment body.',
          status: 'rejected',
        },
      }));
    });

    it('does not expose a pending comment in the public list', async () => {
      const ids = collectIds(await publicList(publishedPost.id));
      expect(ids).to.not.include(pendingComment.id);
    });

    it('does not expose a rejected comment in the public list', async () => {
      const ids = collectIds(await publicList(publishedPost.id));
      expect(ids).to.not.include(rejectedComment.id);
    });

    it('does not expose pending comment content in the public payload', async () => {
      const raw = JSON.stringify(await publicList(publishedPost.id));
      expect(raw).to.not.include('Pending comment body.');
      expect(raw).to.not.include('Rejected comment body.');
    });
  });

  // =====================================================================
  // 9. Approved comments being publicly visible
  // =====================================================================
  describe('9. Approved comments are publicly visible', () => {
    let approvedComment;
    let approvedReply;

    before(async () => {
      approvedComment = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          author: 'Approved Voice',
          content: 'Approved comment body.',
          status: 'approved',
        },
      }));

      approvedReply = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          parentId: approvedComment.id,
          author: 'Approved Reply',
          content: 'Approved reply body.',
          status: 'approved',
        },
      }));
    });

    it('exposes an approved comment in the public list', async () => {
      const ids = collectIds(await publicList(publishedPost.id));
      expect(ids).to.include(approvedComment.id);
    });

    it('exposes an approved reply nested under its parent', async () => {
      const comments = await publicList(publishedPost.id);
      const parent = comments.find(c => c.id === approvedComment.id);

      expect(parent, 'approved parent should be present').to.not.be.undefined;
      expect(parent.replies.map(r => r.id)).to.include(approvedReply.id);
    });

    it('includes the approved content in the public payload', async () => {
      const raw = JSON.stringify(await publicList(publishedPost.id));
      expect(raw).to.include('Approved comment body.');
      expect(raw).to.include('Approved reply body.');
    });
  });

  // =====================================================================
  // 10. Unauthorized moderation requests
  // =====================================================================
  describe('10. Unauthorized moderation requests', () => {
    it('rejects an unauthenticated admin comment list with 401', async () => {
      const res = await request(app).get('/api/comments/admin');
      expect(res.status).to.equal(401);
    });

    it('rejects an unauthenticated approve with 401', async () => {
      const res = await request(app)
        .patch('/api/comments/admin/00000000-0000-4000-8000-000000000000')
        .send({ status: 'approved' });
      expect(res.status).to.equal(401);
    });

    it('rejects an unauthenticated reject with 401', async () => {
      const res = await request(app)
        .patch('/api/comments/admin/00000000-0000-4000-8000-000000000000')
        .send({ status: 'rejected' });
      expect(res.status).to.equal(401);
    });

    it('rejects an unauthenticated delete with 401', async () => {
      const res = await request(app)
        .delete('/api/comments/admin/00000000-0000-4000-8000-000000000000');
      expect(res.status).to.equal(401);
    });

    it('rejects a moderation request carrying a malformed token', async () => {
      const res = await request(app)
        .patch('/api/comments/admin/00000000-0000-4000-8000-000000000000')
        .set('Cookie', 'auth_token=not-a-jwt')
        .send({ status: 'approved' });
      expect(res.status).to.equal(401);
    });

    it('does not expose the admin list through the public post route', async () => {
      // '/admin' must not be swallowed by the public '/:postId' route.
      const res = await request(app).get('/api/comments/admin');
      expect(res.status).to.equal(401);
      expect(res.body).to.not.have.property('postId');
    });
  });

  // =====================================================================
  // 11. Approving, rejecting, and deleting comments
  // =====================================================================
  describe('11. Moderation operations', () => {
    /** Create a fresh pending comment for a single test to act on. */
    const newPending = async () => track(await prisma.comment.create({
      data: {
        postId: publishedPost.id,
        author: 'Moderation Target',
        content: 'Comment awaiting moderation.',
        status: 'pending',
      },
    }));

    it('approves a pending comment', async () => {
      const target = await newPending();
      const res = await adminPatch(target.id, { status: 'approved' });
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('approved');
    });

    it('makes an approved comment publicly visible', async () => {
      const target = await newPending();
      const patched = await adminPatch(target.id, { status: 'approved' });
      expect(patched.status).to.equal(200);

      const ids = collectIds(await publicList(publishedPost.id));
      expect(ids).to.include(target.id);
    });

    it('rejects a pending comment', async () => {
      const target = await newPending();
      const res = await adminPatch(target.id, { status: 'rejected' });
      expect(res.status).to.equal(200);
      expect(res.body.status).to.equal('rejected');
    });

    it('hides a rejected comment from the public list', async () => {
      const target = await newPending();
      const patched = await adminPatch(target.id, { status: 'rejected' });
      expect(patched.status).to.equal(200);

      const ids = collectIds(await publicList(publishedPost.id));
      expect(ids).to.not.include(target.id);
    });

    it('rejects an invalid moderation status with 400', async () => {
      const target = await newPending();
      const res = await adminPatch(target.id, { status: 'banished' });
      expect(res.status).to.equal(400);
    });

    it('leaves the comment status untouched when the status is invalid', async () => {
      const target = await newPending();
      await adminPatch(target.id, { status: 'banished' });

      const found = await prisma.comment.findUnique({ where: { id: target.id } });
      expect(found.status).to.equal('pending');
    });

    it('rejects moderating a comment that does not exist with 404', async () => {
      const res = await adminPatch('00000000-0000-4000-8000-000000000000', { status: 'approved' });
      expect(res.status).to.equal(404);
    });

    it('deletes a comment with 204', async () => {
      const target = await newPending();
      const res = await adminDelete(target.id);
      expect(res.status).to.equal(204);
    });

    it('removes the deleted comment from the database', async () => {
      const target = await newPending();
      const res = await adminDelete(target.id);
      expect(res.status).to.equal(204);

      const found = await prisma.comment.findUnique({ where: { id: target.id } });
      expect(found).to.equal(null);
    });

    it('rejects deleting a comment that does not exist with 404', async () => {
      const res = await adminDelete('00000000-0000-4000-8000-000000000000');
      expect(res.status).to.equal(404);
    });
  });

  // =====================================================================
  // 12. Comment-submission rate limiting
  // =====================================================================
  describe('12. Rate limiting', () => {
    it('blocks comment submission once the per-IP limit is exceeded', async () => {
      const previousMax = process.env.COMMENT_RATE_LIMIT_MAX;
      const previousDisable = process.env.DISABLE_RATE_LIMIT;
      process.env.COMMENT_RATE_LIMIT_MAX = '3';
      process.env.DISABLE_RATE_LIMIT = '';

      try {
        // Clear the counter for this client before starting.
        await resetCommentLimiter('::ffff:127.0.0.1');
        await resetCommentLimiter('127.0.0.1');

        const statuses = [];
        for (let i = 0; i < 5; i++) {
          const res = await submitComment({
            postId: publishedPost.id,
            author: 'Flooder',
            content: `Rate limit probe ${i}`,
          });
          statuses.push(res.status);
          if (res.status === 201) {
            track(await prisma.comment.findFirst({
              where: { postId: publishedPost.id, content: `Rate limit probe ${i}` },
            }));
          }
        }

        expect(statuses.slice(0, 3), 'first requests should be accepted').to.deep.equal([201, 201, 201]);
        expect(statuses.slice(3), 'later requests should be limited').to.deep.equal([429, 429]);
      } finally {
        if (previousMax === undefined) delete process.env.COMMENT_RATE_LIMIT_MAX;
        else process.env.COMMENT_RATE_LIMIT_MAX = previousMax;
        if (previousDisable === undefined) delete process.env.DISABLE_RATE_LIMIT;
        else process.env.DISABLE_RATE_LIMIT = previousDisable;
        await resetCommentLimiter('::ffff:127.0.0.1');
        await resetCommentLimiter('127.0.0.1');
      }
    });
  });

  // =====================================================================
  // 13. CSRF protection for administrative mutations
  // =====================================================================
  describe('13. CSRF protection on administrative mutations', () => {
    /** Create a fresh pending comment for a single test to act on. */
    const newPending = async () => track(await prisma.comment.create({
      data: {
        postId: publishedPost.id,
        author: 'CSRF Target',
        content: 'Comment used for CSRF checks.',
        status: 'pending',
      },
    }));

    it('rejects a moderation request with no CSRF token', async () => {
      const target = await newPending();
      const res = await adminAgent
        .patch(`/api/comments/admin/${target.id}`)
        .send({ status: 'approved' });
      expect(res.status).to.equal(403);
    });

    it('rejects a moderation request with a forged CSRF token', async () => {
      const target = await newPending();
      const res = await adminAgent
        .patch(`/api/comments/admin/${target.id}`)
        .set('x-csrf-token', 'forged-token-value')
        .send({ status: 'approved' });
      expect(res.status).to.equal(403);
    });

    it('rejects a delete request with no CSRF token', async () => {
      const target = await newPending();
      const res = await adminAgent
        .delete(`/api/comments/admin/${target.id}`);
      expect(res.status).to.equal(403);
    });

    it('rejects a comment submission with no CSRF token', async () => {
      const res = await agent
        .post('/api/comments')
        .send({ postId: publishedPost.id, author: 'No Token', content: 'No CSRF token here.' });
      expect(res.status).to.equal(403);
    });

    it('rejects a comment submission with a forged CSRF token', async () => {
      const res = await agent
        .post('/api/comments')
        .set('x-csrf-token', 'forged-token-value')
        .send({ postId: publishedPost.id, author: 'Forged', content: 'Forged token here.' });
      expect(res.status).to.equal(403);
    });

    it('rejects a CSRF token minted for a different session', async () => {
      const target = await newPending();
      const otherAgent = request.agent(app);
      const otherToken = await csrfToken(otherAgent);

      const res = await adminAgent
        .patch(`/api/comments/admin/${target.id}`)
        .set('x-csrf-token', otherToken)
        .send({ status: 'approved' });

      expect(res.status).to.equal(403);
    });

    it('leaves the comment unmodified when CSRF validation fails', async () => {
      const target = await newPending();
      const res = await adminAgent
        .patch(`/api/comments/admin/${target.id}`)
        .set('x-csrf-token', 'forged-token-value')
        .send({ status: 'approved' });

      expect(res.status).to.equal(403);
      const found = await prisma.comment.findUnique({ where: { id: target.id } });
      expect(found.status).to.equal('pending');
    });
  });

  // =====================================================================
  // 14. Safe handling of attempted HTML / script injection
  // =====================================================================
  describe('14. HTML / script injection handling', () => {
    it('stores a script payload without executable markup', async () => {
      const payload = '<script>alert("xss")</script>';
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'Injector',
        content: payload,
      });

      expect(res.status).to.equal(201);

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, author: 'Injector' },
      }));

      expect(created).to.not.be.null;
      expect(created.content.toLowerCase()).to.not.include('<script');
      expect(created.content.toLowerCase()).to.not.include('</script>');
    });

    it('strips inline event handler attributes', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'Event Injector',
        content: '<img src=x onerror="alert(1)">',
      });

      expect(res.status).to.equal(201);

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, author: 'Event Injector' },
      }));

      expect(created.content.toLowerCase()).to.not.include('onerror');
    });

    it('strips javascript: protocol payloads', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'Protocol Injector',
        content: 'javascript:alert(document.cookie)',
      });

      expect(res.status).to.equal(201);

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, author: 'Protocol Injector' },
      }));

      expect(created.content.toLowerCase()).to.not.include('javascript:');
    });

    it('sanitises the author field as well', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: '<script>alert("author")</script>',
        content: 'Payload hidden in the author field.',
      });

      expect(res.status).to.equal(201);

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, content: 'Payload hidden in the author field.' },
      }));

      expect(created.author.toLowerCase()).to.not.include('<script');
    });

    it('preserves ordinary punctuation and formatting in legitimate comments', async () => {
      const res = await submitComment({
        postId: publishedPost.id,
        author: 'The Scrivener',
        content: 'What a lovely <b>bold</b> thought — I love "quotes" & it\'s punctuation!',
      });

      expect(res.status).to.equal(201);

      const created = track(await prisma.comment.findFirst({
        where: { postId: publishedPost.id, author: 'The Scrivener' },
      }));

      expect(created.content).to.include('<b>bold</b>');
      expect(created.content).to.include('"quotes"');
      expect(created.content).to.include("it's punctuation!");
    });

    it('reflects the sanitised value in the public payload rather than raw markup', async () => {
      const raw = JSON.stringify(await publicList(publishedPost.id));
      // The payload is not live markup, and the stored text carries no script tag.
      expect(raw.toLowerCase()).to.not.include('<script>alert');
    });
  });

  // =====================================================================
  // 15. Database integrity for the discussion tree
  // =====================================================================
  describe('15. Database integrity of the discussion tree', () => {
    it('cascades replies when the parent comment is deleted', async () => {
      const parent = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          author: 'Cascade Parent',
          content: 'Parent to be deleted.',
          status: 'approved',
        },
      }));
      const reply = track(await prisma.comment.create({
        data: {
          postId: publishedPost.id,
          parentId: parent.id,
          author: 'Cascade Reply',
          content: 'Reply that must go with its parent.',
          status: 'approved',
        },
      }));

      await prisma.comment.delete({ where: { id: parent.id } });

      const orphan = await prisma.comment.findUnique({ where: { id: reply.id } });
      expect(orphan, 'reply should be removed with its parent').to.equal(null);
    });

    it('cascades the whole discussion tree when the article is deleted', async () => {
      const article = await prisma.post.create({
        data: {
          title: 'Phase 8.1 Cascade Article',
          slug: `${RUN_ID}-cascade-post`,
          content: 'Article with a discussion tree.',
          published: true,
          publishedAt: new Date(),
        },
      });

      const root = track(await prisma.comment.create({
        data: {
          postId: article.id,
          author: 'Tree Root',
          content: 'Root of the tree.',
          status: 'approved',
        },
      }));
      const branch = track(await prisma.comment.create({
        data: {
          postId: article.id,
          parentId: root.id,
          author: 'Tree Branch',
          content: 'Branch of the tree.',
          status: 'approved',
        },
      }));
      const leaf = track(await prisma.comment.create({
        data: {
          postId: article.id,
          parentId: branch.id,
          author: 'Tree Leaf',
          content: 'Leaf of the tree.',
          status: 'approved',
        },
      }));

      await prisma.post.delete({ where: { id: article.id } });

      for (const id of [root.id, branch.id, leaf.id]) {
        const found = await prisma.comment.findUnique({ where: { id } });
        expect(found, `comment ${id} should be removed with its article`).to.equal(null);
      }
    });

    it('keeps pre-existing posts, artifacts, categories and users intact', async () => {
      const [posts, artifacts, categories, users] = await Promise.all([
        prisma.post.count(),
        prisma.artifact.count(),
        prisma.category.count(),
        prisma.user.count(),
      ]);

      // The suite must not have removed the seed content.
      const seededPost = await prisma.post.findFirst({
        where: { slug: 'taxonomy-of-shadows' },
      });
      expect(seededPost, 'the original seeded article must still exist').to.not.be.null;
      expect(seededPost.published, 'the original article publication status must be unchanged').to.be.true;

      const seededArtifact = await prisma.artifact.findFirst({
        where: { slug: 'architecture-of-silence' },
      });
      expect(seededArtifact, 'the original seeded artifact must still exist').to.not.be.null;

      const gothic = await prisma.category.findFirst({ where: { slug: 'gothic' } });
      expect(gothic, 'the original category must still exist').to.not.be.null;

      expect(users, 'administrator accounts must remain intact').to.be.greaterThan(0);
      expect(posts).to.be.greaterThan(0);
      expect(artifacts).to.be.greaterThan(0);
      expect(categories).to.be.greaterThan(0);
    });

    it('never links a reply to a comment from a different article', async () => {
      const mismatched = await prisma.comment.findFirst({
        where: { parentId: { not: null } },
        include: { parent: true },
      });

      if (mismatched) {
        expect(mismatched.parent.postId).to.equal(mismatched.postId);
      }
    });
  });
});
