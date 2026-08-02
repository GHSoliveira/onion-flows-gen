export const authorize = (roles) => (req, res, next) => {
  if (req.user.role === 'SUPER_ADMIN') {
    return next();
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  next();
};

export const requireSuperAdminPermission = (required = []) => (req, res, next) => {
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
  if (permissions.includes('*') || permissions.includes('ALL')) {
    return next();
  }

  if (required.length === 0) {
    return next();
  }

  if (permissions.length === 0) {
    return res.status(403).json({ error: 'Permissao insuficiente' });
  }

  const ok = required.every(p => permissions.includes(p));
  if (!ok) {
    return res.status(403).json({ error: 'Permissão insuficiente' });
  }
  next();
};
