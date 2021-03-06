var fs = Npm.require('fs');
var child_process = Npm.require('child_process');

var querystring = Npm.require('querystring');
var urlParser = Npm.require('url');

// list of bot user agents that we want to serve statically, but do
// not obey the _escaped_fragment_ protocol. The page is served
// statically to any client whos user agent matches any of these
// regexps. Users may modify this array.
//
// An original goal with the spiderable package was to avoid doing
// user-agent based tests. But the reality is not enough bots support
// the _escaped_fragment_ protocol, so we need to hardcode a list
// here. I shed a silent tear.
Spiderable.userAgentRegExps = [
    /^facebookexternalhit/i, /^linkedinbot/i, /^twitterbot/i];

// how long to let phantomjs run before we kill it
var REQUEST_TIMEOUT = 15*1000;
// maximum size of result HTML. node's default is 200k which is too
// small for our docs.
var MAX_BUFFER = 5*1024*1024; // 5MB

Spiderable.CACHE_TIME = 30 * 24 * 60 * 60 * 1000; // 30 days

// Exported for tests.
Spiderable._urlForPhantom = function (siteAbsoluteUrl, requestUrl) {
  // reassembling url without escaped fragment if exists
  var parsedUrl = urlParser.parse(requestUrl);
  var parsedQuery = querystring.parse(parsedUrl.query);
  delete parsedQuery['_escaped_fragment_'];

  var parsedAbsoluteUrl = urlParser.parse(siteAbsoluteUrl);
  // If the ROOT_URL contains a path, Meteor strips that path off of the
  // request's URL before we see it. So we concatenate the pathname from
  // the request's URL with the root URL's pathname to get the full
  // pathname.
  if (parsedUrl.pathname.charAt(0) === "/") {
    parsedUrl.pathname = parsedUrl.pathname.substring(1);
  }
  parsedAbsoluteUrl.pathname = urlParser.resolve(parsedAbsoluteUrl.pathname,
                                                 parsedUrl.pathname);
  parsedAbsoluteUrl.query = parsedQuery;
  // `url.format` will only use `query` if `search` is absent
  parsedAbsoluteUrl.search = null;

  return urlParser.format(parsedAbsoluteUrl);
};

var PHANTOM_SCRIPT = Assets.getText("phantom_script.js");

var SpiderCache = new Meteor.Collection(
    "meteor_spiderable_cache");
// , {
        // _preventAutopublish: true,
        // connection: Meteor.connection
    // });
SpiderCache._ensureIndex({url: 1}, {unique: true});

WebApp.connectHandlers.use(function (req, res, next) {
  // _escaped_fragment_ comes from Google's AJAX crawling spec:
  // https://developers.google.com/webmasters/ajax-crawling/docs/specification
  // This spec was designed during the brief era where using "#!" URLs was
  // common, so it mostly describes how to translate "#!" URLs into
  // _escaped_fragment_ URLs. Since then, "#!" URLs have gone out of style, but
  // the <meta name="fragment" content="!"> (see spiderable.html) approach also
  // described in the spec is still common and used by several crawlers.
  if (/\?.*_escaped_fragment_=/.test(req.url) ||
      _.any(Spiderable.userAgentRegExps, function (re) {
        return re.test(req.headers['user-agent']); })) {

    var url = Spiderable._urlForPhantom(Meteor.absoluteUrl(), req.url);

    // This string is going to be put into a bash script, so it's important
    // that 'url' (which comes from the network) can neither exploit phantomjs
    // or the bash script. JSON stringification should prevent it from
    // exploiting phantomjs, and since the output of JSON.stringify shouldn't
    // be able to contain newlines, it should be unable to exploit bash as
    // well.
    var phantomScript = "var url = " + JSON.stringify(url) + ";" +
          PHANTOM_SCRIPT;

    // Run phantomjs.
    //
    // Use '/dev/stdin' to avoid writing to a temporary file. We can't
    // just omit the file, as PhantomJS takes that to mean 'use a
    // REPL' and exits as soon as stdin closes.
    //
    // However, Node 0.8 broke the ability to open /dev/stdin in the
    // subprocess, so we can't just write our string to the process's stdin
    // directly; see https://gist.github.com/3751746 for the gory details. We
    // work around this with a bash heredoc. (We previous used a "cat |"
    // instead, but that meant we couldn't use exec and had to manage several
    // processes.)

      var cache = SpiderCache.findOne({url: JSON.stringify(url)});
      if (cache && (new Date() - cache.date < Spiderable.CACHE_TIME)) {
          res.writeHead(200, {'Content-Type': 'text/html; charset=UTF-8'});
          res.end(cache.html);
      } else {

          runFile = Meteor._wrapAsync(child_process.execFile)
          try {
              var stdout = runFile(
                  '/bin/bash',
                  ['-c',
                   ("exec phantomjs --load-images=no --disk-cache=true /dev/stdin <<'END'\n" +
                    phantomScript + "END\n")],
                  {timeout: REQUEST_TIMEOUT, maxBuffer: MAX_BUFFER});
              
              // function (error, stdout, stderr) {
              // if (!error && /<html/i.test(stdout)) {
              SpiderCache.upsert({url: JSON.stringify(url)}, {
                  url: JSON.stringify(url), 
                  html: stdout,
                  date: new Date()
              });
              res.writeHead(200, {'Content-Type': 'text/html; charset=UTF-8'});
              res.end(stdout);
              // } else {
              // phantomjs failed. Don't send the error, instead send the
              // normal page.
          } catch (e) {
              
              Meteor._debug("spiderable: phantomjs not installed. Download and install from http://phantomjs.org/");
              // Meteor._debug(e);
              next();
          }
      }

      // });
  } else {
    next();
  }
});
