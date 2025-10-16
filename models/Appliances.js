const mongoose = require('mongoose');
const AppliancesSchema = new mongoose.Schema({
    title: {type: String, required: true},
    time: {type: String, required: true},
    appliancesTags: {type: Array, required: true},
    category: {type: String, required: true},
    appliancesType: {type: Array, required: true},
    code: {type: String, required: true},
    isAvailable: {type: Boolean, default: true},
    store: {type: mongoose.Schema.Types.ObjectId, required: true},
    rating: {type: Number, min: 1, max: 5, default: 3},
    ratingCount: {type: String, default: "267"},
    description: {type: String, required: true}, 
    price: {type: Number, required: true},
    additives: {type: Array, default: []},           
    imageUrl: {type: Array, required: true},
});

module.exports = mongoose.model('Appliances',AppliancesSchema);