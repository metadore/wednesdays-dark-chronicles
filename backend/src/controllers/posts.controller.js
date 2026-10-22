import prisma from '../lib/prisma.js';
import { resolvePagination } from '../lib/pagination.js';

export const getPosts = async (req, res, next) => {
  try {
    const q = req.query.q;
    const categorySlug = req.query.category;

    // An invalid pagination parameter falls back to the default rather than
    // failing the request, and the skip is always a safe integer, so the
    // database is never asked for a range it cannot express.
    const { page, limit, skip } = resolvePagination(req.query);

    // Build filter
    const where = {
      published: true,
      ...(q && {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
          { excerpt: { contains: q, mode: 'insensitive' } },
        ],
      }),
      ...(categorySlug && {
        categories: {
          some: {
            category: { slug: categorySlug },
          },
        },
      }),
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        include: {
          categories: {
            include: { category: true },
          },
        },
      }),
      prisma.post.count({ where }),
    ]);

    res.status(200).json({
      data: posts,
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

export const getPostBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const post = await prisma.post.findFirst({
      where: {
        slug,
        published: true,
      },
      include: {
        categories: {
          include: { category: true },
        },
      },
    });

    if (!post) {
      return res.status(404).json({
        error: 'Post not found',
        message: 'The requested post does not exist or is not published.',
      });
    }

    res.status(200).json(post);
  } catch (error) {
    next(error);
  }
};

