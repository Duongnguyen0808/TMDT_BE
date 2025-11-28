const mongoose = require("mongoose");
const Order = require("../models/Order");
const Appliances = require("../models/Appliances");
const User = require("../models/User");

const { Types } = mongoose;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const toObjectId = (value) => {
    if (!value) return null;
    if (value instanceof Types.ObjectId) return value;
    if (Types.ObjectId.isValid(String(value))) {
        return new Types.ObjectId(String(value));
    }
    return null;
};

const clampRange = (input, { min = 7, max = 180, fallback = 30 } = {}) => {
    const numeric = Number(input);
    if (Number.isNaN(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
};

const buildTimeline = (docs) =>
    docs.map((point) => ({
        date: point._id,
        orders: point.orders,
        revenue: point.revenue,
    }));

const buildTopProducts = (docs) =>
    docs.map((doc) => ({
        productId: doc.productId,
        title: doc.title,
        image: doc.image,
        sold: doc.sold,
        revenue: doc.revenue,
        stock: doc.stock,
        price: doc.price,
    }));

const getVendorOverview = async (req, res) => {
    try {
        const storeId = toObjectId(req.params.storeId);
        if (!storeId) {
            return res.status(400).json({ status: false, message: "StoreId không hợp lệ" });
        }
        const rangeDays = clampRange(req.query.range);
        const since = new Date(Date.now() - rangeDays * ONE_DAY_MS);

        const baseMatch = { storeId, createdAt: { $gte: since } };

        const [totalsDoc] = await Order.aggregate([
            { $match: baseMatch },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    deliveredOrders: {
                        $sum: { $cond: [{ $eq: ["$orderStatus", "Delivered"] }, 1, 0] },
                    },
                    cancelledOrders: {
                        $sum: { $cond: [{ $eq: ["$orderStatus", "Cancelled"] }, 1, 0] },
                    },
                    revenueDelivered: {
                        $sum: {
                            $cond: [{ $eq: ["$orderStatus", "Delivered"] }, "$grandTotal", 0],
                        },
                    },
                    avgOrderValue: { $avg: "$grandTotal" },
                    returnCount: {
                        $sum: { $cond: [{ $ne: ["$returnStatus", "None"] }, 1, 0] },
                    },
                },
            },
        ]);

        const statusDocs = await Order.aggregate([
            { $match: baseMatch },
            { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
        ]);

        const timelineDocs = await Order.aggregate([
            { $match: baseMatch },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt",
                            timezone: process.env.ANALYTICS_TZ || "Asia/Ho_Chi_Minh",
                        },
                    },
                    orders: { $sum: 1 },
                    revenue: {
                        $sum: {
                            $cond: [{ $eq: ["$orderStatus", "Delivered"] }, "$grandTotal", 0],
                        },
                    },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const topProductDocs = await Order.aggregate([
            { $match: baseMatch },
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
            { $limit: 5 },
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
                    image: { $arrayElemAt: ["$product.imageUrl", 0] },
                },
            },
        ]);

        const customerDocs = await Order.aggregate([
            { $match: { ...baseMatch, userId: { $ne: null } } },
            {
                $group: {
                    _id: "$userId",
                    orders: { $sum: 1 },
                    spend: { $sum: "$grandTotal" },
                },
            },
        ]);

        const totalCustomers = customerDocs.length;
        const repeatCustomers = customerDocs.filter((c) => c.orders > 1).length;
        const newCustomers = totalCustomers - repeatCustomers;
        const repeatRate = totalCustomers ? repeatCustomers / totalCustomers : 0;

        const topCustomerDocs = customerDocs
            .slice()
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 5);
        const topCustomerIds = topCustomerDocs.map((doc) => doc._id);
        const userProfiles = await User.find({ _id: { $in: topCustomerIds } })
            .select("username email profile")
            .lean();
        const profileMap = new Map(userProfiles.map((u) => [String(u._id), u]));
        const topCustomers = topCustomerDocs.map((doc) => {
            const profile = profileMap.get(String(doc._id)) || {};
            return {
                customerId: doc._id,
                name: profile.username || "Khách hàng",
                email: profile.email || "",
                orders: doc.orders,
                spend: doc.spend,
            };
        });

        const totals = {
            orders: totalsDoc?.totalOrders || 0,
            delivered: totalsDoc?.deliveredOrders || 0,
            cancelled: totalsDoc?.cancelledOrders || 0,
            revenueDelivered: totalsDoc?.revenueDelivered || 0,
            avgOrderValue: totalsDoc?.avgOrderValue || 0,
            returnRate:
                totalsDoc?.totalOrders
                    ? (totalsDoc.returnCount || 0) / totalsDoc.totalOrders
                    : 0,
        };

        const statuses = statusDocs.reduce((acc, doc) => {
            acc[doc._id || "Unknown"] = doc.count;
            return acc;
        }, {});

        return res.status(200).json({
            status: true,
            data: {
                storeId,
                rangeDays,
                generatedAt: new Date().toISOString(),
                totals,
                statuses,
                timeline: buildTimeline(timelineDocs),
                topProducts: buildTopProducts(topProductDocs),
                customers: {
                    total: totalCustomers,
                    newCustomers,
                    repeatCustomers,
                    repeatRate,
                    topCustomers,
                },
            },
        });
    } catch (error) {
        console.error("[analytics][vendor]", error);
        return res.status(500).json({ status: false, message: error.message });
    }
};

const getPlatformOverview = async (req, res) => {
    try {
        const rangeDays = clampRange(req.query.range, { min: 1, max: 365, fallback: 30 });
        const since = new Date(Date.now() - rangeDays * ONE_DAY_MS);
        const match = { createdAt: { $gte: since } };

        const [totalsDoc] = await Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    revenue: { $sum: "$grandTotal" },
                    deliveredOrders: {
                        $sum: { $cond: [{ $eq: ["$orderStatus", "Delivered"] }, 1, 0] },
                    },
                },
            },
        ]);

        const timelineDocs = await Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt",
                            timezone: process.env.ANALYTICS_TZ || "Asia/Ho_Chi_Minh",
                        },
                    },
                    orders: { $sum: 1 },
                    revenue: { $sum: "$grandTotal" },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        const topStoreDocs = await Order.aggregate([
            { $match: match },
            {
                $group: {
                    _id: "$storeId",
                    orders: { $sum: 1 },
                    revenue: { $sum: "$grandTotal" },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: "stores",
                    localField: "_id",
                    foreignField: "_id",
                    as: "store",
                },
            },
            { $unwind: { path: "$store", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    storeId: "$_id",
                    title: "$store.title",
                    logo: "$store.logoUrl",
                    orders: 1,
                    revenue: 1,
                },
            },
        ]);

        const topCategoryDocs = await Order.aggregate([
            { $match: match },
            { $unwind: "$orderItems" },
            {
                $lookup: {
                    from: "appliances",
                    localField: "orderItems.appliancesId",
                    foreignField: "_id",
                    as: "product",
                },
            },
            { $unwind: "$product" },
            {
                $group: {
                    _id: "$product.category",
                    orders: { $sum: 1 },
                },
            },
            { $sort: { orders: -1 } },
            { $limit: 5 },
        ]);

        const activeStores = await Order.distinct("storeId", match);

        return res.status(200).json({
            status: true,
            data: {
                rangeDays,
                generatedAt: new Date().toISOString(),
                totals: {
                    orders: totalsDoc?.totalOrders || 0,
                    delivered: totalsDoc?.deliveredOrders || 0,
                    revenue: totalsDoc?.revenue || 0,
                },
                activeStores: activeStores.length,
                topStores: topStoreDocs,
                topCategories: topCategoryDocs.map((doc) => ({
                    category: doc._id,
                    orders: doc.orders,
                })),
                timeline: buildTimeline(timelineDocs),
            },
        });
    } catch (error) {
        console.error("[analytics][platform]", error);
        return res.status(500).json({ status: false, message: error.message });
    }
};

module.exports = {
    getVendorOverview,
    getPlatformOverview,
};
