
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Checking for duplicate templates...');

    // Find all '神経衰弱' templates
    const templates = await prisma.gameTemplate.findMany({
        where: { title: '神経衰弱' },
        orderBy: { createdAt: 'desc' } // Newest first
    });

    console.log(`Found ${templates.length} '神経衰弱' templates.`);

    if (templates.length > 1) {
        // Keep the first (newest), delete the rest
        const toKeep = templates[0];
        const toDelete = templates.slice(1);

        console.log(`Keeping: ${toKeep.id} (Created: ${toKeep.createdAt})`);

        const deleteIds = toDelete.map(t => t.id);
        const result = await prisma.gameTemplate.deleteMany({
            where: { id: { in: deleteIds } }
        });

        console.log(`Deleted ${result.count} duplicates.`);
    } else {
        console.log('No duplicates found.');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
