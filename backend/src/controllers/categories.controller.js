import prisma from '../lib/prisma.js';

export const getCategories = async (req, res, next) => {
  try {
    // Get categories that have at least one published post
    const categories = await prisma.category.findMany({
      where: {
        posts: {
          some: {
            post: { published: true },
          },
        },
      },
      include: {
        _count: {
          select: { posts: true },
        },
      },
    });

    // Map to include post count in a friendly way
    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      postCount: cat._count.posts,
    }));

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getArtifactCategories = async (req, res, next) => {
  try {
    // Get categories that have at least one published artifact
    const categories = await prisma.category.findMany({
      where: {
        artifacts: {
          some: {
            artifact: { published: true },
          },
        },
      },
      include: {
        _count: {
          select: { artifacts: true },
        },
      },
    });

    // Map to include artifact count in a friendly way
    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      artifactCount: cat._count.artifacts,
    }));

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
