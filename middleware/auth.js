// Eenvoudige Basic Auth voor het admin-paneel
function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Basic ')) {
    return sendChallenge(res);
  }

  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (
    user === process.env.ADMIN_USERNAME &&
    pass === process.env.ADMIN_PASSWORD
  ) {
    return next();
  }
  return sendChallenge(res);
}

function sendChallenge(res) {
  res.set('WWW-Authenticate', 'Basic realm="Manthano Admin"');
  res.status(401).send('Toegang geweigerd.');
}

module.exports = { requireAdmin };
