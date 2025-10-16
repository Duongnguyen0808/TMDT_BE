const mongoose = require('mongoose');

const RatingSchema = new mongoose.Schema({
    userId: {type: String,require: true},
    ratingType: {type: String,require: true,enum:['Store','Driver','Appliances']},
    product: {type: String,require: true},
    rating: {type: Number,min:1,max:5,require: true},
});

module.exports = mongoose.model('Rating',RatingSchema);