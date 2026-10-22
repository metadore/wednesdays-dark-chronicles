import prisma from '../lib/prisma.js';
import { validateId, validateSlug } from '../lib/story-validation.js';
import { resolvePagination } from '../lib/pagination.js';

/**
 * Public, read-only endpoints for interactive stories.
 *
 * Every query in this file is filtered by `published: true` on the story
 * itself, and the node/choice queries are additionally scoped to the story
 * that was already proven published. A draft story therefore cannot be
 * reached by guessing an id, a slug or a node id.
 */

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Shape a node for public consumption. */
const publicNode = (node) => ({
  id: node.id,
  title: node.title,
  content: node.content,
  isEnding: node.isEnding,
});

/** Shape a choice for public consumption. */
const publicChoice = (choice) => ({
  id: choice.id,
  label: choice.label,
  destinationNodeId: choice.destinationNodeId,
});

/**
 * GET /api/stories
 * List the published interactive stories.
 */
export const getStories = async (req, res, next) => {
  try {
    // An invalid pagination parameter falls back to the default rather than
    // failing the request, and the skip is always a safe integer, so the
    // database is never asked for a range it cannot express.
    const { page, limit, skip } = resolvePagination(req.query);

    const where = { published: true };

    const [stories, total] = await Promise.all([
      prisma.story.findMany({
        where,
        skip,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          introduction: true,
          publishedAt: true,
          updatedAt: true,
        },
      }),
      prisma.story.count({ where }),
    ]);

    res.status(200).json({
      data: stories,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/stories/:slug
 * Retrieve a published story together with its starting node.
 */
export const getStoryBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const slugError = validateSlug(slug);
    if (slugError) {
      return res.status(400).json({ error: slugError });
    }

    const story = await prisma.story.findFirst({
      where: { slug, published: true },
      select: {
        id: true,
        title: true,
        slug: true,
        introduction: true,
        publishedAt: true,
        startingNodeId: true,
        nodes: {
          where: { published: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, content: true, isEnding: true },
        },
        choices: {
          where: { published: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, label: true, nodeId: true, destinationNodeId: true },
        },
      },
    });

    if (!story) {
      return res.status(404).json({
        error: 'Story not found',
        message: 'The requested story does not exist or is not published.',
      });
    }

    const { nodes, choices, ...meta } = story;

    const startNode = story.startingNodeId
      ? nodes.find((n) => n.id === story.startingNodeId) || null
      : null;

    // The choices that leave a node, grouped for the reader's convenience.
    const choicesByNode = {};
    for (const choice of choices) {
      if (!choicesByNode[choice.nodeId]) choicesByNode[choice.nodeId] = [];
      choicesByNode[choice.nodeId].push({
        id: choice.id,
        label: choice.label,
        destinationNodeId: choice.destinationNodeId,
      });
    }

    res.status(200).json({
      ...meta,
      startNode: startNode ? publicNode(startNode) : null,
      nodes,
      choices,
      choicesByNode,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/stories/:slug/nodes/:nodeId
 * Retrieve a node of a published story together with the choices that leave it.
 */
export const getStoryNode = async (req, res, next) => {
  try {
    const { slug, nodeId } = req.params;

    const slugError = validateSlug(slug);
    if (slugError) return res.status(400).json({ error: slugError });

    const idError = validateId(nodeId, 'nodeId');
    if (idError) return res.status(400).json({ error: idError });

    // Resolve the story first: a draft story is indistinguishable from a
    // missing one to the public.
    const story = await prisma.story.findFirst({
      where: { slug, published: true },
      select: { id: true, title: true, slug: true },
    });

    if (!story) {
      return res.status(404).json({
        error: 'Story not found',
        message: 'The requested story does not exist or is not published.',
      });
    }

    const node = await prisma.storyNode.findFirst({
      where: { id: nodeId, storyId: story.id, published: true },
      select: { id: true, title: true, content: true, isEnding: true },
    });

    if (!node) {
      return res.status(404).json({
        error: 'Node not found',
        message: 'The requested section does not exist in this story or is not published.',
      });
    }

    const choices = await prisma.storyChoice.findMany({
      where: {
        nodeId: node.id,
        storyId: story.id,
        published: true,
        destinationNode: { published: true },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, label: true, destinationNodeId: true },
    });

    res.status(200).json({
      story: { id: story.id, title: story.title, slug: story.slug },
      node: publicNode(node),
      choices: choices.map(publicChoice),
      isEnding: node.isEnding,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/stories/:slug/nodes/:nodeId/choices/:choiceId
 * Follow a choice to its destination node.
 */
export const followStoryChoice = async (req, res, next) => {
  try {
    const { slug, nodeId, choiceId } = req.params;

    const slugError = validateSlug(slug);
    if (slugError) return res.status(400).json({ error: slugError });

    const idError = validateId(nodeId, 'nodeId');
    if (idError) return res.status(400).json({ error: idError });

    const choiceIdError = validateId(choiceId, 'choiceId');
    if (choiceIdError) return res.status(400).json({ error: choiceIdError });

    const story = await prisma.story.findFirst({
      where: { slug, published: true },
      select: { id: true, title: true, slug: true },
    });

    if (!story) {
      return res.status(404).json({
        error: 'Story not found',
        message: 'The requested story does not exist or is not published.',
      });
    }

    // The choice must belong to the given source node, to this story, and
    // must itself be published. A choice from another node is a client error
    // rather than a silent redirect.
    const choice = await prisma.storyChoice.findFirst({
      where: {
        id: choiceId,
        nodeId,
        storyId: story.id,
        published: true,
      },
      select: {
        id: true,
        label: true,
        nodeId: true,
        destinationNodeId: true,
        destinationNode: {
          select: { id: true, title: true, content: true, isEnding: true, published: true },
        },
      },
    });

    if (!choice) {
      return res.status(404).json({
        error: 'Choice not found',
        message: 'That choice is not available in this section of the story.',
      });
    }

    if (!choice.destinationNode || !choice.destinationNode.published) {
      return res.status(404).json({
        error: 'Destination not found',
        message: 'The path this choice leads to is not available.',
      });
    }

    const destination = choice.destinationNode;

    const outgoingChoices = destination.isEnding
      ? []
      : await prisma.storyChoice.findMany({
          where: {
            nodeId: destination.id,
            storyId: story.id,
            published: true,
            destinationNode: { published: true },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, label: true, destinationNodeId: true },
        });

    res.status(200).json({
      story: { id: story.id, title: story.title, slug: story.slug },
      choice: { id: choice.id, label: choice.label },
      node: publicNode(destination),
      choices: outgoingChoices.map(publicChoice),
      isEnding: destination.isEnding,
    });
  } catch (error) {
    next(error);
  }
};
