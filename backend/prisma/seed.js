import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// The seed script must target the same database as the rest of the project.
// In test mode that is the dedicated test database; otherwise it is the
// database configured in `.env`. `loadTestEnv()` fails closed if the test
// configuration is missing or points at the production database.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');
const { loadTestEnv } = await import(
  pathToFileURL(path.join(backendDir, 'src', 'lib', 'test-env.js')).href
);

loadTestEnv();

const prisma = new PrismaClient({
  datasources: process.env.DATABASE_URL
    ? { db: { url: process.env.DATABASE_URL } }
    : undefined,
});

async function main() {
  console.log('Seeding database...');

  // Create Categories
  const gothic = await prisma.category.upsert({
    where: { slug: 'gothic' },
    update: {},
    create: { name: 'Gothic', slug: 'gothic' },
  });

  const voids = await prisma.category.upsert({
    where: { slug: 'the-void' },
    update: {},
    create: { name: 'The Void', slug: 'the-void' },
  });

  // Seed Posts
  const posts = [
    {
      title: 'The Taxonomy of Shadows',
      slug: 'taxonomy-of-shadows',
      excerpt: 'Explorations into the dark corners of the human psyche.',
      content: 'Full content for the taxonomy of shadows...',
      coverImageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBtr9HGnoAGjeub8Lwe5MG8U09ztJbQM7j405V5cy3WLJ3XjX-aPzU-aqENxctEP_mTs-1FSqqjqzdJa5DmLdzhG3aeaPYN_ANOk1dTdbu0PkmxgNd97-iuFjhLhZ0NtNjy5Z34oYCWvj_5xcmPqz94V9USOvV7CkKy2O6lH3Lzo3Wa1F1nAOSwR4B4C8P9tuFjyEXsYvlS1DVGnbhz73_ZF4vjoa226mi8OQ2RJmK269V2hSZFsAP77u7Dhu7Wi-rLWB4-Tqqp4_ka',
      published: true,
      publishedAt: new Date('2024-10-31'),
    },
    {
      title: 'Elegies in Dust',
      slug: 'elegies-in-dust',
      excerpt: 'Observations on the inevitable decline of architectural wonders.',
      content: 'Full content for elegies in dust...',
      coverImageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBXY_ueOtCUkChknFk7LgCrIc2rO5xoJMUYniUlb6IODrMznw2_UkunFhK80vDzGK7IZcGzoeVX-UX4cQwQBYqTTHdB8NROYfQPm2-tsBWsyd4ghGd6Ymv40LULebnpUdFDv7WZhoQmwYSLGk4Wolu_1fjUankNYU3MZkl6U0YuubS0VnQN27QfHXiIf5h6BNvh9ISvNMlN2QpAT4vf4PIx9yqqJ7pMKI9f0vLDpPYf9EN9N8Hy1fYeJIedA3MI6HYSq8IUhAN2jM9p',
      published: true,
      publishedAt: new Date('2024-09-14'),
    },
  ];

  for (const postData of posts) {
    const post = await prisma.post.upsert({
      where: { slug: postData.slug },
      update: {},
      create: postData,
    });

    if (postData.title === 'The Taxonomy of Shadows') {
      await prisma.postCategory.upsert({
        where: { postId_categoryId: { postId: post.id, categoryId: gothic.id } },
        update: {},
        create: { postId: post.id, categoryId: gothic.id },
      });
      await prisma.postCategory.upsert({
        where: { postId_categoryId: { postId: post.id, categoryId: voids.id } },
        update: {},
        create: { postId: post.id, categoryId: voids.id },
      });
    } else if (postData.title === 'Elegies in Dust') {
      await prisma.postCategory.upsert({
        where: { postId_categoryId: { postId: post.id, categoryId: gothic.id } },
        update: {},
        create: { postId: post.id, categoryId: gothic.id },
      });
    }
  }

  const artifacts = [
    {
      name: 'The Architecture of Silence',
      slug: 'architecture-of-silence',
      description: 'A high-contrast black and white architectural photograph of a brutalist cathedral interior.',
      imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDmXcYU7tfUF2RtZHspAwe1jPMRL_J_UCkkQ3YN8YOuh0uSVwfyvNKZrmnLjLWOs6OEvT6F67bs0pgFgKXvrpakyaV1OwofI1zTi73fSrsITPxbnjy3_fVWaIHfX5ZQSjGbsTd0UJzeMsyEcV7tYRpNanUNP9DG_uCymChYSdxnqnFARR04sgrMLwGoTkjC1CcG6rnsp1lkizOORON294zMBvBya43px1MlSNz24_uirexuxfypxI7qpEgb98CKI6GEHYj0N2ikNg2O',
    },
  ];

  for (const artData of artifacts) {
    const art = await prisma.artifact.upsert({
      where: { slug: artData.slug },
      update: {},
      create: artData,
    });

    await prisma.artifactCategory.upsert({
      where: { artifactId_categoryId: { artifactId: art.id, categoryId: voids.id } },
      update: {},
      create: { artifactId: art.id, categoryId: voids.id },
    });
  }

  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
