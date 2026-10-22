import prisma from '../lib/prisma.js';

// --- Comment validation constants ---
export const MAX_CONTENT_LENGTH = 2000;
export const MAX_AUTHOR_LENGTH = 100;
export const MAX_NESTING_DEPTH = 3; // depth 0 = top-level comment

const VALID_STATUSES = ['pending', 'approved', 'rejected'];

/**
 * Strip anything that could execute in a browser context from user supplied text.
 * The frontend also escapes on render (defence in depth), but the stored value
 * should never carry a live <script> payload.
 *
 * Ordinary punctuation and formatting characters are preserved so that
 * legitimate comments are not mangled.
 */
export const sanitizeText = (text) => {
  if (typeof text !== 'string') return text;

  return text
    // Remove complete script elements including their body.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    // Remove any remaining script opening/closing tags.
    .replace(/<\/?\s*script\b[^>]*>/gi, '')
    // Remove tags that carry inline event handlers (onclick=, onerror=, ...).
    .replace(/<[^>]*\bon\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi, '')
    // Remove javascript: / vbscript: / data: URL schemes.
    .replace(/\b(?:javascript|vbscript|data)\s*:/gi, '')
    .trim();
};

/**
 * Count the number of ancestors a comment has.
 * A top-level comment has 0 ancestors; a reply to it has 1; and so on.
 * Guards against cycles via the visited set.
 */
const getDepth = async (parentId) => {
  if (!parentId) return 0;

  let visitedCount = 0;
  let currentId = parentId;
  const visited = new Set();

  while (currentId) {
    if (visited.has(currentId)) break; // defensive: cycle guard
    visited.add(currentId);
    visitedCount += 1;

    const parent = await prisma.comment.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });

    if (!parent) break;
    currentId = parent.parentId;
  }

  // The walk includes the comment it started from, which is not an ancestor
  // of itself, so subtract one to obtain the true ancestor count.
  return Math.max(visitedCount - 1, 0);
};

export const createComment = async (req, res, next) => {
  try {
    const { postId, parentId, author, content } = req.body;

    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: 'postId is required' });
    }

    if (typeof author !== 'string' || !author.trim()) {
      return res.status(400).json({ error: 'Author name and comment are required' });
    }

    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'Author name and comment are required' });
    }

    if (author.length > MAX_AUTHOR_LENGTH) {
      return res.status(400).json({ error: `Author name is too long (max ${MAX_AUTHOR_LENGTH} characters)` });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({ error: 'Comment is too long' });
    }

    // Verify post exists and is published
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post || !post.published) {
      return res.status(404).json({ error: 'Article not found or not published' });
    }

    let parent = null;
    if (parentId !== undefined && parentId !== null && parentId !== '') {
      if (typeof parentId !== 'string') {
        return res.status(400).json({ error: 'Invalid parentId' });
      }

      parent = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent) {
        return res.status(404).json({ error: 'Parent comment not found' });
      }

      // A reply must belong to the same article as the new comment.
      if (parent.postId !== postId) {
        return res.status(400).json({ error: 'Parent comment belongs to a different article' });
      }

      // Enforce the maximum nesting depth.
      const parentDepth = await getDepth(parent.id);
      if (parentDepth + 1 > MAX_NESTING_DEPTH) {
        return res.status(400).json({
          error: `Maximum reply depth of ${MAX_NESTING_DEPTH} reached`,
        });
      }
    }

    const cleanAuthor = sanitizeText(author);
    const cleanContent = sanitizeText(content);

    // The original input was already validated as non-empty above. A payload
    // that sanitises down to nothing is still a legitimate submission: the
    // dangerous characters have been removed, which is the point of sanitising.
    const finalAuthor = cleanAuthor || 'Anonymous';
    const finalContent = cleanContent || '(no content)';

    const comment = await prisma.comment.create({
      data: {
        postId,
        parentId: parent ? parent.id : null,
        author: finalAuthor,
        content: finalContent,
        status: 'pending',
      },
    });

    res.status(201).json({
      message: 'Your voice has been added to the séance. It awaits moderation.',
      id: comment.id,
      status: comment.status,
    });
  } catch (error) {
    next(error);
  }
};

export const getApprovedComments = async (req, res, next) => {
  try {
    const { postId } = req.params;

    // Only surface comments for a post that exists and is published.
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, published: true },
    });
    if (!post || !post.published) {
      return res.status(404).json({ error: 'Article not found or not published' });
    }

    const comments = await prisma.comment.findMany({
      where: { 
        postId, 
        status: 'approved',
        parentId: null // Only top-level here, nested logic handled in render or recursive query
      },
      orderBy: { createdAt: 'asc' },
      include: {
        replies: {
          where: { status: 'approved' },
          orderBy: { createdAt: 'asc' },
          include: {
            replies: {
              where: { status: 'approved' },
              orderBy: { createdAt: 'asc' },
              include: {
                replies: {
                  where: { status: 'approved' },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });
    res.status(200).json(comments);
  } catch (error) {
    next(error);
  }
};

export const adminGetComments = async (req, res, next) => {
  try {
    const comments = await prisma.comment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { post: true }
    });
    res.status(200).json(comments);
  } catch (error) {
    next(error);
  }
};

export const adminModerateComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // approved, rejected

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid moderation status' });
    }

    const existing = await prisma.comment.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = await prisma.comment.update({
      where: { id },
      data: { status },
    });
    res.status(200).json(comment);
  } catch (error) {
    next(error);
  }
};

export const adminDeleteComment = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.comment.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Replies cascade at the database level (ON DELETE CASCADE).
    await prisma.comment.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
