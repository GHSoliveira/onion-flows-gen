/**
 * Environment configuration
 */
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const companionMode = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.COMPANION_MODE || '').trim().toLowerCase()
);
const companionUsesLocalJson = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.USE_JSON_DB || '').trim().toLowerCase()
) || String(process.env.DB_ADAPTER || '').trim().toLowerCase() === 'json';

if (companionMode && !companionUsesLocalJson) {
  throw new Error('COMPANION_MODE exige DB_ADAPTER=json; banco remoto foi bloqueado');
}

export const config = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
  PORT: process.env.PORT || 3001,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot',
  DB_ADAPTER: process.env.DB_ADAPTER || 'mongo',
  SUPABASE_URL: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
};
