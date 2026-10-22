import prisma from '../lib/prisma.js';
import {
  LIMITS,
  validatePublished,
  validateSlug,
  validateText,
  validateUrl,
} from '../lib/content-validation.js';

// --- Blog Post Admin Actions ---

export const adminGetPosts = async (req, res, next) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      include: { categories: { include: { category: true } } },
    });
    res.status(200).json(posts);
  } catch (error) {
    next(error);
  }
};

export const adminGetPostById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const post = await prisma.post.findUnique({
      where: { id },
      include: { categories: { include: { category: true } } },
    });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.status(200).json(post);
  } catch (error) {
    next(error);
  }
};

export const adminCreatePost = async (req, res, next) => {
  try {
    const { title, slug, excerpt, content, coverImageUrl, published, categoryIds } = req.body;
    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Title, slug, and content are required' });
    }

    const titleError = validateText(title, { field: 'Title', max: LIMITS.titleMax });
    if (titleError) {
      return res.status(400).json({ error: titleError });
    }

    const excerptError = validateText(excerpt, {
      field: 'Excerpt',
      max: LIMITS.excerptMax,
      required: false,
    });
    if (excerptError) {
      return res.status(400).json({ error: excerptError });
    }

    const contentError = validateText(content, { field: 'Content', max: LIMITS.contentMax });
    if (contentError) {
      return res.status(400).json({ error: contentError });
    }

    const slugError = validateSlug(slug);
    if (slugError) {
      return res.status(400).json({ error: slugError });
    }

    const publishedError = validatePublished(published);
    if (publishedError) {
      return res.status(400).json({ error: publishedError });
    }

    const coverError = validateUrl(coverImageUrl, { field: 'Cover image URL' });
    if (coverError) {
      return res.status(400).json({ error: coverError });
    }

    const post = await prisma.post.create({
      data: {
        title,
        slug,
        excerpt,
        content,
        coverImageUrl,
        published: published === true,
        publishedAt: published === true ? new Date() : null,
        categories: {
          create: categoryIds?.map(id => ({ categoryId: id })) || [],
        },
      },
      include: { categories: { include: { category: true } } },
    });
    res.status(201).json(post);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Slug already exists' });
    next(error);
  }
};

export const adminUpdatePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, slug, excerpt, content, coverImageUrl, published, categoryIds } = req.body;

    // This is a partial update: only the fields present in the body are
    // changed. A field that is absent must not be blanked.
    if (title !== undefined) {
      const titleError = validateText(title, { field: 'Title', max: LIMITS.titleMax });
      if (titleError) {
        return res.status(400).json({ error: titleError });
      }
    }

    if (excerpt !== undefined) {
      const excerptError = validateText(excerpt, {
        field: 'Excerpt',
        max: LIMITS.excerptMax,
        required: false,
      });
      if (excerptError) {
        return res.status(400).json({ error: excerptError });
      }
    }

    if (content !== undefined) {
      const contentError = validateText(content, { field: 'Content', max: LIMITS.contentMax });
      if (contentError) {
        return res.status(400).json({ error: contentError });
      }
    }

    if (slug !== undefined) {
      const slugError = validateSlug(slug);
      if (slugError) {
        return res.status(400).json({ error: slugError });
      }
    }

    if (published !== undefined) {
      const publishedError = validatePublished(published);
      if (publishedError) {
        return res.status(400).json({ error: publishedError });
      }
    }

    if (coverImageUrl !== undefined) {
      const coverError = validateUrl(coverImageUrl, { field: 'Cover image URL' });
      if (coverError) {
        return res.status(400).json({ error: coverError });
      }
    }

    // `publishedAt` is only stamped when the post actually becomes
    // published, and is cleared only when it stops being published. Editing
    // the title of a published post must not erase its publication date.
    const data = {};
    if (title !== undefined) data.title = title;
    if (slug !== undefined) data.slug = slug;
    if (excerpt !== undefined) data.excerpt = excerpt;
    if (content !== undefined) data.content = content;
    if (coverImageUrl !== undefined) data.coverImageUrl = coverImageUrl;
    if (published !== undefined) {
      data.published = published === true;
      data.publishedAt = published === true ? new Date() : null;
    }
    if (categoryIds !== undefined) {
      data.categories = {
        deleteMany: {},
        create: categoryIds.map(id => ({ categoryId: id })) || [],
      };
    }

    const post = await prisma.post.update({
      where: { id },
      data,
      include: { categories: { include: { category: true } } },
    });
    res.status(200).json(post);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Slug already exists' });
    next(error);
  }
};

export const adminTogglePostPublish = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { published } = req.body;

    const publishedError = validatePublished(published);
    if (publishedError) {
      return res.status(400).json({ error: publishedError });
    }

    const post = await prisma.post.update({
      where: { id },
      data: {
        published: published === true,
        publishedAt: published === true ? new Date() : null,
      },
    });
    res.status(200).json(post);
  } catch (error) {
    next(error);
  }
};

export const adminDeletePost = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.post.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// --- Artifact Admin Actions ---

export const adminGetArtifacts = async (req, res, next) => {
  try {
    const artifacts = await prisma.artifact.findMany({
      orderBy: { createdAt: 'desc' },
      include: { categories: { include: { category: true } } },
    });
    res.status(200).json(artifacts);
  } catch (error) {
    next(error);
  }
};

export const adminGetArtifactById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const artifact = await prisma.artifact.findUnique({
      where: { id },
      include: { categories: { include: { category: true } } },
    });
    if (!artifact) return res.status(404).json({ error: 'Artifact not found' });
    res.status(200).json(artifact);
  } catch (error) {
    next(error);
  }
};

export const adminCreateArtifact = async (req, res, next) => {
  try {
    const { name, slug, description, imageUrl, fileUrl, published, categoryIds } = req.body;
    if (!name || !slug || !description) {
      return res.status(400).json({ error: 'Name, slug, and description are required' });
    }

    const nameError = validateText(name, { field: 'Name', max: LIMITS.nameMax });
    if (nameError) {
      return res.status(400).json({ error: nameError });
    }

    const descriptionError = validateText(description, {
      field: 'Description',
      max: LIMITS.descriptionMax,
    });
    if (descriptionError) {
      return res.status(400).json({ error: descriptionError });
    }

    const slugError = validateSlug(slug);
    if (slugError) {
      return res.status(400).json({ error: slugError });
    }

    const publishedError = validatePublished(published);
    if (publishedError) {
      return res.status(400).json({ error: publishedError });
    }

    const imageError = validateUrl(imageUrl, { field: 'Image URL' });
    if (imageError) {
      return res.status(400).json({ error: imageError });
    }

    const fileError = validateUrl(fileUrl, { field: 'File URL' });
    if (fileError) {
      return res.status(400).json({ error: fileError });
    }

    const artifact = await prisma.artifact.create({
      data: {
        name,
        slug,
        description,
        imageUrl,
        fileUrl,
        published: published === true,
        categories: {
          create: categoryIds?.map(id => ({ categoryId: id })) || [],
        },
      },
      include: { categories: { include: { category: true } } },
    });
    res.status(201).json(artifact);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Slug already exists' });
    next(error);
  }
};

export const adminUpdateArtifact = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, imageUrl, fileUrl, published, categoryIds } = req.body;

    // A partial update: only the fields present in the body are changed.
    if (name !== undefined) {
      const nameError = validateText(name, { field: 'Name', max: LIMITS.nameMax });
      if (nameError) {
        return res.status(400).json({ error: nameError });
      }
    }

    if (description !== undefined) {
      const descriptionError = validateText(description, {
        field: 'Description',
        max: LIMITS.descriptionMax,
      });
      if (descriptionError) {
        return res.status(400).json({ error: descriptionError });
      }
    }

    if (slug !== undefined) {
      const slugError = validateSlug(slug);
      if (slugError) {
        return res.status(400).json({ error: slugError });
      }
    }

    if (published !== undefined) {
      const publishedError = validatePublished(published);
      if (publishedError) {
        return res.status(400).json({ error: publishedError });
      }
    }

    if (imageUrl !== undefined) {
      const imageError = validateUrl(imageUrl, { field: 'Image URL' });
      if (imageError) {
        return res.status(400).json({ error: imageError });
      }
    }

    if (fileUrl !== undefined) {
      const fileError = validateUrl(fileUrl, { field: 'File URL' });
      if (fileError) {
        return res.status(400).json({ error: fileError });
      }
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (slug !== undefined) data.slug = slug;
    if (description !== undefined) data.description = description;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (fileUrl !== undefined) data.fileUrl = fileUrl;
    if (published !== undefined) data.published = published === true;
    if (categoryIds !== undefined) {
      data.categories = {
        deleteMany: {},
        create: categoryIds.map(id => ({ categoryId: id })) || [],
      };
    }

    const artifact = await prisma.artifact.update({
      where: { id },
      data,
      include: { categories: { include: { category: true } } },
    });
    res.status(200).json(artifact);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Slug already exists' });
    next(error);
  }
};

export const adminToggleArtifactPublish = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { published } = req.body;

    const publishedError = validatePublished(published);
    if (publishedError) {
      return res.status(400).json({ error: publishedError });
    }

    const artifact = await prisma.artifact.update({
      where: { id },
      data: { published: published === true },
    });
    res.status(200).json(artifact);
  } catch (error) {
    next(error);
  }
};

export const adminDeleteArtifact = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.artifact.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// --- Category Admin Actions ---

export const adminGetCategories = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany();
    res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
};

export const adminCreateCategory = async (req, res, next) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    const nameError = validateText(name, {
      field: 'Name',
      max: LIMITS.categoryNameMax,
    });
    if (nameError) {
      return res.status(400).json({ error: nameError });
    }

    const slugError = validateSlug(slug);
    if (slugError) {
      return res.status(400).json({ error: slugError });
    }

    const category = await prisma.category.create({
      data: { name, slug },
    });
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Category name or slug already exists' });
    next(error);
  }
};

export const adminUpdateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug } = req.body;

    // A partial update: only the fields present in the body are changed.
    if (name !== undefined) {
      const nameError = validateText(name, {
        field: 'Name',
        max: LIMITS.categoryNameMax,
      });
      if (nameError) {
        return res.status(400).json({ error: nameError });
      }
    }

    if (slug !== undefined) {
      const slugError = validateSlug(slug);
      if (slugError) {
        return res.status(400).json({ error: slugError });
      }
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (slug !== undefined) data.slug = slug;

    const category = await prisma.category.update({
      where: { id },
      data,
    });
    res.status(200).json(category);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ error: 'Category name or slug already exists' });
    next(error);
  }
};

export const adminDeleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.category.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
