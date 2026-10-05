// Applied only to managed development services; Unix sockets keep their behavior.
const net = require("node:net");
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] && typeof args[0] === "object" && !args[0].path) {
    args[0] = { ...args[0], host: "127.0.0.1" };
  } else if (typeof args[0] === "number" || /^\d+$/.test(args[0])) {
    if (typeof args[1] === "string") args[1] = "127.0.0.1";
    else args.splice(1, 0, "127.0.0.1");
  }
  return listen.apply(this, args);
};
