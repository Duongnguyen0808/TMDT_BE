const mongoose = require("mongoose");
const Banner = require("../models/Banner");
const Appliances = require("../models/Appliances");

const { Types } = mongoose;

const parseDate = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed;
};

const resolveSortOrder = async (provided) => {
    if (provided !== undefined && provided !== null) {
        const parsed = Number(provided);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    const latest = await Banner.findOne().sort({ sortOrder: -1 }).select("sortOrder");
    if (!latest) return 1;
    return (latest.sortOrder || 0) + 1;
};

const buildActiveFilter = () => {
    const now = new Date();
    return {
        isActive: true,
        $and: [
            {
                $or: [
                    { startAt: { $exists: false } },
                    { startAt: null },
                    { startAt: { $lte: now } },
                ],
            },
            {
                $or: [
                    { endAt: { $exists: false } },
                    { endAt: null },
                    { endAt: { $gte: now } },
                ],
            },
        ],
    };
};

const parseProductIds = (value) => {
    if (!value) return [];

    let candidate = [];
    if (Array.isArray(value)) {
        candidate = value;
    } else if (typeof value === "string") {
        candidate = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    } else {
        candidate = [value];
    }

    const normalized = candidate
        .map((item) => {
            if (!item) return null;
            if (typeof item === "object" && item._id) return item._id.toString();
            return item.toString();
        })
        .map((item) => item?.trim())
        .filter(Boolean)
        .filter((item) => Types.ObjectId.isValid(item));

    return [...new Set(normalized)];
};

const resolveProductSelection = async (rawInput) => {
    const parsedIds = parseProductIds(rawInput);
    if (!parsedIds.length) {
        return { ids: [], products: [] };
    }

    const products = await Appliances.find({ _id: { $in: parsedIds } })
        .select("title price imageUrl status stock slug")
        .lean();

    const map = new Map(products.map((prod) => [prod._id.toString(), prod]));
    const orderedProducts = parsedIds
        .map((id) => {
            const prod = map.get(id);
            if (!prod) return null;
            return {
                ...prod,
                _id: prod._id.toString(),
            };
        })
        .filter(Boolean);

    const validIds = orderedProducts.map((prod) => prod._id);
    return { ids: validIds, products: orderedProducts };
};

const mapBannerWithProducts = async (banner) => {
    if (!banner) return null;
    const rawIds = (banner.productIds || []).map((id) => id.toString());
    const { ids, products } = await resolveProductSelection(rawIds);
    return {
        ...banner,
        _id: banner._id?.toString() || banner._id,
        productIds: ids,
        linkedProducts: products,
    };
};

const toObjectIds = (ids) => ids.map((id) => new Types.ObjectId(id));

module.exports = {
    getActiveBanners: async (req, res) => {
        try {
            const banners = await Banner.find(buildActiveFilter())
                .sort({ sortOrder: 1, createdAt: -1 })
                .lean();
            const enriched = await Promise.all(banners.map((banner) => mapBannerWithProducts(banner)));
            return res.status(200).json(enriched.filter(Boolean));
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    getAllBanners: async (req, res) => {
        try {
            const { page = 1, limit = 20, keyword = "", status } = req.query;
            const filter = {};
            if (keyword) {
                const regex = new RegExp(keyword, "i");
                filter.$or = [{ title: regex }, { subtitle: regex }, { description: regex }];
            }
            if (status === "active") filter.isActive = true;
            if (status === "inactive") filter.isActive = false;

            const pageNum = parseInt(page, 10) || 1;
            const limitNum = parseInt(limit, 10) || 20;
            const skip = (pageNum - 1) * limitNum;

            const [items, total] = await Promise.all([
                Banner.find(filter)
                    .sort({ sortOrder: 1, createdAt: -1 })
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                Banner.countDocuments(filter),
            ]);

            const enrichedItems = await Promise.all(items.map((banner) => mapBannerWithProducts(banner)));

            return res.status(200).json({
                status: true,
                data: enrichedItems.filter(Boolean),
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum) || 1,
                },
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    createBanner: async (req, res) => {
        try {
            const {
                title,
                subtitle,
                description,
                imageUrl,
                category,
                redirectUrl,
                ctaText,
                actionType,
                actionValue,
                isActive,
                sortOrder,
                startAt,
                endAt,
            } = req.body;

            if (!title || !imageUrl) {
                return res
                    .status(400)
                    .json({ status: false, message: "Tiêu đề và hình ảnh là bắt buộc" });
            }

            const normalizedSortOrder = await resolveSortOrder(sortOrder);
            const payload = {
                title: title.trim(),
                subtitle,
                description,
                imageUrl,
                category,
                redirectUrl,
                ctaText,
                actionType: actionType || (category ? "category" : "none"),
                actionValue: actionValue || category || redirectUrl || null,
                isActive: typeof isActive === "boolean" ? isActive : true,
                sortOrder: normalizedSortOrder,
                createdBy: req.user?.id,
                updatedBy: req.user?.id,
            };

            const parsedStartAt = parseDate(startAt);
            const parsedEndAt = parseDate(endAt);
            if (parsedStartAt !== undefined) payload.startAt = parsedStartAt;
            if (parsedEndAt !== undefined) payload.endAt = parsedEndAt;

            const { ids: productIds } = await resolveProductSelection(req.body.productIds || req.body.products);
            if (productIds.length) {
                payload.productIds = toObjectIds(productIds);
            }

            const banner = await Banner.create(payload);
            return res
                .status(201)
                .json({ status: true, message: "Tạo banner thành công", data: banner });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    updateBanner: async (req, res) => {
        try {
            const { id } = req.params;
            const updates = { ...req.body };

            if (updates.sortOrder !== undefined) {
                updates.sortOrder = Number(updates.sortOrder);
            }
            const parsedStartAt = parseDate(updates.startAt);
            const parsedEndAt = parseDate(updates.endAt);
            if (updates.startAt !== undefined) updates.startAt = parsedStartAt;
            if (updates.endAt !== undefined) updates.endAt = parsedEndAt;

            if (
                Object.prototype.hasOwnProperty.call(updates, "productIds") ||
                Object.prototype.hasOwnProperty.call(updates, "products")
            ) {
                const rawProducts = updates.productIds ?? updates.products;
                const { ids: productIds } = await resolveProductSelection(rawProducts);
                updates.productIds = productIds.length ? toObjectIds(productIds) : [];
            } else {
                delete updates.productIds;
            }

            updates.updatedBy = req.user?.id;

            const banner = await Banner.findByIdAndUpdate(id, { $set: updates }, { new: true });
            if (!banner) {
                return res
                    .status(404)
                    .json({ status: false, message: "Không tìm thấy banner" });
            }

            return res
                .status(200)
                .json({ status: true, message: "Cập nhật banner thành công", data: banner });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    deleteBanner: async (req, res) => {
        try {
            const { id } = req.params;
            const deleted = await Banner.findByIdAndDelete(id);
            if (!deleted) {
                return res
                    .status(404)
                    .json({ status: false, message: "Không tìm thấy banner" });
            }
            return res
                .status(200)
                .json({ status: true, message: "Đã xoá banner" });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    updateBannerOrders: async (req, res) => {
        try {
            const { items } = req.body;
            if (!Array.isArray(items) || !items.length) {
                return res.status(400).json({ status: false, message: "Danh sách cập nhật không hợp lệ" });
            }

            const bulkOps = items
                .filter((item) => item?.id)
                .map((item) => ({
                    updateOne: {
                        filter: { _id: item.id },
                        update: { $set: { sortOrder: Number(item.sortOrder) || 0, updatedBy: req.user?.id } },
                    },
                }));

            if (!bulkOps.length) {
                return res.status(400).json({ status: false, message: "Không có dữ liệu hợp lệ để cập nhật" });
            }

            await Banner.bulkWrite(bulkOps);
            return res.status(200).json({ status: true, message: "Đã cập nhật thứ tự banner" });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    getBannerById: async (req, res) => {
        try {
            const { id } = req.params;
            const bannerDoc = await Banner.findById(id).lean();
            if (!bannerDoc) {
                return res.status(404).json({ status: false, message: "Không tìm thấy banner" });
            }
            const payload = await mapBannerWithProducts(bannerDoc);
            return res.status(200).json({ status: true, data: payload });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },

    updateBannerProducts: async (req, res) => {
        try {
            const { id } = req.params;
            const { ids, products } = await resolveProductSelection(req.body.productIds || req.body.products || []);

            const updatePayload = {
                productIds: ids.length ? toObjectIds(ids) : [],
                updatedBy: req.user?.id,
            };

            const banner = await Banner.findByIdAndUpdate(id, { $set: updatePayload }, { new: true }).lean();
            if (!banner) {
                return res.status(404).json({ status: false, message: "Không tìm thấy banner" });
            }

            return res.status(200).json({
                status: true,
                message: "Đã cập nhật danh sách sản phẩm cho banner",
                data: {
                    productIds: ids,
                    linkedProducts: products,
                },
            });
        } catch (error) {
            return res.status(500).json({ status: false, message: error.message });
        }
    },
};
