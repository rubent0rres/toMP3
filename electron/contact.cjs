const developer = require('../shared/developer.json');
function contactLink(target) {
  if (target === 'email') return `mailto:${developer.email}`;
  if (target === 'github') return developer.github;
  throw new Error('Ese enlace de contacto no está disponible.');
}
module.exports = { contactLink };
