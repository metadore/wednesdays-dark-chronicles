import request from 'supertest';
import { expect } from 'chai';
import app from '../../src/app.js';
import prisma from '../../src/lib/prisma.js';

/**
 * Public, read-only endpoints for interactive stories.
 *
 * Covers: listing published stories, retrieving a story and its starting
 * node, retrieving a node and its choices, following a choice to its
 * destination, reaching an ending, and the guarantee that draft stories,
 * draft nodes and draft choices are never exposed.
 */

const uniq = () => `p9a-public-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Public Branching Story API', () => {
  let publishedStory;
  let draftStory;

  let startNode;
  let middleNode;
  let endingNode;
  let secretNode;
  let startChoice;
  let middleChoice;

  let draftStartNode;
  let draftEndNode;

  before(async () => {
    // --- A published story: start -> middle -> ending, plus a branch ------
    publishedStory = await prisma.story.create({
      data: {
        title: 'The Ashen Corridor',
        slug: uniq(),
        introduction: 'A corridor of ash and unanswered questions.',
        published: true,
        publishedAt: new Date(),
      },
    });

    startNode = await prisma.storyNode.create({
      data: { storyId: publishedStory.id, title: 'The Threshold', content: 'The door stands open.' },
    });
    middleNode = await prisma.storyNode.create({
      data: { storyId: publishedStory.id, title: 'The Corridor', content: 'Ash drifts along the floor.' },
    });
    endingNode = await prisma.storyNode.create({
      data: {
        storyId: publishedStory.id,
        title: 'The End',
        content: 'The corridor ends. So do you.',
        isEnding: true,
      },
    });
    // A published node that nothing links to: it must never be reachable
    // through a choice, and it must not appear in the story's public graph.
    secretNode = await prisma.storyNode.create({
      data: { storyId: publishedStory.id, title: 'Unlinked', content: 'Nobody can get here.' },
    });

    startChoice = await prisma.storyChoice.create({
      data: { storyId: publishedStory.id, nodeId: startNode.id, destinationNodeId: middleNode.id, label: 'Walk on' },
    });
    middleChoice = await prisma.storyChoice.create({
      data: { storyId: publishedStory.id, nodeId: middleNode.id, destinationNodeId: endingNode.id, label: 'Open the door' },
    });

    await prisma.story.update({
      where: { id: publishedStory.id },
      data: { startingNodeId: startNode.id },
    });

    // --- A draft story, with a draft node -------------------------------
    draftStory = await prisma.story.create({
      data: {
        title: 'The Sealed Manuscript',
        slug: uniq(),
        introduction: 'This manuscript is not ready to be read.',
        published: false,
      },
    });
    draftStartNode = await prisma.storyNode.create({
      data: { storyId: draftStory.id, title: 'Sealed', content: 'The first line of the draft.' },
    });
    draftEndNode = await prisma.storyNode.create({
      data: { storyId: draftStory.id, title: 'Sealed end', content: 'The end of the draft.', isEnding: true },
    });
    await prisma.storyChoice.create({
      data: { storyId: draftStory.id, nodeId: draftStartNode.id, destinationNodeId: draftEndNode.id, label: 'Read on' },
    });
    await prisma.story.update({
      where: { id: draftStory.id },
      data: { startingNodeId: draftStartNode.id },
    });
  });

  after(async () => {
    // Clear the starting pointers first, then remove the children, then the
    // stories. The starting-node pointer is a foreign key with ON DELETE
    // NO ACTION, so it has to go first.
    const storyIds = [publishedStory.id, draftStory.id];
    await prisma.story.updateMany({
      where: { id: { in: storyIds } },
      data: { startingNodeId: null },
    });
    await prisma.storyChoice.deleteMany({ where: { storyId: { in: storyIds } } });
    await prisma.storyNode.deleteMany({ where: { storyId: { in: storyIds } } });
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
    await prisma.$disconnect();
  });

  describe('GET /api/stories', () => {
    it('should return the published stories', async () => {
      const res = await request(app).get('/api/stories');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
      const found = res.body.data.find((s) => s.id === publishedStory.id);
      expect(found).to.exist;
      expect(found.title).to.equal('The Ashen Corridor');
    });

    it('should not return draft stories', async () => {
      const res = await request(app).get('/api/stories');
      const found = res.body.data.find((s) => s.id === draftStory.id);
      expect(found).to.be.undefined;
      expect(res.body.data.some((s) => s.title === 'The Sealed Manuscript')).to.be.false;
    });

    it('should return pagination metadata and bound the limit', async () => {
      const res = await request(app).get('/api/stories?limit=100');
      expect(res.status).to.equal(200);
      expect(res.body.meta.limit).to.equal(50);
      expect(res.body.meta.page).to.equal(1);
      expect(res.body.meta).to.have.property('total');
    });

    it('should handle invalid pagination parameters gracefully', async () => {
      const res = await request(app).get('/api/stories?page=-3&limit=0');
      expect(res.status).to.equal(200);
      expect(res.body.meta.page).to.equal(1);
      expect(res.body.meta.limit).to.equal(10);
    });
  });

  describe('GET /api/stories/:slug', () => {
    it('should return a published story with its starting node', async () => {
      const res = await request(app).get(`/api/stories/${publishedStory.slug}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(publishedStory.id);
      expect(res.body.title).to.equal('The Ashen Corridor');
      expect(res.body.startNode).to.be.an('object');
      expect(res.body.startNode.id).to.equal(startNode.id);
      expect(res.body.startNode.content).to.equal('The door stands open.');
      expect(res.body.startNode.isEnding).to.be.false;
    });

    it('should return 404 for a draft story', async () => {
      const res = await request(app).get(`/api/stories/${draftStory.slug}`);
      expect(res.status).to.equal(404);
      expect(res.body.error).to.equal('Story not found');
    });

    it('should return 404 for an unknown slug', async () => {
      const res = await request(app).get('/api/stories/no-such-story-at-all');
      expect(res.status).to.equal(404);
    });

    it('should reject a malformed slug', async () => {
      const res = await request(app).get('/api/stories/Not%20A%20Slug');
      expect(res.status).to.equal(400);
    });

    it('should not expose the content of a draft story', async () => {
      const res = await request(app).get(`/api/stories/${draftStory.slug}`);
      expect(res.status).to.equal(404);
      expect(JSON.stringify(res.body)).to.not.contain('The first line of the draft');
    });
  });

  describe('GET /api/stories/:slug/nodes/:nodeId', () => {
    it('should return a node and the choices that leave it', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.node.id).to.equal(startNode.id);
      expect(res.body.node.title).to.equal('The Threshold');
      expect(res.body.isEnding).to.be.false;
      expect(res.body.choices).to.have.lengthOf(1);
      expect(res.body.choices[0].id).to.equal(startChoice.id);
      expect(res.body.choices[0].label).to.equal('Walk on');
      expect(res.body.choices[0].destinationNodeId).to.equal(middleNode.id);
    });

    it('should return no choices for an ending node', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${endingNode.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.isEnding).to.be.true;
      expect(res.body.choices).to.have.lengthOf(0);
    });

    it('should return 404 for a node of a draft story', async () => {
      const res = await request(app).get(
        `/api/stories/${draftStory.slug}/nodes/${draftStartNode.id}`
      );
      expect(res.status).to.equal(404);
    });

    it('should return 404 for a node of a published story reached through a draft story', async () => {
      // The node id is valid and published, but it does not belong to the
      // story named in the URL.
      const res = await request(app).get(
        `/api/stories/${draftStory.slug}/nodes/${startNode.id}`
      );
      expect(res.status).to.equal(404);
    });

    it('should return 404 for an unknown node', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/00000000-0000-0000-0000-000000000000`
      );
      expect(res.status).to.equal(404);
      expect(res.body.error).to.equal('Node not found');
    });

    it('should reject a malformed node id', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/not%20a%20valid%20id`
      );
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/stories/:slug/nodes/:nodeId/choices/:choiceId', () => {
    it('should follow a valid choice to its destination node', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}/choices/${startChoice.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.node.id).to.equal(middleNode.id);
      expect(res.body.node.title).to.equal('The Corridor');
      expect(res.body.isEnding).to.be.false;
      expect(res.body.choices).to.have.lengthOf(1);
      expect(res.body.choices[0].id).to.equal(middleChoice.id);
    });

    it('should reach an ending', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${middleNode.id}/choices/${middleChoice.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.node.id).to.equal(endingNode.id);
      expect(res.body.isEnding).to.be.true;
      expect(res.body.choices).to.have.lengthOf(0);
    });

    it('should return 404 for a choice that does not belong to the source node', async () => {
      // middleChoice leaves middleNode, not startNode.
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}/choices/${middleChoice.id}`
      );
      expect(res.status).to.equal(404);
      expect(res.body.error).to.equal('Choice not found');
    });

    it('should return 404 for an unknown choice', async () => {
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}/choices/00000000-0000-0000-0000-000000000000`
      );
      expect(res.status).to.equal(404);
    });

    it('should return 404 for a choice of a draft story', async () => {
      const draftChoice = await prisma.storyChoice.findFirst({
        where: { storyId: draftStory.id },
      });
      const res = await request(app).get(
        `/api/stories/${draftStory.slug}/nodes/${draftStartNode.id}/choices/${draftChoice.id}`
      );
      expect(res.status).to.equal(404);
    });
  });

  describe('Draft content isolation', () => {
    it('should not expose a draft node inside a published story', async () => {
      const draftNode = await prisma.storyNode.create({
        data: {
          storyId: publishedStory.id,
          title: 'Hidden section',
          content: 'This section has not been released.',
          published: false,
        },
      });
      trackNode(draftNode.id);

      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${draftNode.id}`
      );
      expect(res.status).to.equal(404);
    });

    it('should not expose a draft choice inside a published story', async () => {
      const draftChoice = await prisma.storyChoice.create({
        data: {
          storyId: publishedStory.id,
          nodeId: startNode.id,
          destinationNodeId: middleNode.id,
          label: 'Secret path',
          published: false,
        },
      });
      trackChoice(draftChoice.id);

      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.choices.some((c) => c.id === draftChoice.id)).to.be.false;
      expect(JSON.stringify(res.body)).to.not.contain('Secret path');
    });

    it('should not expose a published choice that leads to a draft node', async () => {
      const draftDest = await prisma.storyNode.create({
        data: {
          storyId: publishedStory.id,
          content: 'An unpublished destination.',
          published: false,
        },
      });
      trackNode(draftDest.id);

      const choice = await prisma.storyChoice.create({
        data: {
          storyId: publishedStory.id,
          nodeId: startNode.id,
          destinationNodeId: draftDest.id,
          label: 'Leads to the dark',
        },
      });
      trackChoice(choice.id);

      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.choices.some((c) => c.id === choice.id)).to.be.false;

      // And following it directly must not work either.
      const follow = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${startNode.id}/choices/${choice.id}`
      );
      expect(follow.status).to.equal(404);
    });
  });

  describe('Loop safety', () => {
    it('should not traverse a cyclic graph indefinitely', async () => {
      // A -> B -> A, with an ending reachable from B as well.
      const loopA = await prisma.storyNode.create({
        data: { storyId: publishedStory.id, content: 'Loop A' },
      });
      const loopB = await prisma.storyNode.create({
        data: { storyId: publishedStory.id, content: 'Loop B' },
      });
      trackNode(loopA.id);
      trackNode(loopB.id);

      const c1 = await prisma.storyChoice.create({
        data: { storyId: publishedStory.id, nodeId: loopA.id, destinationNodeId: loopB.id, label: 'to B' },
      });
      const c2 = await prisma.storyChoice.create({
        data: { storyId: publishedStory.id, nodeId: loopB.id, destinationNodeId: loopA.id, label: 'to A' },
      });
      const c3 = await prisma.storyChoice.create({
        data: { storyId: publishedStory.id, nodeId: loopB.id, destinationNodeId: endingNode.id, label: 'to end' },
      });
      trackChoice(c1.id);
      trackChoice(c2.id);
      trackChoice(c3.id);

      // Each single step is a bounded query.
      const res = await request(app).get(
        `/api/stories/${publishedStory.slug}/nodes/${loopA.id}/choices/${c1.id}`
      );
      expect(res.status).to.equal(200);
      expect(res.body.node.id).to.equal(loopB.id);
      expect(res.body.choices).to.have.lengthOf(2);
    });
  });

  describe('Regression: existing public APIs', () => {
    it('should still list published posts', async () => {
      const res = await request(app).get('/api/posts');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('should still list published artifacts', async () => {
      const res = await request(app).get('/api/artifacts');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });

    it('should still list categories', async () => {
      const res = await request(app).get('/api/categories');
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
    });
  });
});

// Records created by the isolation and loop tests, removed at the end.
const extraNodeIds = [];
const extraChoiceIds = [];
const trackNode = (id) => extraNodeIds.push(id);
const trackChoice = (id) => extraChoiceIds.push(id);

after(async () => {
  if (extraChoiceIds.length) {
    await prisma.storyChoice.deleteMany({ where: { id: { in: extraChoiceIds } } });
  }
  if (extraNodeIds.length) {
    await prisma.storyNode.deleteMany({ where: { id: { in: extraNodeIds } } });
  }
  await prisma.$disconnect();
});
