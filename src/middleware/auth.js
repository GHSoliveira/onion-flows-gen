import jwt from 'jsonwebtoken';
import adapter from '../../db/DatabaseAdapter.js';
import { JWT_SECRET_VALUE } from '../config/constants.js';
import { totpEnrollmentGate } from './totpEnrollmentGate.js';

const ensureLegacyRootSuperAdminPermissions = async (user) => {
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isLegacyRootSuperAdmin = (
    user?.role === 'SUPER_ADMIN' &&
    (user?.id === 'u_superadmin' || user?.username === 'admin')
  );

  if (!isLegacyRootSuperAdmin || permissions.length > 0) {
    return user;
  }

  const nextUser = {
    ...user,
    permissions: ['*'],
    updatedAt: new Date().toISOString()
  };

  if (!adapter.db) {
    await adapter.init();
  }

  await adapter.db.collection('users').updateOne(
    { id: user.id },
    { $set: { permissions: nextUser.permissions, updatedAt: nextUser.updatedAt } }
  );

  return nextUser;
};

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token) {
    return res.status(401).json({ error: 'Token ausente' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE);
    const storedUser = await adapter.findOne(
      'users',
      { id: decoded.userId },
      { projection: { _id: 0 } }
    );

    if (!storedUser) {
      return res.status(401).json({ error: 'Usuario invalido' });
    }

    const user = await ensureLegacyRootSuperAdminPermissions(storedUser);
    req.user = user;
    req.tokenInfo = decoded;
    // Enforcement de TOTP: para SUPER_ADMIN, força enrollment quando a flag
    // TOTP_REQUIRED_FOR_SUPER_ADMIN está ativa. Rotas de cadastro de TOTP
    // são exceções (allow-list dentro do gate).
    return totpEnrollmentGate(req, res, next);
  } catch (error) {
    res.status(401).json({ error: 'Token invalido ou expirado' });
  }
};
