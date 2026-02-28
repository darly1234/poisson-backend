function normalizeFilename(name) {
    if (!name) return '';
    return name
        .normalize('NFD') // Decompõe caracteres (ex: 'á' -> 'a' + '´')
        .replace(/[\u0300-\u036f]/g, '') // Remove os acentos
        .replace(/ç/g, 'c')
        .replace(/Ç/g, 'C')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_'); // fallback para caracteres restantes
}

module.exports = { normalizeFilename };
