const CryptoJS = require('crypto-js');

const encrypt = (data, key, iv) => {
    const secret = CryptoJS.enc.Utf8.parse(key);
    const cipher = CryptoJS.AES.encrypt(data, secret, {
        iv: CryptoJS.enc.Hex.parse(iv),
        mode: CryptoJS.mode.CBC,
        keySize: 256 / 32,
        padding: CryptoJS.pad.Pkcs7,
    });
    return cipher.toString();
};

const decrypt = (data, secret, iv) => {
    const decrypted = CryptoJS.AES.decrypt(data.toString(), secret, {
        iv: CryptoJS.enc.Hex.parse(iv),
        mode: CryptoJS.mode.CBC,
        keySize: 256 / 32,
        padding: CryptoJS.pad.Pkcs7,
    });
    return decrypted.toString(CryptoJS.enc.Utf8);
};

const encryptHmac = (payload, secretKey) => {
    return CryptoJS.HmacSHA256(payload, secretKey).toString();
};

const CryptoService = {
    encrypt,
    decrypt,
    encryptHmac,
};
module.exports = CryptoService;
