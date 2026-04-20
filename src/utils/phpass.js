const crypto = require('crypto');

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function encode64(input, count) {
    let output = '';
    let i = 0;
    do {
        let value = input[i++];
        output += ITOA64[value & 0x3f];
        if (i < count) value |= input[i] << 8;
        output += ITOA64[(value >> 6) & 0x3f];
        if (i++ >= count) break;
        if (i < count) value |= input[i] << 16;
        output += ITOA64[(value >> 12) & 0x3f];
        if (i++ >= count) break;
        output += ITOA64[(value >> 18) & 0x3f];
    } while (i < count);
    return output;
}

function md5(data) {
    return crypto.createHash('md5').update(data).digest();
}

function checkPassword(password, hash) {
    if (!hash || !hash.startsWith('$P$') && !hash.startsWith('$H$')) return false;

    const countLog2 = ITOA64.indexOf(hash[3]);
    if (countLog2 < 0) return false;

    const count = 1 << countLog2;
    const salt = hash.substring(4, 12);
    if (salt.length !== 8) return false;

    let hashVal = md5(Buffer.concat([Buffer.from(salt), Buffer.from(password)]));
    let iter = count;
    do {
        hashVal = md5(Buffer.concat([hashVal, Buffer.from(password)]));
    } while (--iter);

    const computed = '$P$' + hash[3] + salt + encode64(hashVal, 16);
    return computed === hash;
}

module.exports = { checkPassword };
