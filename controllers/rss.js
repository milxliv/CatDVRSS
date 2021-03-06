/**
 * GET /rss/BreakingNews
 * Breaking News rss feed.
 */

var RSS = require('rss');
var http = require('http');
var when = require('when');
var config = require('../catdv_config');
var resParser = require('../libs/response-parser');
var mongoose = require('mongoose');
var validUrl = require('valid-url');
var stations = require('../config/stations');
var feeds = require('../config/feeds');
var cache_expiration = 1 * 1000 * 60; // 1 minute
var feedCache = {};


//define the schema
var feedItemSchema = new mongoose.Schema({
  feed: { type: String, default: 'Breaking News' },
  title: String,
  summary: String,
  link: String,
  created_at: Date,
  expires_at: Date //hours

});
//define the model based on the schema
var Item = mongoose.model('Item', feedItemSchema);

var catdv_url = config.catdv_url;
var catdv_port = config.catdv_port;
var catdv_user = config.catdv_user;
var catdv_pwd = config.catdv_pwd;
var api_path = config.api_path;
var api_version = config.api_version;
var catdv_pubkey = '';
var jsessionid = null;

//** NOTE catdv's provided library wont work because its client-side js requiring jquery
//var CatDV = require('../libs/catdv-api');
function login_catdv( callback , failed_callback){
	var options = {
	  host: catdv_url,
	  port: catdv_port,
	  //path: '/api/4/session?usr='+catdv_user+'&epwd='+encryptPwd(catdv_pwd, catdv_pubkey), // encryption function not working
	  path: api_path +'/' + api_version + '/session?usr='+catdv_user+'&pwd='+catdv_pwd, // not encrypted but doesnt matter once its running on same server (will be localhost)
	  //path: '/api/info',
	  method: 'GET'
	};

	if( jsessionid !== null ){
		return callback("Already Logged in");
	}
	console.log("no sess id logging in");
  console.log(options.path);
	var request = http.request(options, function(res) {
	  res.setEncoding('utf8');
	  res.on('data', function (chunk) {
	  	try{
	  		body = JSON.parse(chunk);
	  	}
	  	catch ( error ){
	  		console.log(chunk);
	  		return failed_callback(error);
	  	}
	  	if(body.status === "OK"){
			jsessionid = body.data.jsessionid;
	  		callback();
	  	}
	  	else {
	  		failed_callback(body.errorMessage);
	  	}
	  });
	  res.on('error', function(e) {
		  console.log('problem with request login_catdv: ' + e.message);
	  });
	});
	request.end();
	request.on("error", function(e){
	    // ECONNRESET error is triggered here...
	    console.info(e);
	});
}

function getPubKey( callback ){
  if(catdv_pubkey != '' && catdv_pubkey != null){
    callback(catdv_pubkey);
    return;
  }
	var options = {
	  host: catdv_url,
	  port: catdv_port,
	  path: api_path +'/' + api_version + '/session/key',
	  method: 'GET'
    // agent: false
	};
  console.log("http://" + options.host +  ":"  +  options.port +  ""  +  options.path);

	var request = http.request(options, function(res) {
	  res.setEncoding('utf8');
	  res.on('data', function (body) {
	  	catdv_pubkey = JSON.parse(body).data.key;
	    // console.log('pubkey: ' + catdv_pubkey);
		  callback(catdv_pubkey);
	  });
	  res.on('error', function(e) {
		  console.log('problem with request getPubKey: ' + e.message);
	  });
	});
	request.end();
	request.on("error", function(e){
	    // ECONNRESET error is triggered here...
	    console.info(e);
	});
}

//http://www.squarebox.com/server7-password-encryption/
function encryptPwd(pwd, pubkey){

	//http://userpages.umbc.edu/~rcampbel/NumbThy/Class/Programming/JavaScript/#PowMod
	function powmod(base,exp,modulus)
	{
		var accum=1, i=0, basepow2=base;
		while ((exp>>i)>0) {
			 if(((exp>>i) & 1) == 1){accum = (accum*basepow2) % modulus;};
			 basepow2 = (basepow2*basepow2) % modulus;
		 i++;
		};
		return accum;
	}

	//  c = powMod(m, e, n);

	//  e,n  -  the two large integer components of the public RSA key.
	//  m    -  the message converted to a large integer.
	//  c    -  the encrypted message as a large integer.

	return powmod( decodeURIComponent(escape(pwd)), pubkey.split(":")[0], pubkey.split(":")[1]);
}

function generateRSS(feedInfo, res){

	function getClipsFromCat(catalogID, num, callback){
		var options = {
		  host: catdv_url,
		  port: catdv_port,
		  path: api_path +'/' + api_version + '/clips;jsessionid='+jsessionid+'?filter=and((catalog.id)EQ('+catalogID+'))and((importSource.importedDate)newer('+feedInfo.newer+'))&include=userFields', //or((clip.recordedDate)newer(172800))', // OFF -- extra 0 for testing  OR &desc=recordedDate&take=50', //
		  method: 'GET'
      // agent: false
		};
		// console.log("http://" + options.host +  ":"  +  options.port +  ""  +  options.path);

		var request = http.request(options, function(res) {
		  var body = '';
		  res.setEncoding('utf8');
		  res.on('data', function (res) {
		  	body += res;
		  });
		  res.on('end', function(){
        try{
  		  	var clipsData = JSON.parse(body).data.items
  		  	for (index in clipsData) {
  		  		injectItem(feed, clipsData[index]);
    			}
          callback();
        }
        catch(exception){
          console.error(exception);
          catdv_pubkey = null;
          jsessionid = null;
          generateRSS(feedInfo, res);
        }
		  })
		  res.on('error', function(e) {
			  console.log('problem with request get Clips: ' + e.message);
		  });
		});
		request.end();
		request.on("error", function(e){
		    // ECONNRESET error is triggered here...
		    console.error(e);
		});
	}

	function getClip(clipID){
		var deferred = when.defer();
		var options = {
		  host: catdv_url,
		  port: catdv_port,
		  path: api_path +'/' + api_version + '/clips/'+clipID+';jsessionid='+jsessionid,
		  method: 'GET'
      // agent: false
		};
    // console.log("http://" + options.host +  ":"  +  options.port +  ""  +  options.path);



		var request = http.request(options, function(res) {
		  var body = '';
		  res.setEncoding('utf8');
		  res.on('data', function (res) {
		  	body += res
		  });
		  res.on('end', function(){
			deferred.resolve();
		  });
		  res.on('error', function(e) {
			  console.log('problem with request ' + clipData.ID + ': ' + e.message);
		  });
		});
		request.end();
		request.on("error", function(e){
		    // ECONNRESET error is triggered here...
		    console.info(e);
		});

		return deferred.promise
	}

	function getAddedItems(name, callback){
		//console.log(name);
		Item.find({feed: name})
		.where('expires_at').gt(Date.now())
		.exec(function(err, items){
			if(err) console.error(err);
			else{
				for (var i = 0; i < items.length; i++ ){
					var url = items[i].link;
				  if (!validUrl.isUri(url)){
			      url = "http://"+config.rss_host+":"+config.rss_port+"/rss/" +items[i].id;
				  }
					//console.log(items[i].title);
					feed.item({
					    title:  items[i].title,
					    description:  items[i].summary,
					    url:  url, //(typeof items[i].link !== "undefined" ? items[i].link : "/"), // link to the item
					    author: "Self",
					    date: items[i].created_at, // any format that js Date can parse.
					    guid: (typeof items[i].guid !== "undefined" ? items[i].guid : items[i].created_at.toFormat("YYMMDDHHMISSPP"))
					});
				}
			}
			callback();
		});
	}
	/* create an rss feed */
	var feed = new RSS({
	    title: 'E.W.Scripps ' + feedInfo.display,
	    description: feedInfo.display,
	    site_url: 'http://'+config.rss_host+':'+config.rss_port,
      feed_url: this.site_url+'/rss/feed?rss='+feedInfo.title,
	    //image_url: 'http://example.com/icon.png',
	    copyright: '2015 E.W. Scripps',
	    language: 'en',
	    ttl: '60',
	});

  //if it has not expired, send the recent data
  if(feedCache[feedInfo.display] && feedCache[feedInfo.display].cache_exp > Date.now()){
    console.log("sending cached data: " + feedInfo.display );
    var xml = feedCache[feedInfo.display].cahced_data.xml();
    res.set('Content-Type', 'application/rss+xml');
    res.send(xml);
    return;
  }
  console.log("data expired.. Getting new data: " + feedInfo.title );
	getClipsFromCat(feedInfo.catID, 20, function(){
			getAddedItems(feedInfo.display, function(){
        feedCache[feedInfo.display] = {};
        feedCache[feedInfo.display].cahced_data = feed;
        feedCache[feedInfo.display].cache_exp = Date.now() + cache_expiration;
				var xml = feed.xml();
			  res.set('Content-Type', 'application/rss+xml');
			  res.send(xml);
			});
		} );
}

function injectItem( feed, clipData){
	if(clipData.userFields !== null && typeof clipData.userFields !== "undefined" ){
		var description = "" ;
		description += "<br/>-Filename: " + clipData.name;
		description += "<br/>-Embargo: " + (clipData.userFields.U3 || "None");
		description += "<br/>-Script: " + (clipData.userFields.U1 || "No Script");
		description += "<br/>-Publish Notes: " + (clipData.userFields.U11 || "");
		description += "<br/>-Video Notes: " + (clipData.userFields.U4 || "");
		description += "<br/>-Modified Date: " + (clipData.modifiedDate || "");
		description = description.replace(/\n/g, "<br/>").replace(/\[pi\](.*?)\[\/pi\]/g, '<b>$1</b>').replace(/\[cc\](.*?)\[\/cc\]/g, '<i>$1</i>').replace(/\[.*?\]/g, ''); // : "No Script Found");

		feed.item({
	    title:  clipData.userFields.U5 + " " + (typeof clipData.userFields.U6 !== "undefined" && clipData.userFields.U6 !== "" ? clipData.userFields.U6 : clipData.name),
	    description: description,
	    url: 'http://'+catdv_url+':'+catdv_port+'/catdv/clip-details.jsp?id='+clipData.ID, // link to the item
	    author: clipData.userFields.U5, // optional - defaults to feed author property
	    date: (typeof clipData.modifiedDate !== null ? clipData.modifiedDate : Date.now()), // any format that js Date can parse.
	    guid: (typeof clipData.ID !== "undefined" ? clipData.ID : null)
		});
	}
  else console.log('clip ' + clipData.ID + ": NO USER FIELDS!!! SKIPPED!!")
}

function findFeedByName(name){
	for(var i = 0 ; i < feeds.length; i++){
		//console.log(feeds[i].title + " vs " + name);
		if(feeds[i].title === name) return feeds[i];
	}
	return null;
}

exports.getRSS  = function(req, res) {

	var feed = findFeedByName(req.query.rss)
  if(feed){
    getPubKey( function( key )
      {
        login_catdv(
          function()
          {
            generateRSS(feed, res);
          },
          function(){
            var msg = [{error: "Login_failed"}];
              res.set('Content-Type', 'application/json');
              res.send(msg);
          }
        );
      }
    );
   }
   else{
    var msg = [{error: "Feed not found: " + req.query.rss}];
    res.set('Content-Type', 'application/json');
    res.send(msg);
  }

};


exports.getItem  = function(req, res) {

	Item.findOne({_id : req.params.id}, function(err, item){
		if(err) return console.error(err);
		//console.log(items);
		res.render('rss/show', {
		    title: 'RSS', item: item,
		});
	});

};

exports.index = function(req, res) {
	Item.find({}).sort({"created_at": "descending"}).exec(
		function(err, items){
		if(err) return console.error(err);
		//console.log(items);
		res.render('rss/index', {
		    title: 'RSS', items: items, feeds: feeds
		});
	});

};


exports.createItem = function(req, res) {
	res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // HTTP 1.1.
	res.setHeader("Pragma", "no-cache"); // HTTP 1.0.
	res.setHeader("Expires", "0"); // Proxies.
  res.render('rss/new', {
    title: 'RSS - New Item', feeds: feeds, stations: stations, rss_host:  config.rss_host, rss_port: config.rss_port
  });

};


/**
 * POST /rss/newItem
 * create a new RSS item.
 */
exports.postItem = function(req, res) {
  req.assert('title', 'Title cannot be blank').notEmpty();
  req.assert('station', 'Station cannot be blank').notEmpty();
  req.assert('description', 'Description cannot be blank').notEmpty();
  req.assert('feed', 'Feed cannot be blank').notEmpty();
  req.assert('format', 'Format cannot be blank').notEmpty();
  req.assert('expires', 'Experation must be an integer in days').isInt();

  req.sanitize('title').escape();
  req.sanitize('station').escape();
  req.sanitize('summary').blacklist('\'"/')
  req.sanitize('summary').escape();
  req.body.description = req.body.description.replace(/(?:\n|\r|\n)/g, '<br />')
  //req.assert('link', 'Message cannot be blank').notEmpty();

  var errors = req.validationErrors();

  if (errors) {
    console.error(errors);
    req.flash('errors', errors);
    return res.redirect('/rss/newItem');
  }
  // console.log("Link: " + req.body.link)

  var summary = resParser.buildSummary(req.body);

  var thisItem = new Item({
  	feed: req.body.feed,
  	title: (req.body.station) + " " + (req.body.title),
  	summary: (summary),
  	link: req.body.link,
  	created_at: Date.now(),
  	expires_at: new Date(Date.now()).addDays(parseInt(req.body.expires)).getTime()
  });

  thisItem.save(function (err, thisItem) {
	  if (err){
      console.error(errors);
    	req.flash('errors', errors);
    	return res.redirect('/rss/newItem');
	  }
	  return res.redirect('/rss/');
  });
};


exports.deleteItem = function(req, res) {
  req.assert('id', 'ID cannot be blank').notEmpty();
  Item.find({ _id:req.body.id }).remove(function(err){
  	// console.log("Delete: " + req.body.id)
  	res.redirect('/rss');
  })

}
