const mongoose = require('mongoose');
const SettingSchema = new mongoose.Schema({
    printerip: {
        type: String,
        default: ""

    },

}, {
    timestamps: true
});
const Setting = mongoose.model('Setting', SettingSchema);

module.exports = Setting;
