const bcrypt = require("bcryptjs");
const CryptoJS = require("crypto-js");

const BCRYPT_ROUNDS = Math.max(parseInt(process.env.BCRYPT_ROUNDS || "12", 10), 10);
const LEGACY_PREFIX = "U2FsdGVkX1"; // CryptoJS AES prefix

const hashPassword = async (plainText) => {
    if (typeof plainText !== "string" || !plainText.trim()) {
        throw new Error("Password must be a non-empty string");
    }
    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    return bcrypt.hash(plainText, salt);
};

const isBcryptHash = (value) => typeof value === "string" && value.startsWith("$2");

const decryptLegacyPassword = (encrypted) => {
    if (typeof encrypted !== "string" || !encrypted.startsWith(LEGACY_PREFIX)) {
        return null;
    }
    const secret = process.env.SECRET;
    if (!secret) {
        console.warn("[passwordService] SECRET env missing – cannot decrypt legacy password");
        return null;
    }
    try {
        const bytes = CryptoJS.AES.decrypt(encrypted, secret);
        const decoded = bytes.toString(CryptoJS.enc.Utf8);
        return decoded || null;
    } catch (error) {
        console.error("[passwordService] Failed to decrypt legacy password", error.message);
        return null;
    }
};

const upgradeUserPassword = async (userDoc, plainText) => {
    if (!userDoc) return;
    userDoc.password = await hashPassword(plainText);
    userDoc.passwordVersion = 2;
    userDoc.passwordMigratedAt = new Date();
    await userDoc.save();
};

const verifyUserPassword = async (userDoc, candidate, { upgradeOnMatch = true } = {}) => {
    if (!userDoc || typeof candidate !== "string") {
        return false;
    }
    const stored = userDoc.password || "";
    if (!stored) return false;

    if (isBcryptHash(stored)) {
        return bcrypt.compare(candidate, stored);
    }

    const legacy = decryptLegacyPassword(stored);
    if (!legacy) return false;
    const isMatch = legacy === candidate;
    if (isMatch && upgradeOnMatch) {
        await upgradeUserPassword(userDoc, candidate);
    }
    return isMatch;
};

module.exports = {
    hashPassword,
    verifyUserPassword,
    upgradeUserPassword,
    decryptLegacyPassword,
    isBcryptHash,
};
