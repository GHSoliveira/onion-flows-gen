

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fiberbot';
const DB_NAME = process.env.MONGODB_DB_NAME || 'fiberbot';

const COLLECTIONS_TO_CHECK = [
  'variables',
  'messageTemplates',
  'users',
  'flows',
  'schedules',
  'cannedResponses',
  'tags',
  'webhooks'
];

async function verifyMongoDB() {
  console.log('🔍 Verificando dados no MongoDB...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Conectado ao MongoDB');

    const db = client.db(DB_NAME);

    const tenants = await db.collection('tenants').find({}).toArray();
    console.log(`\n📊 Tenants encontrados: ${tenants.length}`);

    if (tenants.length === 0) {
      console.log('\n⚠️  AVISO: Nenhum tenant encontrado no sistema!');
      console.log('   Crie tenants antes de criar variáveis, templates, etc.\n');
    }

    for (const tenant of tenants) {
      console.log(`   - ${tenant.name} (${tenant.id})`);
    }

    console.log('\n🔎 Verificando documentos por collection...\n');

    let totalIssues = 0;
    let totalFixed = 0;

    for (const collectionName of COLLECTIONS_TO_CHECK) {
      const collection = db.collection(collectionName);
      const docs = await collection.find({}).toArray();

      console.log(`📦 ${collectionName}: ${docs.length} documentos`);


      const withTenantId = docs.filter(d => d.tenantId !== undefined && d.tenantId !== null);
      const withoutTenantId = docs.filter(d => d.tenantId === undefined || d.tenantId === null);

      if (withoutTenantId.length > 0) {
        console.log(`   ⚠️  ${withoutTenantId.length} documentos SEM tenantId`);
        console.log(`   ✅ ${withTenantId.length} documentos COM tenantId`);


        if (withoutTenantId.length > 0 && withoutTenantId.length <= 3) {
          withoutTenantId.forEach(d => {
            console.log(`      - ID: ${d.id}, Name: ${d.name || d.username || 'N/A'}`);
          });
        } else if (withoutTenantId.length > 3) {
          console.log(`      - Primeiros 3:`);
          withoutTenantId.slice(0, 3).forEach(d => {
            console.log(`        - ID: ${d.id}, Name: ${d.name || d.username || 'N/A'}`);
          });
        }

        totalIssues += withoutTenantId.length;
      } else {
        console.log(`   ✅ Todos os documentos têm tenantId`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 RESUMO DA VERIFICAÇÃO:`);
    console.log(`   Documentos verificados: ${COLLECTIONS_TO_CHECK.length} collections`);
    console.log(`   Documentos sem tenantId: ${totalIssues}`);
    console.log('='.repeat(50));

    if (totalIssues > 0 && process.argv.includes('--fix')) {
      console.log('\n🔧 CORRIGINDO dados...\n');

      for (const collectionName of COLLECTIONS_TO_CHECK) {
        const collection = db.collection(collectionName);


        const result = await collection.updateMany(
          { tenantId: { $exists: false } },
          { $set: { tenantId: null } }
        );

        if (result.modifiedCount > 0) {
          console.log(`   ✅ ${collectionName}: ${result.modifiedCount} documentos corrigidos`);
          totalFixed += result.modifiedCount;
        }
      }

      console.log('\n📊 Total de documentos corrigidos:', totalFixed);
    }

    console.log('\n✅ Verificação concluída!');

  } catch (error) {
    console.error('\n❌ Erro ao conectar ao MongoDB:', error.message);
    console.log('\n💡 Verifique:');
    console.log('   1. MongoDB está rodando?');
    console.log('   2. Variáveis de ambiente estão corretas?');
    console.log('   3. Connection string está válida?');
    process.exit(1);
  } finally {
    await client.close();
  }
}


verifyMongoDB();
