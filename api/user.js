var userDao = require('../dao/userDao.js'),
    db = require('../dao/mongoDao.js').db,
    globalConfig = require('../dao/json.js').GlobalConfig,
    UserPublicTpl = require('../dao/json.js').UserPublicTpl,
    UserPrivateTpl = require('../dao/json.js').UserPrivateTpl,
    errlog = require('rrestjs').restlog,
    union = require('../lib/tools.js').union,
    intersect = require('../lib/tools.js').intersect,
    checkEmail = require('../lib/tools.js').checkEmail,
    checkUserID = require('../lib/tools.js').checkUserID,
    checkUserName = require('../lib/tools.js').checkUserName,
    checkUrl = require('../lib/tools.js').checkUrl,
    SHA256 = require('../lib/tools.js').SHA256,
    HmacSHA256 = require('../lib/tools.js').HmacSHA256,
    gravatar = require('../lib/tools.js').gravatar,
    CacheFn = require('../lib/tools.js').CacheFn,
    callbackFn = require('../lib/tools.js').callbackFn,
    filterSummary = require('../lib/tools.js').filterSummary,
    email = require('../lib/email.js'),
    global = require('./index.js').global,
    filterTags = require('./tag.js').filterTags,
    setTag = require('./tag.js').setTag,
    Err = require('./errmsg.js');

var userCache = new CacheFn(100);
var paginationCache = new CacheFn(5);
userCache.getUser = function(userID, callback) {
    var that = this,
        callback = callback || callbackFn,
        doc = this.get(userID);

    if(doc) return callback(null, doc);
    else userDao.getUserInfo(userDao.convertID(userID), function(err, doc) {
        if(err) errlog.error(err);
        if(doc) {
            doc._id = userID;
            that.put(userID, doc);
        }
        return callback(err, doc);
    });
};

var cache = {
    _initTime: 0,
    _index: []
};
cache._init = function(callback) {
    var that = this,
        callback = callback || callbackFn;
    userDao.getUsersIndex(function(err, doc) {
        if(err) return errlog.error(err);
        if(doc) {
            doc._id = userDao.convertID(doc._id);
            that._update(doc);
        }
        if(callback) callback(err, doc);
    });
    return this;
};
cache._update = function(obj) {
    if(!this[obj._id]) {
        this[obj._id] = {};
        this._index.push(obj._id);
    }
    this[obj._id]._id = obj._id;
    this[obj._id].name = obj.name;
    this[obj._id].email = obj.email;
    this[obj._id].avatar = obj.avatar;
    this[obj.name] = this[obj._id];
    this[obj.email] = this[obj._id];
    this._initTime = Date.now();
    return this;
};
cache._remove = function(userID) {
    var that = this;
    if(this[userID]) {
        delete this[this[userID].name];
        delete this[this[userID].email];
        delete this[userID];
        this._index.splice(this._index.indexOf(userID), 1);
        this._initTime = Date.now();
    }
    return this;
};

function setCache(obj) {
    cache._remove(obj._id);
    cache._update(obj);
    userCache.put(obj._id, obj);
};

function adduser(userObj, callback) {
    var body = {},
        callback = callback || callbackFn;
    if(!checkEmail(userObj.email)) {
        body.err = Err.userEmailErr;
    } else if(cache[userObj.email]) {
        body.err = Err.userEmailExist;
    }
    if(!checkUserName(userObj.name)) {
        body.err = Err.userNameErr;
    } else if(cache[userObj.name]) {
        body.err = Err.userNameExist;
    }
    if(body.err) return callback(body.err, body);
    delete userObj._id;
    userObj.avatar = gravatar(userObj.email);
    userObj.resetDate = Date.now();
    userDao.setNewUser(userObj, function(err, doc) {
        if(err) {
            body.err = Err.dbErr;
            errlog.error(err);
        }
        if(doc) {
            doc._id = userDao.convertID(doc._id);
            body = union(UserPrivateTpl);
            body = intersect(body, doc);
            body.err = null;
            cache._update(body);
        }
        return callback(err, body);
    });
};

function logout(req, res) {
    req.delsession();
    res.sendjson({
        logout: true
    });
};

function login(req, res) {
    var data = req.apibody;
    var _id = null,
        body = {};

    if(!cache[data.logname]) {
        if(checkEmail(data.logname)) body.err = Err.userEmailNone;
        else if(checkUserID(data.logname)) body.err = Err.UidNone;
        else if(checkUserName(data.logname)) body.err = Err.userNameNone;
        else body.err = Err.logNameErr;
        return res.sendjson(body);
    } else {
        _id = userDao.convertID(cache[data.logname]._id);
        userDao.getAuth(_id, function(err, doc) {
            if(err) {
                body.err = Err.dbErr;
                errlog.error(err);
            } else if(doc.locked) {
                body.err = Err.userLocked;
            } else if(doc.loginAttempts >= 5) {
                body.err = Err.loginAttempts;
                userDao.setUserInfo({
                    _id: _id,
                    locked: true
                }, function(err, doc) {
                    if(err) return errlog.error(err);
                    return userDao.setLoginAttempt({
                        _id: _id,
                        loginAttempts: 0
                    });
                });
            }
            if(body.err) {
                db.close();
                return res.sendjson(body);
            }
            if(data.logpwd === HmacSHA256(doc.passwd, data.logname)) {
                doc._id = userDao.convertID(doc._id);
                body = union(UserPrivateTpl);
                body = intersect(body, doc);
                req.session.Uid = body._id;
                req.session.role = body.role;
                if(doc.loginAttempts > 0) userDao.setLoginAttempt({
                    _id: _id,
                    loginAttempts: 0
                });
                var date = Date.now();
                userDao.setLogin({
                    _id: _id,
                    lastLoginDate: date,
                    login: {
                        date: date,
                        ip: req.ip
                    }
                });
            } else {
                body.err = Err.userPasswd;
                userDao.setLoginAttempt({
                    _id: _id,
                    loginAttempts: 1
                });
            }
            db.close();
            return res.sendjson(body);
        });
    }
};

function register(req, res) {
    var data = req.apibody;
    adduser(data, function(err, doc) {
        if(doc) {
            req.session.Uid = doc._id;
            req.session.role = doc.role;
            var userObj = {};
            userObj._id = userDao.convertID(doc._id);
            userObj.resetDate = Date.now();
            userObj.resetKey = SHA256(userObj.resetDate.toString());
            var resetUrl = HmacSHA256(HmacSHA256(userObj.resetKey, 'role'), doc.email);
            resetUrl = {
                request: 'role',
                email: doc.email,
                resetKey: resetUrl
            };
            resetUrl = new Buffer(JSON.stringify(resetUrl)).toString('base64');
            resetUrl = 'http://' + 'jsgen.org' + '/api/user/reset/' + resetUrl;
            userDao.setUserInfo(userObj, function(err) {
                db.close();
                if(err) {
                    errlog.error(err);
                } else email.sendRole(global.title, doc.name, doc.email, resetUrl);
            });
        } else db.close();
        return res.sendjson(doc);
    });
};

function addUsers(req, res) {
    var body = [];
    if(req.session.role === 'admin') {
        function addUserExec() {
            var userObj = req.apibody.shift();
            if(!userObj) return res.sendjson(body);
            adduser(userObj, function(err, doc) {
                if(err) {
                    body.push(doc);
                    return res.sendjson(body);
                }
                if(doc && !doc.err) {
                    body.push(doc);
                    addUserExec();
                }
            });
        };
        addUserExec();
    } else {
        body[0] = {
            err: Err.userRoleErr
        };
        return res.sendjson(body);
    }
};

function getUser(req, res) {
    var user = req.path[2];
    var Uid = null,
        body = {};

    if(checkUserID(user) && cache[user]) {
        Uid = user;
    } else if(checkUserName(user) && cache[user]) {
        Uid = cache[user]._id;
    } else {
        body.err = Err.UidNone;
        return res.sendjson(body);
    }
    if(Uid) userCache.getUser(Uid, function(err, doc) {
        if(err) {
            body.err = Err.dbErr;
            errlog.error(err);
        } else if(doc) {
            body = union(UserPublicTpl);
            body = intersect(body, doc);
        }
        db.close();
        return res.sendjson(body);
    });
};

function getUsers(req, res) {
    var array = [],
        p = 1,
        body = {
            pagination: {},
            data: []
        };

    if(req.session.role === 'admin') {
        if(!req.session.pagination) {
            req.session.pagination = {
                pagination: cache._initTime,
                total: cache._index.length,
                num: 20
            };
            paginationCache.put(req.session.pagination.pagination, cache._index);
        }
        if(req.getparam.n && req.getparam.n >= 1 && req.getparam.n <= 100) req.session.pagination.num = Math.floor(req.getparam.n);
        if(req.getparam.p && req.getparam.p >= 1) p = Math.floor(req.getparam.p);
        else p = 1;
        if(p === 1 && req.session.pagination.pagination !== cache._initTime) {
            req.session.pagination.pagination = cache._initTime;
            req.session.pagination.total = cache._index.length;
            paginationCache.put(req.session.pagination.pagination, cache._index);
        }
        array = paginationCache.get(req.session.pagination.pagination).slice((p - 1) * req.session.pagination.num, p * req.session.pagination.num);
        body.pagination.now = p;
        body.pagination.total = req.session.pagination.total;
        body.pagination.num = req.session.pagination.num;
        array.forEach(function(Uid, i, array) {
            userCache.getUser(Uid, function(err, doc) {
                var data = {};
                if(err) {
                    data.err = Err.dbErr;
                    errlog.error(err);
                } else if(doc) {
                    data = union(UserPublicTpl);
                    data = intersect(data, doc);
                    data.email = doc.email;
                }
                body.data.push(data);
                if(i === array.length - 1) {
                    db.close();
                    return res.sendjson(body);
                }
            });
        });
    } else {
        body.err = Err.userRoleErr;
        return res.sendjson(body);
    }
};

function getUserInfo(req, res) {
    var body = {};
    if(req.session.Uid) {
        userCache.getUser(req.session.Uid, function(err, doc) {
            if(err) {
                body.err = Err.dbErr;
                return res.sendjson(body);
            }
            if(doc) {
                body = doc;
                filterTags(body.tagsList, false, function(err, doc) {
                    if(doc) body.tagsList = doc;
                    return res.sendjson(body);
                });
            }
        });
    } else {
        body.err = Err.userNeedLogin;
        return res.sendjson(body);
    }
};

function editUser(req, res) {
    var defaultObj = {
        name: '',
        email: '',
        passwd: '',
        sex: '',
        avatar: '',
        desc: '',
        tagsList: ['']
    },
        body = {},
        userObj = {},
        setTagList = [];

    if(req.session.Uid) {
        userObj = union(defaultObj);
        userObj = intersect(userObj, req.apibody);
        userObj._id = userDao.convertID(req.session.Uid);
        if(userObj.name) {
            if(!checkUserName(userObj.name)) {
                body.err = Err.userNameErr;
            } else if(userObj.name === cache[req.session.Uid].name) {
                delete userObj.name;
            } else if(cache[userObj.name]) {
                body.err = Err.userNameExist;
            }
        }
        if(userObj.email) {
            if(!checkEmail(userObj.email)) {
                body.err = Err.userEmailErr;
            } else if(userObj.email === cache[req.session.Uid].email) {
                delete userObj.email;
            } else if(cache[userObj.email]) {
                body.err = Err.userEmailExist;
            }
        }
        if(userObj.sex) {
            if(userObj.sex !== 'male' && userObj.sex !== 'female') delete userObj.sex;
        }
        if(userObj.avatar) {
            if(!checkUrl(userObj.avatar)) delete userObj.avatar;
        }
        if(userObj.desc) userObj.desc = filterSummary(userObj.desc);
        if(userObj.tagsList) {
            filterTags(userObj.tagsList.slice(0, globalConfig.UserTagsMax), true, function(err, doc) {
                if(doc) userObj.tagsList = doc;
                userCache.getUser(req.session.Uid, function(err, doc) {
                    var tagList = {};
                    if(doc) doc.tagsList.forEach(function(x) {
                        tagList[x] = -userObj._id;
                    });
                    userObj.tagsList.forEach(function(x) {
                        if(tagList[x]) delete tagList[x];
                        else tagList[x] = userObj._id;
                    });
                    for(var key in tagList) setTagList.push({
                        _id: Number(key),
                        usersList: tagList[key]
                    });
                    daoExec();
                });
            });
        } else daoExec();

        function daoExec() {
            if(body.err) return res.sendjson(body);
            else return userDao.setUserInfo(userObj, function(err, doc) {
                if(err) {
                    body.err = Err.dbErr;
                    errlog.error(err);
                    return res.sendjson(body);
                } else {
                    doc._id = req.session.Uid;
                    body = union(UserPrivateTpl);
                    body = intersect(body, doc);
                    setCache(body);
                    if(setTagList.length > 0) setTagList.forEach(function(x) {
                        setTag(x);
                    });
                    filterTags(body.tagsList, false, function(err, doc) {
                        body = intersect(defaultObj, body);
                        if(doc) body.tagsList = doc;
                        return res.sendjson(body);
                    });
                }
            });
        };
    } else {
        body.err = Err.userNeedLogin;
        return res.sendjson(body);
    }
};

function editUsers(req, res) {};

function getReset(req, res) {};

function resetUser(req, res) {
    var body = {};
    var _id = null;
    try {
        var reset = JSON.parse(new Buffer(req.path[3], 'base64').toString());
        if(reset[email] && reset[request] && reset[resetKey]) {
            if(reset[Uid] && cache[reset[Uid]]) _id = userDao.convertID(cache[reset[Uid]]._id);
            else if(cache[reset[email]]) _id = userDao.convertID(cache[reset[email]]._id);
            else throw new Error(Err.resetInvalid);
            userDao.getAuth(_id, function(err, doc) {
                var userObj = {};
                userObj._id = _id;
                if(err) {
                    errlog.error(err);
                    throw new Error(Err.dbErr);
                } else if(doc && (Date.now() - doc.resetDate) / 86400000 < 3) {
                    if(HmacSHA256(HmacSHA256(doc.resetKey, reset[request]), reset[email]) === reset[resetKey]) {
                        switch(reset[request]) {
                        case 'locked':
                            userObj.locked = false;
                            break;
                        case 'role':
                            userObj.role = user;
                            break;
                        case 'email':
                            userObj.email = reset[email];
                            break;
                        case 'passwd':
                            userObj.passwd = SHA256(reset[email]);
                            break;
                        default:
                            throw new Error(Err.resetInvalid);
                        }
                        userDao.setUserInfo(userObj, function(err, doc) {
                            if(err) {
                                errlog.error(err);
                                throw new Error(Err.dbErr);
                            } else if(doc) {
                                doc._id = userDao.convertID(doc._id);
                                body = union(UserPrivateTpl);
                                body = intersect(body, doc);
                                setCache(body);
                                req.session.Uid = body._id;
                                req.session.role = body.role;
                                db.close();
                                return res.sendjson(body);
                            }
                        });
                    } else throw new Error(Err.resetInvalid);
                } else throw new Error(Err.resetOutdate);
            });
        } else throw new Error(Err.resetInvalid);
    } catch(e) {
        db.close();
        body.err = e.toString();
        return res.sendjson(body);
    }
};

function getFn(req, res) {
    switch(req.path[2]) {
    case undefined:
    case 'index':
        return getUserInfo(req, res);
    case 'logout':
        return logout(req, res);
    case 'admin':
        return getUsers(req, res);
    case 'reset':
        return resetUser(req, res);
    default:
        return getUser(req, res);
    }
};

function postFn(req, res) {
    switch(req.path[2]) {
    case undefined:
    case 'index':
        return editUser(req, res);
    case 'login':
        return login(req, res);
    case 'register':
        return register(req, res);
    case 'admin':
        return editUsers(req, res);
    default:
        return res.r404();
    }
};

module.exports = {
    GET: getFn,
    POST: postFn,
    cache: cache
};
