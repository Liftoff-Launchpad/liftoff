import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed(): Promise<void> {
  const userId = 'cmoohx9w9000ypdq7bc6jkk';

  // Upsert the test user (GitHub ID from the PAT)
  await prisma.user.upsert({
    where: { id: userId },
    update: {
      email: 'munimahmad2@gmail.com',
      githubId: '202656505', // GitHub user ID from API
      githubUsername: 'munimx',
      name: 'Munim Ahmad',
      avatarUrl: 'https://avatars.githubusercontent.com/u/202656505',
      deletedAt: null,
    },
    create: {
      id: userId,
      email: 'munimahmad2@gmail.com',
      githubId: '202656505',
      githubUsername: 'munimx',
      name: 'Munim Ahmad',
      avatarUrl: 'https://avatars.githubusercontent.com/u/202656505',
    },
  });

  console.log('User seeded:', userId);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });