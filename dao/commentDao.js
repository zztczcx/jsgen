/*
    convertID(id);
    getCommentsNum(callback);
    getCommentsIndex(date, limit, callback);
    getLatestId(callback);
    getCommentsList(_idArray, callback);
    getComment(_id, callback);
    setFavors(commentObj);
    setOpposes(commentObj);
    setNewComment(commentObj, callback);
    delComment(_idArray, callback);
 */
var db = require('./mongoDao.js').db,
    union = require('../lib/tools.js').union,
    intersect = require('../lib/tools.js').intersect,
    callbackFn = require('../lib/tools.js').callbackFn,
    converter = require('../lib/nodeAnyBaseConverter.js'),
    IDString = require('./json.js').IDString,
    defautComment = require('./json.js').Comment;

var that = db.bind('comments', {

    convertID: function(id) {
        switch(typeof id) {
        case 'string':
            id = id.substring(1);
            id = converter(id, 62, IDString);
            return id;
        case 'number':
            id = converter(id, 62, IDString);
            while(id.length < 3) {
                id = '0' + id;
            }
            id = 'C' + id;
            return id;
        default:
            return null;
        }
    },

    getCommentsNum: function(callback) {
        var callback = callback || callbackFn;
        that.count({}, function(err, count) {
            // db.close();
            return callback(err, count);
        });
    },

    getLatestId: function(callback) {
        var callback = callback || callbackFn;
        that.findOne({}, {
            sort: {
                _id: -1
            },
            hint: {
                _id: 1
            },
            fields: {
                _id: 1
            }
        }, function(err, doc) {
            // db.close();
            return callback(err, doc);
        });
    },

    getCommentsIndex: function(date, limit, callback) {
        var query = {};
        var callback = callback || callbackFn;
        if(date > 0) query = {
            date: {
                $gt: date
            }
        }
        that.find(query, {
            sort: {
                _id: -1
            },
            limit: limit,
            hint: {
                _id: 1
            },
            fields: {
                _id: 1,
                favors: 1,
                opposes: 1
            }
        }).toArray(function(err, doc) {
            // db.close();
            return callback(err, doc);
        });
    },

    getCommentsList: function(_idArray, callback) {
        var callback = callback || callbackFn;
        if(!Array.isArray(_idArray)) _idArray = [_idArray];
        that.find({
            _id: {
                $in: _idArray
            }
        }, {
            fields: {
                author: 1,
                date: 1,
                article: 1,
                refer: 1,
                content: 1,
                favors: 1,
                opposes: 1
            }
        }).toArray(function(err, doc) {
            // db.close();
            return callback(err, doc);
        });
    },

    getComment: function(_id, callback) {
        var callback = callback || callbackFn;
        that.findOne({
            _id: _id
        }, {
            sort: {
                _id: -1
            },
            fields: {
                author: 1,
                date: 1,
                article: 1,
                refer: 1,
                content: 1,
                favors: 1,
                favorsList: 1,
                opposes: 1,
                opposesList: 1
            }
        }, function(err, doc) {
            // db.close();
            return callback(err, doc);
        });
    },

    setFavors: function(commentObj) {
        var setObj = {},
            newObj = {
                favorsList: 0
            };

        newObj = intersect(newObj, commentObj);
        if(newObj.favorsList < 0) {
            newObj.favorsList = Math.abs(newObj.favorsList);
            setObj.$inc = {
                favors: -1
            };
            setObj.$pull = {
                favorsList: newObj.favorsList
            };
        } else {
            setObj.$inc = {
                favors: 1
            };
            setObj.$push = {
                favorsList: newObj.favorsList
            };
        }

        that.update({
            _id: commentObj._id
        }, setObj);
        // db.close();
    },

    setOpposes: function(commentObj) {
        var setObj = {},
            newObj = {
                opposesList: 0
            };

        newObj = intersect(newObj, commentObj);
        if(newObj.opposesList < 0) {
            newObj.opposesList = Math.abs(newObj.opposesList);
            setObj.$inc = {
                opposes: -1
            };
            setObj.$pull = {
                opposesList: newObj.opposesList
            };
        } else {
            setObj.$inc = {
                opposes: 1
            };
            setObj.$push = {
                opposesList: newObj.opposesList
            };
        }

        that.update({
            _id: commentObj._id
        }, setObj);
        // db.close();
    },

    setNewComment: function(commentObj, callback) {
        var comment = union(defautComment),
            newComment = union(defautComment);

        var callback = callback || callbackFn;
        newComment = intersect(newComment, commentObj);
        newComment = union(comment, newComment);
        newComment.date = Date.now();

        that.getLatestId(function(err, doc) {
            if(err) {
                // db.close();
                return callback(err, null);
            }
            if (!doc) newComment._id = 1;
            else newComment._id = doc._id + 1;
            that.insert(
            newComment, {
                w: 1
            }, function(err, doc) {
                // db.close();
                return callback(err, doc);
            });
        });
    },

    delComment: function(_id, callback) {
        var callback = callback || callbackFn;
        that.remove({
            _id: _id
        }, {
            w: 1
        }, function(err, doc) {
            // db.close();
            return callback(err, doc);
        });
    },
});

module.exports = {
    convertID: that.convertID,
    getCommentsNum: that.getCommentsNum,
    getCommentsIndex: that.getCommentsIndex,
    getLatestId: that.getLatestId,
    getCommentsList: that.getCommentsList,
    getComment: that.getComment,
    setFavors: that.setFavors,
    setOpposes: that.setOpposes,
    setNewComment: that.setNewComment,
    delComment: that.delComment
};
