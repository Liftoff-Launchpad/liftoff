// Generate JWT for the existing user
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'munimahmad2@gmail.com' } });
  if (!user) { console.log('User not found'); return; }

  console.log('User:', user.id, user.email, user.githubUsername);

  // Load JWT secrets from process.env
  const JWT_SECRET = process.env.JWT_SECRET || '3f5fabcb91ed1e60f087e47ee2a275ad11b32a71ed49921e32d19c8aa0d0812e';
  const JWT_EXPIRES_IN = '15m';

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  console.log('\nNew JWT Token:');
  console.log(accessToken);
  console.log('\nUpdate your test file with this token.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());