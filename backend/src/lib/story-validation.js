/**
 * Story graph validation and shared domain rules.
 *
 * A branching story is only safe to publish if every node a reader can reach
 * is itself readable, if every non-ending node offers at least one way out,
 * and if every reachable node can ultimately reach an ending. This module
 * computes that assessment and is the single place where the rules live, so
 * the admin API, the public API and the tests all agree on them.
 *
 * Everything here is pure: it takes already-loaded records and returns a
 * verdict. No database access, no request objects.
 */

// --- Limits (kept in one place so the API and the tests agree) -------------

export const LIMITS = {
  titleMax: 120,
  titleMin: 1,
  introductionMax: 2000,
  introductionMin: 1,
  nodeContentMax: 10000,
  nodeContentMin: 1,
  nodeTitleMax: 120,
  choiceLabelMax: 200,
  choiceLabelMin: 1,
  slugMax: 80,
  // The reader walks the graph one step at a time, but the admin preview and
  // the reachability analysis both need a hard ceiling so a cyclic graph
  // cannot make an unbounded traversal.
  maxNodesPerStory: 500,
  maxChoicesPerNode: 20,
  maxReachDepth: 500,
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Normalise a title into a URL-safe slug.
 * Mirrors the shape the rest of the project already uses for post slugs.
 */
export const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slugMax);

/**
 * Validate a story title. Returns an error string, or null when valid.
 */
export const validateTitle = (title) => {
  if (typeof title !== 'string' || !title.trim()) return 'Title is required';
  if (title.trim().length > LIMITS.titleMax) {
    return `Title must be at most ${LIMITS.titleMax} characters`;
  }
  return null;
};

/**
 * Validate a story slug. Returns an error string, or null when valid.
 */
export const validateSlug = (slug) => {
  if (typeof slug !== 'string' || !slug.trim()) return 'Slug is required';
  if (slug.length > LIMITS.slugMax) {
    return `Slug must be at most ${LIMITS.slugMax} characters`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return 'Slug must contain only lowercase letters, numbers and single hyphens';
  }
  return null;
};

/**
 * Validate the introductory text shown before the story begins.
 */
export const validateIntroduction = (introduction) => {
  if (typeof introduction !== 'string' || !introduction.trim()) {
    return 'Introduction is required';
  }
  if (introduction.length > LIMITS.introductionMax) {
    return `Introduction must be at most ${LIMITS.introductionMax} characters`;
  }
  return null;
};

/**
 * Validate a node's narrative text.
 */
export const validateNodeContent = (content) => {
  if (typeof content !== 'string' || !content.trim()) {
    return 'Node text is required';
  }
  if (content.length > LIMITS.nodeContentMax) {
    return `Node text must be at most ${LIMITS.nodeContentMax} characters`;
  }
  return null;
};

/**
 * Validate a node's optional heading.
 */
export const validateNodeTitle = (title) => {
  if (title === undefined || title === null || title === '') return null;
  if (typeof title !== 'string') return 'Node heading must be text';
  if (title.length > LIMITS.nodeTitleMax) {
    return `Node heading must be at most ${LIMITS.nodeTitleMax} characters`;
  }
  return null;
};

/**
 * Validate the label shown on a choice button.
 */
export const validateChoiceLabel = (label) => {
  if (typeof label !== 'string' || !label.trim()) return 'Choice label is required';
  if (label.length > LIMITS.choiceLabelMax) {
    return `Choice label must be at most ${LIMITS.choiceLabelMax} characters`;
  }
  return null;
};

/**
 * Validate the identifiers the public API accepts.
 * A malformed id is a client error, not a lookup miss.
 */
export const validateId = (id, label = 'id') => {
  if (typeof id !== 'string' || !id.trim()) return `${label} is required`;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return `${label} is malformed`;
  return null;
};

/**
 * Compute the set of nodes reachable from the starting node, following
 * published choices only.
 *
 * The traversal is breadth-first over a `visited` set, so a graph that
 * contains an intentional loop terminates after visiting each node once. The
 * depth ceiling is a second, independent guard.
 */
export const reachableNodeIds = (startingNodeId, nodes, choices) => {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  for (const choice of choices) {
    if (!choice.published) continue;
    if (!nodeById.has(choice.destinationNodeId)) continue;
    if (!outgoing.has(choice.nodeId)) outgoing.set(choice.nodeId, []);
    outgoing.get(choice.nodeId).push(choice.destinationNodeId);
  }

  const visited = new Set();
  if (!startingNodeId || !nodeById.has(startingNodeId)) return visited;

  let frontier = [startingNodeId];
  let depth = 0;

  while (frontier.length > 0 && depth < LIMITS.maxReachDepth) {
    depth += 1;
    const next = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      for (const dest of outgoing.get(id) || []) {
        if (!visited.has(dest)) next.push(dest);
      }
    }
    frontier = next;
  }

  return visited;
};

/**
 * Assess the structural validity of a whole story.
 *
 * @param {object} story      the Story record
 * @param {Array}  nodes      every StoryNode of that story
 * @param {Array}  choices    every StoryChoice of that story
 * @param {object} [opts]
 * @param {boolean} [opts.forPublication=false]
 *        When true, unpublished nodes and unpublished choices are treated as
 *        structural errors, because publishing a story with them would expose
 *        an incomplete graph to readers.
 *
 * @returns {{valid: boolean, errors: string[], warnings: string[], details: object}}
 */
export const validateStoryGraph = (story, nodes, choices, opts = {}) => {
  const forPublication = Boolean(opts.forPublication);
  const errors = [];
  const warnings = [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // --- Starting node -------------------------------------------------------
  const startId = story?.startingNodeId || null;
  let startNode = startId ? nodeById.get(startId) : null;

  if (!startId) {
    errors.push('The story has no starting node');
  } else if (!startNode) {
    errors.push('The starting node does not belong to this story');
  } else if (startNode.isEnding) {
    errors.push('The starting node cannot also be an ending node');
  }

  // --- Per-node consistency ------------------------------------------------
  for (const node of nodes) {
    const outgoing = choices.filter((c) => c.nodeId === node.id);

    if (node.isEnding && outgoing.length > 0) {
      errors.push(
        `Ending node "${node.title || node.id}" must not have outgoing choices`
      );
    }

    if (!node.isEnding && outgoing.length === 0) {
      // A node with no way out is a dead end. It is only an error when the
      // story is being published; while drafting it is merely a warning.
      const message = `Node "${node.title || node.id}" has no choices and is not an ending`;
      if (forPublication) errors.push(message);
      else warnings.push(message);
    }

    // Choices must point at nodes that exist inside this same story.
    for (const choice of outgoing) {
      const dest = nodeById.get(choice.destinationNodeId);
      if (!dest) {
        errors.push(
          `Choice "${choice.label}" points at a node that does not exist in this story`
        );
      }
    }
  }

  // --- Reachability ---------------------------------------------------------
  const reachable = reachableNodeIds(startId, nodes, choices);
  const reachableNodes = nodes.filter((n) => reachable.has(n.id));

  if (startNode && !reachable.has(startNode.id)) {
    errors.push('The starting node is not reachable from itself');
  }

  // Nodes that exist but cannot be reached are dead weight: not fatal, but
  // worth flagging because it usually means a typo in a choice.
  const unreachable = nodes.filter((n) => !reachable.has(n.id));
  if (unreachable.length > 0 && nodes.length > 0) {
    warnings.push(
      `${unreachable.length} node(s) cannot be reached from the starting node`
    );
  }

  // --- Publication-specific rules -----------------------------------------
  if (forPublication) {
    for (const node of reachableNodes) {
      if (!node.published) {
        errors.push(
          `Reachable node "${node.title || node.id}" is not published`
        );
      }
    }

    for (const choice of choices) {
      if (!choice.published) continue;
      if (!reachable.has(choice.nodeId)) continue;
      const dest = nodeById.get(choice.destinationNodeId);
      if (dest && !dest.published) {
        errors.push(
          `Choice "${choice.label}" leads to a node that is not published`
        );
      }
    }

    // Every published choice that is reachable must be usable.
    for (const node of reachableNodes) {
      if (node.isEnding) continue;
      const usable = choices.filter(
        (c) => c.nodeId === node.id && c.published && nodeById.has(c.destinationNodeId)
      );
      if (usable.length === 0) {
        errors.push(
          `Node "${node.title || node.id}" has no published choice leading onward`
        );
      }
    }
  }

  // --- Can every reachable node reach an ending? ---------------------------
  const endings = nodes.filter((n) => n.isEnding);
  const reachableEndings = endings.filter((n) => reachable.has(n.id));

  if (reachableEndings.length === 0) {
    const message = 'The story has no reachable ending';
    if (forPublication) errors.push(message);
    else warnings.push(message);
  }

  if (reachable.size > 0) {
    const canReachEnding = computeNodesThatReachAnEnding(nodes, choices);
    const stranded = [...reachable].filter((id) => !canReachEnding.has(id));
    if (stranded.length > 0) {
      const message = `${stranded.length} reachable node(s) cannot reach any ending`;
      if (forPublication) errors.push(message);
      else warnings.push(message);
    }
  }

  if (nodes.length > LIMITS.maxNodesPerStory) {
    errors.push(`A story may contain at most ${LIMITS.maxNodesPerStory} nodes`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    details: {
      nodeCount: nodes.length,
      choiceCount: choices.length,
      reachableCount: reachable.size,
      reachableEndingCount: reachableEndings.length,
      unreachableCount: unreachable.length,
    },
  };
};

/**
 * Compute the set of node ids from which some ending can be reached.
 * Works backwards from every ending along the reverse edges of the graph.
 */
export const computeNodesThatReachAnEnding = (nodes, choices) => {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const incoming = new Map();
  for (const choice of choices) {
    if (!choice.published) continue;
    if (!nodeIds.has(choice.destinationNodeId)) continue;
    if (!incoming.has(choice.destinationNodeId)) incoming.set(choice.destinationNodeId, []);
    incoming.get(choice.destinationNodeId).push(choice.nodeId);
  }

  const result = new Set();
  let frontier = nodes.filter((n) => n.isEnding).map((n) => n.id);
  frontier.forEach((id) => result.add(id));

  let depth = 0;
  while (frontier.length > 0 && depth < LIMITS.maxReachDepth) {
    depth += 1;
    const next = [];
    for (const id of frontier) {
      for (const src of incoming.get(id) || []) {
        if (!result.has(src)) {
          result.add(src);
          next.push(src);
        }
      }
    }
    frontier = next;
  }

  return result;
};
