import prisma from '../lib/prisma.js';
import {
  LIMITS,
  slugify,
  validateChoiceLabel,
  validateId,
  validateIntroduction,
  validateNodeContent,
  validateNodeTitle,
  validateSlug,
  validateStoryGraph,
  validateTitle,
} from '../lib/story-validation.js';

/**
 * Administrative management of branching stories.
 *
 * Two rules shape everything below:
 *
 *  1. A published story may never become structurally invalid. Every mutation
 *     that could change the shape of the graph re-validates the whole story
 *     afterwards and rolls the change back if the result would be broken.
 *
 *  2. A choice may never point at a node outside its own story. The database
 *     enforces that too (composite foreign keys), and the application rejects
 *     it earlier with a clear message.
 */

/** Load a story with all of its nodes and choices. */
const loadStoryGraph = async (storyId) => {
  const story = await prisma.story.findUnique({
    where: { id: storyId },
    include: {
      nodes: { orderBy: { createdAt: 'asc' } },
      choices: { orderBy: { createdAt: 'asc' } },
    },
  });
  return story;
};

/** Read the body as a plain object, tolerating a missing body. */
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

/**
 * Apply a set of changes to a story and confirm the graph is still valid.
 *
 * Used for every structural mutation on a published story: the change is
 * written inside a transaction, the graph is re-assessed, and the transaction
 * is rolled back if the story would become invalid.
 */
const mutateAndVerify = async (storyId, mutate, { forPublication }) => {
  return prisma.$transaction(async (tx) => {
    // The mutation may return the entity it created or changed, so the
    // caller does not have to look it up again afterwards.
    const result = await mutate(tx);

    const story = await tx.story.findUnique({
      where: { id: storyId },
      include: {
        nodes: true,
        choices: true,
      },
    });

    if (!story) {
      const err = new Error('Story not found');
      err.statusCode = 404;
      throw err;
    }

    const verdict = validateStoryGraph(story, story.nodes, story.choices, {
      forPublication,
    });

    if (!verdict.valid) {
      const err = new Error('The change would leave the story structurally invalid');
      err.statusCode = 409;
      err.errors = verdict.errors;
      throw err;
    }

    return { story, result };
  });
};

// --- Story listing and reading --------------------------------------------

/**
 * GET /api/admin/stories
 * List every story, published or not, with its structural summary.
 */
export const adminGetStories = async (req, res, next) => {
  try {
    const stories = await prisma.story.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        choices: { orderBy: { createdAt: 'asc' } },
      },
    });

    const payload = stories.map((story) => {
      const verdict = validateStoryGraph(story, story.nodes, story.choices, {
        forPublication: false,
      });
      return {
        ...story,
        nodeCount: story.nodes.length,
        choiceCount: story.choices.length,
        endingCount: story.nodes.filter((n) => n.isEnding).length,
        structureValid: verdict.valid,
        structureErrors: verdict.errors,
        structureWarnings: verdict.warnings,
      };
    });

    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/stories/:id
 * Retrieve a single story with its full graph.
 */
export const adminGetStoryById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const story = await loadStoryGraph(id);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const verdict = validateStoryGraph(story, story.nodes, story.choices, {
      forPublication: false,
    });

    res.status(200).json({
      ...story,
      structureValid: verdict.valid,
      structureErrors: verdict.errors,
      structureWarnings: verdict.warnings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/stories/:id/validate
 * Report the structural verdict for a story without changing anything.
 */
export const adminValidateStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const story = await loadStoryGraph(id);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const verdict = validateStoryGraph(story, story.nodes, story.choices, {
      forPublication: false,
    });

    res.status(200).json({
      storyId: story.id,
      published: story.published,
      valid: verdict.valid,
      errors: verdict.errors,
      warnings: verdict.warnings,
      details: verdict.details,
      nodes: story.nodes.map((n) => ({
        id: n.id,
        title: n.title,
        isEnding: n.isEnding,
        published: n.published,
        choiceCount: story.choices.filter((c) => c.nodeId === n.id).length,
      })),
      choices: story.choices.map((c) => ({
        id: c.id,
        label: c.label,
        nodeId: c.nodeId,
        destinationNodeId: c.destinationNodeId,
        published: c.published,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// --- Story lifecycle -------------------------------------------------------

/**
 * POST /api/admin/stories
 * Create a story. It always starts as a draft.
 */
export const adminCreateStory = async (req, res, next) => {
  try {
    const { title, slug, introduction } = body(req);

    const titleError = validateTitle(title);
    if (titleError) return res.status(400).json({ error: titleError });

    const introError = validateIntroduction(introduction);
    if (introError) return res.status(400).json({ error: introError });

    const effectiveSlug = slug && String(slug).trim() ? String(slug).trim() : slugify(title);
    const slugError = validateSlug(effectiveSlug);
    if (slugError) return res.status(400).json({ error: slugError });

    const existing = await prisma.story.findUnique({ where: { slug: effectiveSlug } });
    if (existing) {
      return res.status(400).json({ error: 'Slug already exists' });
    }

    const story = await prisma.story.create({
      data: {
        title: title.trim(),
        slug: effectiveSlug,
        introduction,
        published: false,
        publishedAt: null,
      },
    });

    res.status(201).json(story);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Slug already exists' });
    next(error);
  }
};

/**
 * PUT /api/admin/stories/:id
 * Update a story's title, slug and introduction.
 */
export const adminUpdateStory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, slug, introduction } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const existing = await prisma.story.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Story not found' });

    const effectiveTitle = title === undefined ? existing.title : title;
    const titleError = validateTitle(effectiveTitle);
    if (titleError) return res.status(400).json({ error: titleError });

    const effectiveSlug = slug === undefined ? existing.slug : String(slug).trim();
    const slugError = validateSlug(effectiveSlug);
    if (slugError) return res.status(400).json({ error: slugError });

    const effectiveIntro =
      introduction === undefined ? existing.introduction : introduction;
    const introError = validateIntroduction(effectiveIntro);
    if (introError) return res.status(400).json({ error: introError });

    const data = {
      title: effectiveTitle.trim(),
      slug: effectiveSlug,
      introduction: effectiveIntro,
    };

    try {
      const story = await prisma.story.update({ where: { id }, data });
      res.status(200).json(story);
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'Slug already exists' });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/stories/:id/publish
 * Publish or unpublish a story.
 *
 * Publishing is refused unless the whole graph is valid for publication.
 */
export const adminToggleStoryPublish = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { published } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    if (typeof published !== 'boolean') {
      return res.status(400).json({ error: 'published must be a boolean' });
    }

    const story = await loadStoryGraph(id);
    if (!story) return res.status(404).json({ error: 'Story not found' });

    if (published) {
      const verdict = validateStoryGraph(story, story.nodes, story.choices, {
        forPublication: true,
      });

      if (!verdict.valid) {
        return res.status(409).json({
          error: 'The story is not structurally valid and cannot be published',
          errors: verdict.errors,
        });
      }
    }

    const updated = await prisma.story.update({
      where: { id },
      data: {
        published,
        publishedAt: published ? story.publishedAt || new Date() : null,
      },
    });

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/stories/:id
 * Delete a story together with all of its nodes and choices.
 */
export const adminDeleteStory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    // Nodes and choices are removed by ON DELETE CASCADE, but doing it
    // explicitly inside a transaction keeps the behaviour obvious and works
    // even if the cascade is ever changed.
    //
    // The starting-node pointer must be cleared FIRST: it is a foreign key
    // into StoryNode with ON DELETE NO ACTION, so deleting the node while
    // the story still points at it would be rejected by PostgreSQL.
    await prisma.$transaction(async (tx) => {
      await tx.story.update({ where: { id }, data: { startingNodeId: null } });
      await tx.storyChoice.deleteMany({ where: { storyId: id } });
      await tx.storyNode.deleteMany({ where: { storyId: id } });
      await tx.story.delete({ where: { id } });
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// --- Node management --------------------------------------------------------

/**
 * POST /api/admin/stories/:id/nodes
 * Create a node inside a story.
 */
export const adminCreateNode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, content, isEnding, published } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const contentError = validateNodeContent(content);
    if (contentError) return res.status(400).json({ error: contentError });

    const titleError = validateNodeTitle(title);
    if (titleError) return res.status(400).json({ error: titleError });

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const nodeCount = await prisma.storyNode.count({ where: { storyId: id } });
    if (nodeCount >= LIMITS.maxNodesPerStory) {
      return res.status(409).json({
        error: `A story may contain at most ${LIMITS.maxNodesPerStory} nodes`,
      });
    }

    const node = await prisma.storyNode.create({
      data: {
        storyId: id,
        title: title === undefined || title === null || title === '' ? null : title,
        content,
        isEnding: Boolean(isEnding),
        published: published === undefined ? true : Boolean(published),
      },
    });

    // A published story must remain valid, so the new node is checked against
    // the graph as a whole. A brand new node is unreachable from the starting
    // node, so it cannot break reachability; but it could introduce a dead end
    // if it were an ending-less node, which the publication check tolerates
    // only when the node is unreachable. It is validated defensively anyway.
    if (story.published) {
      const graph = await loadStoryGraph(id);
      const verdict = validateStoryGraph(graph, graph.nodes, graph.choices, {
        forPublication: true,
      });
      if (!verdict.valid) {
        await prisma.storyNode.delete({ where: { id: node.id } });
        return res.status(409).json({
          error: 'The change would leave the story structurally invalid',
          errors: verdict.errors,
        });
      }
    }

    res.status(201).json(node);
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/stories/:id/nodes/:nodeId
 * Update a node's heading, text, ending flag and published flag.
 */
export const adminUpdateNode = async (req, res, next) => {
  try {
    const { id, nodeId } = req.params;
    const { title, content, isEnding, published } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const nodeIdError = validateId(nodeId, 'nodeId');
    if (nodeIdError) return res.status(400).json({ error: nodeIdError });

    const node = await prisma.storyNode.findFirst({
      where: { id: nodeId, storyId: id },
    });
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const effectiveContent = content === undefined ? node.content : content;
    const contentError = validateNodeContent(effectiveContent);
    if (contentError) return res.status(400).json({ error: contentError });

    const effectiveTitle = title === undefined ? node.title : title;
    const titleError = validateNodeTitle(effectiveTitle);
    if (titleError) return res.status(400).json({ error: titleError });

    const data = {
      content: effectiveContent,
      title: effectiveTitle === null || effectiveTitle === '' ? null : effectiveTitle,
      isEnding: isEnding === undefined ? node.isEnding : Boolean(isEnding),
      published: published === undefined ? node.published : Boolean(published),
    };

    // Turning a node into an ending removes its choices, because an ending
    // node must not have outgoing choices. On a published story the removal
    // happens inside the validating transaction below, so the story is never
    // left in a half-changed state.
    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const becomesEnding = data.isEnding && !node.isEnding;

    if (story.published) {
      try {
        const { result } = await mutateAndVerify(
          id,
          async (tx) => {
            if (becomesEnding) {
              await tx.storyChoice.deleteMany({ where: { nodeId: node.id } });
            }
            return tx.storyNode.update({ where: { id: node.id }, data });
          },
          { forPublication: true }
        );
        return res.status(200).json(result);
      } catch (error) {
        if (error.statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            errors: error.errors || [],
          });
        }
        throw error;
      }
    }

    if (becomesEnding) {
      await prisma.storyChoice.deleteMany({ where: { nodeId: node.id } });
    }

    const updated = await prisma.storyNode.update({ where: { id: node.id }, data });
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/stories/:id/nodes/:nodeId
 * Delete a node.
 *
 * `?strategy=block` (the default) refuses the deletion while other nodes or
 * choices still reference the node. `?strategy=detach` removes the dependent
 * choices in the same transaction and clears the starting-node pointer.
 */
export const adminDeleteNode = async (req, res, next) => {
  try {
    const { id, nodeId } = req.params;
    const strategy = (req.query.strategy || 'block').toString().toLowerCase();

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const nodeIdError = validateId(nodeId, 'nodeId');
    if (nodeIdError) return res.status(400).json({ error: nodeIdError });

    if (!['block', 'detach'].includes(strategy)) {
      return res.status(400).json({
        error: "strategy must be either 'block' or 'detach'",
      });
    }

    const node = await prisma.storyNode.findFirst({
      where: { id: nodeId, storyId: id },
    });
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const incoming = await prisma.storyChoice.findMany({
      where: { destinationNodeId: node.id, storyId: id },
      select: { id: true, label: true },
    });

    const outgoing = await prisma.storyChoice.findMany({
      where: { nodeId: node.id, storyId: id },
      select: { id: true, label: true },
    });

    const isStarting = story.startingNodeId === node.id;

    if (strategy === 'block' && (incoming.length > 0 || isStarting)) {
      return res.status(409).json({
        error:
          'This node is still referenced by other records and cannot be deleted. ' +
          'Delete or repoint the dependent choices first, or use ?strategy=detach.',
        references: {
          incomingChoices: incoming,
          outgoingChoices: outgoing,
          isStartingNode: isStarting,
        },
      });
    }

    if (story.published) {
      try {
        await mutateAndVerify(
          id,
          async (tx) => {
            // Remove only the choices that depend on this node: the ones that
            // leave it, and the ones that point at it. Choices elsewhere in
            // the story are untouched.
            await tx.storyChoice.deleteMany({
              where: { storyId: id, nodeId: node.id },
            });
            await tx.storyChoice.deleteMany({
              where: { storyId: id, destinationNodeId: node.id },
            });
            // The starting-node pointer must be cleared before the node is
            // removed, otherwise the foreign key refuses the deletion.
            if (isStarting) {
              await tx.story.update({ where: { id }, data: { startingNodeId: null } });
            }
            await tx.storyNode.delete({ where: { id: node.id } });
          },
          { forPublication: true }
        );
      } catch (error) {
        if (error.statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            errors: error.errors || [],
          });
        }
        throw error;
      }
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.storyChoice.deleteMany({ where: { storyId: id, nodeId: node.id } });
        await tx.storyChoice.deleteMany({
          where: { storyId: id, destinationNodeId: node.id },
        });
        if (isStarting) {
          await tx.story.update({ where: { id }, data: { startingNodeId: null } });
        }
        await tx.storyNode.delete({ where: { id: node.id } });
      });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/stories/:id/start
 * Set the story's starting node.
 */
export const adminSetStartingNode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nodeId } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const nodeIdError = validateId(nodeId, 'nodeId');
    if (nodeIdError) return res.status(400).json({ error: nodeIdError });

    const node = await prisma.storyNode.findFirst({
      where: { id: nodeId, storyId: id },
    });
    if (!node) {
      return res.status(404).json({
        error: 'Node not found',
        message: 'The starting node must belong to this story.',
      });
    }

    if (node.isEnding) {
      return res.status(409).json({
        error: 'The starting node cannot be an ending node',
      });
    }

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    if (story.published) {
      try {
        const { result } = await mutateAndVerify(
          id,
          async (tx) =>
            tx.story.update({ where: { id }, data: { startingNodeId: node.id } }),
          { forPublication: true }
        );
        return res.status(200).json({
          id: result.id,
          startingNodeId: result.startingNodeId,
        });
      } catch (error) {
        if (error.statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            errors: error.errors || [],
          });
        }
        throw error;
      }
    }

    const updated = await prisma.story.update({
      where: { id },
      data: { startingNodeId: node.id },
    });
    res.status(200).json({ id: updated.id, startingNodeId: updated.startingNodeId });
  } catch (error) {
    next(error);
  }
};

// --- Choice management -----------------------------------------------------

/**
 * POST /api/admin/stories/:id/nodes/:nodeId/choices
 * Add a choice that leads from a node to a destination node.
 */
export const adminCreateChoice = async (req, res, next) => {
  try {
    const { id, nodeId } = req.params;
    const { label, destinationNodeId, published } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const nodeIdError = validateId(nodeId, 'nodeId');
    if (nodeIdError) return res.status(400).json({ error: nodeIdError });

    const labelError = validateChoiceLabel(label);
    if (labelError) return res.status(400).json({ error: labelError });

    const destError = validateId(destinationNodeId, 'destinationNodeId');
    if (destError) return res.status(400).json({ error: destError });

    const sourceNode = await prisma.storyNode.findFirst({
      where: { id: nodeId, storyId: id },
    });
    if (!sourceNode) {
      return res.status(404).json({ error: 'Node not found' });
    }

    if (sourceNode.isEnding) {
      return res.status(409).json({
        error: 'An ending node cannot have outgoing choices',
      });
    }

    // The destination must be a node of THIS story.
    const destination = await prisma.storyNode.findFirst({
      where: { id: destinationNodeId, storyId: id },
    });
    if (!destination) {
      const otherStory = await prisma.storyNode.findUnique({
        where: { id: destinationNodeId },
        select: { storyId: true },
      });

      if (otherStory) {
        return res.status(400).json({
          error: 'The destination node belongs to a different story',
        });
      }
      return res.status(404).json({
        error: 'Destination node not found',
      });
    }

    const choiceCount = await prisma.storyChoice.count({ where: { nodeId: sourceNode.id } });
    if (choiceCount >= LIMITS.maxChoicesPerNode) {
      return res.status(409).json({
        error: `A node may have at most ${LIMITS.maxChoicesPerNode} choices`,
      });
    }

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    const create = async (tx) =>
      tx.storyChoice.create({
        data: {
          storyId: id,
          nodeId: sourceNode.id,
          destinationNodeId: destination.id,
          label: label.trim(),
          published: published === undefined ? true : Boolean(published),
        },
      });

    if (story.published) {
      try {
        const { result } = await mutateAndVerify(id, create, { forPublication: true });
        return res.status(201).json(result);
      } catch (error) {
        if (error.statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            errors: error.errors || [],
          });
        }
        throw error;
      }
    }

    const choice = await create(prisma);
    res.status(201).json(choice);
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/stories/:id/choices/:choiceId
 * Update a choice's label, destination or published flag.
 */
export const adminUpdateChoice = async (req, res, next) => {
  try {
    const { id, choiceId } = req.params;
    const { label, destinationNodeId, published } = body(req);

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const choiceIdError = validateId(choiceId, 'choiceId');
    if (choiceIdError) return res.status(400).json({ error: choiceIdError });

    const choice = await prisma.storyChoice.findFirst({
      where: { id: choiceId, storyId: id },
    });
    if (!choice) return res.status(404).json({ error: 'Choice not found' });

    const effectiveLabel = label === undefined ? choice.label : label;
    const labelError = validateChoiceLabel(effectiveLabel);
    if (labelError) return res.status(400).json({ error: labelError });

    const effectiveDestination =
      destinationNodeId === undefined ? choice.destinationNodeId : destinationNodeId;
    const destError = validateId(effectiveDestination, 'destinationNodeId');
    if (destError) return res.status(400).json({ error: destError });

    const destination = await prisma.storyNode.findFirst({
      where: { id: effectiveDestination, storyId: id },
    });
    if (!destination) {
      const otherStory = await prisma.storyNode.findUnique({
        where: { id: effectiveDestination },
        select: { storyId: true },
      });
      if (otherStory) {
        return res.status(400).json({
          error: 'The destination node belongs to a different story',
        });
      }
      return res.status(404).json({ error: 'Destination node not found' });
    }

    const data = {
      label: effectiveLabel.trim(),
      destinationNodeId: destination.id,
      published: published === undefined ? choice.published : Boolean(published),
    };

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    if (story.published) {
      try {
        const { result } = await mutateAndVerify(
          id,
          async (tx) => tx.storyChoice.update({ where: { id: choice.id }, data }),
          { forPublication: true }
        );
        return res.status(200).json(result);
      } catch (error) {
        if (error.statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            errors: error.errors || [],
          });
        }
        throw error;
      }
    }

    const updated = await prisma.storyChoice.update({ where: { id: choice.id }, data });
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/stories/:id/choices/:choiceId
 * Remove a choice.
 */
export const adminDeleteChoice = async (req, res, next) => {
  try {
    const { id, choiceId } = req.params;

    const idError = validateId(id, 'id');
    if (idError) return res.status(400).json({ error: idError });

    const choiceIdError = validateId(choiceId, 'choiceId');
    if (choiceIdError) return res.status(400).json({ error: choiceIdError });

    const choice = await prisma.storyChoice.findFirst({
      where: { id: choiceId, storyId: id },
    });
    if (!choice) return res.status(404).json({ error: 'Choice not found' });

    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) return res.status(404).json({ error: 'Story not found' });

    if (story.published) {
      try {
        await mutateAndVerify(
          id,
          async (tx) => {
            await tx.storyChoice.delete({ where: { id: choice.id } });
          },
          { forPublication: true }
        );
      } catch (error) {
        if (error.statusCode === 409) {
          return res.status(409).json({
            error: error.message,
            errors: error.errors || [],
          });
        }
        throw error;
      }
    } else {
      await prisma.storyChoice.delete({ where: { id: choice.id } });
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
