const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const ObjectId = Schema.ObjectId;

const serverSchema = new Schema({
  _id: ObjectId,
  token: String,
  type: String,
  address: String
}, { collection : 'servers'});
module.exports = {
  init: function (url) {
    var a = mongoose.createConnection(url);
    return a.model('Streams', serverSchema);
  }
}
//module.exports = mongoose.model('Streams', streamSchema);
