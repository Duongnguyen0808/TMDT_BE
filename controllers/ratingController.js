const Rating = require('../models/Rating');
const Store = require('../models/Store');
const Appliances = require('../models/Appliances');

module.exports = {
    addRating: async (req, res) => {
        const newRating = new Rating({
            userId: req.body.id,
        ratingType: req.body.ratingType,
        product: req.body.product,
        rating: req.body.rating
        });
    try {
        await newRating.save();
        if(req.body.ratingType === 'Store'){
            const store = await Rating.aggregate([
                {$match: {ratingType: req.body.ratingType,product:req.body.product}},
                {$group: {_id: '$product'}, averageRating: {$avg: '$rating'}}
            ]);
        if(store.length>0){
            const averageRating = store[0].averageRating;
            await Store.findByIdAndUpdate(req.body.product,{averageRating: averageRating},{new:true});
        }
        }else if(req.body.ratingType === 'Appliances'){
              const appliances = await Rating.aggregate([
                {$match: {ratingType: req.body.ratingType,product:req.body.product}},
                {$group: {_id: '$product'}, averageRating: {$avg: '$rating'}}
            ]);
        if(appliances.length>0){
            const averageRating = appliances[0].averageRating;
            await Appliances.findByIdAndUpdate(req.body.product,{averageRating: averageRating},{new:true});
        }
        }
        res.status(200).json({ status: true, message: "Rating has been successfully added" });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
    },

    checkUserRating: async (req, res) => {
        const ratingType = req.params.ratingType;
        const product = req.params.product;
    try {
        const existingRating = await Rating.findOne(
            {
                userId: req.body.id,
                ratingType: ratingType,
                product: product 
            }
        );
        if (existingRating) {
            res.status(2000).json({status:true,message:"You has already rated this store",rating: existingRating.rating});
        }else{
            res.status(200).json({status:false,message:"User has not rated this store yet"});
        }
    } catch (error) {

    }
    
    }
};