import prisma from '../lib/prisma.js';
import { resolvePagination } from '../lib/pagination.js';

export const getArtifacts = async (req, res, next) => {
  try {
    const q = req.query.q;
    const categorySlug = req.query.category;

    // An invalid pagination parameter falls back to the default rather than
    // failing the request, and the skip is always a safe integer, so the
    // database is never asked for a range it cannot express.
    const { page, limit, skip } = resolvePagination(req.query);

    const where = {
      published: true,
      ...(q && {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
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

    const [artifacts, total] = await Promise.all([
      prisma.artifact.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          categories: {
            include: { category: true },
          },
        },
      }),
      prisma.artifact.count({ where }),
    ]);

    res.status(200).json({
      data: artifacts,
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

export const getArtifactBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const artifact = await prisma.artifact.findFirst({
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

    if (!artifact) {
      return res.status(404).json({
        error: 'Artifact not found',
        message: 'The requested artifact does not exist or is not published.',
      });
    }

    res.status(200).json(artifact);
  } catch (error) {
    next(error);
  }
};
