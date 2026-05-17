// Simple seed script — run directly with tsx or node
// Usage: npx tsx prisma/seed-simple.ts
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seed() {
  const userId = 'cmoohx9w9000ypdq7bc6jkk';

  // Check existing user
  const existing = await prisma.user.findFirst({ where: { email: 'munimahmad2@gmail.com' } });
  console.log('Existing user:', existing ? { id: existing.id, githubId: existing.githubId, githubUsername: existing.githubUsername } : 'none');

  if (existing) {
    // Update existing user with correct githubId
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        githubId: '202656505',
        githubUsername: 'munimx',
        name: 'Munim Ahmad',
        avatarUrl: 'https://avatars.githubusercontent.com/u/202656505',
        deletedAt: null,
      },
    });
    console.log('User updated:', existing.id);
  } else {
    await prisma.user.create({
      data: {
        id: userId,
        email: 'munimahmad2@gmail.com',
        githubId: '202656505',
        githubUsername: 'munimx',
        name: 'Munim Ahmad',
        avatarUrl: 'https://avatars.githubusercontent.com/u/202656505',
      },
    });
    console.log('User created:', userId);
  }
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());