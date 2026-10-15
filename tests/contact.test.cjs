const test = require('node:test');
const assert = require('node:assert/strict');
const { contactLink } = require('../electron/contact.cjs');
test('el contacto solo permite el correo y GitHub configurados del desarrollador', () => {
  assert.equal(contactLink('email'), 'mailto:dev@rubentorres.com.mx');
  assert.equal(contactLink('github'), 'https://github.com/rubent0rres');
  for (const target of ['https://evil.example', 'file:///etc/passwd', 'mailto:someone@example.com', '__proto__', 'constructor', undefined, {}, ['email']]) assert.throws(() => contactLink(target), /no está disponible/);
});
