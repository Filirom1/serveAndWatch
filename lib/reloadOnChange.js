// # reloadOnChange
//
// this one will use raw connect middleware application with socket.io 
// connection setup.
//
// It works by injecting a tiny client-side script on any `*.html` request (might be better
// if done on any `content-type: text/html`, this way it would be able to catch up requests,
// even those serving dynamic content, not just statics). That client side establish
// a new websocket connection and retrigger a page reload whenever the `changed` event is emitted.
//
var fs = require('fs'),
  path = require('path'),
  url = require('url'),
  socketio = require('socket.io'),
  logio = new (require('socket.io/lib/logger'))(),
  connect = require('connect'),
  mustache = require('mustache'),
  _ = require('underscore'),
  colors = require('colors'),
  coffee = require('coffee-script'), /* for watchr */
  watch = require('watchr').watch,
  mime = connect.static.mime,
  sockets = {},
  // one time-hit, get the file content of the socket.io client side script
  ioScript = (function() {
    var template = fs.readFileSync(path.join(__dirname, '../util/socket-enable.js'), 'utf8');
    // emulate a precompiled mustache template, mainly trying to keep
    // the same usage as a precompiled underscore or handlebar template.
    return function() {
      return mustache.to_html(template, arguments[0], arguments[1]);
    };
  })();


module.exports = function(dirToWatch, server){
  if(!fs.statSync(dirToWatch)) return console.error('Unable to watch ' + dirToWatch, err.message);
  watch(dirToWatch, _.debounce(emit, 100));

  // setup socketio
  var io = socketio.listen(server);
  io.enable('browser client minification');
  io.enable('browser client etag');
  io.enable('browser client gzip');
  io.set('log level', 1);

  // store the socket object in grunt's config, so that we can interract from other tasks
  io.sockets.on('connection', function(socket) {
    // should support multiple-connections
    // raw first attempt

    // should also catch up client disconnection and clean
    // the stored socket
    socket.on('disconnect', function() {
      console.log(('[socket.io] Remove client ' + socket.id).grey);
      if(sockets[socket.id]) delete sockets[socket.id];
      // restore sockets back in config
    });

    console.log(('[socket.io] Add client ' + socket.id).grey);
    sockets[socket.id] = socket;
  });

  return function reloadOnChange(req, res, next) {
    // serve any static *.html, support of `index.html`
    var parsed = url.parse(req.url),

      // join / normalize from root dir
      filepath = path.normalize(path.join(dirToWatch, decodeURIComponent(parsed.pathname))),

      // index.html support when trainling `/`
      index = path.normalize('/') === filepath.charAt(filepath.length - 1),

      ioResponse;

    if(index) filepath += 'index.html';

    // deal with our special socket.io client-side script
    if(path.basename(filepath) === 'socket-enable.js') {
      res.setHeader('Content-Type', mime.lookup('js'));
      ioResponse = ioScript({});
      res.setHeader('Content-Length', ioResponse.length);
      return res.end(ioResponse);
    }

    fs.stat(filepath, function(e, stat) {
      // files do not exists, next with error only on unexpected errors
      if(e) return next((e.code === 'ENOENT' || 'ENAMETOOLONG' === e.code) ? null : e);

      // file is a dir, next to the directory listing if enabled
      if(stat.isDirectory()) return next();

      // anything that's not `*.html`, give back control to static / directory listing middleware
      if(path.extname(filepath) !== '.html') return next();

      // setup some basic headers, might add some. Below is pretty minimalist (might tweak and add
      // basic caching stuff for example)
      res.setHeader('Content-Type', mime.lookup(filepath));

      // can't use the ideal stream / pipe case, we need to alter the html response
      // by injecting that little socket.io client-side app.
      fs.readFile(filepath, 'utf8', function(e, body) {
        if(e) return next(e);

        body = body.replace(/<\/body>/, function(w) {
          return [
            '  <script defer src="/socket.io/socket.io.js"></script>',
            '  <script defer src="/socket-enable.js"></script>',
            w
          ].join('\n');
        });

        //res.setHeader('Content-Length', body.length);
        res.end(body);
      });
    });
  };
};

// basic reload tasks, works in tandem with serve task
function emit(){
  console.log('Changes detected'.grey);
  var errors = [];
  if(_.isEmpty(sockets)) return console.error('No client connected to socket.io');
  Object.keys(sockets).forEach(function(s) {
    if(errors.length) return sockets[s].emit('error', errors);
    console.log('[socket.io] reload clients'.grey);
    sockets[s].emit('changed');
  });
}