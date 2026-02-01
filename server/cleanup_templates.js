
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Cleaning up old templates...');
    const result = await prisma.gameTemplate.deleteMany({
        where: { title: 'Test Memory' }
    });
    console.log(`Deleted ${result.count} templates with title 'Test Memory'.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
