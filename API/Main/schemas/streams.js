const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const moderatorSchema = new Schema({
  id: String,
  permissions: Number
});
const punishmentSchema = new Schema({
  id: String,
  restrictions: Number,
  by: String,
  at: Date,
  reason: String
});
const streamSchema = new Schema({
  _id: ObjectId,
  user_id: String,
  stream_key: String,
  info: {
    title: String,
    desc: String,
    views: Number,
    startsAt: Date,
    startedAt: Date
  },
  endpoint: {
    hls: String,
    thumbnail: String
  },
  chat: {
    flags: Number,
    moderators: [moderatorSchema],
    punishments: [punishmentSchema]
  },
  updatedAt: Date,
  createdAt: Date
}, { collection : 'streams' });
module.exports = {
  init: function (url) {
    var a = mongoose.createConnection(url);
    return a.model('Streams', streamSchema);
  }
}
//module.exports = mongoose.model('Streams', streamSchema);
