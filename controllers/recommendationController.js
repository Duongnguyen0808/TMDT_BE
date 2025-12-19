const mongoose = require("mongoose");
const Order = require("../models/Order");
const Appliances = require("../models/Appliances");
const Favorite = require("../models/Favorite");

const { Types } = mongoose;

const clampNumber = (value, { min = 1, max = 50, fallback = 10 } = {}) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
};

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof Types.ObjectId) return value;
    if (Types.ObjectId.isValid(String(value))) {
        return new Types.ObjectId(String(value));
    }
    return null;
};

const formatProductPayload = (doc, extra = {}) => {
    if (!doc) return null;
    const imageUrl = Array.isArray(doc.imageUrl) && doc.imageUrl.length
        ? doc.imageUrl[0]
        : "";
    const storeInfo = (() => {
        const store = doc.store;
        if (!store) return undefined;
        if (typeof store === "string") {
            return { id: store };
        }
        return {
            id: store._id || store.id || store,
            title: store.title || "",
            logo: store.logoUrl || "",
        };
    })();
    return {
        id: doc._id,
        title: doc.title,
        price: doc.price,
        stock: doc.stock,
        rating: doc.rating ?? 0,
        discount: doc.discount ?? 0,
        soldCount: doc.soldCount ?? 0,
        image: imageUrl,
        store: storeInfo,
        ...extra,
    };
};

const fetchSeedProducts = async ({ userId, rangeDays }) => {
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const [orders, favorites] = await Promise.all([
        Order.find({ userId, createdAt: { $gte: since } })
            .select("orderItems updatedAt")
            .limit(80)
            .sort({ updatedAt: -1 })
            .lean(),
        Favorite.find({ userId }).select("appliancesId").lean(),
    ]);

    const productIds = new Set();
    for (const order of orders) {
        for (const item of order.orderItems || []) {
            if (item.appliancesId) {
                productIds.add(String(item.appliancesId));
            }
        }
    }
    for (const fav of favorites) {
        if (fav.appliancesId) {
            productIds.add(String(fav.appliancesId));
        }
    }

    if (!productIds.size) return [];

    return Appliances.find({ _id: { $in: Array.from(productIds) } })
        .select("category store appliancesTags")
        .lean();
};

const buildPreferenceBuckets = (products) => {
    const categoryScores = new Map();
    const storeScores = new Map();
    const tagScores = new Map();

    products.forEach((product) => {
        if (product.category) {
            categoryScores.set(
                product.category,
                (categoryScores.get(product.category) || 0) + 1
            );
        }
        if (product.store) {
            const storeId = String(product.store);
            storeScores.set(storeId, (storeScores.get(storeId) || 0) + 1);
        }
        if (Array.isArray(product.appliancesTags)) {
            product.appliancesTags.forEach((tag) => {
                if (!tag) return;
                tagScores.set(tag, (tagScores.get(tag) || 0) + 1);
            });
        }
    });

    const sortEntries = (map) =>
        Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([key]) => key);

    return {
        categories: sortEntries(categoryScores),
        stores: sortEntries(storeScores).map((id) => toObjectId(id)).filter(Boolean),
        tags: sortEntries(tagScores),
    };
};

const getFallbackSegments = async (limit) => {
    const [bestsellers, hotDeals] = await Promise.all([
        Appliances.find({ isAvailable: true })
            .populate("store", "title logoUrl")
            .sort({ soldCount: -1 })
            .limit(limit)
            .lean(),
        Appliances.find({ isAvailable: true, discount: { $gt: 0 } })
            .populate("store", "title logoUrl")
            .sort({ discount: -1, soldCount: -1 })
            .limit(limit)
            .lean(),
    ]);

    const segments = [];
    if (bestsellers.length) {
        segments.push({
            key: "bestsellers",
            title: "Bán chạy toàn sàn",
            reason: "Dựa trên số đơn giao thành công",
            products: bestsellers.map((doc) => formatProductPayload(doc)),
        });
    }
    if (hotDeals.length) {
        segments.push({
            key: "hotDeals",
            title: "Ưu đãi đang diễn ra",
            reason: "Sản phẩm đang có khuyến mãi",
            products: hotDeals.map((doc) => formatProductPayload(doc)),
        });
    }
    return segments;
};

const getUserRecommendations = async (req, res) => {
    try {
        const userId = req.user?.id ? toObjectId(req.user.id) : toObjectId(req.query.userId);
        if (!userId) {
            return res.status(400).json({ status: false, message: "Không xác định được người dùng" });
        }

        const limit = clampNumber(req.query.limit, { min: 4, max: 30, fallback: 12 });
        const rangeDays = clampNumber(req.query.range, { min: 7, max: 365, fallback: 90 });

        const seedProducts = await fetchSeedProducts({ userId, rangeDays });
        const preferences = buildPreferenceBuckets(seedProducts);

        const query = { isAvailable: true };
        if (preferences.categories.length) {
            query.category = { $in: preferences.categories.slice(0, 3) };
        }
        if (!query.category && preferences.stores.length) {
            query.store = { $in: preferences.stores.slice(0, 3) };
        }

        const personalizedDocs = await Appliances.find(query)
            .populate("store", "title logoUrl")
            .sort({ soldCount: -1, rating: -1 })
            .limit(limit)
            .lean();

        const personalized = personalizedDocs.map((doc) =>
            formatProductPayload(doc)
        );

        const segments = [];
        if (personalized.length) {
            segments.push({
                key: "personalized",
                title: "Gợi ý cho bạn",
                reason: preferences.categories.length
                    ? "Dựa trên ngành hàng mua gần đây"
                    : preferences.stores.length
                        ? "Lấy từ cửa hàng bạn thường ghé"
                        : "Phù hợp với xu hướng chung",
                products: personalized,
            });
        }

        const fallbackSegments = await getFallbackSegments(limit);
        segments.push(...fallbackSegments);

        return res.status(200).json({
            status: true,
            data: {
                generatedAt: new Date().toISOString(),
                userId,
                segments,
            },
        });
    } catch (error) {
        console.error("[recommendations][user]", error);
        return res.status(500).json({ status: false, message: error.message });
    }
};

const aggregateTrendingForStore = async ({ storeId, rangeDays, limit }) => {
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    return Order.aggregate([
        { $match: { storeId, createdAt: { $gte: since } } },
        { $unwind: "$orderItems" },
        {
            $group: {
                _id: "$orderItems.appliancesId",
                sold: { $sum: "$orderItems.quantity" },
                revenue: {
                    $sum: { $multiply: ["$orderItems.quantity", "$orderItems.price"] },
                },
            },
        },
        { $sort: { sold: -1 } },
        { $limit: limit },
        {
            $lookup: {
                from: "appliances",
                localField: "_id",
                foreignField: "_id",
                as: "product",
            },
        },
        { $unwind: "$product" },
        {
            $project: {
                productId: "$_id",
                sold: 1,
                revenue: 1,
                title: "$product.title",
                price: "$product.price",
                stock: "$product.stock",
                discount: "$product.discount",
                image: { $arrayElemAt: ["$product.imageUrl", 0] },
            },
        },
    ]);
};

const buildRestockAlerts = (trending) => {
    const alerts = [];
    trending.forEach((product) => {
        const currentStock = Number(product.stock ?? 0);
        const sold = Number(product.sold ?? 0);
        if (currentStock <= 0 || currentStock >= sold) return;
        const suggested = Math.max(10, Math.ceil(sold * 1.5));
        const urgency = currentStock <= sold * 0.25 ? "high" : currentStock <= sold * 0.5 ? "medium" : "low";
        alerts.push({
            productId: product.productId,
            title: product.title,
            stock: currentStock,
            sold,
            suggestedOrder: suggested,
            urgency,
        });
    });
    return alerts;
};

const buildBundleIdeas = async ({ storeId, rangeDays }) => {
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const recentOrders = await Order.find({ storeId, createdAt: { $gte: since } })
        .select("orderItems")
        .limit(120)
        .sort({ createdAt: -1 })
        .lean();

    const comboCounter = new Map();
    recentOrders.forEach((order) => {
        const uniqueItems = Array.from(
            new Set(
                (order.orderItems || [])
                    .map((item) => (item.appliancesId ? String(item.appliancesId) : null))
                    .filter(Boolean)
            )
        );
        for (let i = 0; i < uniqueItems.length; i += 1) {
            for (let j = i + 1; j < uniqueItems.length; j += 1) {
                const pair = [uniqueItems[i], uniqueItems[j]].sort().join("__");
                comboCounter.set(pair, (comboCounter.get(pair) || 0) + 1);
            }
        }
    });

    const topCombos = Array.from(comboCounter.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    if (!topCombos.length) return [];

    const productIds = new Set();
    topCombos.forEach(([key]) => key.split("__").forEach((id) => productIds.add(id)));

    const products = await Appliances.find({ _id: { $in: Array.from(productIds) } })
        .select("_id title price stock imageUrl")
        .lean();
    const productMap = new Map(products.map((doc) => [String(doc._id), doc]));

    const bundles = [];
    topCombos.forEach(([key, count]) => {
        const [firstId, secondId] = key.split("__");
        const firstProduct = productMap.get(firstId);
        const secondProduct = productMap.get(secondId);
        if (!firstProduct || !secondProduct) return;
        bundles.push({
            ordersTogether: count,
            products: [formatProductPayload(firstProduct), formatProductPayload(secondProduct)],
        });
    });

    return bundles;
};

const getStoreRecommendations = async (req, res) => {
    try {
        const storeId = toObjectId(req.params.storeId);
        if (!storeId) {
            return res.status(400).json({ status: false, message: "StoreId không hợp lệ" });
        }
        const rangeDays = clampNumber(req.query.range, { min: 7, max: 120, fallback: 30 });
        const limit = clampNumber(req.query.limit, { min: 4, max: 20, fallback: 8 });

        const trending = await aggregateTrendingForStore({ storeId, rangeDays, limit });
        const restockAlerts = buildRestockAlerts(trending);
        const bundleIdeas = await buildBundleIdeas({ storeId, rangeDays });

        return res.status(200).json({
            status: true,
            data: {
                storeId,
                rangeDays,
                generatedAt: new Date().toISOString(),
                trending,
                restockAlerts,
                bundleIdeas,
            },
        });
    } catch (error) {
        console.error("[recommendations][store]", error);
        return res.status(500).json({ status: false, message: error.message });
    }
};

module.exports = {
    getUserRecommendations,
    getStoreRecommendations,
};
