const crypto = require('crypto');

// Usamos o JWT_SECRET do ambiente como base para a chave de criptografia
// Criamos um hash SHA-256 para garantir que a chave tenha exatamente 32 bytes para o AES-256
const SECRET = process.env.JWT_SECRET || 'fallback-secret-poisson-erp';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(SECRET).digest();
const IV_LENGTH = 16; // Para AES, o IV tem sempre 16 bytes

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (err) {
    // Se falhar (ex: dados antigos não criptografados), retorna o original
    return text;
  }
}

module.exports = { encrypt, decrypt };
