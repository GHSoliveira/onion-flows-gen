import { MongoClient } from 'mongodb';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

async function seedAdmin() {
  const mongoUri = process.env.MONGODB_URI;
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;

  if (!mongoUri) {
    throw new Error('MONGODB_URI nao definido. Configure no .env antes de executar o seed.');
  }

  if (!adminPassword || adminPassword.length < 8) {
    throw new Error('ADMIN_INITIAL_PASSWORD e obrigatorio e deve ter ao menos 8 caracteres.');
  }

  console.log('Conectando ao MongoDB...');

  const client = new MongoClient(mongoUri);
  await client.connect();

  const db = client.db(process.env.MONGODB_DB_NAME || 'onionflow');
  const users = db.collection('users');

  console.log('Conectado ao MongoDB');

  const existing = await users.findOne({ username: 'admin' });
  if (existing) {
    console.log('Usuario admin ja existe no banco de dados');
    console.log('  Username:', existing.username);
    console.log('  Role:', existing.role);
    await client.close();
    return;
  }

  console.log('Criando usuario admin...');
  const hashedPassword = await bcrypt.hash(adminPassword, 12);

  await users.insertOne({
    id: 'u_admin',
    name: 'Super Admin',
    username: 'admin',
    password: hashedPassword,
    role: 'SUPER_ADMIN',
    queues: [],
    permissions: ['all'],
    tenantId: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  console.log('Usuario admin criado com sucesso.');
  console.log('  Username: admin');
  console.log('  Password: definido por ADMIN_INITIAL_PASSWORD');
  console.log('  Role: SUPER_ADMIN');

  await client.close();
  process.exit(0);
}

seedAdmin().catch(async (error) => {
  console.error('Erro ao criar usuario admin:', error.message);
  process.exit(1);
});
