import bcrypt from 'bcrypt';
import adapter from '../../db/DatabaseAdapter.js';

export const verifyUserPassword = async (user, password) => {
  const storedPassword = String(user?.password || '');
  const candidatePassword = String(password || '');

  if (!storedPassword || !candidatePassword) {
    return false;
  }

  const isBcryptHash = /^\$2[aby]\$/.test(storedPassword);

  if (!isBcryptHash) {
    // Legacy plaintext password — reject and force reset
    return false;
  }

  return bcrypt.compare(candidatePassword, storedPassword);
};

/**
 * One-time migration: hash all plaintext passwords still in the database.
 * Run once via: node -e "import('./src/services/passwords.js').then(m => m.migratePlaintextPasswords())"
 */
export const migratePlaintextPasswords = async () => {
  if (!adapter.db) {
    await adapter.init();
  }
  const users = await adapter.db.collection('users').find({}).toArray();
  let migrated = 0;
  for (const user of users) {
    const pw = String(user.password || '');
    if (pw && !/^\$2[aby]\$/.test(pw)) {
      const hashed = await bcrypt.hash(pw, 10);
      await adapter.db.collection('users').updateOne(
        { id: user.id },
        { $set: { password: hashed, updatedAt: new Date().toISOString() } }
      );
      migrated++;
    }
  }
  console.log(`[PASSWORD MIGRATION] ${migrated} passwords hashed.`);
  return migrated;
};
