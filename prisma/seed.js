import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';

const prisma = new PrismaClient();
const personnelTfaSecret = 'JBSWY3DPEHPK3PXP';

async function main() {
  // Clear existing data (optional, for clean slate)
  await prisma.auditLog.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.user.deleteMany();

  // Seed Admins
  await prisma.user.create({
    data: {
      name: 'Admin One',
      staffId: 'admin123',
      email: 'admin1@cocobod.gh',
      phoneNumber: '+233557484584',
      password: await bcrypt.hash('password123', 10),
      role: 'SUPERADMIN',
      tfaSecret: authenticator.generateSecret(),
    },
  });

  await prisma.user.create({
    data: {
      name: 'Staff One',
      staffId: 'staff003',
      email: 'staff1@cocobod.gh',
      phoneNumber: '+233500000003',
      password: await bcrypt.hash('staff123', 10),
      role: 'STAFF',
      isTfaEnabled: false,
    },
  });

  await prisma.user.create({
    data: {
      name: 'Personnel One',
      nssNumber: 'nss0012026',
      email: 'personnel1@example.com',
      phoneNumber: '+233500000001',
      password: await bcrypt.hash('student123', 10),
      role: 'PERSONNEL',
      isTfaEnabled: true,
      tfaSecret: personnelTfaSecret,
    },
  });

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
