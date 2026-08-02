const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET e obrigatorio. Defina a variavel de ambiente antes de iniciar o servidor.');
}

export const JWT_SECRET_VALUE = JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
export const PORT = process.env.PORT || 3001;
export const MAX_LOGS = 500;
