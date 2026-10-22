import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config.js';
import { signAdminToken } from '../helpers/admin-token.js';

/**
 * Administrative management of branching stories.
 *
 * Covers: authentication, CSRF, creation, node and choice authoring, the
 * starting node, publication gating, structural validation, cross-story
 * references, and deletion with its dependent records.
 */

const slug = (name) => `p9a-admin-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Admin Branching Story API', () => {
  let agent;
  let adminToken;

  // Records created by this suite, removed afterwards.
  const createdStoryIds = [];
  const createdNodeIds = [];
  const createdChoiceIds = [];

  const track = {
    story: (id) => { createdStoryIds.push(id); return id; },
    node: (id) => { createdNodeIds.push(id); return id; },
    choice: (id) => { createdChoiceIds.push(id); return id; },
  };

  before(async () => {
    agent = request.agent(app);

    const admin = await prisma.user.upsert({
      where: { username: 'admin_test' },
      update: {},
      create: { username: 'admin_test', password: 'Password123!' },
    });
    adminToken = signAdminToken(admin);
  });

  after(async () => {
    // Remove only what this suite created. The order matters: the
    // starting-node pointer must be cleared before any node row is removed,
    // because it is a foreign key with ON DELETE NO ACTION.
    if (createdStoryIds.length) {
      await prisma.story.updateMany({
        where: { id: { in: createdStoryIds } },
        data: { startingNodeId: null },
      });
    }
    if (createdChoiceIds.length) {
      await prisma.storyChoice.deleteMany({ where: { id: { in: createdChoiceIds } } });
    }
    if (createdNodeIds.length) {
      await prisma.storyNode.deleteMany({ where: { id: { in: createdNodeIds } } });
    }
    if (createdStoryIds.length) {
      await prisma.storyChoice.deleteMany({
        where: { storyId: { in: createdStoryIds } },
      });
      await prisma.storyNode.deleteMany({
        where: { storyId: { in: createdStoryIds } },
      });
      await prisma.story.deleteMany({ where: { id: { in: createdStoryIds } } });
    }
    await prisma.$disconnect();
  });

  /** Authenticated, CSRF-protected request helpers. */
  const authed = (method) => (endpoint) =>
    agent[method](endpoint).set('Cookie', `auth_token=${adminToken}`);

  const withCsrf = async (method, endpoint, body) => {
    const csrfRes = await agent.get('/api/auth/csrf-token');
    expect(csrfRes.status).to.equal(200);
    const token = csrfRes.body.token;
    let req = agent[method](endpoint)
      .set('Cookie', `auth_token=${adminToken}`)
      .set('x-csrf-token', token);
    if (body !== undefined) req = req.send(body);
    return req;
  };

  const createStory = async (overrides = {}) => {
    const res = await withCsrf('post', '/api/admin/stories', {
      title: 'The Ashen Corridor',
      slug: slug('story'),
      introduction: 'A corridor of ash and unanswered questions.',
      ...overrides,
    });
    expect(res.status).to.equal(201);
    track.story(res.body.id);
    return res.body;
  };

  const createNode = async (storyId, overrides = {}) => {
    const res = await withCsrf('post', `/api/admin/stories/${storyId}/nodes`, {
      title: 'A section',
      content: 'The narrative text of this section of the story.',
      ...overrides,
    });
    expect(res.status).to.equal(201);
    track.node(res.body.id);
    return res.body;
  };

  const createChoice = async (storyId, nodeId, destinationNodeId, overrides = {}) => {
    const res = await withCsrf(
      'post',
      `/api/admin/stories/${storyId}/nodes/${nodeId}/choices`,
      { label: 'Take the left corridor', destinationNodeId, ...overrides }
    );
    expect(res.status).to.equal(201);
    track.choice(res.body.id);
    return res.body;
  };

  describe('Authentication and CSRF', () => {
    const guarded = [
      { method: 'get', url: '/api/admin/stories' },
      { method: 'get', url: '/api/admin/stories/some-id' },
      { method: 'get', url: '/api/admin/stories/some-id/validate' },
      { method: 'post', url: '/api/admin/stories' },
      { method: 'put', url: '/api/admin/stories/some-id' },
      { method: 'patch', url: '/api/admin/stories/some-id/publish' },
      { method: 'delete', url: '/api/admin/stories/some-id' },
      { method: 'post', url: '/api/admin/stories/some-id/nodes' },
      { method: 'put', url: '/api/admin/stories/some-id/nodes/some-node' },
      { method: 'delete', url: '/api/admin/stories/some-id/nodes/some-node' },
      { method: 'post', url: '/api/admin/stories/some-id/nodes/some-node/choices' },
      { method: 'put', url: '/api/admin/stories/some-id/choices/some-choice' },
      { method: 'delete', url: '/api/admin/stories/some-id/choices/some-choice' },
      { method: 'post', url: '/api/admin/stories/some-id/start' },
    ];

    guarded.forEach(({ method, url }) => {
      it(`should reject unauthenticated ${method.toUpperCase()} ${url}`, async () => {
        const res = await request(app)[method](url);
        expect(res.status).to.equal(401);
        expect(res.body.error).to.equal('Authentication required');
      });
    });

    it('should reject a state-changing request without a CSRF token', async () => {
      const res = await agent
        .post('/api/admin/stories')
        .set('Cookie', `auth_token=${adminToken}`)
        .send({ title: 'No CSRF', slug: slug('nocsrf'), introduction: 'x' });
      expect(res.status).to.equal(403);
    });

    it('should reject a CSRF token minted by a different session', async () => {
      const otherAgent = request.agent(app);
      const csrfRes = await otherAgent.get('/api/auth/csrf-token');
      const otherToken = csrfRes.body.token;

      const res = await agent
        .post('/api/admin/stories')
        .set('Cookie', `auth_token=${adminToken}`)
        .set('x-csrf-token', otherToken)
        .send({ title: 'Cross session', slug: slug('cross'), introduction: 'x' });
      expect(res.status).to.equal(403);
    });
  });

  describe('Story lifecycle', () => {
    it('should create a story as an administrator', async () => {
      const story = await createStory();
      expect(story.id).to.be.a('string');
      expect(story.title).to.equal('The Ashen Corridor');
      expect(story.published).to.be.false;
      expect(story.startingNodeId).to.equal(null);
    });

    it('should list stories for an administrator, including drafts', async () => {
      const story = await createStory();
      const res = await authed('get')('/api/admin/stories');
      expect(res.status).to.equal(200);
      const found = res.body.find((s) => s.id === story.id);
      expect(found).to.exist;
      expect(found).to.have.property('structureValid');
    });

    it('should retrieve a single story with its graph', async () => {
      const story = await createStory();
      const node = await createNode(story.id);
      const res = await authed('get')(`/api/admin/stories/${story.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(story.id);
      expect(res.body.nodes).to.have.lengthOf(1);
      expect(res.body.nodes[0].id).to.equal(node.id);
    });

    it('should update the title, slug and introduction', async () => {
      const story = await createStory();
      const newSlug = slug('renamed');
      const res = await withCsrf('put', `/api/admin/stories/${story.id}`, {
        title: 'The Ashen Corridor (Revised)',
        slug: newSlug,
        introduction: 'A revised introduction.',
      });
      expect(res.status).to.equal(200);
      expect(res.body.title).to.equal('The Ashen Corridor (Revised)');
      expect(res.body.slug).to.equal(newSlug);
      expect(res.body.introduction).to.equal('A revised introduction.');
    });

    it('should reject a duplicate slug', async () => {
      const story = await createStory();
      const res = await withCsrf('post', '/api/admin/stories', {
        title: 'Duplicate',
        slug: story.slug,
        introduction: 'x',
      });
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('Slug already exists');
    });

    it('should reject a missing title, slug or introduction', async () => {
      const noTitle = await withCsrf('post', '/api/admin/stories', {
        slug: slug('notitle'),
        introduction: 'x',
      });
      expect(noTitle.status).to.equal(400);

      const noIntro = await withCsrf('post', '/api/admin/stories', {
        title: 'No intro',
        slug: slug('nointro'),
      });
      expect(noIntro.status).to.equal(400);
    });

    it('should reject a malformed slug', async () => {
      const res = await withCsrf('post', '/api/admin/stories', {
        title: 'Bad slug',
        slug: 'Not A Valid Slug!',
        introduction: 'x',
      });
      expect(res.status).to.equal(400);
    });

    it('should return 404 for a story that does not exist', async () => {
      const res = await authed('get')('/api/admin/stories/00000000-0000-0000-0000-000000000000');
      expect(res.status).to.equal(404);
    });
  });

  describe('Nodes and choices', () => {
    it('should create nodes and link them with choices', async () => {
      const story = await createStory();
      const start = await createNode(story.id, { title: 'The Threshold' });
      const middle = await createNode(story.id, { title: 'The Corridor' });
      const ending = await createNode(story.id, {
        title: 'The End',
        content: 'The story ends here.',
        isEnding: true,
      });

      const choiceOne = await createChoice(story.id, start.id, middle.id, {
        label: 'Walk on',
      });
      const choiceTwo = await createChoice(story.id, middle.id, ending.id, {
        label: 'Open the door',
      });

      expect(choiceOne.nodeId).to.equal(start.id);
      expect(choiceOne.destinationNodeId).to.equal(middle.id);
      expect(choiceTwo.destinationNodeId).to.equal(ending.id);
    });

    it('should set the starting node', async () => {
      const story = await createStory();
      const node = await createNode(story.id);
      const res = await withCsrf('post', `/api/admin/stories/${story.id}/start`, {
        nodeId: node.id,
      });
      expect(res.status).to.equal(200);
      expect(res.body.startingNodeId).to.equal(node.id);

      const fetched = await authed('get')(`/api/admin/stories/${story.id}`);
      expect(fetched.body.startingNodeId).to.equal(node.id);
    });

    it('should refuse a starting node that belongs to another story', async () => {
      const storyA = await createStory();
      const storyB = await createStory();
      const foreignNode = await createNode(storyB.id);

      const res = await withCsrf('post', `/api/admin/stories/${storyA.id}/start`, {
        nodeId: foreignNode.id,
      });
      expect(res.status).to.equal(404);
      expect(res.body.error).to.equal('Node not found');
    });

    it('should refuse a starting node that is an ending node', async () => {
      const story = await createStory();
      const ending = await createNode(story.id, { isEnding: true });
      const res = await withCsrf('post', `/api/admin/stories/${story.id}/start`, {
        nodeId: ending.id,
      });
      expect(res.status).to.equal(409);
    });

    it('should refuse a choice whose destination does not exist', async () => {
      const story = await createStory();
      const node = await createNode(story.id);
      const res = await withCsrf(
        'post',
        `/api/admin/stories/${story.id}/nodes/${node.id}/choices`,
        { label: 'Into nowhere', destinationNodeId: '00000000-0000-0000-0000-000000000000' }
      );
      expect(res.status).to.equal(404);
      expect(res.body.error).to.equal('Destination node not found');
    });

    it('should refuse a choice that points into a different story', async () => {
      const storyA = await createStory();
      const storyB = await createStory();
      const nodeA = await createNode(storyA.id);
      const nodeB = await createNode(storyB.id);

      const res = await withCsrf(
        'post',
        `/api/admin/stories/${storyA.id}/nodes/${nodeA.id}/choices`,
        { label: 'Cross the boundary', destinationNodeId: nodeB.id }
      );
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('The destination node belongs to a different story');
    });

    it('should refuse a choice that leaves an ending node', async () => {
      const story = await createStory();
      const ending = await createNode(story.id, { isEnding: true });
      const other = await createNode(story.id);
      const res = await withCsrf(
        'post',
        `/api/admin/stories/${story.id}/nodes/${ending.id}/choices`,
        { label: 'Not allowed', destinationNodeId: other.id }
      );
      expect(res.status).to.equal(409);
      expect(res.body.error).to.equal('An ending node cannot have outgoing choices');
    });

    it('should update a choice label and destination', async () => {
      const story = await createStory();
      const nodeA = await createNode(story.id);
      const nodeB = await createNode(story.id);
      const choice = await createChoice(story.id, nodeA.id, nodeA.id);

      const res = await withCsrf(
        'put',
        `/api/admin/stories/${story.id}/choices/${choice.id}`,
        { label: 'Renamed choice', destinationNodeId: nodeB.id }
      );
      expect(res.status).to.equal(200);
      expect(res.body.label).to.equal('Renamed choice');
      expect(res.body.destinationNodeId).to.equal(nodeB.id);
    });

    it('should refuse to update a choice that does not belong to the story', async () => {
      const storyA = await createStory();
      const storyB = await createStory();
      const nodeA = await createNode(storyA.id);
      const nodeB = await createNode(storyB.id);
      const choiceB = await createChoice(storyB.id, nodeB.id, nodeB.id);

      const res = await withCsrf(
        'put',
        `/api/admin/stories/${storyA.id}/choices/${choiceB.id}`,
        { label: 'Hijacked' }
      );
      expect(res.status).to.equal(404);
    });

    it('should delete a choice', async () => {
      const story = await createStory();
      const node = await createNode(story.id);
      const choice = await createChoice(story.id, node.id, node.id);

      const res = await withCsrf(
        'delete',
        `/api/admin/stories/${story.id}/choices/${choice.id}`
      );
      expect(res.status).to.equal(204);

      const remaining = await prisma.storyChoice.findUnique({ where: { id: choice.id } });
      expect(remaining).to.equal(null);
    });
  });

  describe('Publication gating', () => {
    it('should refuse to publish a story with no starting node', async () => {
      const story = await createStory();
      await createNode(story.id);
      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: true,
      });
      expect(res.status).to.equal(409);
      expect(res.body.errors.join(' ')).to.contain('no starting node');
    });

    it('should refuse to publish a story whose starting node is a dead end', async () => {
      const story = await createStory();
      const node = await createNode(story.id);
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: node.id });

      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: true,
      });
      expect(res.status).to.equal(409);
    });

    it('should refuse to publish a story with no reachable ending', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const middle = await createNode(story.id);
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, middle.id);

      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: true,
      });
      expect(res.status).to.equal(409);
    });

    it('should refuse to publish a story with an unreachable draft node', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const ending = await createNode(story.id, { isEnding: true });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, ending.id);
      // A second, published node that nothing leads to is merely unreachable;
      // a DRAFT node that is reachable is what must block publication.
      await createNode(story.id, { published: false, title: 'Hidden section' });

      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: true,
      });
      expect(res.status).to.equal(409);
    });

    it('should publish a structurally valid story', async () => {
      const story = await createStory();
      const start = await createNode(story.id, { title: 'The Threshold' });
      const ending = await createNode(story.id, {
        title: 'The End',
        content: 'It ends.',
        isEnding: true,
      });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, ending.id, { label: 'Step through' });

      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: true,
      });
      expect(res.status).to.equal(200);
      expect(res.body.published).to.be.true;
      expect(res.body.publishedAt).to.be.a('string');
    });

    it('should unpublish a story', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const ending = await createNode(story.id, { isEnding: true });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, ending.id);
      await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, { published: true });

      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: false,
      });
      expect(res.status).to.equal(200);
      expect(res.body.published).to.be.false;
      expect(res.body.publishedAt).to.equal(null);
    });

    it('should refuse to mutate a published story into an invalid one', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const ending = await createNode(story.id, { isEnding: true });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, ending.id);
      await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, { published: true });

      // Deleting the only choice would strand the starting node.
      const choices = await prisma.storyChoice.findMany({ where: { storyId: story.id } });
      expect(choices).to.have.lengthOf(1);

      const res = await withCsrf(
        'delete',
        `/api/admin/stories/${story.id}/choices/${choices[0].id}`
      );
      expect(res.status).to.equal(409);
      expect(res.body.errors.join(' ')).to.contain('no published choice');

      // The story must be unchanged after the refused change.
      const after = await prisma.storyChoice.findMany({ where: { storyId: story.id } });
      expect(after).to.have.lengthOf(1);
    });

    it('should refuse to unpublish or republish with a non-boolean flag', async () => {
      const story = await createStory();
      const res = await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, {
        published: 'yes',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('Structure validation report', () => {
    it('should report the structural verdict for a story', async () => {
      const story = await createStory();
      const node = await createNode(story.id);
      const res = await authed('get')(`/api/admin/stories/${story.id}/validate`);
      expect(res.status).to.equal(200);
      expect(res.body.valid).to.be.false;
      expect(res.body.errors.join(' ')).to.contain('no starting node');
      expect(res.body.nodes).to.have.lengthOf(1);
      expect(res.body.nodes[0].id).to.equal(node.id);
    });

    it('should report a valid story as valid', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const ending = await createNode(story.id, { isEnding: true });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, ending.id);

      const res = await authed('get')(`/api/admin/stories/${story.id}/validate`);
      expect(res.status).to.equal(200);
      expect(res.body.valid).to.be.true;
      expect(res.body.errors).to.have.lengthOf(0);
    });
  });

  describe('Deletion', () => {
    it('should refuse to delete a node that is still referenced, by default', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const other = await createNode(story.id);
      await createChoice(story.id, start.id, other.id);

      const res = await withCsrf(
        'delete',
        `/api/admin/stories/${story.id}/nodes/${other.id}`
      );
      expect(res.status).to.equal(409);
      expect(res.body.references.incomingChoices).to.have.lengthOf(1);
    });

    it('should delete a referenced node and its dependent choices with ?strategy=detach', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const other = await createNode(story.id);
      const choice = await createChoice(story.id, start.id, other.id);

      const res = await withCsrf(
        'delete',
        `/api/admin/stories/${story.id}/nodes/${other.id}?strategy=detach`
      );
      expect(res.status).to.equal(204);

      const node = await prisma.storyNode.findUnique({ where: { id: other.id } });
      expect(node).to.equal(null);
      const dangling = await prisma.storyChoice.findUnique({ where: { id: choice.id } });
      expect(dangling).to.equal(null);
    });

    it('should delete a story together with its nodes and choices', async () => {
      const story = await createStory();
      const start = await createNode(story.id);
      const ending = await createNode(story.id, { isEnding: true });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      const choice = await createChoice(story.id, start.id, ending.id);

      const res = await withCsrf('delete', `/api/admin/stories/${story.id}`);
      expect(res.status).to.equal(204);

      const storyAfter = await prisma.story.findUnique({ where: { id: story.id } });
      expect(storyAfter).to.equal(null);
      const nodesAfter = await prisma.storyNode.findMany({ where: { storyId: story.id } });
      expect(nodesAfter).to.have.lengthOf(0);
      const choicesAfter = await prisma.storyChoice.findMany({ where: { storyId: story.id } });
      expect(choicesAfter).to.have.lengthOf(0);
      const choiceAfter = await prisma.storyChoice.findUnique({ where: { id: choice.id } });
      expect(choiceAfter).to.equal(null);
    });

    it('should return 404 when deleting a story that does not exist', async () => {
      const res = await withCsrf(
        'delete',
        '/api/admin/stories/00000000-0000-0000-0000-000000000000'
      );
      expect(res.status).to.equal(404);
    });
  });

  describe('Isolation from existing content', () => {
    it('should not modify posts, artifacts, categories or users', async () => {
      const before = {
        posts: await prisma.post.count(),
        artifacts: await prisma.artifact.count(),
        categories: await prisma.category.count(),
        users: await prisma.user.count(),
      };

      const story = await createStory();
      const start = await createNode(story.id);
      const ending = await createNode(story.id, { isEnding: true });
      await withCsrf('post', `/api/admin/stories/${story.id}/start`, { nodeId: start.id });
      await createChoice(story.id, start.id, ending.id);
      await withCsrf('patch', `/api/admin/stories/${story.id}/publish`, { published: true });
      await withCsrf('delete', `/api/admin/stories/${story.id}`);

      const after = {
        posts: await prisma.post.count(),
        artifacts: await prisma.artifact.count(),
        categories: await prisma.category.count(),
        users: await prisma.user.count(),
      };

      expect(after.posts).to.equal(before.posts);
      expect(after.artifacts).to.equal(before.artifacts);
      expect(after.categories).to.equal(before.categories);
      expect(after.users).to.equal(before.users);
    });
  });
});
