const mongoose = require("mongoose");
const Schema = mongoose.Schema;
//const ObjectId = Schema.ObjectId;

const userSchema = new Schema({
  _id: { type: Schema.Types.ObjectId },
  username: { type: String, required: true },
  email: { type: String, select: false },
  password: { type: String, select: false },
  displayName: { type: String, default: this.username },
  dateOfBirth: { type: Date, select: false },
  avatar: String,
  banner: { type: String, select: false },
  bio: { type: String, select: false },
  pronouns: { type: String, select: false },
  verified: Boolean,
  totpSecret: { type: String, select: false },
  backupCodes: { type: Array, select: false },
  followers: { type: Array, select: false },
  following: { type: Array, select: false },
  roles: { type: Array, select: false },
  isMLFlagged: { type: Boolean, select: false },
  canStream: Boolean,
  premium: { type: Object, select: false },
  banReason: { type: String, select: false },
  banExpiration: { type: Date, select: false },
  deletedAt: { type: Date, select: false },
  createdAt: { type: Date, select: false },
  updatedAt: { type: Date, select: false },
  videos: { type: Array, select: false },
  stripe: { type: Object, select: false }
}, { collection : 'users' });
module.exports = {
  init: function (url) {
    var a = mongoose.createConnection(url);
    return a.model('Users', userSchema);
  }
}
//module.exports = mongoose.model('Streams', streamSchema);
