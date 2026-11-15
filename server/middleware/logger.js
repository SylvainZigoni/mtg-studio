/* Logger : comme server.py, les requêtes /api/ restent discrètes */
export function logger(req, res, next) {
  if (!req.path.startsWith('/api/')) {
    res.on('finish', () => console.log(`${req.method} ${req.path} -> ${res.statusCode}`));
  }
  next();
}
