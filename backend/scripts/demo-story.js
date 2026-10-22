/**
 * Creates a small, fully published branching story in the LIVE database so the
 * reader can be exercised in a real browser.
 *
 * The story is written to be clearly recognisable as a demo, and the script
 * removes it again with `--cleanup`.
 *
 * Usage:
 *   node scripts/demo-story.js            (create)
 *   node scripts/demo-story.js --cleanup  (remove)
 */
import prisma from '../src/lib/prisma.js';

const SLUG = 'the-ashen-corridor-demo';

const run = async () => {
  const existing = await prisma.story.findUnique({ where: { slug: SLUG } });

  if (existing) {
    await prisma.story.update({
      where: { id: existing.id },
      data: { startingNodeId: null },
    });
    await prisma.storyChoice.deleteMany({ where: { storyId: existing.id } });
    await prisma.storyNode.deleteMany({ where: { storyId: existing.id } });
    await prisma.story.delete({ where: { id: existing.id } });
    console.log('removed existing demo story');
  }

  if (process.argv.includes('--cleanup')) {
    console.log('cleanup complete');
    await prisma.$disconnect();
    return;
  }

  const story = await prisma.story.create({
    data: {
      title: 'The Ashen Corridor',
      slug: SLUG,
      introduction:
        'A demonstration chronicle. Two corridors diverge from the threshold, and each of them ends somewhere different.',
      published: true,
      publishedAt: new Date(),
    },
  });

  const threshold = await prisma.storyNode.create({
    data: {
      storyId: story.id,
      title: 'The Threshold',
      content:
        'The door was already open when you arrived, as though it had been waiting for the specific weight of your hand.\n\nBeyond it, a corridor of ash stretches in two directions. The air is warm to the left and cold to the right, and somewhere far ahead, something has stopped moving.',
    },
  });

  const warm = await prisma.storyNode.create({
    data: {
      storyId: story.id,
      title: 'The Warm Corridor',
      content:
        'You turn left, into the warmth.\n\nThe ash here is old, packed down by years of footsteps that were not your own. The prints go in. They do not come back.\n\nA door waits at the end of the corridor, and it is ajar.',
    },
  });

  const cold = await prisma.storyNode.create({
    data: {
      storyId: story.id,
      title: 'The Cold Corridor',
      content:
        'You turn right, into the cold.\n\nFrost has crystallised on the walls in shapes that almost resemble handwriting. It is almost a warning. It is almost a name.\n\nThe corridor narrows until there is only one way forward, and you are already several steps along it.',
    },
  });

  const endingReturn = await prisma.storyNode.create({
    data: {
      storyId: story.id,
      title: 'The Door That Opened Outward',
      content:
        'You push the door. It opens outward, onto the same threshold you came from, and the ash is still falling.\n\nThe corridor is patient. It will wait for you to choose again.',
      isEnding: true,
    },
  });

  const endingAlone = await prisma.storyNode.create({
    data: {
      storyId: story.id,
      title: 'The Last Frost',
      content:
        'The cold takes the corridor, and then it takes the door, and then it takes the light.\n\nYou are the last warm thing in a building that has forgotten how to be warm. The frost finishes its sentence on the wall: it was always going to be your name.',
      isEnding: true,
    },
  });

  await prisma.storyChoice.create({
    data: {
      storyId: story.id,
      nodeId: threshold.id,
      destinationNodeId: warm.id,
      label: 'Follow the warmth',
    },
  });
  await prisma.storyChoice.create({
    data: {
      storyId: story.id,
      nodeId: threshold.id,
      destinationNodeId: cold.id,
      label: 'Follow the cold',
    },
  });
  await prisma.storyChoice.create({
    data: {
      storyId: story.id,
      nodeId: warm.id,
      destinationNodeId: endingReturn.id,
      label: 'Push the ajar door',
    },
  });
  await prisma.storyChoice.create({
    data: {
      storyId: story.id,
      nodeId: cold.id,
      destinationNodeId: endingAlone.id,
      label: 'Keep walking until the corridor ends',
    },
  });

  await prisma.story.update({
    where: { id: story.id },
    data: { startingNodeId: threshold.id },
  });

  console.log('demo story created:', story.id, '| slug:', SLUG);
  await prisma.$disconnect();
};

run().catch(async (e) => {
  console.error(e.message);
  await prisma.$disconnect();
  process.exit(1);
});
