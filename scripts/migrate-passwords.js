require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const passwordService = require("../utils/passwordService");

const connect = async () => {
    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) {
        throw new Error("MONGO_URL is required to run the migration");
    }
    await mongoose.connect(mongoUrl);
};

(async () => {
    try {
        console.log("[migrate-passwords] Starting migration...");
        await connect();

        const legacyUsers = await User.find({ password: { $not: /^\$2/ } });
        console.log(`[migrate-passwords] Found ${legacyUsers.length} candidate accounts`);

        let migrated = 0;
        let skipped = 0;

        for (const user of legacyUsers) {
            const plain = passwordService.decryptLegacyPassword(user.password);
            if (!plain) {
                skipped += 1;
                console.warn(
                    `[migrate-passwords] Skip user=${user.email} – cannot decrypt legacy password`
                );
                continue;
            }

            user.password = await passwordService.hashPassword(plain);
            user.passwordVersion = 2;
            user.passwordMigratedAt = new Date();
            await user.save();
            migrated += 1;
            console.log(`[migrate-passwords] Migrated user=${user.email}`);
        }

        console.log(
            `[migrate-passwords] Completed. migrated=${migrated} skipped=${skipped}`
        );
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error("[migrate-passwords] Migration failed", error);
        await mongoose.disconnect().catch(() => { });
        process.exit(1);
    }
})();
